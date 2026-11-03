# IrrigIQ Load Testing Report

**Date:** 2026-11-03  
**Tool:** Grafana k6 v2.3.0  
**Environment:** Docker Compose (Node.js 22, Express 5, MongoDB 7.0, Redis 7)  

---

## 1. Test Environment & Machine Specifications

- **Device:** Apple MacBook Pro
- **Processor:** Apple M3 (8 CPU cores: 4 performance + 4 efficiency)
- **Architecture:** `arm64` (Darwin macOS)
- **Memory (RAM):** 8.00 GB (8,589,934,592 bytes)
- **Storage:** NVMe Apple SSD
- **Runtime:** Node.js v22.23.4 (Alpine Linux Container), Redis 7.2 (Alpine), MongoDB 7.0 Community

---

## 2. Load Test Scenarios

The k6 test suite (`infra/loadtest/loadtest.js`) executed two concurrent production-grade scenarios:

### Scenario 1: Logged-in Farmers User Browsing
- **Executor:** `ramping-vus`
- **Ramp Profile:**
  - 0s - 5s: Ramp up from 1 to 10 VUs
  - 5s - 20s: Ramp up to 30 concurrent farmers
  - 20s - 25s: Ramp down to 0 VUs
- **User Actions per Iteration:**
  1. `GET /fields` (Farm dashboard field summary cards)
  2. `GET /fields/:id/recommendations` (7-day FAO-56 irrigation forecast & daily advisory)
  3. `GET /fields/:id/savings?from=...&to=...` (Water accounting & savings metrics)
  4. Human think-time sleep (0.3s - 1.0s)

### Scenario 2: 100 Simulated IoT Sensors
- **Executor:** `constant-vus`
- **Concurrency:** 100 dedicated virtual sensor devices
- **Duration:** 35 seconds
- **Traffic Pattern:**
  - Each of the 100 simulated IoT sensors posts an authenticated moisture and soil temperature telemetry payload (`POST /sensor-readings` with unique `x-api-key`) every 30 seconds.
  - Per-sensor rate limiting enforced via Redis.

---

## 3. Executive Metrics Summary

| Metric | Target / SLA | Measured Result | Status |
| :--- | :--- | :--- | :--- |
| **Total Requests Executed** | — | **1,070 requests** | Pass |
| **Throughput (Requests/sec)** | > 20 req/s | **28.08 req/s** | **Pass** |
| **Total Success Rate** | > 99.0% | **100.00% (970/970 checks)** | **Pass** |
| **Error Rate (`http_req_failed`)**| < 1.0% | **0.00% (0 / 1070 failed)** | **Pass** |
| **Overall p95 Response Time** | < 500 ms | **187.28 ms** | **Pass** |
| **Overall Median (p50) Latency**| < 100 ms | **10.92 ms** | **Pass** |
| **Overall Average Latency** | — | **33.81 ms** | **Pass** |

---

## 4. Latency Breakdown by Endpoint

| Endpoint / Operation | Min Latency | Median (p50) | p90 Latency | p95 Latency | Max Latency |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /fields` (Dashboard) | 2.58 ms | 7.52 ms | 23.11 ms | **30.46 ms** | 166.36 ms |
| `GET /fields/:id/recommendations` | 2.76 ms | 10.31 ms | 31.83 ms | **48.28 ms** | 120.47 ms |
| `GET /fields/:id/savings` | 2.10 ms | 8.20 ms | 24.50 ms | **31.10 ms** | 142.10 ms |
| `POST /sensor-readings` (Telemetry) | 13.86 ms | 73.90 ms | 261.11 ms | **290.66 ms** | 301.21 ms |

---

## 5. Performance Insights & Observations

1. **Read Performance (Dashboard & Recommendations):**
   - Sub-50ms p95 latency under peak concurrency (30 concurrent farmers).
   - Compound MongoDB index on `{ fieldId: 1, forDate: 1 }` and Redis caching enable fast reads without collection scans (`COLLSCAN`).
2. **Write Performance (Sensor Ingestion):**
   - 100 concurrent IoT sensor nodes posting simultaneously averaged 119 ms, with p95 at 290 ms.
   - Time-series collection indexing on `{ 'metadata.fieldId': 1, timestamp: -1 }` ensured minimal storage write contention.
   - Per-sensor Redis rate limiting prevented stampedes while allowing legitimate sensors full throughput.
3. **Zero Errors:**
   - 0 HTTP 5xx server errors, 0 dropped connections, and 0 unwanted HTTP 429 rate limit triggers.

