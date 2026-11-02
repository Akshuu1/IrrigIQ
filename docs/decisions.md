# Architecture Decisions & Weather Provider Research

## ADR 001: Open-Meteo Forecast API Integration

### Context

IrrigIQ requires accurate, daily agricultural weather data—specifically Reference Evapotranspiration ($ET_0$), precipitation, maximum temperature, and minimum temperature—for small farms across India.

### Provider Analysis: Open-Meteo Forecast API

Open-Meteo provides a free-tier, open-access weather API utilizing national meteorological models (DWD, NOAA, ECMWF) with precomputed FAO-56 Penman-Monteith reference evapotranspiration.

#### 1. Exact Parameter Names

- **Endpoint**: `https://api.open-meteo.com/v1/forecast`
- **Query Parameters**:
  - `latitude`: Decimal latitude (e.g. `26.9`)
  - `longitude`: Decimal longitude (e.g. `75.8`)
  - `daily`: Comma-separated list of daily aggregated metrics:
    - `et0_fao_evapotranspiration`: Daily sum of Reference Evapotranspiration according to the FAO-56 Penman-Monteith equation (unit: `mm`).
    - `precipitation_sum`: Total daily precipitation (rain, showers, snow) (unit: `mm`).
    - `temperature_2m_max`: Maximum daily air temperature at 2 meters above ground (unit: `°C`).
    - `temperature_2m_min`: Minimum daily air temperature at 2 meters above ground (unit: `°C`).
  - `timezone`: `Asia/Kolkata` (mandatory for daily aggregation aligning with Indian Standard Time UTC+05:30).
  - `forecast_days`: Number of days to return (1–16 days, typically 7).

#### 2. Terms of Use & Limits

- **License & Attribution**: Distributed under the Creative Commons Attribution 4.0 International (CC BY 4.0) license. Usage requires visible attribution to Open-Meteo (e.g., _"Weather data by Open-Meteo.com"_).
- **Non-Commercial Tier**: Free for non-commercial, educational, and public research use without an API key.
- **Rate Limits**:
  - 10,000 calls per day
  - 5,000 calls per hour
  - 600 calls per minute
- **Call Weighting**: Requesting $\le 10$ daily variables and a duration of $\le 14$ days counts as a single standard request (1.0 weight).

---

## ADR 002: Reliability, Caching & Concurrency Strategy

To guarantee uptime and minimize external dependency risk, the weather subsystem adheres to the following principles:

1. **Spatial Aggregation via Grid Cells**:
   - Coordinates are rounded to 0.1 degree ($\approx 11 \text{ km}$ grid resolution in India) using `weatherCellKey(lat, lon)`.
   - Multiple neighbouring fields share the same weather forecast cell, preventing redundant upstream queries.

2. **6-Hour Freshness Window**:
   - Daily weather forecasts update 1 to 4 times a day upstream. Forecasts fetched within the past 6 hours are served directly from the MongoDB `WeatherDay` cache collection.

3. **Redis Distributed Locking (Stampede Prevention)**:
   - To prevent upstream hammering when a cache entry expires (cache stampede), a Redis mutex (`lock:weather:{cellKey}`) is acquired per cell with a 10-second TTL.
   - Double-checked locking pattern: after acquiring the lock, the worker re-checks the cache in case another concurrent request just completed the fetch.

4. **Resilience & Timeout Policies**:
   - Request timeout: **5 seconds** enforced via `AbortController`.
   - Retry policy: **1 retry** after a short delay (300 ms).
   - Graceful degradation: If upstream fails (timeout or HTTP 5xx), the system serves the latest cached days with `stale: true`. If no cache exists, a structured domain error is returned without crashing the process.

5. **Hargreaves Fallback for $ET_0$**:
   - If Open-Meteo returns null/missing for `et0_fao_evapotranspiration` on any day, the system computes $ET_0$ locally using the FAO-56 Hargreaves formula from `@irrigiq/shared` (`hargreavesEt0(tmax, tmin, lat, dayOfYear)`) and tags the day's source as `'hargreaves'`.

---

## ADR 003: Irrigation Recommendation Engine & Distributed Scheduler

### Context

IrrigIQ must provide daily actionable irrigation advice (e.g. irrigate $X$ mm or skip) tailored to smallholder farmers in India. The recommendation engine needs to balance scientific rigor (FAO-56 water balance, soil texture triggers, method efficiencies) with reliability, high-throughput daily execution, and offline/resilient scheduling.

### Decision & Architectural Implementation

