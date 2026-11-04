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
    - `wind_speed_10m_max`: Daily maximum wind speed at 10 meters above ground (unit: `km/h`). Required by Phase 17 to detect high-wind spray drift risk (> 20 km/h) for sprinkler irrigation scheduling.
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

---

## ADR 007: Field Detail Page Architecture & Live Telemetry

### Context

Phase 10 provides the primary operational interface for smallholder farmers to inspect 7-day irrigation advisories, monitor live soil moisture from physical/simulated sensors, record executed irrigation events, and view cumulative water savings.

### Decision & Architectural Implementation

1. **7-Day Advisory & Scientific Breakdown**:
   - Visual dual-bar chart (`apps/web/src/pages/field-detail/PlanForecastSection.tsx`) implemented with Recharts comparing daily crop water demand ($ET_c$) with precipitation forecast.
   - Irrigation scheduled days (`action === 'irrigate'`) are highlighted with distinct markers and badges.
   - Accompanying tabular breakdown displays date, $ET_c$, forecast rain, action chip, and scientific justification translated via i18n parameter interpolation (e.g. `reason.deficit_reached`, `reason.rain_expected`).

2. **Today's Actionable Big Answer (`TodayAdvisoryCard.tsx`)**:
   - Prominently showcases whether to irrigate or skip today, recommended depth in mm, total volume in litres, and best application window (`"before 8:00 AM"` / `"सुबह 8:00 बजे से पहले"`).
   - Features a primary `"I Irrigated"` action button opening a pre-filled logging modal.

3. **Optimistic Irrigation Logging (`IrrigationLogModal.tsx` & `RecentLogsTable.tsx`)**:
   - Submitting an irrigation log optimistically updates TanStack Query cache and triggers asynchronous recomputation on the backend (`POST /fields/:id/logs`).
   - Recomputation resets the cumulative soil moisture deficit, automatically recalculating the 7-day schedule and water savings.
   - Log entries can be deleted with optimistic removal and subsequent deficit restoration.

4. **Real-time Soil Moisture Telemetry (`SoilMoistureLiveSection.tsx`)**:
   - Employs native browser `EventSource` connecting to `GET /fields/:id/moisture/stream?token=...`.
   - Automatic reconnect handler recovers from network disconnects with a 4-second delay.
   - Moisture readings are categorized into high-contrast status chips: Dry ($\le 40\%$), Optimal ($40\% < \text{moisture} < 80\%$), and Saturated ($\ge 80\%$).
   - Sensor provisioning allows generating cryptographically secure API keys (`iq_sn_...`) displayed strictly once with one-click clipboard copying.

5. **Transparent Water Savings (`SavingsCard.tsx`)**:
   - Compares baseline routine water usage against IrrigIQ recommended and farmer actual water applications.
   - Reports both potential and realised savings in litres and percentage, preserving negative values without artificial clamping.
   - Includes an assumptions breakdown detailing irrigation method efficiency, farmer baseline interval and depth, and total land area.

---

## ADR 008: Offline-First Architecture, Workbox PWA, IndexedDB & Idempotent Sync Queue

### Context

Indian smallholder farmers frequently experience intermittent, low-bandwidth, or completely absent cellular connectivity while in the field. The application must function offline reliably: allowing farmers to review cached field advisories, inspect crop requirements, log irrigation events locally, and make field boundary or parameter edits. Once connectivity returns, changes must synchronize seamlessly with optimistic conflict resolution, zero data duplication, and strict multi-tenant privacy.

### Decision & Architectural Implementation

1. **Progressive Web App (PWA) & Workbox Service Worker**:
   - Configured via `vite-plugin-pwa` with Google Workbox.
   - App shell (HTML, CSS, JS bundles, and static assets) is precached for instantaneous offline loading.
   - Runtime caching policies:
     - `StaleWhileRevalidate` with a 24-hour expiration for read-heavy domain endpoints: `/fields`, `/crops`, and recommendations.
     - `NetworkFirst` (3s timeout) for session validation endpoints (`/auth/me`).
   - Compliant with ADR 006: Map raster tiles are never precached or bulk-downloaded; offline map views render field boundaries using standalone vector SVG geometry (`OfflineFieldMap.tsx`).

