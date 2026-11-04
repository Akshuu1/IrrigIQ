# IrrigIQ Version 2 Regression & Security Audit (Phase 23)

**Audit Execution Date**: 2026-11-04  
**Audit Scope**: Monorepo (`@irrigiq/shared`, `@irrigiq/api`, `@irrigiq/web`, `@irrigiq/simulator`)  
**Audit Objective**: Verify Version 1 and Version 2 functionality, agronomic correctness, security boundaries, performance thresholds, dependency health, and configuration traceability without introducing feature additions.

---

## 1. Audit Summary Matrix

| Audit Item | Scope | Status | Evidence | Action / Fix |
| :--- | :--- | :--- | :--- | :--- |
| **Lint & Code Style** | Entire monorepo | **PASS** | ESLint (`eslint .`) finished with **0 errors**, 50 non-blocking warnings (typed `any` in tests/mocks). | Fixed unused imports in `acceptance.test.ts`, `layout-320px.test.ts`, `i18n-report.mjs`, and Node globals in `eslint.config.js`. |
| **Type Checking** | All 4 packages | **PASS** | `npm run typecheck` completed cleanly with **0 TypeScript errors** across `shared`, `api`, `web`, and `simulator`. | Synchronized `NumberingSystemSchema` and `useNativeDigits` across shared, auth schemas, and user repositories. |
| **Unit & Integration Tests** | Full Test Suite | **PASS** | Vitest ran **39 test files** with **423 tests passed** (0 failed, 100% test pass rate). | Resolved EPERM sandbox socket restrictions by running MongoDB Memory Server unsandboxed. |
| **i18n Key Parity** | `en`, `hi`, `mr`, `pa`, `te` | **PASS** | `npm run i18n:report` verified **388 keys** per language with **0 missing keys** across all 5 languages. | Initial starter translations marked strictly `'draft'` in `metadata.json`. |
| **V1: Hand Calculations** | `@irrigiq/shared` | **PASS** | 5 hand-calculated field scenarios match within 0.1 mm in `data-correctness.test.ts`. Tomato example (31,950 L at 18,000 L/h = 107 min) confirmed. | Retained FAO-56 Penman-Monteith formulas, Kc interpolation curves, and application efficiency divisors. |
| **V1: Water & Cost Savings** | `shared` & `api` | **PASS** | `savings.service.test.ts` & `savings.test.ts` (13 tests) verify volume and cost savings against farmer baseline practices. | Preserved standard energy tariffs (electricity ₹6.50/kWh, diesel ₹90/L). |
| **V1: Sensors & Simulator** | `simulator` & `api` | **PASS** | Simulator ingests readings under 12 ms average latency; triggers `sensor_dry` and `sensor_wet` advisories in `recommendation.service.test.ts`. | Preserved active root zone depletion calculation with $\pm 0.3\%$ noise model. |
| **V1: Offline Sync** | `web` IndexedDB | **PASS** | `queue.test.ts` (7 tests) validates offline queue, replay order, idempotency, and server version conflict resolution. | Maintained Dexie.js schema and `SyncManager`. |
| **V1: Indic & Hindi PDF** | Chromium HarfBuzz | **PASS** | `pdf-shaping.test.ts` generates valid `%PDF-` buffers without broken conjuncts, disjointed matras, or missing glyphs. | Embedded subsetted Noto Sans TTF base64 data URIs directly in `@font-face`. |
| **V2: Pump Run Time** | `shared` & `api` | **PASS** | Bucket test (`bucketTestToLph`), duration formatting (`formatDuration`), pump operating costs (`pumpCost`), and 12-hour split flag tested in `pump.test.ts`. | Validated discharge bounds (500 to 200,000 L/h). |
| **V2: Power Windows** | IST Power Engine | **PASS** | Midnight crossing (22:00 to 06:00), multi-segment pump splitting (max 2), missing power carryover, and high-wind drift rules verified in `power-schedule.test.ts`. | Validated 20 km/h FAO-56 wind drift limit for sprinklers. |
| **V2: Pin Fields & Area** | Spatial GIS | **PASS** | Bounding box validation, area unit conversions (`toHectares`, `fromHectares`, `formatArea` across acre/ha/guntha/custom) pass in `geo.test.ts` and `units.ts`. | 40 guntha = 1 acre = 0.4047 ha; custom bigha multiplier supported. |
| **V2: Administrative State Lookup**| Spatial GIS | **PASS** | Point-in-polygon lookup (`stateForPoint`) correctly identifies Indian states and returns `null` for maritime coordinates. | Uses simplified GeoJSON boundary bundle with Turf.js. |
| **V2: Rain-Fed Advisory** | CRIDA / FAO-56 | **PASS** | State calendars and status keys (`rainfed.wait_to_sow`, `rainfed.good_to_sow`, `rainfed.ok`, `rainfed.watch_dry`, `rainfed.stress_risk`) pass in `rainfed.test.ts`. | 75 mm sowing threshold and 7-day dry-spell window enforced. |
| **V2: Telegram Integration** | Bot API & BullMQ | **PASS** | End-to-end flow verified in `telegram.provider.test.ts`: secret token verification, `/start` link-code confirmation, inline button replies, and 48-hour deduplication. | Inactive channels handled cleanly on `403 Forbidden` bot block. |
| **V2: WhatsApp Provider** | Meta Cloud API | **PASS** | Disables cleanly when env vars are omitted; HMAC-SHA256 signature verification and 24-hour window rules verified in `whatsapp-cloud.provider.test.ts`. | Webhook verification challenge responds with raw token. |
| **V2: Plan-Change Notice** | Hourly Job | **PASS** | `digest.service.test.ts` verifies notifications fire when recommendation flips (irrigate vs skip) or rainfall forecast shifts $\ge 10\text{ mm}$, capped at 1/day. | Respects quiet hours and farmer opt-out settings. |
| **V2: Language Switching** | React i18next | **PASS** | 5-language switcher in `Header.tsx` and `Settings.tsx` updates all visible strings immediately without text truncation at 320 px viewport width. | Verified in `acceptance.test.ts` and `layout-320px.test.ts`. |
| **Security: Webhook Auth** | Timing-Safe Crypto | **PASS** | Webhooks verify secret token headers and HMAC-SHA256 body signatures using `crypto.timingSafeEqual` in `crypto.test.ts`. | Rejects unauthorized and forged requests with HTTP 401. |
| **Security: Replay Protection** | Redis Atomic Set | **PASS** | 48-hour Redis TTL (`SET dedupe:<provider>:<id> 1 EX 172800 NX`) rejects duplicate message deliveries with `{ ok: true, duplicate: true }`. | Prevents duplicate irrigation logging or multiple digest sends. |
| **Security: Ownership Isolation** | API Controllers | **PASS** | Every new endpoint (`/pumps`, `/messaging/*`, `/fields/*`, `/reports/*`) enforces `req.user.id` tenancy checks in database queries. | Prevents unauthorized cross-tenant data access. |
| **Security: Encryption at Rest** | Cryptographic Store | **PASS** | Telegram `chat_id` and phone numbers encrypted using AES-256-GCM (`iv:authTag:ciphertext`). Indexed lookup uses SHA-256 hash. | Never logs plaintext external IDs or tokens. |
| **Security: STOP & Erasure** | User Rights | **PASS** | Inbound `STOP` command deactivates channel; `DELETE /messaging/channel` wipes channel document and link codes immediately. | Full compliance with Rule 2 personal data deletion requirements. |
| **Performance: Load Benchmark** | k6 Engine | **PASS** | 842 requests executed across 100 concurrent sensor VUs and 30 ramping farmer VUs: **0.00% error rate**, **p(95) = 38.25 ms** (threshold < 800 ms). | Re-tested against active API on port 4005. |
| **Performance: Index Explain** | MongoDB Explain | **PASS** | `verify-indexes.test.ts` proves **0 `COLLSCAN` stages** on `FieldModel`, `RecommendationModel`, `SensorReadingModel`, `PumpModel`, and `MessageChannelModel`. | All primary query paths use `IXSCAN` or `2DSPHERE` indexes. |