1. **Pure Shared Science in `@irrigiq/shared`**:
   - `buildDailyNeeds(field, weatherDays)`: Computes daily crop coefficients ($K_c$), crop evapotranspiration ($ET_c = ET_0 \times K_c$), effective rainfall ($P_{\text{eff}}$), and net crop requirement ($\max(0, ET_c - P_{\text{eff}})$).
   - `planIrrigation(field, dailyNeeds, lastIrrigationDate?, sensorReading?)`: Simulates cumulative soil moisture deficit. When accumulated deficit reaches or exceeds the soil trigger threshold (`triggerMm`: Sandy 12mm, Loam 20mm, Clay 25mm), an irrigation event is scheduled for $\min(\text{deficit}, \text{maxDepthMm})$.
   - **Application Efficiency**: The gross water applied adjusts for irrigation method efficiency (Drip 90%, Sprinkler 75%, Flood 60%). Volumetric water requirement is calculated in litres via $\text{litres} = \text{grossMm} \times \text{areaHa} \times 10,000$.
   - **Sensor Overrides**:
     - Soil moisture $\ge 80\%$: Farm is waterlogged/sufficient; forces `skip` with key `reason.sensor_wet`.
     - Soil moisture $\le 40\%$: Farm is experiencing water stress; forces immediate irrigation capped at `maxDepthMm` with key `reason.sensor_dry`.
   - **Rain Rule**: If forecast precipitation $\ge 5\text{ mm}$, irrigation is skipped with key `reason.rain_expected`.
   - **Explainability**: `explain(plan)` returns structured translation keys and numeric parameters (e.g., `reason.deficit_reached { mm }`, `reason.not_needed`) ensuring i18n support without dynamic string concatenation.

2. **Idempotent Data Persistence**:
   - The `Recommendation` collection enforces a unique compound index on `{ fieldId: 1, forDate: 1 }`.
   - `recomputeField(fieldId)` generates 7 days of recommendations and writes them via MongoDB `bulkWrite` with `updateOne(..., { upsert: true })`. Running recomputation twice produces identical rows without duplicates or race conditions.

3. **Distributed Job Scheduling via BullMQ 6**:
   - In `apps/api/src/scheduler/recommendation.scheduler.ts`, BullMQ 6's `upsertJobScheduler` configures a repeatable cron job at `05:00` in the `Asia/Kolkata` timezone (`0 5 * * *`).
   - **Two-phase Batch Pipeline**:
     - Phase A: Collects all unique grid cells across all fields and refreshes weather forecasts upstream once per cell.
     - Phase B: Queries fields in memory-efficient batches of 50. Each field recomputation is wrapped in isolated exception handling—a failing or corrupted field is logged with context and skipped without halting or aborting the batch.

4. **Triggers & Rate Limiting**:
   - Automatic recomputation triggers asynchronously upon field creation and field updates.
   - On-demand recomputation endpoint `POST /fields/:id/recommendations/recompute` is protected by a Redis sliding-window rate limiter (10 requests per 15 minutes per IP/user) with in-memory fallback.
   - Endpoints strictly enforce user ownership checks across all tenants.

---

## ADR 004: Irrigation Logging, Deficit Reset & Honest Savings Accounting

### Context

IrrigIQ must track actual irrigation applications made by the farmer, use them to reset the ongoing soil moisture deficit, and compute transparent water savings compared to the farmer's self-reported baseline routine.

### Decision & Architectural Implementation

1. **Irrigation Log Subsystem**:
   - The `IrrigationLog` model tracks `{ fieldId, userId, date, appliedMm, source, note }`.
   - Sources are constrained to `'recommended'` (farmer followed IrrigIQ recommendation) or `'manual'` (farmer made an ad-hoc adjustment).
   - Logging or deleting an irrigation event automatically triggers `recomputeField(fieldId)`. In `recomputeField`, the most recent irrigation date ($\le \text{today}$) is passed to `planIrrigation`, resetting the deficit counter and recalculating future advice.

2. **Shared Water Accounting (`@irrigiq/shared/src/savings.ts`)**:
   - **Baseline Water Use**:
     $$\text{baselineCount} = \lfloor \text{daysInRange} / \text{baseline.everyDays} \rfloor$$
     $$\text{baselineMm} = \text{baselineCount} \times \text{baseline.depthMm}$$
     $$\text{baselineLitres} = \text{mmToLitres}(\text{baselineMm}, \text{areaHa})$$
   - **Recommended Total**: Sum of gross mm and litres for all days within the range where `action === 'irrigate'`.
   - **Actual Total**: Sum of gross mm and litres recorded in the `IrrigationLog` collection for the date range.
   - **Potential Savings**:
     $$\text{potentialSavedLitres} = \text{baselineLitres} - \text{recommendedLitres}$$
   - **Realised Savings**:
     $$\text{realisedSavedLitres} = \text{baselineLitres} - \text{actualLitres}$$

3. **Honest Reporting of Negative Savings**:
   - If actual water applied exceeds baseline water use (e.g. over-irrigation or severe drought), realised savings are negative (e.g. $-300,000\text{ litres}$, $-33.33\%$).
   - Savings are never clamped at 0 or hidden. Farmers and agronomists receive an honest, transparent account of water balance.

