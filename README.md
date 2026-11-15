# Rotation Lab — farm decisions from orbit

Climate-aware crop and rotation planning for any field on Earth, built for the NASA Space Apps 2026 challenge
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).

Pick a field on the map. Rotation Lab pulls **10 years of daily NASA POWER data** for that location, overlays **live NASA GIBS satellite
imagery**, and presents the result in **two views on the same data**:

| View | URL | What it shows |
| --- | --- | --- |
| **Field view** (default) | `/` | One field at a glance, in plain words: conditions right now, things to consider, a season calendar, how each crop has done in this climate, and a check of *your own* rotation plan. Bright and high-contrast for a phone outdoors, printable, with the numbers one tap away. |
| **Data view** | `/data` | The full analysis: map-led layout with satellite layers and data overlays, telemetry, rule-based advisories with evidence, time series, crop-season simulation, weighted rotation scoring, season log, provenance. |

Both views are for anyone: they differ in depth, not in who they are for. Growers are the experts on their own fields, so the
field view reports what the records show and offers options. It does not give orders, and the rotation it evaluates is the
one the grower sets. The old `/specialist` and `/farmer` links redirect to `/data` and `/`.

The data view includes:

- **Field telemetry**: temperature, 30-day rain vs. normal, root-zone soil wetness percentile, water balance (rain − ET₀), heat units, frost-free season.
- **Mission briefing**: plain-language advisories (dry/wet root zone, water deficit, frost and planting windows, season running ahead/behind, heat-stress and dry-spell trends). Every advisory shows the evidence behind it.
- **Climate signals**: interactive charts of the last 120 days, GDD accumulation vs. the 10-year envelope, soil moisture vs. its typical range, and monthly anomalies vs. the POWER long-term normals, each with a table view.
- **Crop suitability**: 13 crops simulated through every past season at the location (sowing date, maturity reliability, rain vs. crop water need, heat stress).
- **Rotation planner**: editable multi-year rotations ranked on soil health, water resilience, diversity and yield stability. Water and stability scores come from the field's NASA climate history.
- **Saved fields**, a **CSV export** of the daily data, and full **data provenance**.

## The problem and how rotation-lab helps

A grower choosing what to plant next has to weigh several seasons at once. A familiar crop may fit the farm's equipment and market, while a different crop family may improve rotation diversity. Rainfall, soil texture, drainage, and irrigation access can change which sequence is practical. That information often lives in separate maps, weather records, and farm notes.

| Problem | How rotation-lab helps |
| --- | --- |
| Crop choices affect later seasons. | Edit multi-year sequences (2–6 years) side by side and see where the same crop family repeats, including the transition from the previous crop. |
| Soil and water priorities can pull in different directions. | Enter soil texture, drainage, and irrigation access, then adjust the priority weights to see which rotation ranks higher under those assumptions. |
| Weather records are hard to apply to a rotation decision. | Summarize 10 years of daily NASA POWER temperature, rainfall, and soil wetness for any chosen field. Rain versus crop water need drives the water score, and how often each crop reaches maturity drives yield stability. |
| A ranking alone gives growers little to review. | Open each score breakdown to see the factors behind it. Advisories list their evidence, and the data provenance section shows the exact NASA request, retrieval time, and coverage. Soil inputs still come from the grower until mapped soil sources are attached. |

The platform supports comparing options with a grower or adviser. Its scores reflect explicit rules and user priorities. Field-specific advice requires verified local inputs and agronomic review.

## How to run

### Requirements

- Python **3.10 or newer** (`python3 --version`)
- Internet access to `power.larc.nasa.gov` (climate data) and `gibs.earthdata.nasa.gov` (map imagery). Without it, only the bundled offline demo field works (see below).
- A modern browser. No Node.js or build step is needed.

### Start

```sh
git clone https://github.com/cheop-byeon/rotation-lab.git
cd rotation-lab
./run.sh
```

