# 📐 IrrigIQ Pilot Metrics Definitions & Accounting Standards

This specification defines the exact formulas, data types, and reporting rules for IrrigIQ pilot evaluations and impact reports.

---

## 1. Application Ratio (Primary Water Accounting Metric)

### Mathematical Definition
The **Application Ratio** measures the volumetric depth of gross water applied to a field relative to the scientific net crop water requirement over a specified time window:

$$\text{Application Ratio} = \frac{\text{Actual Gross Water Applied } (mm)}{\text{Net Crop Water Need } (mm)}$$

Where:
* $\text{Actual Gross Water Applied } (mm) = \frac{\text{Total Pumped Litres}}{10,000 \times \text{Field Area } (ha)}$
* $\text{Net Crop Water Need } (mm) = \max\left(0, \sum_{t} (ET_{c,t} - P_{\text{eff},t})\right)$
* $ET_{c,t} = ET_{0,t} \times K_{c,t}$ (FAO-56 Penman-Monteith crop evapotranspiration)
* $P_{\text{eff},t} = \max(0, (P_t - 5) \times 0.75)$ (Effective precipitation reaching the root zone)

### Interpretation Spectrum
| Application Ratio Range | Agronomic Meaning | Operational Status |
| :--- | :--- | :--- |
| **$> 1.30$** | **Substantial Over-irrigation** | Significant excess water applied; risk of root suffocation, anaerobic soil conditions, nutrient leaching, and wasted pumping energy. |
| **$0.90 \le \text{Ratio} \le 1.20$** | **Optimal Alignment** | Water applied closely matches crop evapotranspirative demand while accounting for method distribution efficiency. |
| **$< 0.85$** | **Deficit / Under-irrigation** | Applied water is below net crop demand. Permissible only in deliberate protective irrigation or rain-fed stress-hardening stages. |

### Strict Empty Baseline Handling Rule
> [!IMPORTANT]
> **No Synthetic Zeroes or Guesses**:  
> If an unadvised baseline period contains no logged application records (e.g. newly registered farmers without pre-pilot telemetry), the Application Ratio MUST NOT return `0.00`, `NaN`, or an arbitrary number.  
> The system strictly returns `{ status: 'not_enough_data', ratio: null, ratioFormatted: 'Not enough data' }` (or `'डेटा अपर्याप्त'` in Hindi).

---

## 2. Mandatory Climate-Coupled Savings Rule

> [!WARNING]
> **Rule: Never show a saving without the period and rain figures beside it.**  
> Observed differences in irrigation between two calendar periods are heavily confounded by natural rainfall and seasonal weather shifts. IrrigIQ strictly prohibits displaying a water or electricity saving figure without publishing the baseline period dates, advised period dates, baseline rainfall ($mm$), and advised rainfall ($mm$) in the immediate context.

### Required Reporting Format
```
Water difference: 25.0 mm (24.5%) 
[Baseline Rain: 4.0 mm (2026-09-01 to 2026-09-14) vs Advised Rain: 16.5 mm (2026-09-15 to 2026-09-28)]
```
If baseline has insufficient data, the savings output must explicitly state:
*"Baseline period has insufficient data; water savings cannot be computed against advised period."*

---

## 3. Engagement & Telemetry Metrics

### A. Advice Delivered
* **Formula**: Count of records where `adviceSent === true` (either via outbound channel message or agent WhatsApp share).
* **Unit**: Integer count of advisories.

### B. Farmer Reply Rate
* **Formula**: $\text{Reply Rate} = \frac{\text{Replies Received}}{\text{Advice Delivered}} \times 100\%$
* **Handling**: If `adviceDelivered === 0`, returns `0.0%`. Capped at $100\%$.

### C. Days Advice Followed
* **Formula**: Count of distinct calendar dates where the farmer either logged a pumping event matching the advice, or was confirmed `followed` via agent field check.

### D. Weekly Pump Runtime & Cost
* **Pump Hours per Week**: $\frac{\sum \text{Pump Minutes} / 60}{\text{Days in Period} / 7}$
* **Pump Cost per Week**: $\frac{\sum \text{Pump Cost (INR)}}{\text{Days in Period} / 7}$
  * Costs are computed from the farmer's specific `costPerHour` (electricity tariff or diesel expenditure), never hardcoded estimates.

---

## 4. Cost-to-Serve per Farmer per Month

To provide transparent unit economics for agricultural cooperatives, FPOs, and buyers, IrrigIQ tracks actual cloud infrastructure utilization across three drivers:

1. **Messages Sent ($M$)**: WhatsApp messages, Telegram alerts, and transactional notifications.
2. **Database Storage ($S$)**: Cold and hot data footprint (field records, polygons, sensor logs).
3. **API & Server Requests ($R$)**: REST API calls, mobile syncs, and telemetry ingestion.

### Cost-to-Serve Formula
$$\text{Cost to Serve} = \frac{(M \times C_{\text{msg}}) + (S \times C_{\text{storage}}) + \left(\frac{R}{1000} \times C_{\text{req}}\right)}{\text{Period Days}} \times 30$$

$$\text{Monthly Cost per Farmer} = \frac{\text{Total Monthly Cost}}{\text{Active Farmers}}$$

### Configurable Engineering Assumptions (Defaults)
* $C_{\text{msg}}$: **₹0.20** per outbound message.
* $C_{\text{storage}}$: **₹2.00** per GB-month database storage.
* $C_{\text{req}}$: **₹0.10** per 1,000 backend API requests.
* **Disclaimer**: All unit prices are configurable engineering assumptions and must be shown with assumptions notes in all exported reports.

