# 📊 IrrigIQ Pilot Evaluation & Results Report

> **Pilot Name**: [e.g. Western Maharashtra Sugarcane & Wheat Cohort]  
> **Implementing Partner / Cooperative**: [Name of Organization]  
> **Evaluation Period**: [Start Date] to [End Date] (Total Weeks: ____)  
> **Report Date**: [YYYY-MM-DD]  
> **Report Author / Lead**: [Name and Title]  

---

## 1. Executive Summary
* **Cohort Summary**: ____ Farmers across ____ Villages managing ____ Fields (Total Area: ____ Hectares / Acres).
* **Target Crops**: [e.g. Wheat, Potato, Sugarcane, Cotton].
* **Primary Finding**: [Brief 2-3 sentence overview of water accounting, farmer adherence, and key operational takeaways].

---

## 2. Cohort Metadata & Operational Setup

| Parameter | Recorded Value | Notes & Verification |
| :--- | :--- | :--- |
| **Total Enrolled Farmers** | ____ | Verified via `FarmerRecord` |
| **Total Active Fields** | ____ | Mapped with GPS pin/polygon |
| **Predominant Soil Types** | [Loam / Sandy / Clay] | Local soil test or observation |
| **Irrigation Methods** | [Drip ___%, Flood ___%, Sprinkler ___%] | In-field verification |
| **Average Pump Discharge** | ____ Litres/Hour | Drum calibration test |
| **Power Window Schedule** | [Day Shift / Night Shift Rotational] | MSEDCL / UHBVN / PSPCL feeder |

---

## 3. Water Accounting & Comparison Table

> [!WARNING]
> **Mandatory Notice**: Savings figures MUST be presented side-by-side with baseline rainfall and advised rainfall figures.

| Water Accounting Metric | Baseline Period (Unadvised) | Advised Period (IrrigIQ Active) | Difference / Impact |
| :--- | :--- | :--- | :--- |
| **Observation Dates** | `YYYY-MM-DD` to `YYYY-MM-DD` | `YYYY-MM-DD` to `YYYY-MM-DD` | - |
| **Period Duration (Days)** | ____ days | ____ days | - |
| **Total Natural Rainfall** | **____ mm** | **____ mm** | Δ = ____ mm |
| **Net Crop Water Need ($ET_c - P_{\text{eff}}$)** | ____ mm | ____ mm | - |
| **Gross Water Applied** | ____ mm (____ Litres) | ____ mm (____ Litres) | Δ = ____ mm (____ %) |
| **Application Ratio** | **____** *(or "Not enough data")* | **____** | - |
| **Average Pump Hours / Week** | ____ hrs / week | ____ hrs / week | Δ = ____ hrs / week |
| **Average Pumping Cost / Week** | ₹____ / week | ₹____ / week | Δ = ₹____ / week |

---

## 4. Farmer Adherence & Advisory Telemetry

* **Advisories Delivered**: ____ total advisories sent.
* **Farmer Reply Rate**: ____ % (____ inbound replies received).
* **Adherence Rate**: ____ % of recommended actions followed.
* **Top Reasons When Not Followed**:
  1. [e.g. Rural power outage / feeder trip: ____ %]
  2. [e.g. Pump mechanical breakdown: ____ %]
  3. [e.g. Labor unavailable for pipe movement: ____ %]
  4. [e.g. Neighbor's canal runoff: ____ %]

---

## 5. Cost-to-Serve & Economic Viability

* **Total Messages Dispatched**: ____ messages @ ₹0.20/msg = ₹____
* **Database & Cloud Storage Footprint**: ____ GB @ ₹2.00/GB-mo = ₹____
* **API & Telemetry Transactions**: ____ requests @ ₹0.10/1k = ₹____
* **Normalized Monthly Cost-to-Serve**: **₹____ per farmer per month**.
* **Farmer ROI / Benefit Ratio**: Farmer saved approx ₹____ in electricity/diesel versus ₹____ cost to serve.

---

## 6. Mandatory Caveats: What This Does Not Prove

> [!CAUTION]
> **What This Observational Pilot Does Not Prove**:  
> 1. **Non-RCT Observational Design**: This pilot did not include a concurrent, blinded, randomized control group (RCT). Differences in observed water use cannot be conclusively isolated from seasonal crop growth dynamics without randomized controls.  
> 2. **Weather Disparities**: Rainfall timing, humidity, and temperature variations between the baseline period (Rain: ____ mm) and advised period (Rain: ____ mm) directly influence farmer pumping behavior.  
> 3. **Self-Reported Baseline**: Historical baseline routines were self-reported by farmers rather than measured through sealed water meters.  
> 4. **No Causal Yield Claim**: This trial measured water accounting and pumping runtimes; it makes no causal claims regarding crop yield enhancement or soil nutrient retention.

---

## 7. Raw Telemetry Audit Trail
* Attach generated raw CSV export: `irrigiq-pilot-raw-data-[date].csv`.
* Attach official bilingual PDF report: `irrigiq-pilot-report-[lang]-[date].pdf`.
