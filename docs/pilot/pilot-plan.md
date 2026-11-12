# 📋 IrrigIQ 5-Week Pilot Deployment Plan

## Executive Overview

The IrrigIQ 5-Week Pilot is an observational field trial designed to validate advisory delivery, farmer adherence, pump energy savings, and application ratios across a cohort of smallholder farmers (typically 20–50 farmers per cluster) managed by local agricultural extension agents.

```mermaid
flowchart LR
    W1["Week 1\nOnboarding & Baseline"] --> W2["Week 2\nShadow Observation"]
    W2 --> W3["Week 3\nAdvisory Launch"]
    W3 --> W4["Week 4\nFull Advisory & Diary"]
    W4 --> W5["Week 5\nEvaluation & Report"]
```

---

## Detailed Week-by-Week Execution

### Week 1: Onboarding, Field Calibration & In-Person Consent

* **Objectives**:
  - Establish organization workspace and assign field agents.
  - Collect baseline farm parameters and historical routines.
  - Record explicit farmer consent before any digital communication begins.
* **Agent Checklist**:
  - [ ] **CSV Import**: Upload cohort farmers and plots using the CSV template (`docs/pilot/baseline-sheet.csv`).
  - [ ] **Field Boundary Mapping**: Record field centroid (pin) or polygon boundary in `FieldWizard`.
  - [ ] **Pump Discharge Calibration**: Conduct a 200-litre drum test to measure actual pump discharge rate (litres per hour) rather than trusting pump nameplates.
  - [ ] **Power Window Verification**: Note the local rural 3-phase electricity distribution timings (day/night shifts).
  - [ ] **Consent Registration**: Read the versioned consent script in the farmer's native language (`docs/pilot/consent-template.md`), record verbal or in-person consent, and submit `POST /farmers/:id/consent`.
  - [ ] **Baseline Routine Recording**: Record the farmer's traditional routine (interval in days, depth in mm, weekly pump hours).

---

### Week 2: Shadow Observation (Unadvised Baseline Period)

* **Objectives**:
  - Measure actual farmer water application and pumping habits without intervention.
  - Verify weather forecasting accuracy against local rainfall.
  - Test agent dashboard connectivity and offline caching.
* **Agent Checklist**:
  - [ ] **No Advisory Dispatched**: Do not send irrigation recommendations to farmers during this week.
  - [ ] **Daily Application Logging**: Check in with farmers to log whenever they irrigate (date, minutes pumped, source: manual) using `daily-log-sheet.csv`.
  - [ ] **Rain Gauge Tracking**: Record daily rainfall from local rain gauge or village station to validate Open-Meteo forecast grid data.
  - [ ] **Agent System Check**: Ensure agents can open `/today` offline in remote fields with precached farmer rosters.

---

### Week 3: Advisory Launch & Assisted Sharing

* **Objectives**:
  - Initiate daily morning advisories (05:00 AM IST) calculated from the FAO-56 Penman-Monteith engine.
  - Implement agent-assisted WhatsApp sharing via `wa.me` links.
  - Track initial delivery, read rates, and farmer feedback.
* **Agent Checklist**:
  - [ ] **05:00 AM Advisory Review**: Agent opens `/today` dashboard on their mobile device.
  - [ ] **Filter Priority**: Review "Needs Water" and "Pending Send" lists.
  - [ ] **One-Tap WhatsApp Share**: Tap **"Share on WhatsApp"** for each farmer. The pre-composed bilingual message opens in WhatsApp with the farmer's number prefilled. Agent taps Send.
  - [ ] **Telegram Dispatch**: For farmers linked to Telegram, send instant advisory directly via the dashboard.
  - [ ] **Evening Status Log**: Record whether farmers irrigated or skipped. Note any constraints (e.g. power outage, pump mechanical failure).

---

### Week 4: Full Advisory Operation & Chat Diary Logging

* **Objectives**:
  - Farmers actively interact with the advisory system.
  - Capture pump runtimes reported via SMS/WhatsApp chat replies (Latin or Devanagari numbers).
  - Automatically recompute soil moisture balance and next irrigation triggers.
* **Agent Checklist**:
  - [ ] **Reply Diary Processing**: Monitor inbound farmer replies (e.g., `90` or `९०` minutes). Verify system converts minutes to litres and logs `PumpRunLog`.
  - [ ] **Followed / Not Followed Tagging**: Use the Agent Today action buttons to tag farmers as `followed` or `not followed` with reason chips.
  - [ ] **Mid-Pilot Field Check**: Inspect crop root zone moisture for plots where irrigation was skipped to build farmer confidence.

---

### Week 5: Pilot Evaluation, Audit & Buyer Reporting

* **Objectives**:
  - Compile the 4–5 week dataset comparing baseline vs advised periods.
  - Calculate application ratios, pump energy savings, and cost-to-serve.
  - Generate bilingual PDF Impact Reports and raw CSV audit trails.
  - Conduct structured exit interviews with farmers and institutional buyers.
* **Agent & Admin Checklist**:
  - [ ] **Export Raw Telemetry CSV**: Download `GET /pilot-metrics/csv` to inspect daily records.
  - [ ] **Compile PDF Impact Report**: Generate `GET /pilot-metrics/pdf?lang=en` and `?lang=hi`.
  - [ ] **Verify Caveats**: Ensure all reports prominently feature the "What This Does Not Prove" section and weather disparity notices.
  - [ ] **Conduct Interviews**: Execute the farmer and buyer questionnaire (`docs/pilot/interview-script.md`).
  - [ ] **Present Findings**: Deliver the completed results report (`docs/pilot/results-template.md`) to cooperative management and pilot sponsors.

