# IrrigIQ Irrigation Science & Hydrological Calculations

IrrigIQ is built on the standardized **FAO Irrigation and Drainage Paper No. 56 (FAO-56)** methodology ("Crop Evapotranspiration: Guidelines for computing crop water requirements", Allen et al., 1998).

This document explains every formula in plain words, explains the fallback science, defines the crop and soil constants, and walks through a complete numerical example.

---

## 1. Core Principles in Plain Words

Plants need water to replace moisture lost through their leaves (transpiration) and from the surrounding soil surface (evaporation). Together, this loss is called **evapotranspiration (ET)**.

IrrigIQ calculates how much water a field loses each day, subtracts any rain the crop can actually absorb, factors in the water wasted during irrigation pumping, and produces a simple daily instruction for the farmer:

- **"Irrigate X mm (Y litres) tomorrow before 8:00 AM"**, or
- **"Skip today, soil moisture / rain is sufficient"**

---

## 2. Reference Evapotranspiration ($ET_0$)

### What it means

$ET_0$ (Reference Evapotranspiration) is the depth of water (in millimetres per day) evaporated from an extensive surface of standard green grass, well-watered, actively growing, and completely shading the ground. It represents the atmospheric evaporative demand driven by sunlight, air temperature, humidity, and wind.

### Primary Source: Open-Meteo API

IrrigIQ queries the Open-Meteo forecast API for daily $ET_0$ computed via the FAO-56 Penman-Monteith equation.

### Fallback Model: Hargreaves-Samani (1985)

When external forecast providers are unreachable or omit radiation data, IrrigIQ falls back to the **FAO-56 Hargreaves equation** (Eq. 52), which requires only daily maximum temperature ($T_{\max}$), daily minimum temperature ($T_{\min}$), latitude, and the day of the year:

$$ET_0 = 0.0023 \times (T_{\text{mean}} + 17.8) \times \sqrt{T_{\max} - T_{\min}} \times R_a$$

Where:

- $T_{\text{mean}} = \frac{T_{\max} + T_{\min}}{2}$ (in $^\circ\text{C}$)
- $\sqrt{T_{\max} - T_{\min}}$ acts as a proxy for solar radiation and cloud cover (a large difference indicates clear skies and high radiation; a small difference indicates cloudy/humid days).
- $R_a$ is **extraterrestrial radiation** in $\text{mm/day}$ equivalent evaporation, computed purely from astronomical geometry (latitude $\phi$ and day of year $J$).

#### Astronomical Calculation of $R_a$ (FAO-56 Eqs. 21–28):

1. **Inverse relative distance Earth–Sun ($d_r$):**
   $$d_r = 1 + 0.033 \cos\left(\frac{2\pi}{365} J\right)$$

2. **Solar declination ($\delta$):**
   $$\delta = 0.409 \sin\left(\frac{2\pi}{365} J - 1.39\right)$$

3. **Sunset hour angle ($\omega_s$):**
   $$\omega_s = \arccos\left(\max\left(-1, \min\left(1, -\tan(\phi) \tan(\delta)\right)\right)\right)$$

4. **Extraterrestrial radiation ($R_a$ in $\text{MJ}/(\text{m}^2 \cdot \text{day})$):**
   $$R_a = \frac{24 \times 60}{\pi} G_{sc} \, d_r \left[\omega_s \sin(\phi) \sin(\delta) + \cos(\phi) \cos(\delta) \sin(\omega_s)\right]$$
   _(where solar constant $G\_{sc} = 0.0820\text{ MJ}/(\text{m}^2 \cdot \text{min})$)._

5. **Conversion to equivalent evaporation:**
   $$R_a (\text{mm/day}) = 0.408 \times R_a (\text{MJ}/(\text{m}^2 \cdot \text{day}))$$

---

## 3. Crop Coefficient ($Kc$) and Growth Stages

### What it means

A tiny seedling uses far less water than a full-grown plant with dense green foliage. The **Crop Coefficient ($Kc$)** is a crop-specific multiplier that scales $ET_0$ according to the plant's current stage of development.

### The Four FAO-56 Growth Stages