Then open **http://127.0.0.1:8000** in your browser.

On the first run, `run.sh` creates a virtual environment in `.venv/` and installs `backend/requirements.txt`
(FastAPI, Uvicorn, httpx, Pydantic, pytest). Later runs start immediately. Stop the server with `Ctrl+C`.

| What you want | Command |
| --- | --- |
| Different port | `PORT=8080 ./run.sh` |
| Reachable from other devices on your network (e.g. a phone) | `HOST=0.0.0.0 ./run.sh` |
| Auto-reload while editing code | `./run.sh --reload` (extra arguments are passed to Uvicorn) |
| Interactive API docs | open http://127.0.0.1:8000/docs |
| Run the tests | `cd backend && ../.venv/bin/python -m pytest -q tests` |

If port 8000 is already in use, pick another port with `PORT=…`.

### Using the app

Switch between the two views with **Field view / Data view** at the top right.

The demo field **Stjørdal 01** (Trøndelag, Norway) loads automatically: a real grass field east of Stjørdal, with its outline
drawn on satellite imagery, so its weather, satellite record and crop-type hints appear straight away. Its location and outline are
real; its soil, drainage, irrigation and crop are **illustrative example values, not a real farm's records**. Both views label it as a demo.
Editing and saving it, or saving your own field, removes the label. (Databases created before this change have their old demo point,
which sat on Værnes airport, moved automatically.)

A second demo field, **Orosháza 01** (Békés county, Hungary), is rainfed arable land: a ~7 ha rectangle drawn inside a real field,
with illustrative farm details. It shows the season check catching droughts from NASA data alone (2022 and 2026, below).
The field view's demo note switches between the demo fields, and `/?field=<id>` opens a field directly (handy for recording a demo).

**The two views stay on the same field.** Both open the same default (your own first field, else a demo) and read `?field=<id>`; the links between them carry it.
Each field-view card ends with **See the evidence in the data view**, which opens the data view on the same field at the matching section (e.g. `/data?field=3#crop-then-now`).
An unsaved field is passed as its location; save it to keep it, with its outline, in both views.

**Field view (`/`)**
1. Press **Choose my field**, tap the field on the map (or *Use my location*), and tap your soil, drainage, irrigation and this year's crop.
2. Press **Show my field**. A new location takes ~3–5 s the first time, then it is cached for 12 hours. **Save this field** keeps it for next time.
3. Read top to bottom: *Right now → Things to consider → Your season → Crops in your climate → Your rotation → Where does this come from?*
   Tap **The numbers** on any card to see the evidence.
4. In **Your rotation**, set your own crop for each of the next three years on the field tiles; each change is checked against ten years of weather at the field.
   Until you change it, the tiles start from the sequence that scores best here, and the page says so. *Other sequences that score well here* lists ideas
   built from the crops that do well in this climate (best crop of each crop family), each with **Use this**. Pick what matters most to you to re-weight the scores.

**Outlining a field (both views).** Optional, but it unlocks the field's own satellite record. In the field view, open
*Choose my field* → **Outline my field** and tap each corner, then **Done**. In the data view, use **Draw field boundary** in the map
toolbar (the satellite overlay fades while you trace). The outline is saved with the field (0.3–2000 ha). The first satellite read
takes ~15–30 s for every season since 2020, then it is cached.

**Data view (`/data`)**
1. Click the map (or type `lat, lon` into *Go to*, or *Use my location*), set the field inputs and press **Analyze field**. Switch satellite layers and dates in the map toolbar.
2. Scroll through conditions, briefing, trends, crop suitability, the rotation planner, the season log and data provenance.
   *Download daily CSV* in the provenance section exports the raw data used.

### Translating the field view

