# Rotation Lab: architecture

How Rotation Lab is put together: the pages a grower moves through, the backend that answers them, which data are prepared ahead of time and which are fetched live, and how it runs on a laptop, offline and on Vercel.
For the data and methods behind each number, see [data-and-methods.md](data-and-methods.md).

## 1. How a grower moves through the app

The pages follow how a grower thinks about their land: find the farm, choose a field, then look at that field at two levels of detail.

```
/  Find my farm  ──►  /farm  Your farm  ──►  /field  One field: Overview  ◄──►  /data  One field: Evidence
   municipality +        parcels to choose        Now · From space ·            the same four tabs,
   farm/holding no.,     a field from; what        Climate · Plan                every chart, table
   or a farm on a map    the farm grew; farm                                     and source
                         vs municipality
                              │
                              └──►  /area  Farming in the municipality (context): what farms grow,
                                           the climate, where the farms are
```

- **A trail** on every page below the start (*Find my farm › Stjørdal › Farm 81/5 › Parcel 2 · 2.5 ha*) shows where you are and leads back up. The header always has **Find my farm**.
- **Overview and Evidence are the same land.** They read the same address and fill it from the same records (`frontend/js/records.js`), so switching never changes the field. A field is edited in one place, the overview's **Change field**; the evidence page shows it read-only.
- **One topic at a time.** Both field pages show four tabs (Now, From space, Climate, Plan). *See the evidence* on an overview tab opens the matching evidence tab at that section; secondary detail sits behind *show more*.

### Addresses

| Page | Address | Notes |
| --- | --- | --- |
| Find my farm | `/` | Old `/?field=…` and `/?area=…` links redirect to `/field` and `/area`. |
| Your farm | `/farm?area=5035&gnr=81&bnr=5` or `/farm?area=5035&at=lat,lon` | By farm and holding number (shown on the page), or by a point on the farm (a dot; the number is not shown). |
| One field | `/field?field=<id>` (saved) or `/field?lat=&lon=&place=&area=&label=&fq=&fn=` (from a farm page) | `lat/lon` is a point inside the parcel; `fq`/`fn` carry the farm page's address and name for the trail. `/data` takes the same parameters. |
| Municipality | `/area?area=5035` | Context, linked from the farm page. |

## 2. Code layout

```
frontend/                 static HTML/CSS/JS, no build step; Leaflet 1.9.4 and Chart.js 4.4.1 vendored in frontend/vendor
  start.html  js/start.js   Find my farm
  farm.html   js/farm.js    Your farm
  index.html  js/field.js   One field: Overview (css/field.css, all text in js/i18n/en.js)
  data.html   js/data.js    One field: Evidence (js/charts.js, css/data.css)
  area.html   js/area.js    Farming in a municipality
  js/records.js             fills a spot from public records, shared by Overview and Evidence
  js/api.js, js/map.js, js/draw.js   API client, layer map, outline drawing
backend/app/
  main.py          FastAPI routes and static pages
  power.py         NASA POWER client: daily record and climatology, retries, cache, snapshot fallback
  agro.py          agroclimate engine: ET₀, degree-days, frost dates, seasons, anomalies, soil-moisture percentiles
  crops.py         crop catalogue, season-by-season crop simulation, rotation ranking
  change.py        then (1991–2000) versus now (last ten seasons)
  cropcheck.py     one crop through every season since 1981, incl. blight weather
  advisor.py       rule-based advisories with their evidence (language-neutral codes for the overview)
  hls.py           NASA HLS field record: search, cloud masking, indices, crop hints, usual range, trend, zones
  stress.py        season check: weak seasons against same-crop seasons, and the weather that stood out
  neighbourhood.py what's grown within ~2 km (HLS for every farmland pixel; ESA WorldCover farmland mask)
  publicdata.py    Norway's public records: property parcels and farms (Kartverket), reported crops
                   (Landbruksdirektoratet index), soil texture (SoilGrids)
  areas.py         farming in a municipality, from the prepared area files
  db.py            SQLite: response caches, saved fields, the example field
scripts/
  build_areas.py        prepares data/areas/ from Landbruksdirektoratet, SSB KLASS and Kartverket
  build_farm_crops.py   prepares data/farm_crops.json.gz (crops per farm and year, keyed by property)
  snapshot.py           saves offline copies for the example field and farm
api/index.py, vercel.json, requirements.txt   the hosted version (Vercel)
```

