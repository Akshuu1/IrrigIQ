# 💧 IrrigIQ — Precision Irrigation Advisory for Smallholder Farms

[![CI & Deployment Pipeline](https://github.com/Akshuu1/IrrigIQ/actions/workflows/ci.yml/badge.svg)](https://github.com/Akshuu1/IrrigIQ/actions/workflows/ci.yml)
[![Daily Cron](https://github.com/Akshuu1/IrrigIQ/actions/workflows/daily-cron.yml/badge.svg)](https://github.com/Akshuu1/IrrigIQ/actions/workflows/daily-cron.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-brightgreen.svg)](https://nodejs.org/)
[![PWA](https://img.shields.io/badge/PWA-Offline--First-blue.svg)](https://web.dev/progressive-web-apps/)

**IrrigIQ** is an offline-first, bilingual (English & Hindi) irrigation advisory system built for Indian smallholder farmers. Using open-access meteorological data, the FAO-56 Penman-Monteith model, and optional IoT soil moisture telemetry, IrrigIQ tells farmers **exactly when and how many litres of water to apply**, saving 20–40% of agricultural groundwater compared to traditional routines.

---

## 🏛️ System Architecture

```mermaid
graph TD
    subgraph Farmer Device [Mobile PWA (Client)]
        PWA["Offline-First PWA (React 19 + Vite + Tailwind v4)"]
        IDB["IndexedDB (Dexie / IDB Queue)"]
        SW["Service Worker (Workbox Stale-While-Revalidate)"]
        PWA <--> IDB
        PWA <--> SW
    end

    subgraph Cloud Gateway [Reverse Proxy & CDN]
        Vercel["Vercel Edge Network / Nginx"]
        SW -->|Sync & API Calls| Vercel
    end

    subgraph Backend Services [API & Worker Core]
        API["Node.js / Express 5 API (Multi-tenant)"]
        Scheduler["BullMQ Scheduler & Worker (05:00 IST)"]
        Vercel --> API
    end

    subgraph Data & Cache Layer
        Mongo[("MongoDB 7.0+\n- GeoJSON 2dsphere\n- Time-Series SensorReadings\n- Multi-tenant Fields")]
        Redis[("Redis 7.0+\n- Weather 6h Cache\n- Rate Limiting\n- BullMQ Job Queue")]
        API <--> Mongo
        API <--> Redis
        Scheduler <--> Mongo
        Scheduler <--> Redis
    end

    subgraph External Systems
        OpenMeteo["Open-Meteo Forecast API (FAO-56 ET0)"]
        IoTSensors["Field IoT Sensors (HTTP Stream)"]
        GitHubCron["GitHub Actions Cron (05:00 IST Ping)"]
        Scheduler -->|Refresh Forecast| OpenMeteo
        IoTSensors -->|Telemetry / Moisture Stream| API
        GitHubCron -->|Wakeup & Advisory Trigger| API
    end
```

---

## 🔑 Environment Variables Reference

IrrigIQ is designed to **boot with only the core variables set** (`MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`). In local development, all variables provide sensible defaults and the system runs out of the box with zero `.env` file configuration.

### Backend API (`apps/api`)

| Variable Name | Required? | Default (Development) | Purpose & Description |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Optional | `development` | Environment mode (`development`, `test`, `production`). In production, enables strict security cookies and disables verbose debug outputs. |
| `PORT` | Optional | `4000` | Port on which the Express HTTP server listens. Automatically provided by Render, Railway, and Fly.io. |
| `MONGODB_URI` | **Required** (Prod) | `mongodb://localhost:27017/irrigiq` | MongoDB connection URI. Supports MongoDB Atlas replica sets (`mongodb+srv://...`). |
| `REDIS_URL` | **Required** (Prod) | `redis://localhost:6379` | Redis connection URL. Supports hosted Redis (e.g. Upstash, Railway, Render) with TLS (`rediss://...`). Powers distributed caching and BullMQ queues. |
| `JWT_SECRET` | **Required** (Prod) | `development-super-secret-jwt-key...` | HMAC SHA-256 signing secret for authentication access tokens. Must be at least 32 characters long. |
| `JWT_ACCESS_EXPIRES_IN` | Optional | `15m` | Lifetime of short-lived JWT access tokens. |
| `REFRESH_TOKEN_EXPIRES_DAYS` | Optional | `7` | Retention window for rotating refresh tokens stored in MongoDB. |
| `CORS_ORIGIN` | Optional | `http://localhost:3000,http://localhost:5173` | Comma-separated list of allowed web origins. Supports `*` and dynamically matches `*.vercel.app` preview deployments. |
| `COOKIE_SAME_SITE` | Optional | `lax` (or `none` in prod) | SameSite attribute for the `refreshToken` HTTP-only cookie (`lax`, `strict`, `none`). Set to `none` when deploying web and API across different domains. |
| `CRON_SECRET` | Optional | `development-cron-secret-key-min-16-chars` | Shared secret key for triggering `POST /scheduler/trigger-daily-recommendations`. Used by external cron runners to wake free-tier sleeping servers. |
| `LOG_LEVEL` | Optional | `info` | Structured logging level via Pino (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). Exact coordinates and secrets are automatically redacted. |
| `CHROMIUM_PATH` | Optional | Auto-detected | Path to system Chromium executable used for headless PDF report generation with Devanagari font shaping. In Alpine Linux Docker: `/usr/bin/chromium-browser`. |

### Frontend Web (`apps/web`)

| Variable Name | Required? | Default | Purpose & Description |
| :--- | :---: | :--- | :--- |
| `VITE_API_URL` | Optional | `""` (relative root) | Target URL of the backend API (e.g. `https://irrigiq-api.onrender.com`). When empty, requests use relative paths (used with reverse proxies like Nginx). |

---

## ⚡ Quickstart

### Option 1: Docker Compose (All-in-One)

The fastest way to run IrrigIQ locally with MongoDB, Redis, API, and the Web PWA:

```bash
# Clone the repository
git clone https://github.com/Akshuu1/IrrigIQ.git
cd IrrigIQ

# Start all containers in the background
docker compose up -d

# Verify all containers are healthy
docker compose ps
```

* **Web Application**: [http://localhost:3000](http://localhost:3000)
* **API Healthcheck**: [http://localhost:4001/health](http://localhost:4001/health)

---

### Option 2: Local Node.js Development

Prerequisites: Node.js 22 LTS, MongoDB 7.0+, and Redis 7.0+.

```bash
# 1. Install all dependencies across workspaces
npm install

# 2. Build the shared science package
npm run build -w @irrigiq/shared

# 3. Seed the database with demo crops, user, and fields
npm run seed

# 4. Start the backend API in watch mode
npm run dev -w @irrigiq/api

# 5. In another terminal, start the Web frontend
npm run dev -w @irrigiq/web
```

---

## 🌾 Seed Data & Demo Account

The database seed script sets up a ready-to-test demonstration environment:

```bash
npm run seed
```

### Pre-configured Demo Credentials:
* **Email**: `demo@irrigiq.org`
* **Password**: `DemoPassword123!`
* **Farmer Name**: `Ramesh Kumar (रमेश कुमार)`
* **Language**: `Hindi` (switchable in the UI header)
* **Area Unit**: `Acre`

### Pre-loaded Fields:
1. **करनाल गेहूं फार्म (Karnal Wheat Farm)**
   * Location: Karnal, Haryana (`Loam` soil, `Drip` irrigation, 35-day-old Wheat).
   * Pre-connected IoT soil sensor (`karnal_demo_sensor_secret_key_1`) with healthy moisture.
2. **जयपुर आलू खेत (Jaipur Potato Plot)**
   * Location: Jaipur, Rajasthan (`Sandy` soil, `Sprinkler` irrigation, 20-day-old Potato).
   * Pre-connected IoT sensor (`jaipur_demo_sensor_secret_key_2`) with low moisture triggering an irrigation alert.

---

## 🧪 Testing & Quality Gates

IrrigIQ enforces strict automated quality gates across all workspaces:

```bash
# 1. Run all unit and integration test suites (176 tests across 21 suites)
npm test

# 2. Verify strict Vitest coverage thresholds (>= 95% science, >= 80% services)
npm run test:coverage

# 3. Static typechecking across TypeScript workspaces
npm run typecheck

# 4. Code quality & style linting
npm run lint

# 5. Playwright End-to-End User Journey Tests
npm run e2e

# 6. k6 Load Testing (130 concurrent VUs, 0.00% error rate benchmark)
npm run loadtest
```

---

## 🚀 Production Deployment

### 1. Database (MongoDB Atlas)
1. Create a free **M0 Sandbox cluster** on [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a database user and allow connections from `0.0.0.0/0`.
3. Copy the connection string (`mongodb+srv://...`) into `MONGODB_URI`.

### 2. Cache & Queues (Upstash Redis)
1. Create a free serverless Redis database on [Upstash](https://upstash.com/).
2. Copy the `rediss://...` connection URL into `REDIS_URL`.

### 3. API & Scheduler (Render / Railway / Fly.io)

#### Deploying on Render:
1. Connect this GitHub repository to [Render](https://render.com/).
2. Render detects `render.yaml` automatically.
3. Set the environment variables in the dashboard:
   * `MONGODB_URI`: Your MongoDB Atlas URI.
   * `REDIS_URL`: Your Upstash Redis URL.
   * `JWT_SECRET`: Random 32+ character string.
   * `CRON_SECRET`: Random 16+ character string.

> [!IMPORTANT]
> **Free Tier Sleep Survival (05:00 AM IST Advisory)**:
> Free web services on Render sleep after 15 minutes of inactivity. To ensure the 5:00 AM IST advisory runs on time, enable the included GitHub Actions workflow [`.github/workflows/daily-cron.yml`](.github/workflows/daily-cron.yml) by setting two repository secrets:
> * `API_BASE_URL`: `https://your-api.onrender.com`
> * `CRON_SECRET`: Your shared `CRON_SECRET`
>
> Every day at 23:30 UTC (05:00 IST), GitHub Actions sends an authenticated ping to `/scheduler/trigger-daily-recommendations`, waking up the server and triggering the batch calculations.

### 4. Web Frontend (Vercel)
1. Import the repository into [Vercel](https://vercel.com/).
2. Set **Root Directory** to `apps/web` (or use the root `vercel.json`).
3. Set **Build Command** to `npm run build`.
4. Add the environment variable:
   * `VITE_API_URL`: Your deployed API URL (e.g. `https://irrigiq-api.onrender.com`).
5. Deploy! Vercel handles HTTPS, SPA routing, and PWA caching automatically.

---

## 📱 PWA Mobile Installation

IrrigIQ is designed as a standalone Progressive Web App with full offline capabilities:

* **Android (Chrome)**:
  1. Open the live URL in Google Chrome.
  2. Tap the **"Add IrrigIQ to Home screen"** prompt or tap the three dots menu $\to$ **"Install app"**.
  3. The app installs as a standalone native app with its own icon and splash screen.
* **iOS (Safari)**:
  1. Open the URL in Safari.
  2. Tap the **Share** button $\to$ tap **"Add to Home Screen"**.
  3. Launch IrrigIQ from your home screen in full-screen standalone mode.

---

## 🛡️ Security & Privacy Guardrails

* **Data Privacy**: Raw GPS coordinates and polygon boundaries are redacted from all log streams.
* **Header Hardening**: Configured with `helmet` and strict Content Security Policies.
* **Payload Limits**: Express JSON parser is bounded at `100kb` to prevent memory exhaustion denial-of-service.
* **Multi-Tier Rate Limiting**: Global IP-based rate limiting on public routes, strict rate limiting on `/auth`, and dedicated rate limiting per sensor API key on `/sensor-readings`.
* **Cookie Isolation**: Refresh tokens use `httpOnly`, `secure`, and `sameSite` isolation.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