1. **Initial Stage (`ini`):** From sowing/transplanting until ~10% ground cover. Soil evaporation dominates; $Kc$ is constant at $Kc_{\text{ini}}$.
2. **Development Stage (`dev`):** From 10% ground cover to full canopy/flowering. Foliage expands rapidly; $Kc$ increases linearly from $Kc_{\text{ini}}$ to $Kc_{\text{mid}}$.
3. **Mid-Season Stage (`mid`):** From flowering through yield formation. Water consumption peaks; $Kc$ is constant at $Kc_{\text{mid}}$.
4. **Late Season Stage (`late`):** From ripening/maturation until harvest. Foliage yellows and senesces; $Kc$ decreases linearly from $Kc_{\text{mid}}$ to $Kc_{\text{end}}$.
5. **Finished (`finished`):** Post-harvest. $Kc = \text{null}$; irrigation recommendation stops.

```
       Kc
       ^
Kc_mid |             +--------------------+
       |            /                      \
       |           /                        \
Kc_ini |----------+                          +
       |                                      \
Kc_end |                                       +
       +----------+-----------------------+----+---> Time (Days After Sowing)
         Initial        Development         Mid    Late
```

### Continuous Interpolation Formulas

To avoid sharp artificial jumps on stage transition days, IrrigIQ uses smooth piecewise linear curves:

- **During Initial Stage ($t < \text{ini}$):**
  $$Kc(t) = Kc_{\text{ini}}$$

- **During Development Stage ($\text{ini} \le t < \text{ini} + \text{dev}$):**
  $$Kc(t) = Kc_{\text{ini}} + \frac{t - (\text{ini} - 1)}{\text{dev} + 1} \times (Kc_{\text{mid}} - Kc_{\text{ini}})$$

- **During Mid-Season Stage ($\text{ini} + \text{dev} \le t < \text{ini} + \text{dev} + \text{mid}$):**
  $$Kc(t) = Kc_{\text{mid}}$$

- **During Late Season Stage:**
  $$Kc(t) = Kc_{\text{mid}} + \frac{t - (\text{ini} + \text{dev} + \text{mid} - 1)}{\text{late} + 1} \times (Kc_{\text{end}} - Kc_{\text{mid}})$$

### Starter Crop Table (India Focus)

_Note: Verify against FAO-56 Tables 11 and 12 and local State Agriculture University (SAU/ICAR) advisories._

| Crop Key    | English Name | Hindi Name | $Kc_{\text{ini}}$ | $Kc_{\text{mid}}$ | $Kc_{\text{end}}$ | Stage Days (`ini` / `dev` / `mid` / `late`) | Total Days |
| :---------- | :----------- | :--------- | :---------------: | :---------------: | :---------------: | :-----------------------------------------: | :--------: |
| `wheat`     | Wheat        | गेहूं      |       0.30        |       1.15        |       0.30        |              20 / 25 / 60 / 30              |    135     |
| `rice`      | Rice (Paddy) | धान (चावल) |       1.05        |       1.20        |       0.90        |              30 / 30 / 60 / 30              |    150     |
| `maize`     | Maize (Corn) | मक्का      |       0.30        |       1.20        |       0.60        |              25 / 40 / 40 / 30              |    135     |
| `cotton`    | Cotton       | कपास       |       0.35        |       1.15        |       0.50        |              30 / 50 / 60 / 55              |    195     |
| `sugarcane` | Sugarcane    | गन्ना      |       0.40        |       1.25        |       0.75        |             35 / 60 / 190 / 120             |    405     |
| `tomato`    | Tomato       | टमाटर      |       0.60        |       1.15        |       0.80        |              30 / 40 / 40 / 25              |    135     |
| `potato`    | Potato       | आलू        |       0.50        |       1.15        |       0.75        |              25 / 30 / 45 / 30              |    130     |
| `onion`     | Onion (Dry)  | प्याज      |       0.70        |       1.05        |       0.75        |              15 / 25 / 70 / 40              |    150     |

---

## 4. Crop Water Need ($ET_c$)

### Formula

$$ET_c = ET_0 \times Kc$$

$ET_c$ is the exact depth of water (in mm) that the crop transpires and evaporates on that day under ideal conditions.

---

## 5. Effective Rainfall ($\text{P}_{\text{eff}}$)

### What it means

Not all rain enters the crop's root zone:

1. **Light drizzle ($\le 5\text{ mm}$):** Wets only the plant surface and top few millimetres of soil; it evaporates within hours before roots can take it up.
2. **Heavy rain:** Part of the volume runs off the surface or percolates beyond the root zone.

### IrrigIQ Rule

$$\text{effectiveRain} = \begin{cases} 0 & \text{if } \text{rain} \le 5\text{ mm} \\ 0.80 \times (\text{rain} - 5\text{ mm}) & \text{if } \text{rain} > 5\text{ mm} \end{cases}$$

