# Rotation Lab: data and methods

Where every number in Rotation Lab comes from, how it is computed, and its limits.
For how the system is put together, see [architecture.md](architecture.md); for using the app, the [README](../README.md).

## Data used

Weather and climate numbers come from NASA POWER, the field's satellite record from NASA HLS, and the map layers from NASA GIBS (backdrops only). Every value in the UI can be traced back via
the *Data provenance* section, which shows the exact POWER request URL, retrieval time and whether the data came live,
from cache, or from the offline snapshot.

### 1. NASA POWER — daily point data (the core dataset)

- **API:** [POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) v2 (`/api/temporal/daily/point`), community `AG` (Agroclimatology), UTC days.
- **Period:** one download from 1 January 1981 to today (~16,700 days). The "climate now" analyses use the last 10 years (currently 2016 onwards); the full record feeds *then and now* and *crops then and now* (section 2b).
- **Spatial resolution:** meteorology on a 0.5° × 0.625° grid (≈ 55 × 35 km at 60° N). The map draws this cell as a dashed box.
- **Upstream sources** (as listed in the response header): `MERRA2`, `GEOSIT`, `SYN1DEG`, `POWER`.
  MERRA-2 reanalysis covers most of the record. GEOS-IT near-real-time fills the most recent 1–3 months. CERES SYN1deg provides solar irradiance.
- **Latency:** temperature and precipitation lag ~2 days. Solar irradiance can lag a few days longer, and missing latest values are hidden in the UI.

| Parameter | Meaning | Unit | Used for |
| --- | --- | --- | --- |
| `T2M` | Mean air temperature at 2 m | °C | GDD, sowing dates, anomalies |
| `T2M_MAX` / `T2M_MIN` | Daily max / min air temperature at 2 m | °C | ET₀, frost dates, heat-stress days |
| `PRECTOTCORR` | Precipitation, bias-corrected | mm/day | Rain totals, water balance, dry spells, crop water supply |
| `RH2M` | Relative humidity at 2 m | % | Blight-weather days (crops then and now) |
| `ALLSKY_SFC_SW_DWN` | All-sky surface shortwave irradiance | MJ/m²/day | Context |
| `GWETROOT` | Root-zone soil wetness (0 = dry, 1 = saturated) | – | Soil-moisture status and percentiles, tropical sowing onset |
| `GWETTOP` | Surface soil wetness | – | Soil-moisture chart/table |
| `WS2M` | Wind speed at 2 m | m/s | Context |

Fill values (`-999`) are treated as missing. Trailing missing days are normal latency, and interior gaps are counted and shown under *Data provenance*.

**Known data issue handled by the app:** where MERRA-2 hands over to GEOS-IT, root-zone soil wetness jumps to a
different baseline overnight (observed 2026-10-02: 0.93 → 0.52 in Stjørdal and 0.65 → 0.50 in Pergamino, Argentina, with no matching rain).
The app detects this splice automatically and does not compare the near-real-time segment with the 10-year history.
Soil percentiles and advisories use the last reanalysis day and state its date. The near-real-time values are shown separately (dashed in the chart).

### 2. NASA POWER — climatology (long-term normals)

