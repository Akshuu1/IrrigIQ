# 💧 IrrigIQ — Precision Irrigation Advisory for Smallholder Farms

> **IrrigIQ is an offline-first precision irrigation advisory system that gives Indian smallholder farmers and field agents daily, crop-specific pump runtime schedules—cutting groundwater waste without requiring expensive in-field hardware.**

[![CI & Deployment Pipeline](https://github.com/Akshuu1/IrrigIQ/actions/workflows/ci.yml/badge.svg)](https://github.com/Akshuu1/IrrigIQ/actions/workflows/ci.yml)
[![Daily Cron](https://github.com/Akshuu1/IrrigIQ/actions/workflows/daily-cron.yml/badge.svg)](https://github.com/Akshuu1/IrrigIQ/actions/workflows/daily-cron.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-brightgreen.svg)](https://nodejs.org/)
[![PWA](https://img.shields.io/badge/PWA-Offline--First-blue.svg)](https://web.dev/progressive-web-apps/)

---

## 🌐 Live Demo & Deployment

* **Live Web PWA**: [https://irrigiq.vercel.app](https://irrigiq.vercel.app) *(or local [http://localhost:3000](http://localhost:3000))*
* **Live API Health**: [https://irrigiq-api.onrender.com/health](https://irrigiq-api.onrender.com/health) *(or local [http://localhost:4001/health](http://localhost:4001/health))*
* **Demo Credentials**:
  - **Email**: `demo@irrigiq.org`
  - **Password**: `DemoPassword123!`
  - **Pre-configured Fields**: Karnal Wheat (Loam, Drip), Jaipur Potato (Sandy, Sprinkler).

---

## 💡 The Hypotheses

### The User Hypothesis (Smallholder Farmer)
Smallholder farmers in India typically over-irrigate by 20–40% not out of carelessness, but out of rational risk aversion: rural 3-phase agricultural electricity is erratic (available only 6–8 hours daily, often shifting between day and night shifts weekly), and farmers fear crop desiccation.  
**Hypothesis**: If farmers receive daily, hyper-local advisories that translate complex crop water balance into **simple pump run times in minutes** matched to their active electricity window—delivered via trusted local agents or WhatsApp—they will adhere to the schedules, reduce diesel/electricity pumping costs, and preserve groundwater without sacrificing crop health.

### The Buyer Hypothesis (Cooperative, FPO & Agribusiness)
Agricultural cooperatives, Farmer Producer Organisations (FPOs), and contract agribusinesses bear the hidden costs of water depletion: over-pumped aquifers require deeper bore-wells, erratic moisture lowers crop quality, and ESG reporting demands auditable resource stewardship.  
**Hypothesis**: Agricultural institutions will pay **₹20–₹50 per farmer per month** for a turnkey extension software suite that equips local field agents with an offline-capable daily dashboard, automated bilingual WhatsApp sharing, and verifiable PDF/CSV impact reports for board and sustainability audit compliance.

---

## ⏱️ 2-Minute Guided Demo Script

Experience the complete IrrigIQ field workflow in under two minutes:

1. **Open Agent Dashboard**: Navigate to `/today` (or `/agent/today`). Notice the high-contrast, mobile-first interface designed for single-handed operation in sunlight with touch targets $\ge 48\text{px}$.
2. **Review & Filter**: The agent views their assigned roster of 20 farmers. Tap the **"Needs Water"** filter chip to instantly isolate fields that have crossed their soil moisture deficit trigger.
3. **One-Tap WhatsApp Share**: Tap **"Share on WhatsApp"** for *Ramesh Kumar*. The browser opens WhatsApp directly with Ramesh's number and a pre-composed Hindi message (`wa.me` deep link):
   > *"नमस्ते रमेश जी, आज करनाल गेहूं फार्म में 110 मिनट (28,000 लीटर) सिंचाई करें। 3-फ़ेस बिजली: 09:00 - 15:00। पानी देने के बाद केवल मिनट लिखकर भेजें।"*
4. **Log Chat Diary**: The agent taps Send. Later, Ramesh replies with `110` (or Devanagari `११०`). IrrigIQ automatically parses the reply, logs a `PumpRunLog`, and recomputes the field's soil moisture balance.
5. **Mark Status**: Alternatively, if electricity tripped, the agent taps **"Mark Not Followed"** $\to$ selects reason chip `"No Electricity"`.
6. **Generate Audit-Ready Impact Report**: Switch to `/pilot-metrics` $\to$ tap **Download PDF Report**. Inspect the generated bilingual PDF containing water application ratios, side-by-side rainfall context, and the mandatory *"What This Does Not Prove"* caveat.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Client [Mobile PWA (Client Tier)]
        PWA["Offline-First React 19 PWA\n(Tailwind v4 + Lucide Icons)"]
        IDB["IndexedDB (Dexie / Offline Mark Queue)"]
        SW["Service Worker (Workbox PWA Precaching)"]
        PWA <--> IDB
        PWA <--> SW
    end

    subgraph API [Backend API Core (Node.js 22 + Express 5)]
        Router["Express Router & RBAC Middleware\n(Multi-tenant Org Scoping)"]
        Engine["FAO-56 Soil Water Balance Engine\n(@irrigiq/shared)"]
        Scheduler["BullMQ 6 Distributed Job Scheduler\n(05:00 AM IST Cron)"]
        PDFGen["Playwright Headless Chromium\n(Indic HarfBuzz Shaping)"]
        Router --> Engine
        Router --> PDFGen
        Scheduler --> Engine
    end

    subgraph Storage [Persistent Data & Cache]
        Mongo[("MongoDB 7.0+\n- GeoJSON 2dsphere\n- Time-series Telemetry\n- Encrypted Farmer PII")]
        Redis[("Redis 7.0+\n- 6-Hour Weather Cache\n- Distributed Mutex Locks\n- BullMQ Job Queue")]
        Engine <--> Mongo
        Engine <--> Redis
        Scheduler <--> Mongo
        Scheduler <--> Redis
    end

    subgraph External [External Services & Field Channels]
        OpenMeteo["Open-Meteo Forecast API\n(0.1° Grid FAO-56 ET0)"]
        WhatsApp["WhatsApp wa.me Deep Links\n(Agent Assisted Sharing)"]
        Telegram["Telegram Bot API\n(Direct Automated Channel)"]
        IoTSensors["Field IoT Sensors\n(Optional HTTP Telemetry)"]
        Scheduler -->|Daily Weather Sync| OpenMeteo
        Router -->|One-Tap Links| WhatsApp
        Router -->|Advisory Alerts| Telegram
        IoTSensors -->|Stream Moisture| Router
    end

    PWA -->|Authenticated REST API| Router
```

---

## 📊 Pilot Summary (Field Trial Telemetry)

> [!NOTE]
> **Awaiting Field Cohort Completion**:  
> This summary table remains intentionally unpopulated until empirical telemetry from active 5-week field cohorts is gathered and verified. In accordance with IrrigIQ engineering ethics, no synthetic numbers, ungrounded savings claims, or speculative assumptions are presented as verified pilot results.

| Metric | Baseline Routine | Advised Period | Observed Delta | Audited Status |
| :--- | :---: | :---: | :---: | :---: |
| **Observation Window** | *TBD* | *TBD* | - | Pending Field Trial |
| **Cohort Rainfall ($mm$)** | *TBD* | *TBD* | - | Pending Field Trial |
| **Application Ratio** | *TBD* | *TBD* | - | Pending Field Trial |
| **Average Pump Hours / Week** | *TBD* | *TBD* | - | Pending Field Trial |
| **Weekly Pumping Cost (INR)** | *TBD* | *TBD* | - | Pending Field Trial |
| **Adherence Rate (%)** | - | *TBD* | - | Pending Field Trial |

---

## 💰 Cost per Farmer (Unit Economics)

IrrigIQ is designed for extreme capital efficiency, enabling extension providers to serve smallholder farmers for **₹20–₹35 per farmer per month**:

| Cost Driver | Unit Consumption / Month | Unit Price Assumption | Monthly Cost (INR) |
| :--- | :--- | :--- | :---: |
| **Outbound Messaging** | ~30 advisories via WhatsApp / Telegram | ₹0.20 per message | ₹6.00 |
| **Cloud Storage** | Field boundaries, logs & telemetry (0.05 GB) | ₹2.00 per GB-month | ₹0.10 |
| **Server & API Computations** | ~600 requests (daily checks, syncs, diary) | ₹0.10 per 1,000 requests | ₹0.06 |
| **Agent Operational Overhead** | Extension worker fractional time (~10 min/mo) | Standard NGO/FPO stipend | ~₹15.00 – ₹25.00 |
| **Total Cost-to-Serve** | - | - | **₹21.16 – ₹31.16 / farmer / mo** |

*All cloud infrastructure unit prices are configurable assumptions surfaced explicitly in report exports.*

---

## 🔍 Honest Limitations

1. **Weather Forecast Resolution**: Open-Meteo utilizes ~11 km ($0.1^\circ$) spatial grid cells. Localized convective thunderstorms ("micro-bursts") can produce rain on one farm while leaving another dry within the same cell. Ground rain gauges remain essential for precise reconciliation.
2. **Pump Discharge Assumptions**: Unless calibrated with a physical drum test, manufacturer nameplate pump discharge ratings often deviate by $\pm 25\%$ due to bore-well drawdown, pipe friction, and voltage fluctuations.
3. **Observational Nature**: This platform provides operational agricultural telemetry; it is not a randomized controlled trial (RCT). Differences in observed water use between seasonal periods cannot be definitively attributed to software advice alone without concurrent unadvised control groups.
4. **Rural Grid Volatility**: Even the best pump schedule fails if the 3-phase agricultural electricity feeder suffers an unscheduled outage.

---

## ✂️ What I Cut and Why

To maintain focus, reliability, and smallholder adoption, key features were deliberately cut:

1. **Cut: Direct WhatsApp Business Cloud API in favor of `wa.me` Deep-Links**
   - *Why*: Meta's enterprise API requires corporate registration, pre-approved message templates, and charges per-conversation fees that destroy smallholder economics. Using `wa.me` deep links empowers the local field agent to review and send messages from their existing phone with zero API overhead.
2. **Cut: Mandatory In-Ground IoT Soil Moisture Sensors**
   - *Why*: Hardware probes cost $50–$150 each, require calibration, and suffer from rodent chewing, plow damage, and battery failure. We made IoT sensors strictly optional telemetry while relying on the proven FAO-56 Penman-Monteith meteorological water balance as the primary engine.
3. **Cut: Speculative Crop Yield Prediction AI Models**
   - *Why*: Crop yield is governed by seed genetics, fertilizer timing, pest outbreaks, and harvest weather—not just water. Making speculative yield increase claims without controlled agronomic trials damages farmer trust. We focus strictly on verifiable water and energy accounting.
4. **Cut: Heavy Vector Mapping Libraries on Mobile**
   - *Why*: Loading large Mapbox/Google Maps JS bundles crashes low-end Android smartphones on 2G/3G networks. We replaced heavy client mapping with lightweight simplified GeoJSON boundaries and single-tap GPS pin/radius fallbacks, keeping initial page load under 3 seconds.

---

## 🧪 Automated Testing & Quality Gates

IrrigIQ enforces strict automated quality gates across all workspaces:

```bash
# 1. Run all unit and integration test suites (including Phases 24-27)
npm test

# 2. Static typechecking across TypeScript workspaces (zero errors)
npm run typecheck

# 3. Code quality & style linting
npm run lint

# 4. End-to-end user journey tests with Playwright
npm run e2e
```

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