_Example:_ A $12\text{ mm}$ rain yields $0.80 \times (12 - 5) = 5.60\text{ mm}$ of usable root moisture.

---

## 6. Net Irrigation Requirement ($\text{I}_{\text{net}}$)

### Formula

$$\text{netNeed} = \max(0, ET_c - \text{effectiveRain})$$

If effective rain exceeds or matches $ET_c$, the net water need is $0\text{ mm}$ (no irrigation required).

---

## 7. Application Efficiency & Gross Irrigation ($\text{I}_{\text{gross}}$)

### What it means

When a farmer pumps water, some is lost to wind drift, canal seepage, and uneven distribution. To deliver $1\text{ mm}$ of net water to the roots, the farmer must pump more than $1\text{ mm}$.

$$\text{grossNeed} = \frac{\text{netNeed}}{\text{efficiency}}$$

### Standard Efficiency Values (FAO-56):

- **Drip Irrigation:** $0.90$ ($90\%$ efficient)
- **Sprinkler Irrigation:** $0.75$ ($75\%$ efficient)
- **Flood (Surface) Irrigation:** $0.60$ ($60\%$ efficient)

---

## 8. Converting Millimetres to Litres

Depth in millimetres expresses water volume relative to ground surface:

- $1\text{ mm}$ of water over $1\text{ m}^2 = 1\text{ litre}$.
- $1\text{ hectare} = 10,000\text{ m}^2$.
- $1\text{ acre} \approx 4,046.86\text{ m}^2$.

### Formulas

$$\text{Litres} = \text{grossNeed (mm)} \times \text{area (ha)} \times 10,000$$
$$\text{Depth (mm)} = \frac{\text{Litres}}{\text{area (ha)} \times 10,000}$$

---

## 9. Soil Water Deficit Triggers & Application Limits

To prevent energy waste from irrigating trivial amounts every day and to avoid drowning roots, IrrigIQ tracks the accumulated soil moisture deficit against soil-specific thresholds:

| Soil Type | Trigger Deficit ($\text{mm}$) _(when to irrigate)_ | Max Single Depth ($\text{mm}$) _(to avoid runoff)_ |
| :-------- | :------------------------------------------------: | :------------------------------------------------: |
| **Sandy** |                   $12\text{ mm}$                   |                   $25\text{ mm}$                   |
| **Loam**  |                   $20\text{ mm}$                   |                   $40\text{ mm}$                   |
| **Clay**  |                   $25\text{ mm}$                   |                   $50\text{ mm}$                   |

---

## 10. Worked Examples

### Scenario A: Dry Sunny Day (Tomato, Mid-season, Drip, 0.5 ha)

- Weather forecast: $ET_0 = 5.0\text{ mm/day}$, $\text{Rain} = 0\text{ mm}$.
- Crop: Tomato in mid-season ($Kc = 1.15$).
- Irrigation method: Drip (efficiency $= 0.90$).
- Field area: $0.5\text{ ha}$ ($1.235\text{ acres}$).

1. **Crop need ($ET_c$):**
   $$ET_c = 5.0 \times 1.15 = 5.75\text{ mm}$$
2. **Effective rain:**
   $$\text{effectiveRain} = 0\text{ mm}$$
3. **Net need:**
   $$\text{netNeed} = 5.75 - 0 = 5.75\text{ mm}$$
4. **Gross depth to pump:**
   $$\text{grossNeed} = \frac{5.75}{0.90} \approx 6.39\text{ mm}$$
5. **Total water volume:**
   $$\text{Litres} = 6.39 \times 0.5 \times 10,000 = 31,950\text{ litres}$$

_Action:_ **Irrigate 6.4 mm (~31,950 litres)**.

---

### Scenario B: Rainy Day (Same Field, 12 mm Rain Forecast)

- Weather forecast: $ET_0 = 5.0\text{ mm}$, $\text{Rain} = 12.0\text{ mm}$.

1. **Crop need ($ET_c$):**
   $$ET_c = 5.75\text{ mm}$$
2. **Effective rain:**
   $$\text{effectiveRain} = 0.80 \times (12.0 - 5.0) = 5.60\text{ mm}$$
3. **Net need:**
   $$\text{netNeed} = \max(0, 5.75 - 5.60) = 0.15\text{ mm}$$

_Action:_ Since accumulated deficit is below the loam trigger ($20\text{ mm}$), the recommendation is:
**"Skip today, rain is expected"** (saving ~31,950 litres of groundwater!).