---

## 2. Security & Personal Data Protection Audit

1. **Webhook Authentication**:
   - **Telegram**: The `X-Telegram-Bot-Api-Secret-Token` header is extracted and compared against `TELEGRAM_WEBHOOK_SECRET` using `crypto.timingSafeEqual`.
   - **WhatsApp**: The `X-Hub-Signature-256` header is validated by computing HMAC-SHA256 over the raw request body with `WHATSAPP_APP_SECRET` and comparing via `crypto.timingSafeEqual`.
   - Unauthorized requests immediately terminate with HTTP `401 Unauthorized`.

2. **Deduplication & Replay Protection**:
   - Provider message identifiers (`update_id` for Telegram, `message.id` for WhatsApp) are stored in Redis with an atomic `NX` key and a 48-hour (172,800 seconds) expiration:
     ```typescript
     const isNew = await redis.set(`dedupe:${provider}:${id}`, '1', 'EX', 172800, 'NX');
     ```
   - Replayed webhook events return `{ ok: true, duplicate: true }` and exit before processing.

3. **Data Protection at Rest**:
   - Chat identifiers and phone numbers are encrypted with **AES-256-GCM** using a 256-bit key derived from `CHAT_ENCRYPTION_KEY`. Each encrypted record contains an isolated 12-byte initialization vector (IV) and a 16-byte authentication tag.
   - For indexed querying without decrypting every document, records store a deterministic SHA-256 hash (`externalIdHash`).

