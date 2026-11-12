# Data Retention, Erasure, and Deletion Policy

This document details the data retention and complete erasure policy for IrrigIQ, specifically governing the account-wide deletion endpoint (`DELETE /me` / `DELETE /auth/me`).

---

## 1. Account Deletion (`DELETE /me`)

When a farmer triggers account deletion via `DELETE /me` (or `DELETE /auth/me`), an atomic cascading erasure is executed across all collections in MongoDB.

### Data Deleted Immediately and Permanently

| Category | Collection / Model | Scope | Description |
|---|---|---|---|
| **Identity & Authentication** | `users` (`UserModel`) | User ID | Profile details (name, email, language, areaUnit, numberingSystem) and argon2/bcrypt password hash. |
| **Active Sessions** | `refresh_tokens` (`RefreshTokenModel`) | User ID | All active, expired, and revoked refresh token hashes. |
| **Farm Assets** | `fields` (`FieldModel`) | User ID | All field geometry (polygons, pin centroids), area values, crop assignments, sowing dates, soil types, and baseline irrigation settings. |
| **Equipment** | `pumps` (`PumpModel`) | User ID | Pump calibrations, discharge rates ($L/h$), and custom operational costs per hour (`costPerHour`). |
| **Power Schedules** | `power_schedules` (`PowerScheduleModel`) | User ID | Night/day power availability windows and rotational rosters. |
| **Sensors** | `sensors` (`SensorModel`) | User ID | Sensor registrations, device names, simulated status, and hashed API keys. |
| **Telemetry** | `sensor_readings` (`SensorReadingModel`) | Field IDs | All soil moisture percentage and temperature timeseries readings linked to the user's fields. |
| **Irrigation History** | `irrigation_logs` (`IrrigationLogModel`) | User ID & Field IDs | Manual, chat, and system-logged water applications ($mm$ and duration). |
| **Advisory History** | `recommendations` (`RecommendationModel`) | User ID & Field IDs | Daily FAO-56 dual crop coefficient irrigation recommendations, water run times, split windows, and rain-fed advisories. |
| **Audit Reports** | `reports` (`ReportModel`) | User ID & Field IDs | Generated weekly/monthly PDF summaries and comparison metrics. |
| **Messaging Channels** | `message_channels` (`MessageChannelModel`) | User ID | Telegram/WhatsApp channel bindings, encrypted IDs (`AES-256-GCM`), HMAC-SHA256 blind indices (`CHAT_INDEX_KEY`), quiet hours, and daily cap states. |
| **Inbound Messages** | `inbound_messages` (`InboundMessageModel`) | Channel IDs | Raw incoming webhook payloads and user interaction logs. |
| **Outbound Messages** | `outbound_messages` (`OutboundMessageModel`) | User ID & Channel IDs | Outbound daily digests, plan-change alerts, and confirmation notifications. |
| **Link Codes** | `link_codes` (`LinkCodeModel`) | User ID | Temporary 6-digit channel link codes and expiration timestamps. |
| **Web Push** | `push_subscriptions` (`PushSubscriptionModel`) | User ID | Browser VAPID push notification subscriptions, endpoint URLs, and p256dh/auth encryption keys. |

---

## 2. What Is Kept and Why

| Data Set | Collection / Location | Rationale & Privacy Guarantee |
|---|---|---|
| **Grid Weather Observations & Forecasts** | `weather_days` (`WeatherDayModel`) | **Zero PII / Shared Infrastructure**: Weather data is geographical grid data indexed strictly by coordinate bounding cell (`gridCell: "26.90_75.80"` at ~0.05° resolution) containing public meteorological parameters (solar radiation, max/min temperature, wind speed, relative humidity, precipitation). It contains no user identifiers, no farm identifiers, and is shared by all agricultural fields located within the same grid cell. |
| **Agronomic Constants & Crop Metadata** | Shared static packages (`crops.json`, `rainfed.config.json`) | **System-Wide Reference Tables**: Baseline crop coefficients ($K_c$), stage lengths, maximum root depths ($Z_{r,max}$), and soil hydrological properties ($FC$, $WP$) are shared agronomic reference constants packaged with the software. |

---

## 3. Verification & Compliance Evidence

- **Automated Cascade Test**: `apps/api/src/routes/auth.routes.test.ts`
  - Validates that when User A triggers `DELETE /me`, all 14 personal data collections are wiped to 0 documents for User A.
  - Confirms multi-tenant isolation: surviving User B's fields, pumps, and data are untouched.
  - Confirms unauthenticated requests receive `401 UNAUTHORIZED`.
- **Idempotency & Zero Leftover Guarantee**: Subsequent queries for `userId` across any personal collection yield `null` / `count = 0`.