All field-view text is in `frontend/js/i18n/en.js`. To add a language, copy it (e.g. `nb.js`), translate the strings (keep the
`{placeholders}`), and import it in `frontend/js/field.js` in place of `en`. Dates and month names follow the file's `locale`.
Advisories reach the field view as a language-neutral `code` plus `params` from the API, so they are phrased in the language file, not in the backend.

### Offline demo

Both demo fields work **without internet**:

- **Weather:** dated copies of the NASA POWER responses for the demo fields, 1981 to today (`data/snapshots/dailyfull_*.json`, `clim_*.json`).
- **Satellite record:** every NASA HLS image reading for the demo outlines, with per-pixel values for the zones (`data/snapshots/hls_*.json`).
- **Libraries:** Leaflet and Chart.js are served from `frontend/vendor/` (copied from cdnjs and checked against its SRI hashes), not a CDN.

When NASA POWER or the HLS catalogue can't be reached, the API serves the local cache, then these snapshots. It says so in the UI
(*from the offline snapshot*, *Delivery: offline · saved snapshot*). Offline requests return immediately rather than retrying.
Other locations, and outlines with no saved copy, return a clear *503* message.

**Not available offline:** satellite and street basemap tiles (the map area is blank, but outlines and markers still show), the NASA GIBS
overlays, and web fonts (system fonts are used instead). Open the demo once while online on the presentation laptop, so the browser can cache the tiles it shows.

To refresh the snapshots before a presentation (or add weather for other points):

```sh
.venv/bin/python scripts/snapshot.py                          # demo fields: weather + satellite record
.venv/bin/python scripts/snapshot.py 63.46 10.92 -33.89 -60.57  # extra weather points (lat lon pairs)
```

### Local files

| Path | Contents | In git? |
| --- | --- | --- |
| `data/rotation_lab.db` | SQLite: NASA POWER response cache + saved fields (created on first start) | no |
| `data/snapshots/*.json` | Offline copies of POWER responses | yes |
| `.venv/` | Python virtual environment | no |

Set `ROTATION_LAB_DB=/path/to/file.db` to use a different database file.

## Data used

All climate numbers come from NASA POWER, and all map overlays from NASA GIBS. Every value in the UI can be traced back via
the *Data provenance* section, which shows the exact POWER request URL, retrieval time and whether the data came live,
from cache, or from the offline snapshot.

### 1. NASA POWER — daily point data (the core dataset)

- **API:** [POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) v2 (`/api/temporal/daily/point`), community `AG` (Agroclimatology), UTC days.
- **Period:** 1 January ten years back → today (currently 2016-01-01 → latest available day, ~3,970 days per location).
- **Spatial resolution:** meteorology on a 0.5° × 0.625° grid (≈ 55 × 35 km at 60° N). The map draws this cell as a dashed box.
- **Upstream sources** (as listed in the response header): `MERRA2`, `GEOSIT`, `SYN1DEG`, `POWER`.
  MERRA-2 reanalysis covers most of the record. GEOS-IT near-real-time fills the most recent 1–3 months. CERES SYN1deg provides solar irradiance.
- **Latency:** temperature and precipitation lag ~2 days. Solar irradiance can lag a few days longer, and missing latest values are hidden in the UI.

| Parameter | Meaning | Unit | Used for |
| --- | --- | --- | --- |
| `T2M` | Mean air temperature at 2 m | °C | GDD, sowing dates, anomalies |
| `T2M_MAX` / `T2M_MIN` | Daily max / min air temperature at 2 m | °C | ET₀, frost dates, heat-stress days |
| `PRECTOTCORR` | Precipitation, bias-corrected | mm/day | Rain totals, water balance, dry spells, crop water supply |
| `RH2M` | Relative humidity at 2 m | % | Context |
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
- Stjørdal: frost-free season 133 → 151 days, last spring frost 25 May → 13 May, growing season +1.3 °C; no clear change in rain or dry spells.
  Orosháza: season 195 → 220 days, days above 30 °C 40 → 62 a season, +1.7 °C; no clear change in rain or dry spells.