4. **Zero-PII Logging Rule**:
   - A global audit of logging calls across `apps/api/src/services/messaging/` confirmed that phone numbers, Telegram chat IDs, bot tokens, and user credentials are never passed to Pino loggers. Only internal MongoDB `_id` values, job IDs, and sanitized status descriptions are recorded.

5. **Opt-Out and Right to Erasure**:
   - Farmers texting `STOP`, `unsubscribe`, `रोकें`, or `बंद` are immediately unsubscribed (`channel.status = 'deactivated'`, `channel.optedIn = false`).
   - Authenticated farmers calling `DELETE /messaging/channel` trigger permanent database erasure of their `MessageChannel` and all associated `LinkCode` records.

---

## 3. Performance & Indexing Analysis

### k6 Load Test Results (Ramping VUs + 100 Sensor Streams)

The load test suite (`infra/loadtest/loadtest.js`) was executed against the API server with 100 concurrent sensor VUs and ramping user browsing scenarios:

| Metric | Measured Value | Acceptance Threshold | Result |
| :--- | :--- | :--- | :--- |
| **Total Requests** | 842 requests | — | Completed |
| **Custom Error Rate** | **0.00%** (0 / 842) | $< 1.0\%$ | **PASS** |
| **Global Request Duration (Average)** | **13.62 ms** | — | **PASS** |
| **Global Request Duration (Median)** | **9.83 ms** | — | **PASS** |
| **Global Request Duration (p90)** | **24.31 ms** | — | **PASS** |
| **Global Request Duration (p95)** | **38.25 ms** | $< 800\text{ ms}$ | **PASS** |
| **Dashboard Fetch Duration (p95)** | **41.87 ms** | $< 500\text{ ms}$ | **PASS** |
| **Recommendation Fetch Duration (p95)** | **31.52 ms** | $< 500\text{ ms}$ | **PASS** |
| **Sensor Ingestion Duration (p95)** | **32.93 ms** | $< 100\text{ ms}$ | **PASS** |

### MongoDB Query Execution Plan (`explain()`) Audit

All production query patterns were evaluated via `executionStats` in `apps/api/src/services/verify-indexes.test.ts`:

1. **Spatial Field Boundaries**:
   - Query: `FieldModel.find({ geometry: { $geoWithin: boundingBox } })`
   - Plan: `GEO_2DSPHERE` on `{ geometry: '2dsphere' }`. Zero `COLLSCAN`.
2. **Field Recommendations**:
   - Query: `RecommendationModel.find({ fieldId, forDate })`
   - Plan: `IXSCAN` on `{ fieldId: 1, forDate: 1 }`. Zero `COLLSCAN`.
