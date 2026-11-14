# Rotation Lab — farm decisions from orbit

Climate-aware crop and rotation planning for any field on Earth, built for the NASA Space Apps 2026 challenge
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).

Pick a field on the map. Rotation Lab pulls **10 years of daily NASA POWER data** for that location, overlays **live NASA GIBS satellite
imagery**, and returns:

- **Field telemetry**: temperature, 30-day rain vs. normal, root-zone soil wetness percentile, water balance (rain − ET₀), heat units, frost-free season.
- **Mission briefing**: plain-language advisories (dry/wet root zone, water deficit, frost and planting windows, season running ahead/behind, heat-stress and dry-spell trends). Every advisory shows the evidence behind it.
- **Climate signals**: interactive charts of the last 120 days, GDD accumulation vs. the 10-year envelope, soil moisture vs. its typical range, and monthly anomalies vs. 2001–2020 normals, each with a table view.
- **Crop suitability**: 13 crops simulated through every past season at the location (sowing date, maturity reliability, rain vs. crop water need, heat stress).
- **Rotation planner**: editable multi-year rotations ranked on soil health, water resilience, diversity and yield stability. Water and stability scores come from the field's NASA climate history.
- **Saved fields**, a **CSV export** of the daily data, and full **data provenance**.

## Run it

```sh
./run.sh            # creates .venv on first run, then serves http://127.0.0.1:8000
```

Requires Python 3.10+ and internet access for NASA POWER/GIBS. API docs are at `/docs`.
The first analysis of a location takes ~3–5 s; it is then cached in SQLite for 12 h.

Offline demo: `.venv/bin/python scripts/snapshot.py [lat lon …]` saves dated copies to `data/snapshots/`, which the API
falls back to when NASA POWER is unreachable (Stjørdal is included).

Tests: `cd backend && ../.venv/bin/python -m pytest -q tests`

## Architecture

```
frontend/            static HTML/CSS/JS (Leaflet + Chart.js from cdnjs, no build step)
backend/app/
  power.py           NASA POWER client: daily + climatology, retries, SQLite cache, snapshot fallback
  agro.py            agroclimatic engine: ET₀, GDD, frost dates, seasons, anomalies, soil-moisture percentiles
  crops.py           crop catalog, crop-season simulation/suitability, rotation ranking
  advisor.py         rule-based advisories with evidence
  main.py            FastAPI routes + static hosting
  db.py              SQLite (cache + saved fields)
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analysis?lat&lon&soil&drainage&irrigation&previous_crop` | Full field analysis |
| `POST /api/rotations/rank` | Rank rotations (optionally with the climate of `lat`/`lon`) |
| `GET /api/layers` | NASA GIBS layer configuration |
| `GET /api/export.csv?lat&lon` | Daily NASA POWER data + ET₀ as CSV |
| `GET/POST/PUT/DELETE /api/fields` | Saved fields |

## Data sources

| Data | Source | Use |
| --- | --- | --- |
| Daily T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN, GWETROOT, GWETTOP, WS2M | [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) (MERRA-2, GEOS-IT, CERES) | All indicators, suitability, advisories |
| Monthly normals 2001–2020 | NASA POWER Climatology API | Monthly anomalies |
| NDVI (MODIS 8-day), SMAP L4 root-zone soil moisture, GPM IMERG precipitation, MODIS LST, MODIS true color, Blue/Black Marble | [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) WMTS | Map layers |
| High-resolution basemap and place labels | Esri World Imagery / Boundaries & Places | Finding the actual parcel (GIBS tops out at ~250 m) |

## Methods

- **ET₀**: Hargreaves–Samani (FAO-56 eq. 52), extraterrestrial radiation from FAO-56 eq. 21 (unit-tested against FAO-56 Example 8).
- **GDD**: Σ max(0, Tmean − Tbase). The headline uses base 5 °C; each crop has its own base.
- **Frost**: 2 m daily minimum ≤ 0 °C (≤ −3 °C kills frost-tolerant crops). Seasons run mid-winter to mid-winter (1 Jan in the north, 1 Jul in the south), so southern-hemisphere and frost-free tropical sites work.
- **Crop simulation**: per past season, sow when the 7-day mean temperature reaches the crop's sowing temperature after the last damaging frost *and* the soil is moist (rain-season onset in the tropics). Accumulate GDD to maturity, stopping at a killing frost. Water need = Kc × ET₀ over the cycle.
- **Rotation ranking**: weighted soil-health, water, diversity and stability components. A **viability gate** scales the score down when a crop in the rotation rarely matures at the location.
- **Soil-moisture splice detection**: POWER fills the latest 1–3 months from GEOS-IT near-real-time, which has a different soil-wetness baseline than MERRA-2 (we observed a 0.93 → 0.52 overnight step on 2026-10-02). The splice is detected automatically. Percentiles and advisories use the last reanalysis day, and the near-real-time segment is shown separately.

## Limitations

- POWER is a ~50 km grid. Ground frost is more frequent than 2 m air frost, and local microclimate is not resolved.
- Crop parameters (base temperature, GDD to maturity, Kc, heat limit) are planning-grade approximations. Validate them and the scoring rules with a local agronomist.
- The yield-stability component is a proxy (thermal reliability), not a yield model.
- Soil texture, drainage and irrigation come from the farmer. Mapped soil data (e.g. NIBIO Kilden in Norway, SoilGrids globally) is a natural next step.