#### Is this crop still a good choice here?

The crop-season simulation behind *Crops in your climate* is run over **every complete season since 1981** for one crop (any of the 13), and 1991–2000 is compared with the last ten seasons, counting each measure **while the crop is in the ground**:
ripened before frost (count of seasons), days in the ground, heat-stress days above the crop's limit, rain as a share of its water use (Kc × ET₀), and for potatoes **blight-weather days**.

- **Blight-weather day:** daily minimum ≥ 10 °C and daily mean humidity ≥ 85%. The official late-blight rules (Smith, Hutton) need *hourly* humidity; NASA POWER's daily record allows only this stand-in, so it shows how often the weather favours blight, not a warning. Both views point to the national warning service (VIPS in Norway) for spraying decisions.
- **"Ripened"** means the simulated crop reached its full thermal time before a killing frost. Early varieties and lifting or cutting before full maturity are not modelled, so it understates where a crop is grown in practice (potatoes are grown around Stjørdal, yet the main-crop profile ripens in only 5 of the last 10 seasons). The change over time is the more useful signal. Both views say so.
- Climate side only: prices, contracts and costs are the grower's to weigh.
- **Potato, Stjørdal:** ripened in 1 of 10 seasons in 1991–2000 and 5 of 10 now; **blight-weather days 7 → 12 a season** (consistent, p < 0.001); no clear change in heat or water.
  **Potato, Orosháza:** ripens every year; no clear change; rain covers only ~46% of its water use, consistent with irrigated potatoes there.
  **Grain maize, Orosháza:** heat-stress days above 35 °C 8 → 13 a season (consistent).

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

The GIBS layers are for visual context. The numerical analysis uses NASA POWER only.

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
  On two Stjørdal test fields the hints read *spring-sown ×5* and *spring-sown → unclear → grass ×3* (a cereal followed by a ley). No ground-truth validation has been done yet.
- **Productivity zones:** stronger and weaker parts of the field, from **EVI** (less saturated than NDVI in dense crops) for every 30 m pixel.
  For each season, each pixel's 90th-percentile EVI (at least 3 clear images) is divided by the median of the field's interior pixels that season, which removes the effect of different crops in different years.
  These values are averaged over at least 2 seasons. Weaker means below 0.95 of the field median, stronger above 1.05.
  *Consistency* is the share of seasons in which a pixel fell on the same side of the median.
  **Edge pixels** overlap hedges, roads and neighbouring fields, so they are drawn but never classified. In testing, a hedgerow made edge pixels look "stronger" until they were excluded.
  If under 10% of the interior differs, the field is reported as uniform; with fewer than 8 interior pixels, as too small.
  The zones are **uncalibrated**: satellite greenness, not measured yield. Both views say so.
  Inspired by DigiFarm's productivity zones, which are calibrated on Norwegian yield data; ours are not.
  **Download:** both views export the zone map as GeoJSON: one 30 m square per pixel with `zone` and `zone_id` (1 weaker, 2 average, 3 stronger, 0 edge), relative EVI and consistency, ready to load into farm-machinery or GIS software for variable-rate planning.