2. **Client-Side Storage with IndexedDB (`idb`)**:
   - Structured IndexedDB database (`irrigiq-offline-db`) managing dedicated stores:
     - `fields`: Cached field metadata, geometry, and version numbers.
     - `plans`: Cached 7-day irrigation recommendations.
     - `crops`: Crop agronomic profiles and coefficients.
     - `preferences`: User settings (language, preferred units).
     - `mutationQueue`: FIFO queue of offline operations.
     - `fieldDrafts`: Conflict staging store for divergent field edits.
   - **Multi-Tenant Cache Clearing**: On logout, `clearAllUserData()` purges all IndexedDB stores and purges all CacheStorage entries (`caches.delete`), preventing cross-account data leakage on shared devices.

3. **Offline Mutation Queue & TanStack Query Configuration**:
   - When offline, irrigation logs and field edits assign a client-generated UUID (`clientId`) and enter `mutationQueue`.
   - TanStack Query v5 `networkMode` is configured to `'always'` across default query/mutation options, preventing mutations from being paused when the browser detects `navigator.onLine === false`.
   - `flushQueue()` runs automatically on browser `online` events, application initialization, and explicit farmer-triggered "Sync now" buttons.

4. **Idempotent Backend Batch Sync (`POST /sync`)**:
   - Accepts a batch of pending client mutations `{ clientId, type, entityId, payload, timestamp }`.
   - Backed by the `SyncRecord` collection with a unique compound index `{ userId: 1, clientId: 1 }` and a 30-day automatic TTL expiration.
   - Resubmitted requests return stored results, ensuring network retries never generate duplicate irrigation logs or corrupted field versions.
   - Successful irrigation logs reset cumulative deficit and trigger asynchronous recomputation.

5. **Version-Based Concurrency & Visual Conflict Resolution**:
   - Every `Field` document maintains an integer `version` incremented on every update.
   - If a client mutation sends a stale version, `apps/api` rejects the update with `status: 'conflict'`.
   - The web app persists the conflicting modification in `fieldDrafts` and prompts the user via `ConflictResolutionModal`, comparing local drafts with current server values so the farmer can consciously choose "Keep mine" or "Use server".

---

## ADR 009: PDF Report Generation, Devanagari Complex Text Shaping & Headless Chromium

### Context

Phase 12 requires exporting professional irrigation advisory and water savings reports in both English and Hindi. The document incorporates farmer details, scientific water accounting summaries, daily weather and recommendation tables, engineering assumptions, mandatory disclaimers, and an embedded multi-series daily bar chart.

A critical engineering challenge in Hindi PDF generation is **Complex Text Layout (CTL)**. Indic scripts like Devanagari require OpenType glyph substitution and positioning (GSUB/GPOS) to correctly form ligatures, conjuncts (e.g., `क्ष`, `त्र`, `ज्ञ`, `श्र`, `दृ`, `ष्ट`), and pre-base vowel signs (such as the 'ि' matra in `सिंचाई` or `कृषि`). Standard PDF generation engines (e.g. PDFKit, jsPDF) lack a native HarfBuzz shaping engine, causing Devanagari letters to render out-of-order and broken.

### Prototype Evaluation & Font Verification

We benchmarked pure PDF generation against headless Chromium with the open-licensed `Noto Sans Devanagari` font:

1. **PDFKit / jsPDF Shaping Failure**:
   - In standard PDF generation libraries, Devanagari glyphs are output in raw Unicode stream order without OpenType glyph repositioning.
   - Words such as `"सिंचाई"` render incorrectly as `"स िक ं च ा ई"` (the short 'i' matra appears after the consonant instead of before it). Conjuncts fail to form ligatures.
2. **Headless Chromium with Noto Sans Devanagari**:
   - Headless Chromium bundles the full HarfBuzz layout engine and Blink layout renderer.
   - Embedding `Noto Sans Devanagari` (OFL licensed) via base64 `@font-face` renders complex Hindi conjuncts, matras, and typography identically to a modern browser.
   - Enables responsive HTML/CSS layouts, crisp typography, and native SVG charts without needing canvas conversion or rasterization.

### Resource & Memory Cost Analysis

During prototype profiling on a macOS/Linux container runtime:
- **Execution Time**: ~1,100 ms – 1,400 ms per generated report.
- **Process Memory Footprint**:
  - Resident Set Size (RSS) delta per render: **~8.2 MB**.
  - Total Chromium process heap: **~38 MB – 48 MB** while rendering.
- **CPU Overhead**: Spikes to ~35% on a single core for ~900 ms during page rendering and PDF serialization.

### Architectural Decision