## 3. Prepared ahead of time, or fetched live

Rotation Lab mixes two kinds of data. Records that change once a year are prepared ahead of time and shipped with the app as small files, so the pages that use them load instantly and work anywhere. Data tied to one exact place are fetched live and cached.

| Data | How | Where | Refresh |
| --- | --- | --- | --- |
| What farms grow, per municipality; farm dots | Prepared | `data/areas/` (353 files + index, ~2.3 MB) | Yearly, after Landbruksdirektoratet publishes: `scripts/build_areas.py` |
| Crops per farm and year, by property | Prepared | `data/farm_crops.json.gz` (~2 MB) | Yearly: `scripts/build_farm_crops.py` |
| Weather, 1981 to today | Live, cached 12 h | NASA POWER | Automatic |
| Satellite record of a field | Live, every image cached for good | NASA HLS via Planetary Computer | New images are read on the next visit |
| What's grown around a field, zones | Live, cached | Computed from HLS | As above |
| Property parcels, the farm under a point | Live, cached a year | Kartverket | Automatic |
| Soil texture | Live, cached a year | SoilGrids | Automatic |

Every live source falls back in the same order when it can't be reached: the local cache, then a saved snapshot in `data/snapshots/`, then a clear message. The page says which one it used (*live*, *offline · local cache*, *offline · saved snapshot*).

## 4. Where it runs

- **Laptop (`./run.sh`):** the full app. Live satellite reads need `rasterio` (GDAL), installed from `backend/requirements.txt`. The cache is `data/rotation_lab.db`.
- **Offline:** the example field and farm run entirely from `data/snapshots/` (weather since 1981, every satellite reading, zones, the area around, soil, property outlines) and the prepared files. Map tiles and web fonts need the internet; open the demo once online so the browser caches them.
- **Vercel (hosted):** one Python function (`api/index.py`) serving the API and the pages, with the prepared files and snapshots bundled (`vercel.json` → `includeFiles`). Three limits shape it:
  - *No GDAL:* Vercel's runtime lacks the system libraries `rasterio` needs, so the hosted version serves satellite results for the example field from snapshots and gives other new outlines a clear message instead of a live read.
  - *Read-only code folder and short-lived instances:* the SQLite cache lives in `/tmp`, so saved fields last only until the instance restarts.
  - *60-second limit per request:* a first satellite read of a new field can take longer, which is another reason it runs on the laptop.

## 5. Updating the yearly data

Landbruksdirektoratet publishes each year's applications in its open-data repository. To add a year:

1. Extend `YEARS` in `scripts/build_areas.py` and `scripts/build_farm_crops.py`.
2. Run both scripts (each takes under a minute) and `scripts/snapshot.py` for the example field and farm.
3. Run the tests (`cd backend && ../.venv/bin/python -m pytest -q tests`), commit the regenerated files, and deploy.

Municipal mergers and splits are handled by SSB's KLASS change list in `build_areas.py`; farms whose old municipality was split and cannot be placed are counted and left out (66 in the 2017–2026 build).

## 6. Principles that shaped the design

- **The grower is the expert.** Pages report what the records show and offer options; they never give orders. Satellite crop types are "likely", and the grower's own entries win.
- **Unknown stays unknown.** Values with no source (drainage, irrigation) are left as *Unknown* rather than invented, and a farm's crops are tied to a field only when the farm grew one crop on all its land.
- **Every number has a source.** Each tab of the evidence page ends with its sources; dates, grid sizes and cloud gaps are shown with the results.
- **Privacy.** No farm names or organisation numbers anywhere; a property number appears only when the grower typed it.
- **One topic at a time.** A page answers one question first; tables, maps and footnotes are one tap away.