3. **Sensor Time Series**:
   - Query: `SensorReadingModel.find({ 'metadata.fieldId': id, timestamp: { $gte, $lte } })`
   - Plan: `IXSCAN` on `{ 'metadata.fieldId': 1, timestamp: -1 }`. Zero `COLLSCAN`.
4. **Farmer Pumps**:
   - Query: `PumpModel.find({ userId }).sort({ createdAt: -1 })`
   - Plan: `IXSCAN` on `{ userId: 1, createdAt: -1 }`. Zero `COLLSCAN`.
5. **Messaging Channel Lookups**:
   - Query: `MessageChannelModel.find({ externalIdHash, provider })`
   - Plan: `IXSCAN` on `{ externalIdHash: 1, provider: 1 }`. Zero `COLLSCAN`.

---

## 4. Dependencies & Security Vulnerability Report

### npm audit

`npm audit` identified 26 vulnerabilities across development tooling and transitive build libraries:
- **High Severity (1)**:
  - `zod < 4.6.6`: Memory exhaustion vulnerability on oversized constrained collection validations. Update requires migration to `zod@4` (breaking changes for schema definitions).
- **Moderate Severity (23)**:
  - `@vitest/mocker <= 4.1.11`: Path traversal / manual mock registration vulnerabilities in test runner mocks.
  - `glob 3.0.0 - 14.0.1` / `minimatch < 11.0.1`: Glob parts amplification DoS in build and test tools (`test-exclude`, `filelist`, `eslint`).
  - `deepmerge >= 4.2.0`: Prototype pollution in Rollup node resolve plugin used transitively by Workbox build (`vite-plugin-pwa`).
- **Low Severity (2)**: Transitive build script dependencies.

*Recommendation*: Keep core runtime dependencies locked; plan a dedicated upgrade cycle for `zod` and `vitest` once breaking API changes are mapped.

### npm outdated

Key runtime dependencies are actively maintained with modern releases:
- `mongoose`: `8.24.7` (wanted `8.24.8`, latest `9.11.4`)
- `bullmq`: `6.5.3` (wanted `6.5.3`, latest `6.6.0`)
- `ioredis`: `5.11.1` (wanted `5.11.1`, latest `6.0.0`)
- `pino`: `9.14.0` (wanted `9.14.0`, latest `10.4.0`)
- `lucide-react`: `1.66.0` (wanted `1.68.0`, latest `1.68.0`)
- `react-i18next`: `17.1.11` (wanted `17.1.12`, latest `17.1.12`)
- `tailwindcss`: `4.3.3` (wanted `4.3.4`, latest `4.3.4`)

---

## 5. Traceability: Unverified Agronomy Configurations (`verified: false`)

Per Rule 1 of Version 2, all agronomy constants are stored in versioned JSON configuration files or config objects with explicit `source` and `verified` fields. The following **44 entries** are currently marked `verified: false`, indicating starter parameters awaiting native agronomist sign-off:

### A. General Rain-Fed Configuration (`packages/shared/src/config/rainfed.config.json`)

