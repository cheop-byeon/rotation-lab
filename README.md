# Rotation Lab

Your farm and fields, with NASA weather and satellite records. Built for the NASA Space Apps 2026 challenge
[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/), focused on Norway.

**Live:** https://rotation-lab-tawny.vercel.app · **Docs:** [architecture](docs/architecture.md) · [data and methods](docs/data-and-methods.md) · [submission text](docs/space-apps-submission.md)

## What it does

Rotation Lab helps a grower see how each of their fields has done, what has changed in their climate, and what they could grow next, with the evidence for every statement one tap away. It follows how a grower thinks about their land:

1. **Find my farm** (`/`): type the municipality and the farm and holding numbers (*gårdsnummer/bruksnummer*, e.g. 81/5), or pick the farm on a map that shows farms only.
2. **Your farm** (`/farm`): the property's parcels to choose a field from, what the farm reported growing each year since 2017, and its crops next to the municipality's.
3. **One field** (`/field` and `/data`): an **Overview** in plain words and the **Evidence** behind it, both in four tabs:
   - **Now:** conditions against normal, things to consider, the sowing window.
   - **From space:** every NASA HLS satellite image of the field since 2020, the likely crop each season (checked against the crops the farm reported), weak seasons with the weather that stood out, stronger and weaker parts of the field, and what is grown around it.
   - **Climate:** what has changed since the 1990s in NASA POWER's record since 1981, and how 13 crops would have done in each past season.
   - **Plan:** the grower's own rotation, checked against ten years of weather at the field.

**Farming in a municipality** (`/area`) adds context: what farms there grow and how it is changing, the climate, and a map of farms.

The pages report what the records show and offer options; they never give orders, because the grower knows the field. Unknown values stay unknown, every number shows its source, and no farm names are shown.

**Example:** open *the example farm in Stjørdal* on the start page: farm 81/5, whose 2.5 ha *Parcel 2* grew winter wheat, then barley undersown with grass, then grass ley, all visible from space and confirmed by the farm's own reports.

## How to run

### Requirements

- Python **3.10 or newer** (`python3 --version`)
- Internet access to `power.larc.nasa.gov` (weather), `planetarycomputer.microsoft.com` (NASA HLS and ESA WorldCover), `gibs.earthdata.nasa.gov` (NASA map layers) and `server.arcgisonline.com` (Esri basemap). Without it, only the bundled offline demo fields work (see below).
- A modern browser. No Node.js or build step is needed.

### Start

```sh
git clone https://github.com/cheop-byeon/rotation-lab.git
cd rotation-lab
./run.sh
```

Then open **http://127.0.0.1:8000** in your browser.

On the first run, `run.sh` creates a virtual environment in `.venv/` and installs `backend/requirements.txt`
(FastAPI, Uvicorn, httpx, Pydantic, NumPy, rasterio, pytest). Later runs start immediately. Stop the server with `Ctrl+C`.

| What you want | Command |
| --- | --- |
| Different port | `PORT=8080 ./run.sh` |
| Reachable from other devices on your network (e.g. a phone) | `HOST=0.0.0.0 ./run.sh` |
| Auto-reload while editing code | `./run.sh --reload` (extra arguments are passed to Uvicorn) |
| Interactive API docs | open http://127.0.0.1:8000/docs |
| Run the tests | `cd backend && ../.venv/bin/python -m pytest -q tests` |

If port 8000 is already in use, pick another port with `PORT=…`.

### Using the app

- **Choose a field** from a farm page, or press **Change field** on the overview to pick a spot, outline your field (0.3–2000 ha) and set soil, drainage, irrigation and this year's crop; **Save this field** keeps it. The soil answer is pre-filled with a SoilGrids estimate, marked as such.
- The first satellite read of a new field takes ~20–120 s (every image since 2020), then it is cached. New locations' weather takes ~3–5 s, then 12 h from the cache.
- `/data#crops`-style links open a tab at a section; *Download daily CSV* in the evidence page's sources exports the raw weather.

### Translating

The text of the grower pages (Find my farm, Your farm, Overview, the municipality page) is in `frontend/js/i18n/en.js`. To add a language, copy it (e.g. `nb.js`), translate the strings (keep the
`{placeholders}`), and import it in `start.js`, `farm.js`, `field.js` and `area.js` in place of `en`. Dates and month names follow the file's `locale`.
Advisories reach the overview as a language-neutral `code` plus `params` from the API, so they are phrased in the language file, not in the backend. The Evidence page is in English only.

### Hosted version and offline demo

The repo deploys to Vercel as one Python function (Root Directory empty, Framework Preset *Other*). The hosted version has no GDAL, so satellite results come from saved snapshots for the example field, and fields saved there last until the instance restarts. The example field and farm also run **without internet** from `data/snapshots/`. Refresh the snapshots with:

```sh
.venv/bin/python scripts/snapshot.py                          # example field and farm
.venv/bin/python scripts/snapshot.py 63.46 10.92              # extra weather points (lat lon pairs)
```

Details, including how to update the yearly farm data, are in [docs/architecture.md](docs/architecture.md).

### Local files

| Path | Contents | In git? |
| --- | --- | --- |
| `data/rotation_lab.db` | SQLite: response caches + saved fields (created on first start) | no |
| `data/snapshots/*.json` | Offline copies for the example field and farm (weather, satellite record, zones, area around, soil, property outlines) | yes |
| `data/areas/*.json` | Farming per municipality, 2017–2026 (built by `scripts/build_areas.py`) | yes |
| `data/farm_crops.json.gz` | Crops per farm and year, by property (built by `scripts/build_farm_crops.py`) | yes |
| `.venv/` | Python virtual environment | no |

Set `ROTATION_LAB_DB=/path/to/file.db` to use a different database file.

## Data

| Source | Used for |
| --- | --- |
| NASA POWER (daily since 1981, climatology) | Weather, soil wetness, normals, then and now, crop simulation |
| NASA HLS v2.0 (Landsat + Sentinel-2, 30 m) | Each field's satellite record, crop hints, zones, what's grown around |
| NASA GIBS | Map layers in the evidence view (backdrops only) |
| ESA WorldCover 2021 | Farmland mask for what's grown around |
| Landbruksdirektoratet (open data) | Crops each farm reported 2017–2026; farm locations |
| Kartverket | Property parcels; municipality names |
| Statistics Norway (KLASS) | Municipality changes since 2017 |
| ISRIC SoilGrids | Soil texture estimate |

Methods, validation results and limits: [docs/data-and-methods.md](docs/data-and-methods.md).

## Limits and next steps

- NASA POWER is a ~50 km grid; field-scale frost and rain are not resolved.
- The 13 crop profiles and the rotation scoring are planning-grade values that still need review by a local agronomist.
- Crops are public per farm, not per field, and drainage and irrigation have no public source: the grower fills these in.
- Next: a Norwegian translation of all text (`frontend/js/i18n/`), agronomist review of the crop profiles, and a lighter Evidence page.
