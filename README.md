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
takes ~10–20 s for five seasons, then it is cached.

**Data view (`/data`)**
1. Click the map (or type `lat, lon` into *Go to*, or *Use my location*), set the field inputs and press **Analyze field**. Switch satellite layers and dates in the map toolbar.
2. Scroll through conditions, briefing, trends, crop suitability, the rotation planner, the season log and data provenance.
   *Download daily CSV* in the provenance section exports the raw data used.

### Translating the field view

All field-view text is in `frontend/js/i18n/en.js`. To add a language, copy it (e.g. `nb.js`), translate the strings (keep the
`{placeholders}`), and import it in `frontend/js/field.js` in place of `en`. Dates and month names follow the file's `locale`.
Advisories reach the field view as a language-neutral `code` plus `params` from the API, so they are phrased in the language file, not in the backend.

### Offline demo

The demo field works **without internet**:

- **Weather:** dated copies of the NASA POWER responses for the demo field (`data/snapshots/daily_*.json`, `clim_*.json`).
- **Satellite record:** every NASA HLS image reading for the demo outline (`data/snapshots/hls_*.json`).
- **Libraries:** Leaflet and Chart.js are served from `frontend/vendor/` (copied from cdnjs and checked against its SRI hashes), not a CDN.

When NASA POWER or the HLS catalogue can't be reached, the API serves the local cache, then these snapshots. It says so in the UI
(*from the offline snapshot*, *Delivery: offline · saved snapshot*). Offline requests return immediately rather than retrying.
Other locations, and outlines with no saved copy, return a clear *503* message.

**Not available offline:** satellite and street basemap tiles (the map area is blank, but outlines and markers still show), the NASA GIBS
overlays, and web fonts (system fonts are used instead). Open the demo once while online on the presentation laptop, so the browser can cache the tiles it shows.

To refresh the snapshots before a presentation (or add weather for other points):

```sh
.venv/bin/python scripts/snapshot.py                          # demo field: weather + satellite record
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
- **Per image:** pixels flagged by HLS **Fmask** as cloud, adjacent to cloud, cloud shadow, snow/ice or water are removed. Images with under 60% of the field clear are counted but give no value. **NDVI** = (NIR − Red)/(NIR + Red) and **NDMI** = (NIR − SWIR1)/(NIR + SWIR1), each the median over the clear pixels.
  Bands: Sentinel-2 `B04`/`B8A`/`B11`, Landsat `B04`/`B05`/`B06`.
- **Seasons:** the last five, growing months only (Apr–Oct north, Oct–Apr south, all year in the tropics). Per season: images, clear images, green-up date, peak NDVI and date, mean NDVI, peak NDMI. Green-up is reported as *hidden by cloud* when no clear image exists in the three weeks before it.
- **Joined with weather:** the data view lines each satellite season up with the NASA POWER weather for the same season (rain, ET₀, longest dry spell, heat days). The field view names the least green season and checks whether that season's weather stands out. If all peaks are within 0.08 NDVI, it says no season stands out.
- **Crop-type hints:** each season's curve is labelled *grass / ley* (green in late April–May and again in Sep–Oct), *autumn-sown* (green in spring, bare in autumn), *spring-sown* (bare until late May, peak before August), *late crop* (peak in August or later), *bare / failed* (peak NDVI below 0.5), *unclear*, or *too cloudy*.
  Each hint carries its evidence. The rules are for temperate seasons; southern dates are shifted six months, and the tropics are not covered.
  The field view calls these "likely" crops and says they are hints, not records. If the latest season's pattern differs from the crop the grower entered, it says so as an observation.
  On two Stjørdal test fields the hints read *spring-sown ×5* and *spring-sown → unclear → grass ×3* (a cereal followed by a ley). No ground-truth validation has been done yet.
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
  hls.py             NASA HLS field record: STAC search, Fmask cloud masking, NDVI/NDMI per image, season summaries, cache
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
| `POST /api/vegetation` `{boundary, seasons}` | NASA HLS NDVI/NDMI record for a field outline (GeoJSON Polygon) |
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
  *Partly done: with a drawn outline, the app reads a 30 m NDVI/NDMI record from NASA HLS (Landsat + Sentinel-2) for the last five seasons. Native 10 m Sentinel-2 is not used.*
- **Terrain for geographic 3D.** Obtain a digital elevation model covering the same parcel, with resolution, vertical datum, and usage terms recorded.
  *The mockup's illustrative 3D field preview was not carried over into this platform.*

### First real-data release checklist

- [ ] Load the verified parcel and attach soil evidence and grower inputs.
- [x] Fetch and validate daily NASA POWER weather, then preserve a dated copy for offline demos (`data/snapshots/`, `scripts/snapshot.py`).
- [x] Show the source, dates, coverage, and missing values next to the data in the UI (*Data provenance* section).
- [ ] Have an agronomist review the scoring assumptions.
- [ ] Verify on the deployed app that changing a crop or priority recalculates the ranking and that the score breakdown identifies the inputs used. *(Verified on a local run; no deployed instance exists yet.)*