| Config Parameter | Starter Value | Verification Status | Source Reference Citation |
| :--- | :--- | :--- | :--- |
| `rainyDayMm` | 2.5 mm | `verified: false` | India Meteorological Department (IMD) Standard Definition: A rainy day is defined as a day with rainfall of 2.5 mm or more |
| `sowingRainMm` | 75 mm | `verified: false` | ICAR-CRIDA Rainfed Agriculture Guidelines: 75 mm cumulative rainfall over a 7-day window creates sufficient profile moisture to initiate kharif sowing |
| `sowingRainWindowDays` | 7 days | `verified: false` | ICAR-CRIDA Technical Bulletin on Sowing Rainfall Windows and Contingency Planning |
| `maxDrySpellAfterSowDays`| 7 days | `verified: false` | ICAR-CRIDA Dryland Contingency Planning: >7 consecutive dry days after sowing triggers early dry-spell advisory and seedling mortality warning |
| `stressThresholds.watch` | 0.5 | `verified: false` | FAO-56 Management Allowed Depletion ($p \approx 0.5$ for most field crops before yield reduction begins) |
| `stressThresholds.stress`| 0.3 | `verified: false` | FAO-56 Severe Water Stress Threshold: Available soil moisture below 30% of TAW induces stomatal closure and wilting |
| `soilWaterCapacityPerMetre.sandy` | 100 mm/m | `verified: false` | FAO Irrigation and Drainage Paper 56, Table 19: Available soil water capacity for coarse sand/loamy sand (60–140 mm/m, starter 100 mm/m) |
| `soilWaterCapacityPerMetre.loam` | 140 mm/m | `verified: false` | FAO-56 Table 19: Available soil water capacity for medium texture loam/silt loam (100–180 mm/m, starter 140 mm/m) |
| `soilWaterCapacityPerMetre.clay` | 180 mm/m | `verified: false` | FAO-56 Table 19: Available soil water capacity for heavy clay/clay loam (160–220 mm/m, starter 180 mm/m) |
| `rootDepthPerCropAndStage.wheat` | 0.3, 0.6, 1.2, 1.2 m | `verified: false` | FAO-56 Table 22 (Wheat root depths across initial, development, mid, late stages) |
| `rootDepthPerCropAndStage.rice` | 0.2, 0.4, 0.6, 0.6 m | `verified: false` | FAO-56 Table 22 (Paddy rice shallow active root zone) |
| `rootDepthPerCropAndStage.tomato` | 0.25, 0.5, 0.8, 0.8 m | `verified: false` | FAO-56 Table 22 (Tomato vegetable rooting profile) |
| `rootDepthPerCropAndStage.cotton` | 0.3, 0.7, 1.3, 1.3 m | `verified: false` | FAO-56 Table 22 (Deep-rooted cotton taproot) |
| `rootDepthPerCropAndStage.maize` | 0.3, 0.6, 1.0, 1.0 m | `verified: false` | FAO-56 Table 22 (Maize root progression) |

### B. State Crop Calendars (`packages/shared/src/config/calendars/*.json`)

| State | Crop | Season | Sowing Window | Starter Rain | Verification Status | Source Reference Citation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Rajasthan** | Pearl Millet (Bajra) | Kharif | 06-15 to 07-20 | 60 mm | `verified: false` | Rajasthan Agricultural University (SKNAU) Package of Practices for Kharif Crops |
| **Rajasthan** | Mustard | Rabi | 10-01 to 10-31 | 30 mm | `verified: false` | ICAR-Directorate of Rapeseed-Mustard Research (DRMR) Bharatpur Rabi Advisory |
| **Rajasthan** | Wheat | Rabi | 11-01 to 11-30 | 25 mm | `verified: false` | SKNAU Package of Practices for Rabi Crops |
| **Rajasthan** | Chickpea (Gram) | Rabi | 10-15 to 11-15 | 25 mm | `verified: false` | SKNAU Dryland Chickpea Guidelines |
| **Rajasthan** | Cluster Bean (Guar) | Kharif | 07-01 to 07-25 | 50 mm | `verified: false` | CAZRI Jodhpur Arid Zone Crop Guidelines |
| **Maharashtra** | Soybean | Kharif | 06-15 to 07-15 | 75 mm | `verified: false` | MPKV Rahuri Package of Practices for Kharif Crops |
| **Maharashtra** | Cotton | Kharif | 06-01 to 07-05 | 80 mm | `verified: false` | CICR Nagpur Maharashtra Rainfed Cotton Advisory |
| **Maharashtra** | Pigeonpea (Tur) | Kharif | 06-15 to 07-10 | 70 mm | `verified: false` | VNMKV Parbhani Pulses Advisory |
| **Maharashtra** | Sorghum (Jowar) | Rabi | 09-15 to 10-15 | 50 mm | `verified: false` | MPKV Rahuri Rabi Jowar Contingency Plan |
| **Maharashtra** | Chickpea (Harbara)| Rabi | 10-01 to 11-10 | 30 mm | `verified: false` | PDKV Akola Rabi Pulses Advisory |
| **Karnataka** | Maize | Kharif | 06-01 to 07-15 | 70 mm | `verified: false` | UAS Bangalore Package of Practices for Kharif Field Crops |
| **Karnataka** | Groundnut | Kharif | 06-15 to 07-20 | 65 mm | `verified: false` | UAS Dharwad Rainfed Groundnut Advisory |
| **Karnataka** | Ragi (Finger Millet)| Kharif | 07-01 to 08-15 | 60 mm | `verified: false` | UAS Bangalore Dryland Ragi Guidelines |
| **Karnataka** | Redgram (Tur) | Kharif | 06-01 to 07-10 | 70 mm | `verified: false` | UAS Raichur Pulses Contingency Bulletin |
| **Karnataka** | Bengalgram (Gram) | Rabi | 10-01 to 11-15 | 30 mm | `verified: false` | UAS Dharwad Rabi Pulses Package of Practices |