- **What's grown around you (within ~2 km):** every 30 m farmland pixel in a 4 × 4 km square around the field gets the same rule-based crop hint as the field (grass/ley, autumn-sown, spring-sown, late crop, bare, unclear), each season since 2020.
  Farmland = **ESA WorldCover 2021** cropland or grassland (leys are often mapped as grassland; majority of the 10 m cells inside each 30 m pixel), via Planetary Computer, CC BY 4.0. The field itself is left out. One MGRS tile is used so pixels line up; the vectorised rules give the same answer as the field's own hints (0 mismatches on 12,000 test pixels).
  A shift is mentioned only when a share trends the same way across the seasons (Theil–Sen, Mann–Kendall p < 0.1, ≥ 5 points in total); around both demo fields there is none, and the first two vs last two seasons comparison it replaced had reported noise as shifts.
  **Checked against Statistics Norway** (table 06462, Stjørdal municipality, 2020–2025: cereals and oilseeds 52%, grass and leys 46%, potatoes and green fodder ~2%): around the demo field we read spring-sown 38–51%, grass 10–39%, late crops 10–28%, unclear 6–16%. Spring-sown crops match within ~5–15 points and the order is right; **grass and leys are undercounted by ~20 points**, mostly read as late or unclear crops (northern leys green up late and dip after each cut). Around Orosháza single seasons swing by up to ~40 points (e.g. the 2022 drought). Not checked for Hungary.
  So the field view gives the order of crop types, not percentages, plus the shift result and this caveat; the data view shows the numbers, map, chart and the check. First read ~80 s per field, then cached; both demo areas are in the offline snapshots.
- **Season check (crop stress, season level):** was a season clearly less green than the field's *other seasons with the same likely crop*, and did its weather stand out?
  Each season's season-long EVI (see the trend below) is compared with the median of the field's other seasons with the same crop hint (at least 2). 10% or more below is flagged. Seasons with a cloud gap, an unclear crop or too few same-crop seasons are listed as not judged, with the reason.
  For each season, the NASA POWER weather of that season is ranked against all ~10 seasons on record. Once the growing months are over (November in the north, May in the south), the current season is included too, marked "season so far". A factor "stands out" only when the season is among the 2 most extreme *and* clearly differs from the median: longest dry spell (+3 days), low rain (≤ 80%), high rain (≥ 125%), hot days (+2), cool season (GDD5 ≤ 92%), late spring frost (+7 days), dry or wet root zone (±0.05).
  The wording is "coincides with", never "caused by". When the weather was normal, the field view says sowing, variety, field work or pests may explain it, and that the grower knows best.
  Within-season dips are deliberately not flagged: grass cuts and harvests look exactly like damage from orbit.
  **Tested on real fields:** on both Stjørdal fields no season is flagged (all within ±10% of the same-crop median).
  On two rainfed fields near Orosháza, Hungary, it flagged **2022** (a likely lucerne stand 18% below its other lucerne years, during the longest dry spell in the record: 33 days against 23) and **2026** on both fields (23% below, during the lowest rainfall on record: 119 mm against 324, with the most hot days and the driest root zone). The 2026 flags were raised before the weather was attached, so satellite and weather agree independently.
  Where a weak season has only one other same-crop season (a winter crop in 2022 on the second field, peak NDVI 0.76 against ~0.9), it is reported as not judged rather than guessed.
  Inspired by DigiFarm's crop-damage indicator.
- **Productivity trend:** is the field's season-long greenness rising or falling over the years?
  Per season, the clear-image EVI values are interpolated into a daily curve and averaged over **that season's likely crop's window** (northern dates; shifted six months in the south): winter crops 1 Apr–15 Jul (harvested in July, so the stubble after harvest is left out), spring crops 1 May–31 Aug, late crops 15 May–15 Oct, grass and unclassified 1 Apr–31 Oct.
  A season is **skipped** when the core of that window has a long cloud gap (40 days, or 45% of the core for shorter windows) or fewer than 8 clear images, because one missing month can move the mean more than any real trend. Skipped seasons are listed with their gap.
  The slope is a **Theil–Sen** estimate (robust to one odd season), tested with **Mann–Kendall**. A trend is reported only with at least 6 usable seasons, p < 0.1 and a slope of at least 1% of the mean per year; otherwise it says "no clear trend" or "too few seasons".
  **When the likely crop changes, no overall direction is given**: a perennial ley followed by cereals is "less green" without the field getting worse (on the Hungarian field the overall line read −13.8% a year, p = 0.007, purely from that change). Instead it reports the trend among seasons with the most common crop when there are at least 4, and the chart colours each season by its likely crop.
  On the Stjørdal test fields: one has no clear trend across its 5 spring-crop seasons; the demo field has too few complete seasons (2024 and 2026 lost 43–44 days of June to cloud).
  Inspired by DigiFarm's sustainability index; with HLS from 2020 the record is short, so this is a first look, not a verdict.