4. **Assumptions & Farmer Context Transparency**:
   - The `GET /fields/:id/savings?from&to` endpoint returns the underlying engineering assumptions (method application efficiency: Drip 0.90, Sprinkler 0.75, Flood 0.60; field area; baseline parameters) and explicitly notes that the baseline is the farmer's self-reported routine prior to using IrrigIQ.

---

## ADR 005: Sensor Integration, Time Series Storage, SSE & Moisture Simulation

### Context

Real-time field monitoring requires ingesting high-frequency soil moisture and temperature readings from physical or simulated probes, streaming live telemetry to the UI, downsampling long histories for charting, and reacting automatically to moisture extremes (water stress $\le 40\%$ or saturation $\ge 80\%$).

### Decision & Architectural Implementation

1. **Sensor Identity & One-Way Key Hashing**:
   - Sensor identity is tracked in `Sensor` with `{ fieldId, userId, name, apiKeyHash, isSimulated, lastSeenAt }`.
   - On sensor creation (`POST /fields/:id/sensors`), a cryptographically secure 24-byte hex key (`iq_sn_...`) is generated and presented to the client **once**.
   - Only its SHA-256 hash is persisted in MongoDB. Incoming telemetry (`POST /sensor-readings`) authenticates via the `x-api-key` header.
   - Field boundaries are enforced strictly on the server: telemetry metadata (`fieldId`, `sensorId`) is bound directly to the authenticated sensor document, preventing any probe from spoofing or writing data to another field.

2. **MongoDB Time Series Collection**:
   - Telemetry documents are stored in the `SensorReading` collection configured as a native MongoDB time series collection:
     ```ts
     timeseries: {
       timeField: 'timestamp',
       metaField: 'metadata',
       granularity: 'seconds',
     },
     expireAfterSeconds: 7776000 // 90 days automatic TTL expiration
     ```
   - Eliminates manual index pruning and provides columnar compression optimized for sensor telemetry.

3. **Real-time Server-Sent Events (SSE)**:
   - `GET /fields/:id/moisture/stream` opens an authenticated persistent event stream (`text/event-stream`).
   - Supports both `Authorization: Bearer` and `?token=` query authentication (enabling native browser `EventSource` usage).
   - Keeps connections alive across reverse proxies with a comment heartbeat (`: heartbeat\n\n`) every 25 seconds.
   - Cleans up subscriptions and timers on client disconnect.

4. **Adaptive Downsampling for Analytics**:
   - `GET /fields/:id/moisture?from&to` analyzes the requested query span:
     - For short spans ($\le 24\text{ hours}$), raw sensor points are returned sorted chronologically.
     - For wide spans ($> 24\text{ hours}$), an aggregation pipeline groups readings using `$dateTrunc` into 1-hour or 1-day buckets (`avgMoisture`, `avgTemp`, `count`), ensuring bounded payload sizes regardless of query length.

5. **Threshold-Crossing Debounced Recomputation**:
   - When moisture crosses into water stress ($\le 40\%$) or saturation ($\ge 80\%$), an irrigation plan recomputation is triggered.
   - A Redis distributed lock (`debounce:recompute:${fieldId}`) with a 60-second TTL prevents rapid fluctuations from firing duplicate recomputation jobs.

6. **Physics-Based CLI Simulator (`apps/simulator`)**:
   - Simulates diurnal evapotranspiration based on FAO-56 crop stage $ET_c$, active root zone holding capacity, sun angle weighting, temperature cycles, rainfall, and farmer irrigation triggers.
   - Speed configuration `--speed 60` simulates 1 farm day per minute.

---

## ADR 006: Map Tile Provider and Usage Policy

### Context

Phase 9 introduces the interactive map wizard for farmers to draw and inspect agricultural field boundaries using Leaflet and `@geoman-io/leaflet-geoman-free`. An underlying raster tile layer is required for spatial orientation across India. We must select a tile provider with clear terms of use that support open-source, non-bulk interactive map rendering.

### Decision

We use the **OpenStreetMap (OSM) Standard Tile Layer**:

- **Tile URL Template**: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Attribution**: `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`
- **Max Zoom**: 19
- **Compliance with OSM Tile Usage Policy**:
  1. **Strictly On-Demand / No Bulk Pre-fetching**: Tiles are requested strictly as the user pans or zooms in their browser. As explicitly prohibited by the OSM Tile Usage Policy, IrrigIQ **does not** scrape, bulk-download, or store tile raster grids in offline caches or databases.
  2. **Offline Graceful Degradation**: When offline in PWA mode, the field boundary polygon and recommendations are rendered directly on an interactive SVG/canvas canvas without requesting background tiles.
  3. **Attribution & Referer**: Every map instance prominently renders standard OpenStreetMap attribution and standard browser referer headers.