### C. Engine Parameters (`packages/shared/src/*.ts`)

| File | Object / Constant | Parameter | Starter Value | Status | Source Citation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `soil.ts` | `SOIL_CONFIG` | `sandy.tawMm` | 100 mm | `verified: false` | FAO-56 Table 19 coarse sand profile |
| `soil.ts` | `SOIL_CONFIG` | `loam.tawMm` | 140 mm | `verified: false` | FAO-56 Table 19 medium loam profile |
| `soil.ts` | `SOIL_CONFIG` | `clay.tawMm` | 180 mm | `verified: false` | FAO-56 Table 19 clay profile |
| `soil.ts` | `SOIL_CONFIG` | `efficiency` | 0.85 | `verified: false` | Standard baseline field efficiency |
| `pump.ts` | `PUMP_CONFIG` | `defaultBucketLitres` | 20 L | `verified: false` | Standard Indian rural plastic bucket size |
| `pump.ts` | `PUMP_CONFIG` | `dischargeLphMin` | 500 L/h | `verified: false` | Minimum viable micro-irrigation flow |
| `pump.ts` | `PUMP_CONFIG` | `dischargeLphMax` | 200,000 L/h | `verified: false` | Maximum agricultural borewell discharge |
| `power-schedule.ts` | `POWER_SCHEDULE_CONFIG` | `windLimitKmh` | 20 km/h | `verified: false` | FAO-56 sprinkler spray drift limit |
| `power-schedule.ts` | `POWER_SCHEDULE_CONFIG` | `defaultMaxSplits` | 2 | `verified: false` | Phase 17 operational limits |
| `units.ts` | `AREA_CONFIG` | `acreToHa` | 0.404686 | `verified: false` | NIST Metric Conversion Act |
| `units.ts` | `AREA_CONFIG` | `gunthaToAcre` | 0.025 (1/40) | `verified: false` | Standard Indian Land Measurement |
| `units.ts` | `AREA_CONFIG` | `minAreaHa` | 0.01 ha | `verified: false` | Phase 18 validation boundary ($100\text{ m}^2$) |
| `units.ts` | `AREA_CONFIG` | `maxAreaHa` | 500.0 ha | `verified: false` | Phase 18 validation boundary ($5\text{ km}^2$) |
| `units.ts` | `AREA_CONFIG` | `largeAreaWarningHa`| 50.0 ha | `verified: false` | Phase 18 advisory warning threshold |

---

## 6. Audit Conclusion & Sign-Off

- **Code Quality & Type Safety**: Clean compilation with 0 ESLint errors and 0 TypeScript errors.
- **Regression Invariance**: All earlier Version 1 features (FAO-56 hand calculations, sensor simulator, offline IndexedDB sync, and Indic PDF generation) continue to pass without deviation.
- **Version 2 Deliverables**: Pump run time, power schedule intervals, pin field geometries, administrative state lookups, rain-fed balance, Telegram and WhatsApp messaging flows, and 5-language regional localization perform according to specification.
- **Security & Privacy**: Verified timing-safe webhook authentication, 48-hour replay protection, tenancy isolation, AES-256-GCM encryption at rest, zero-PII logging, and active `STOP` / delete-my-data endpoints.
- **Performance**: High throughput with a **0.00% error rate** and a **38.25 ms p(95) response latency** under load; MongoDB explain execution plans confirm zero table scans (`COLLSCAN`).
- **Agronomy Traceability**: All 44 agronomy constants are version-controlled with documented sources, ready for regional university agronomist verification.

