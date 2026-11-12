# 🛡️ Agronomic & Operational Safety Rules

To ensure farmer safety, crop health, and equipment protection, the IrrigIQ recommendation engine and pilot field protocols enforce mandatory safety thresholds.

---

## 1. Crop Root-Zone Hydrology Guardrails

### A. Maximum Single Application Depth (`maxDepthMm`)
* Irrigation depth must never exceed the soil texture's safe water holding capacity:
  - **Sandy Soil**: Capped at **35 mm** per event.
  - **Loam Soil**: Capped at **50 mm** per event.
  - **Clay Soil**: Capped at **65 mm** per event.
* **Reason**: Prevents anaerobic root saturation, nutrient leaching into deep groundwater, and excessive surface ponding.

### B. Minimum Irrigation Depth
* No irrigation event is recommended below **5 mm**.
* **Reason**: Water volumes below 5 mm evaporate from crop foliage and dry soil surfaces before infiltrating into the active root zone.

### C. Severe Heat & Desiccation Safeguard
* If forecast maximum temperature exceeds **$42^\circ\text{C}$** or soil moisture telemetry drops below **$30\%$**, a stress mitigation irrigation is scheduled regardless of interval, capping runtime at `maxDepthMm`.

### D. Rainfall Cancellation Threshold
* If forecast precipitation for the day is **$\ge 5\text{ mm}$**, any scheduled irrigation is automatically converted to `skip` with key `reason.rain_expected`.
* If heavy rainfall ($\ge 25\text{ mm}$) occurs, cumulative soil moisture deficit resets to zero.

---

## 2. Pumping & Spray Safety Guardrails

### A. High Wind Sprinkler Cut-Off
* When forecast maximum wind speed exceeds **$20\text{ km/h}$**, sprinkler irrigation recommendations are delayed or flagged with a spray-drift caution.
* **Reason**: Wind speeds above 20 km/h cause significant droplet evaporation, pattern distortion, and spray drift onto neighboring non-target crops.

### B. Agricultural Power Window Enforcement
* In most Indian states (e.g. Maharashtra, Punjab, Haryana, Rajasthan), agricultural 3-phase electricity is restricted to rotational 6-to-8 hour windows, often shifting between day and night shifts every week.
* The recommendation engine maps required pump runtime against the field's designated power schedule. If runtime exceeds the window, it flags the remaining minutes or splits runtime across consecutive days.
* **Operator Safety**: Field agents must instruct farmers never to operate manual switchgear during thunderstorms or flood conditions.

---

## 3. Human Observation & Ground-Truthing Primacy

> [!CAUTION]
> **Human Primacy Principle**:  
> In any instance of conflict between satellite/meteorological telemetry and visual in-field inspection (e.g. standing water, visible crop wilting, or localized hail damage), the farmer's and field agent's visual ground observation **always takes precedence** over algorithmic advisories.
