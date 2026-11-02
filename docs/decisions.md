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