1. **HTML-to-PDF via Headless Chromium**:
   - We generate reports by compiling a self-contained HTML page containing inline base64-encoded `Noto Sans Devanagari`, styled tables, summary cards, and an embedded vector `<svg>` bar chart, rendered via Playwright's headless Chromium (`page.pdf({ format: 'A4', printBackground: true })`).
2. **Dual-Mode Execution (Sync Fast-Path + BullMQ Async)**:
   - Report requests are initiated via `POST /fields/:id/reports`.
   - If rendering completes within **2,000 ms**, the response returns HTTP 201 Created immediately with the report object.
   - If rendering takes longer than 2,000 ms, the API returns HTTP 202 Accepted with a report ID. The generation job continues asynchronously in the BullMQ `reports` queue, and the frontend polls `GET /reports/:id` until `status === 'completed'`.
3. **Multi-Tenant Ownership & PDF Streaming**:
   - Report documents and binaries are strictly scoped to `userId` and `fieldId`.
   - `GET /reports/:id/pdf` validates ownership before streaming the PDF binary with `Content-Type: application/pdf` and `Content-Disposition: inline`.

---

## ADR 010: Production Deployment Architecture, Hosting Limits & 05:00 AM Scheduler Reliability

### Context

Deploying IrrigIQ to production requires coordinating five core components:
1. **Frontend**: Offline-first progressive web app (React 19, Tailwind CSS v4, Workbox PWA).
2. **Backend API**: Node.js/Express service with geospatial queries and PDF report streaming via headless Chromium.
3. **Background Scheduler**: BullMQ job scheduler running the daily advisory at 05:00 AM IST (Asia/Kolkata).
4. **Primary Database**: MongoDB 7.0+ for multi-tenant users, fields, recommendations, reports, and time-series sensor data.
5. **Cache & Queue**: Redis 7 for weather caching, distributed locking, and BullMQ worker queues.

### Hosting Provider Limits & Sleeping Behaviour Analysis

| Service | Provider | Free-Tier Specs & Limits | Sleep / Spindown Behaviour | Architectural Trade-offs & Handling |
| :--- | :--- | :--- | :--- | :--- |
| **Web Frontend** | **Vercel** | • 100 GB bandwidth/mo<br>• Unlimited serverless deployments<br>• Edge CDN routing | **No sleeping** (static edge CDN is always available). | Pre-compiled PWA shell, assets cached for 1 year immutable (`assets/*`), service worker `sw.js` set to `must-revalidate`. SPA routes rewritten to `/index.html`. |
| **API & Scheduler** | **Render** | • 512 MB RAM<br>• 0.1 shared vCPU<br>• 750 free instance hrs/mo | **Spins down after 15 minutes** of HTTP inactivity. Cold start takes ~50 seconds. | **Critical Risk**: Internal timers and BullMQ schedulers in sleeping containers **will not trigger** at 05:00 AM IST.<br>**Mitigation**: External cron ping or always-on instance (see below). |
| **API Alternative** | **Railway** | • 8 GB RAM shared<br>• $5 one-time free credit<br>• Configurable container sizing | **No auto-sleep** while credits remain active. | Excellent for running always-on BullMQ workers and API without sleep latency. |
| **API Alternative** | **Fly.io** | • Up to 3 shared-cpu-1x 256MB VMs<br>• 3 GB persistent storage | Can disable auto-stop (`auto_stop_machines = false`). | Low-latency container hosting; 256MB requires careful Chromium memory bounding during PDF generation. |
| **Database** | **MongoDB Atlas** | • M0 Shared Sandbox<br>• 512 MB storage<br>• 500 connections limit | **No sleeping** (24/7 replica set availability). | Supports geospatial `2dsphere` indexes and native time-series collections (`SensorReading`). |
| **Cache & Queue** | **Upstash / Hosted Redis** | • 10,000 commands/day free<br>• TLS encryption (`rediss://`)<br>• 256 MB data limit | **Serverless (always ready)**. | Fully supports standard Redis 7 commands and persistent connections required by BullMQ. |

### Solving the 05:00 AM Daily Scheduler Dilemma

A core requirement of IrrigIQ is generating daily irrigation recommendations at **05:00 AM Asia/Kolkata (23:30 UTC)** before farmers begin morning irrigation. Free container hosting tiers (such as Render) sleep after 15 minutes of zero inbound HTTP traffic, suspending the Node event loop and causing the in-process cron timer to be missed.

To guarantee that daily recommendations are executed without requiring expensive dedicated infrastructure, we adopted a **Dual-Trigger Execution Architecture**:

