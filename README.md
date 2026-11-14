# Rotation Lab — farm decisions from orbit

Climate-aware crop and rotation planning for any field on Earth, built for the NASA Space Apps 2026 challenge
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).

Pick a field on the map. Rotation Lab pulls **10 years of daily NASA POWER data** for that location, overlays **live NASA GIBS satellite
imagery**, and returns:

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

1. The demo field **Stjørdal 01** (Trøndelag, Norway) loads and is analyzed automatically.
2. To analyze another place, **click the map** (or type `lat, lon` into *Find place* and press Enter, or use *Use my location*), set soil, drainage, irrigation and previous crop, and press **▶ Analyze field**.
   A new location takes ~3–5 s the first time. It is then cached for 12 hours.
3. **Save field** stores it in the local database so it appears in the field console next time.
4. Scroll down through telemetry, briefing, charts, crop suitability, the rotation planner, the season log and data provenance.
   *Download daily CSV* in the provenance section exports the raw data used.

### Offline demo

The repository ships a dated copy of the NASA POWER responses for Stjørdal (`data/snapshots/`, retrieved 2026-11-14).
If NASA POWER cannot be reached and a location has no cache, the API serves the snapshot and the UI says so
("from the offline snapshot"). Other locations return a clear *503 – NASA POWER is unavailable* error.

To snapshot more demo locations before a presentation:

```sh
.venv/bin/python scripts/snapshot.py 63.46 10.92 -33.89 -60.57   # lat lon pairs
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

### 4. Non-NASA map tiles

- **Esri World Imagery** basemap: high-resolution imagery for locating the actual parcel, since GIBS stops at ~250 m.
- **Esri World Boundaries and Places**: place-name and boundary labels. GIBS `Reference_Labels_15m` returns error pages instead of transparent tiles where there are no labels, which rendered as black squares.

### 5. Inputs from the farmer and built-in assumptions

- **Farmer inputs:** soil texture, drainage, irrigation, previous crop, and the rotation priorities. Unknown values are flagged in the ranking.
- **Crop parameters** (`backend/app/crops.py`): base temperature, GDD to maturity, sowing temperature, frost tolerance, heat limit and FAO-56 crop coefficient for 13 crops.
  These are planning-grade approximations from FAO-56, FAO Irrigation & Drainage Paper 33 and common extension guidance, not locally calibrated values.

## Methods

- **ET₀**: Hargreaves–Samani (FAO-56 eq. 52), extraterrestrial radiation from FAO-56 eq. 21 (unit-tested against FAO-56 Example 8).
- **GDD**: Σ max(0, Tmean − Tbase). The headline uses base 5 °C; each crop has its own base.
- **Frost**: 2 m daily minimum ≤ 0 °C (≤ −3 °C kills frost-tolerant crops). Seasons run mid-winter to mid-winter (1 Jan in the north, 1 Jul in the south), so southern-hemisphere and frost-free tropical sites work.
- **Crop simulation**: per past season, sow when the 7-day mean temperature reaches the crop's sowing temperature after the last damaging frost *and* the soil is moist (rain-season onset in the tropics). Accumulate GDD to maturity, stopping at a killing frost. Water need = Kc × ET₀ over the cycle.
- **Rotation ranking**: weighted soil-health, water, diversity and stability components. A **viability gate** scales the score down when a crop in the rotation rarely matures at the location.

## Architecture

```
frontend/            static HTML/CSS/JS (Leaflet 1.9.4 + Chart.js 4.4.1 from cdnjs, no build step)
backend/app/
  power.py           NASA POWER client: daily + climatology, retries, SQLite cache, snapshot fallback
  agro.py            agroclimatic engine: ET₀, GDD, frost dates, seasons, anomalies, soil-moisture percentiles, splice detection
  crops.py           crop catalog, crop-season simulation/suitability, rotation ranking
  advisor.py         rule-based advisories with evidence
  main.py            FastAPI routes + static hosting
  db.py              SQLite (cache + saved fields)
scripts/snapshot.py  save offline copies of POWER data
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analysis?lat&lon&soil&drainage&irrigation&previous_crop` | Full field analysis |
| `POST /api/rotations/rank` | Rank rotations (optionally with the climate of `lat`/`lon`) |
| `GET /api/layers` | NASA GIBS layer configuration |
| `GET /api/export.csv?lat&lon` | Daily NASA POWER data + ET₀ as CSV |
| `GET/POST/PUT/DELETE /api/fields` | Saved fields |
| `GET /api/health` | Server status |

## Limitations

- POWER is a ~50 km grid. Ground frost is more frequent than 2 m air frost, and local microclimate is not resolved.
- Crop parameters are approximations. Validate them and the scoring rules with a local agronomist before using rankings for farm decisions.
- The yield-stability component is a proxy (thermal reliability), not a yield model.
- Soil texture, drainage and irrigation come from the farmer. Mapped soil data (e.g. NIBIO Kilden in Norway, SoilGrids globally) is a natural next step.
- Latitudes are limited to −60° … 75°.