- **Cross-checks seen in testing (Stjørdal):** Sentinel-2 and Landsat values from the same day agree within about 0.02 NDVI, and emergence in early June matches the weather-based sowing window.
- **Limits:** cloudy regions have gaps. A 30 m pixel needs fields of at least 0.3 ha, and edge pixels mix with the neighbouring land. NDVI differences between seasons also reflect *which crop* was grown.

### 5. Non-NASA map tiles

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

## Architecture

```
frontend/            static HTML/CSS/JS (Leaflet 1.9.4 + Chart.js 4.4.1 from cdnjs, no build step)
  index.html         field view (js/field.js, css/field.css, js/i18n/en.js)
  data.html          data view (js/data.js, js/charts.js, css/data.css)
  js/api.js, js/map.js, js/draw.js  shared API client, map, field-outline drawing
backend/app/
  power.py           NASA POWER client: daily + climatology, retries, SQLite cache, snapshot fallback
  agro.py            agroclimatic engine: ET₀, GDD, frost dates, seasons, anomalies, soil-moisture percentiles, splice detection
  crops.py           crop catalog, crop-season simulation/suitability, rotation ranking
  neighbourhood.py   what's grown around you: crop hints for every farmland pixel within ~2 km (HLS + ESA WorldCover)
  cropcheck.py       is this crop still a good choice: one crop through every season since 1981, incl. blight weather
  change.py          then versus now: 1990s vs the last ten seasons from the full NASA POWER record
  stress.py          season check: weak seasons vs same-crop seasons, and the weather that stood out
  hls.py             NASA HLS field record: STAC search, Fmask cloud masking, NDVI/NDMI per image, season summaries,
                     crop-type hints, EVI productivity zones, cache and offline snapshots
  advisor.py         rule-based advisories with evidence, plus language-neutral codes for the field view
  main.py            FastAPI routes + static hosting
  db.py              SQLite (POWER + HLS caches, saved fields with optional outline and demo flag)
scripts/snapshot.py  save offline copies of POWER data
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analysis?lat&lon&soil&drainage&irrigation&previous_crop` | Full field analysis |
| `POST /api/rotations/rank` | Rank rotations (optionally with the climate of `lat`/`lon`) |
| `GET /api/layers` | NASA GIBS layer configuration |
| `POST /api/neighbourhood` `{boundary}` | Broad crop types on farmland within ~2 km, each season since 2020, with a map of the latest season |
| `GET /api/crop-check?lat&lon&crop` | One crop through every season since 1981: ripening, heat, water, blight weather, then versus now |
| `GET /api/change?lat&lon` | Then (1991–2000) versus now (last ten seasons) from the NASA POWER record since 1981 |
| `POST /api/vegetation` `{boundary, seasons}` | NASA HLS NDVI/NDMI/EVI record for a field outline (GeoJSON Polygon); `seasons` optional (default: all since 2020); includes the productivity `trend` and the `season_check` (joined with NASA POWER weather) |
| `POST /api/zones` `{boundary, seasons}` | Productivity zones from multi-season HLS EVI (30 m pixels, GeoJSON cells) |
| `GET /api/export.csv?lat&lon` | Daily NASA POWER data + ET₀ as CSV |
| `GET/POST/PUT/DELETE /api/fields` | Saved fields |
| `GET /api/health` | Server status |

## Limitations