- **API:** [POWER Climatology API](https://power.larc.nasa.gov/docs/services/api/temporal/climatology/) (`/api/temporal/climatology/point`), community `AG`.
- **Period:** 25-year climatology, **January 2001 – December 2025**. The app reads this from the response's `range` field rather than hard-coding it.
- **Parameters:** monthly means of `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`.
- **Used for:** the monthly temperature and rainfall anomaly charts.
  Other "normal" comparisons (30-day rain, 7-day temperature, soil-moisture percentiles, GDD envelope) are computed from the same location's 10-year daily record.

### 2b. NASA POWER — the full daily record since 1981 (then versus now)

The daily download covers **1 January 1981 to today** in one request (about 2.7 MB, cached; one weather model, MERRA-2, through 2025).
Everything about *your climate now* (conditions, frost dates, crop suitability, rotations, season tables) still uses **only the last 10 years**, so those results are unchanged.
The full record feeds **What has changed here** (field view) and **Then and now** (data view):

- Per complete season: frost-free season, last spring and first autumn frost, warmth for crops (GDD above 5 °C), growing-season mean temperature and rain (Apr–Sep north, Oct–Mar south), longest dry spell, heavy-rain days (≥ 20 mm), warm days (≥ 25 °C) and hot days (≥ 30 °C).
- **1991–2000 is compared with the last ten seasons.** A change is called *consistent* only when the whole 1981–today record trends the same way (Theil–Sen slope, Mann–Kendall p < 0.05), so two decades that merely differ are not reported as climate change.
- The field view lists consistent changes in plain words, without judging them good or bad (that depends on the grower's crops), and names the measures with no clear change.
- For a ~50 km grid cell, not the field; grid-cell rain smooths out local downpours, so heavy-rain days are undercounted.
- Stjørdal demo field: growing season +1.3 °C (8.8 → 10.1 °C), warmth for crops 850 → 1078 degree-days, growing-season rain 730 → 802 mm, days ≥ 25 °C 1.2 → 4.6 (all consistent).
  The frost-free season is longer on average (144 → 161 days) but too uneven year to year to call consistent (p = 0.26), so the app does not report it as a change.

#### Is this crop still a good choice here?

The crop-season simulation behind *Crops in your climate* is run over **every complete season since 1981** for one crop (any of the 13), and 1991–2000 is compared with the last ten seasons, counting each measure **while the crop is in the ground**:
ripened before frost (count of seasons), days in the ground, heat-stress days above the crop's limit, rain as a share of its water use (Kc × ET₀), and for potatoes **blight-weather days**.

- **Blight-weather day:** daily minimum ≥ 10 °C and daily mean humidity ≥ 85%. The official late-blight rules (Smith, Hutton) need *hourly* humidity; NASA POWER's daily record allows only this stand-in, so it shows how often the weather favours blight, not a warning. Both views point to the national warning service (VIPS in Norway) for spraying decisions.
- **"Ripened"** means the simulated crop reached its full thermal time before a killing frost. Early varieties and lifting or cutting before full maturity are not modelled, so it understates where a crop is grown in practice (potatoes are grown around Stjørdal, yet the main-crop profile ripens in only 6 of the last 10 seasons). The change over time is the more useful signal. Both views say so.
- Climate side only: prices, contracts and costs are the grower's to weigh.
- **Potato, Stjørdal:** ripened in 1 of 10 seasons in 1991–2000 and 6 of 10 now; **blight-weather days 9 → 13 a season** (consistent); no clear change in heat or water.
  **Barley, spring wheat and grass ley, Stjørdal:** ripen (or reach full growth) in nearly every season; they now need 18–30 fewer days in the ground (consistent).

### 3. NASA GIBS — satellite map layers

Served as Web Mercator WMTS tiles from `gibs.earthdata.nasa.gov/wmts/epsg3857/best`. Dated layers default to the most recent
available day, and you can choose any date in the map toolbar.

| Layer (GIBS identifier) | What it shows | Native resolution |
| --- | --- | --- |
| `MODIS_Terra_NDVI_8Day` (default) | Vegetation greenness, 8-day composite | 250 m |
| `SMAP_L4_Analyzed_Root_Zone_Soil_Moisture` | Root-zone soil moisture (SMAP Level 4) | ~9 km |
| `IMERG_Precipitation_Rate` | Daily precipitation (GPM IMERG) | ~10 km |
| `MODIS_Terra_Land_Surface_Temp_Day` | Daytime land-surface temperature | 1 km |
| `MODIS_Terra_CorrectedReflectance_TrueColor` | Daily true-color imagery | 250 m |
| `BlueMarble_ShadedRelief_Bathymetry` | Blue Marble relief (static) | 500 m |
| `VIIRS_Black_Marble` | Night lights, 2016 composite (static) | 500 m |

The GIBS layers are for visual context only; nothing is calculated from them. The numbers come from NASA POWER and NASA HLS.

### 4. NASA HLS: the field's own satellite record (when a field outline is drawn)

- **Product:** [HLS v2.0](https://lpdaac.usgs.gov/products/hlss30v002/) (Harmonized Landsat Sentinel-2) from NASA LP DAAC: 30 m surface reflectance from Landsat 8/9 (`L30`) and Sentinel-2 (`S30`), harmonised so both sensors can be used together.
- **Access:** the copy hosted openly on [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/hls2-s30) (collections `hls2-s30`, `hls2-l30`), with an anonymous access token. **No Earthdata login needed.** Only the pixels inside the field are read, using HTTP range requests on the cloud-optimised GeoTIFFs.
- **Per image:** pixels flagged by HLS **Fmask** as cloud, adjacent to cloud, cloud shadow, snow/ice or water are removed. Images with under 60% of the field clear are counted but give no value. **NDVI** = (NIR − Red)/(NIR + Red), **NDMI** = (NIR − SWIR1)/(NIR + SWIR1) and **EVI** = 2.5 (NIR − Red)/(NIR + 6 Red − 7.5 Blue + 1), each the median over the clear pixels.
  Bands: Sentinel-2 `B02`/`B04`/`B8A`/`B11`, Landsat `B02`/`B04`/`B05`/`B06`.
  The data view switches the greenness chart between NDVI and EVI. The last five seasons are coloured, older ones grey.
- **Archive:** the openly hosted HLS v2.0 collections start on **1 January 2020**, so the record covers every season from 2020 (seven seasons by 2026). NASA LP DAAC holds HLS back to 2013, but needs an Earthdata login, which the app avoids. The response says so (`archive.note`).
- **Seasons:** every season in the archive (or the last *n* with `seasons`), growing months only (Apr–Oct north, Oct–Apr south, all year in the tropics). Per season: images, clear images, green-up date, peak NDVI and date, mean NDVI, peak NDMI. Green-up is reported as *hidden by cloud* when no clear image exists in the three weeks before it.
- **Joined with weather:** the data view lines each satellite season up with the NASA POWER weather for the same season (rain, ET₀, longest dry spell, heat days). Both views then run the **season check** below.
- **Crop-type hints:** each season's curve is labelled *grass / ley* (green in late April–May and again in Sep–Oct), *autumn-sown* (green in spring, bare in autumn), *spring-sown* (bare until late May, peak before August), *late crop* (peak in August or later), *bare / failed* (peak NDVI below 0.5), *unclear*, or *too cloudy*.
  Each hint carries its evidence. The rules are for temperate seasons; southern dates are shifted six months, and the tropics are not covered.
  The field view calls these "likely" crops and says they are hints, not records. If the latest season's pattern differs from the crop the grower entered, it says so as an observation.
  An unclear or late curve that never drops below green (NDVI 0.5) from late July to early September and is still green in autumn is read as *grass / ley* (no harvest; see the area-around section).
  If that field was also **bare in late April–May** (NDVI below 0.4), it was sown that spring, so it is read as a **new ley**: often grass sown under a spring cereal, which is harvested while the grass keeps growing.
  **Checked against the crops the farm reported (demo field):** 2021–2024 grass ley, read as grass in all 4 seasons. 2020 barley was first read as grass; the curve was bare in May and green from July into October, the pattern of barley with grass sown under it, which matches grass from 2021. That case led to the *new ley* rule, and a new ley counts as fitting both a reported cereal and a reported ley.
- **Reported crops (any field in Norway):** the app finds the property under the field (Kartverket) and the farm based there, and shows that farm's reported crops 2017–2026 next to the satellite hints (`/api/farm-crops`).
  A year counts as this field's crop only when the farm had one crop on at least 95% of its arable land (pasture left out); other years show the farm's mix and are not compared.
  If several farms are based on the property, or none, it says so instead. Caveats shown with it: the farm may rent other land, and the field may be rented to another farm.
  The index (`data/farm_crops.json.gz`, 2.1 MB, 51,122 farms on 45,889 properties) is built by `scripts/build_farm_crops.py`; farm names and organisation numbers are left out, and the views do not show the property number.
- **Productivity zones:** stronger and weaker parts of the field, from **EVI** (less saturated than NDVI in dense crops) for every 30 m pixel.
  For each season, each pixel's 90th-percentile EVI (at least 3 clear images) is divided by the median of the field's interior pixels that season, which removes the effect of different crops in different years.
  These values are averaged over at least 2 seasons. Weaker means below 0.95 of the field median, stronger above 1.05.
  *Consistency* is the share of seasons in which a pixel fell on the same side of the median.
  **Edge pixels** overlap hedges, roads and neighbouring fields, so they are drawn but never classified. In testing, a hedgerow made edge pixels look "stronger" until they were excluded.
  If under 10% of the interior differs, the field is reported as uniform; with fewer than 8 interior pixels, as too small.
  The zones are **uncalibrated**: satellite greenness, not measured yield. Both views say so.
  Inspired by DigiFarm's productivity zones, which are calibrated on Norwegian yield data; ours are not.
  **Download:** both views export the zone map as GeoJSON: one 30 m square per pixel with `zone` and `zone_id` (1 weaker, 2 average, 3 stronger, 0 edge), relative EVI and consistency, ready to load into farm-machinery or GIS software for variable-rate planning.
- **This season against the field's usual range:** both greenness charts shade the field's usual range for this season's likely crop: lowest to highest NDVI, day by day, of the earlier seasons with the same crop hint (curves interpolated between clear images; no range across cloud gaps over 30 days; at least 2 seasons). One line under the chart says whether this season is within, mostly below or mostly above it. Only images inside the crop's own growing window count (as in the season check), allowing ±0.05 for sensor noise; "within" when ≥ 60% fall inside. Early in a season, before the crop is clear, it compares with all earlier seasons and says so.
  Demo result: Stjørdal 2026, within the grass range of 2021–2025 (23 of 24 images).
- **What's grown around you (within ~2 km):** every 30 m farmland pixel in a 4 × 4 km square around the field gets the same rule-based crop hint as the field (grass/ley, autumn-sown, spring-sown, late crop, bare, unclear), each season since 2020.
  Farmland = **ESA WorldCover 2021** cropland or grassland (leys are often mapped as grassland; majority of the 10 m cells inside each 30 m pixel), via Planetary Computer, CC BY 4.0. The field itself is left out. One MGRS tile is used so pixels line up; the vectorised rules give the same answer as the field's own hints (0 mismatches on 12,000 test pixels).
  A shift is mentioned only when a share trends the same way across the seasons (Theil–Sen, Mann–Kendall p < 0.1, ≥ 5 points in total); around the demo field there is none, and the first two vs last two seasons comparison it replaced had reported noise as shifts.
  **Checked against what farms reported** (Landbruksdirektoratet, production-subsidy applications, open data): the 11 farms based within 2 km of the demo field reported **grass 22–24% and cereals 76–78%** of their arable land in 2021–2024, and no potatoes.
  From satellite, the farmland around the field read grass 20–29%, spring-sown 56–62% plus new ley 7–14% (cereals with grass sown under them count as cereals in the applications), late crops 2–8%. Grass is within a few points; cereals read ~5–10 points low; late crops are overcounted.
  Rough: those farms farm only about a third of the 524 ha of farmland in the square, and other farms rent land there. 2020 is not comparable (44% read as late crops; many cloudy images).
  An earlier check against Statistics Norway (table 06462, Stjørdal municipality, 2020–2025: cereals and oilseeds 52%, grass and leys 46%) found a real weakness: northern leys green up late after snow and missed the spring test, so grass first read 24% around the earlier demo field. The crop-hint rules then added: **an unclear or late curve that never drops below green (NDVI 0.5) from late July to early September and is still green in autumn has had no harvest, so it is grass or ley.** The threshold is the app's existing definition of "green", not tuned to the statistics.
  So the field view gives the order of crop types, not percentages, plus the shift result and this caveat; the data view shows the numbers, map, chart and the check. First read ~80 s per field, then cached; the demo area is in the offline snapshots.
- **Season check (crop stress, season level):** was a season clearly less green than the field's *other seasons with the same likely crop*, and did its weather stand out?
  Each season's season-long EVI (see the trend below) is compared with the median of the field's other seasons with the same crop hint (at least 2). 10% or more below is flagged. Seasons with a cloud gap, an unclear crop or too few same-crop seasons are listed as not judged, with the reason.
  For each season, the NASA POWER weather of that season is ranked against all ~10 seasons on record. Once the growing months are over (November in the north, May in the south), the current season is included too, marked "season so far". A factor "stands out" only when the season is among the 2 most extreme *and* clearly differs from the median: longest dry spell (+3 days), low rain (≤ 80%), high rain (≥ 125%), hot days (+2), cool season (GDD5 ≤ 92%), late spring frost (+7 days), dry or wet root zone (±0.05).
  The wording is "coincides with", never "caused by". When the weather was normal, the field view says sowing, variety, field work or pests may explain it, and that the grower knows best.
  Within-season dips are deliberately not flagged: grass cuts and harvests look exactly like damage from orbit.
  **On the demo field:** 2021, the first full year of the new ley, is flagged at 11% below the other grass years, with no weather factor standing out, so the app points to establishment, field work or other causes the grower knows. 2022–2026 are within the usual range; 2020 (the new ley's sowing year) is not judged because of a 41-day cloud gap.
  Inspired by DigiFarm's crop-damage indicator.
- **Productivity trend:** is the field's season-long greenness rising or falling over the years?
  Per season, the clear-image EVI values are interpolated into a daily curve and averaged over **that season's likely crop's window** (northern dates; shifted six months in the south): winter crops 1 Apr–15 Jul (harvested in July, so the stubble after harvest is left out), spring crops 1 May–31 Aug, late crops 15 May–15 Oct, grass and unclassified 1 Apr–31 Oct.
  A season is **skipped** when the core of that window has a long cloud gap (40 days, or 45% of the core for shorter windows) or fewer than 8 clear images, because one missing month can move the mean more than any real trend. Skipped seasons are listed with their gap.
  The slope is a **Theil–Sen** estimate (robust to one odd season), tested with **Mann–Kendall**. A trend is reported only with at least 6 usable seasons, p < 0.1 and a slope of at least 1% of the mean per year; otherwise it says "no clear trend" or "too few seasons".
  **When the likely crop changes, no overall direction is given**: a perennial ley followed by cereals is "less green" without the field getting worse (on an earlier test field the overall line read −13.8% a year, p = 0.007, purely from that change). Instead it reports the trend among seasons with the most common crop when there are at least 4, and the chart colours each season by its likely crop.
  On the demo field: no clear trend across its 6 grass seasons, 2021–2026 (+1.3% a year, p = 0.26).
  Inspired by DigiFarm's sustainability index; with HLS from 2020 the record is short, so this is a first look, not a verdict.
- **Cross-checks seen in testing (Stjørdal):** Sentinel-2 and Landsat values from the same day agree within about 0.02 NDVI, and emergence in early June matches the weather-based sowing window.
- **Limits:** cloudy regions have gaps. A 30 m pixel needs fields of at least 0.3 ha, and edge pixels mix with the neighbouring land. NDVI differences between seasons also reflect *which crop* was grown.

### 5. Non-NASA data and map tiles

- **ESA WorldCover 2021** (CC BY 4.0) via Microsoft Planetary Computer: the farmland mask for *what's grown around you*.
- **Microsoft Planetary Computer**: open hosting of NASA HLS and ESA WorldCover (STAC API, anonymous token).
- **Statistics Norway table 06462**: used once to check the area-around results; not used by the app.
- **Landbruksdirektoratet, production-subsidy applications and farm register 2017–2026** ([open data on GitHub](https://github.com/LandbruksdirektoratetGIT/opendata), NLOD): crop areas each farm reported, per year. Gives the demo field's real crop history, the reported crops for any Norwegian field, and an offline check of the area-around results. Per farm, not per field; farm names are not shown.
- **Kartverket property service** (`ws.geonorge.no/eiendom/v1`, open): the property under a field (for its reported crops) and the demo field's outline.
- **ISRIC SoilGrids 2.0** (CC BY 4.0, `rest.isric.org`): sand, silt and clay for 0–30 cm at 250 m, turned into a USDA texture class and the app's soil choice (`/api/soil`). The field view pre-fills the soil answer with it, says it is an estimate, and the grower can change it. SoilGrids' organic carbon is very uncertain in Norway (16–506 g/kg at the demo field), so a soil is called peat only if it is still ≥ 20% organic carbon at 15–30 cm. No drainage.

- **Esri World Imagery** basemap: high-resolution imagery for locating the actual parcel, since GIBS stops at ~250 m.
- **Esri World Boundaries and Places**: place-name and boundary labels. GIBS `Reference_Labels_15m` returns error pages instead of transparent tiles where there are no labels, which rendered as black squares.

### 6. Inputs from the grower and built-in assumptions

- **Farmer inputs:** soil texture, drainage, irrigation, previous crop, and the rotation priorities. Unknown values are flagged in the ranking.
- **Crop parameters** (`backend/app/crops.py`): base temperature, GDD to maturity, sowing temperature, frost tolerance, heat limit and FAO-56 crop coefficient for 13 crops.
  These are planning-grade approximations from FAO-56, FAO Irrigation & Drainage Paper 33 and common extension guidance, not locally calibrated values.

## Methods

- **ET₀**: Hargreaves–Samani (FAO-56 eq. 52), extraterrestrial radiation from FAO-56 eq. 21 (unit-tested against FAO-56 Example 8).
- **GDD**: Σ max(0, Tmean − Tbase). The headline uses base 5 °C; each crop has its own base.
- **Frost**: 2 m daily minimum ≤ 0 °C (≤ −3 °C kills frost-tolerant crops). Seasons run mid-winter to mid-winter (1 Jan in the north, 1 Jul in the south), so southern-hemisphere and frost-free tropical sites work.
- **Crop simulation**: per past season, sow when the 7-day mean temperature reaches the crop's sowing temperature after the last damaging frost *and* the soil is moist (rain-season onset in the tropics). Accumulate GDD to maturity, stopping at a killing frost. Water need = Kc × ET₀ over the cycle.
- **Rotation ranking**: weighted soil-health, water, diversity and stability components. A **viability gate** scales the score down when a crop in the rotation rarely matures at the location.
  Two nitrogen-fixing crops back to back (e.g. grass–clover then faba bean) count as a repeat: both are legumes, they share root diseases, and a cereal should use the nitrogen a legume leaves.

## Limitations

- POWER is a ~50 km grid. Ground frost is more frequent than 2 m air frost, and local microclimate is not resolved.
- Crop parameters are approximations. Validate them and the scoring rules with a local agronomist before using rankings for farm decisions.
- The yield-stability component is a proxy (thermal reliability), not a yield model.
- Soil texture is a SoilGrids estimate (250 m model) until the grower changes it; drainage and irrigation come from the grower only (no public source we could reach).
- Crops are public per farm, not per field: a field's reported crop is known only in years when its farm grew one crop on all its arable land.
- Latitudes are limited to −60° … 75°.