```
+-------------------------------------------------------------+
| PATH 1: Internal Scheduler (Always-on / Paid / Local Dev)   |
| BullMQ Repeatable Job -> 0 5 * * * Asia/Kolkata             |
+-------------------------------------------------------------+

+-------------------------------------------------------------+
| PATH 2: External Ping (Free-Tier Sleep Survival)            |
| GitHub Actions Scheduled Cron (23:30 UTC / 05:00 IST)       |
|    OR cron-job.org / Upstash QStash                         |
|         │                                                   |
|         ▼ HTTP POST with x-cron-secret                      |
| https://irrigiq-api.onrender.com/scheduler/trigger-daily    |
|         │                                                   |
|         ▼ (Container Wakes Up within 50s)                   |
| processDailyRecommendations() executes in batches of 50     |
+-------------------------------------------------------------+
```

1. **In-Process BullMQ Schedule**:
   - `initRecommendationScheduler()` registers an internal cron job (`0 5 * * *` with timezone `Asia/Kolkata`).
   - If deployed on Railway, Fly.io, or an always-on Render instance, this worker executes natively inside the cluster.
2. **Authenticated External Cron Endpoint (`/scheduler/trigger-daily-recommendations`)**:
   - Exposed on the Express server: `POST /scheduler/trigger-daily-recommendations`.
   - Protected by `CRON_SECRET` header validation (`x-cron-secret` or `Authorization: Bearer <CRON_SECRET>`).
   - An external cron runner (e.g. GitHub Actions `.github/workflows/daily-cron.yml` firing at `30 23 * * *`, or cron-job.org) sends a ping every morning.
   - The inbound HTTP request wakes the sleeping Render instance, executes `processDailyRecommendations()`, logs results, and returns HTTP 200 with the execution summary (`{ distinctCells, processedFields, failedFields }`).

---

## ADR 007: Phase 17 Power Windows & Wind Drift Sprinkler Protection

### Context

In rural Indian agriculture, electrical power for agricultural tubewells and pumps is intermittent and scheduled in 6-to-8 hour daily blocks (e.g., night blocks from 22:00 to 06:00 IST or day blocks from 06:00 to 14:00 IST, often rotating weekly between feeder circuits). Furthermore, sprinkler irrigation in high wind causes severe droplet drift, non-uniform distribution, and up to 30% water loss from spray evaporation.

### Upstream Meteorological Specifications

- **API Variable**: `wind_speed_10m_max` from Open-Meteo Forecast API (`https://api.open-meteo.com/v1/forecast`).
- **Unit**: `km/h` (default unit returned by Open-Meteo).
- **Physical Meaning**: Daily maximum 10-meter wind speed over the 24-hour UTC/IST aggregation window.
- **Agronomic Threshold**: FAO-56 and USDA Natural Resources Conservation Service guidelines establish $20 \text{ km/h}$ ($\approx 5.5 \text{ m/s}$) as the upper permissible limit for standard agricultural impact sprinklers. Above $20 \text{ km/h}$, operating sprinklers leads to pattern distortion.
- **Config Representation**: Versioned under `POWER_SCHEDULE_CONFIG.windLimitKmh` with `source: 'FAO-56 Irrigation and Drainage Paper No. 56 / Sprinkler droplet drift threshold (starter 20 km/h)'` and `verified: false`.

### Power Window Model Architecture

1. **Concrete Interval Expansion (`expandWindows`)**:
   - Converts weekly recurrent schedules `{ days, start 'HH:MM', end 'HH:MM' }` in Indian Standard Time (IST) into concrete timestamps for date $D$ and $D+1$.
   - Handles midnight-crossing windows (e.g. `22:00` to `06:00`): splits cleanly into `22:00` to `24:00` on Day $D$, and `00:00` to `06:00` on Day $D+1$.
2. **Weekly Rotation Support (`weekA` vs `weekB`)**:
   - Compares target date against `anchorDate` in 7-day increments: even week index maps to `weekA`, odd week index maps to `weekB`.
3. **Multi-Field Dispatch (`planPumpDay`)**:
   - When multiple fields share a single pump, field run durations are sorted by urgency (highest water deficit in mm first) and allocated back-to-back across available intervals.
4. **No-Power Resilience (`rescheduleForNoPower`)**:
   - When a farmer reports an unexpected feeder outage, the scheduled run moves to the next available interval while preserving the accumulated root-zone soil water deficit.