- POWER is a ~50 km grid. Ground frost is more frequent than 2 m air frost, and local microclimate is not resolved.
- Crop parameters are approximations. Validate them and the scoring rules with a local agronomist before using rankings for farm decisions.
- The yield-stability component is a proxy (thermal reliability), not a yield model.
- Soil texture, drainage and irrigation come from the farmer. Mapped soil data (e.g. NIBIO Kilden in Norway, SoilGrids globally) is a natural next step.
- Latitudes are limited to −60° … 75°.

## Roadmap: from demo point to a real field

The platform analyzes a **point**. Turning it into advice for one documented parcel needs the inputs below.
Start with one parcel in Stjørdal and use the same field ID across all inputs.

| Dataset or input | Minimum to collect | Source | Status |
| --- | --- | --- | --- |
| Field boundary | One verified WGS84 GeoJSON Polygon or MultiPolygon with a stable field ID. Use a representative point inside the parcel for the weather query. | Grower-approved boundary or open agricultural parcel data verified against the actual field | **Partial.** Growers can draw and save a Polygon outline, and its centre is used for the weather query. Importing official parcel data is not done. |
| Historical weather | Daily temperature and precipitation with dates, query coordinates, units, retrieval date, and missing-value metadata. | [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) | **Done.** 10 years, 9 parameters, provenance and missing-day counts in the UI. See [Data used](#data-used). |
| Soil texture and drainage | Mapped topsoil texture and natural drainage for the parcel, plus coverage and source date. Where mapping is absent, record grower observations or a soil report and label the evidence source. | [NIBIO Kilden soil area reports](https://www.nibio.no/tjenester/kilden/veiledning-arealrapport) | **Partial.** Grower-entered only, and the evidence source is not recorded yet. |
| Farm records and priorities | Previous crop at minimum, ideally several years of crop history, plus irrigation access and weights for soil health, water resilience, diversity, and yield stability. Record unknowns explicitly. | Grower or adviser | **Partial.** Previous crop, irrigation, priority weights and "Unknown" values are supported. Multi-year crop history is not. |
| Regional crop reference | Crop families, broad water needs, drainage constraints, and locally suitable crop choices. Record the evidence and review date for each scoring assumption. | Local agronomist or documented regional guidance | **Partial.** 13 crops with approximate parameters in `backend/app/crops.py`. Not yet reviewed, and no review dates recorded. |

The prototype's fixed 240 mm summer-rainfall cutoff has been replaced by crop water need (Kc × ET₀) computed for each crop and season.
The crop parameters, the scoring rules and the viability gate still need review by a local agronomist before rankings are used for farm decisions. Yield stability is a proxy score.

### Optional datasets

- **Satellite vegetation comparison.** Use two comparable Sentinel-2 L2A acquisitions over the parcel. Retain acquisition dates, product IDs, valid-pixel coverage, red (B04), near infrared (B08), and the scene classification layer for masking. Compute NDVI after masking and clipping. Interpret changes alongside crop stage and management history. [Copernicus Sentinel-2 L2A](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html)
  *Partly done: with a drawn outline, the app reads a 30 m NDVI/NDMI record from NASA HLS (Landsat + Sentinel-2) for every season since 2020, with productivity zones, a zone-map download and a season-long EVI trend. Native 10 m Sentinel-2 is not used.*
- **Terrain for geographic 3D.** Obtain a digital elevation model covering the same parcel, with resolution, vertical datum, and usage terms recorded.
  *The mockup's illustrative 3D field preview was not carried over into this platform.*

### First real-data release checklist

- [ ] Load the verified parcel and attach soil evidence and grower inputs.
- [x] Fetch and validate daily NASA POWER weather, then preserve a dated copy for offline demos (`data/snapshots/`, `scripts/snapshot.py`).
- [x] Show the source, dates, coverage, and missing values next to the data in the UI (*Data provenance* section).
- [ ] Have an agronomist review the scoring assumptions.
- [ ] Verify on the deployed app that changing a crop or priority recalculates the ranking and that the score breakdown identifies the inputs used. *(Verified on a local run; no deployed instance exists yet.)*
