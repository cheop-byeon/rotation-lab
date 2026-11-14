# rotation-lab

rotation-lab is a crop rotation planner built for the [NASA Space Apps Field Shift challenge](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/). Compare three-year crop sequences, adjust farm priorities, and inspect how the inputs contribute to each ranking.

## Run the prototype

From the directory containing `index.html`, run:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The app uses browser JavaScript and needs no package installation. Internet access is required for the NASA POWER request.

Edit a crop in any year, adjust the farm priorities, and open **Score breakdown**. Use **Field preview** to select a rotation and year and switch between 2D and an adjustable perspective view of the illustrative parcel.

The current prototype requests daily NASA POWER temperature and precipitation near the Stjørdal demo location (63.46° N, 10.92° E). It summarizes complete June–August periods from 2021 through 2025. Live retrieval from the deployed app remains unverified. The parcel, crop thumbnails, and scoring rules are illustrative. The planner can compare sequences when weather is unavailable.

## Data needed for the first real field

Start with one documented parcel in Stjørdal and use the same field ID across all inputs.

| Dataset or input | Minimum to collect | Source |
| --- | --- | --- |
| Field boundary | One verified WGS84 GeoJSON Polygon or MultiPolygon with a stable field ID. Use a representative point inside the parcel for the weather query. | Grower-approved boundary or open agricultural parcel data verified against the actual field |
| Historical weather | Daily `T2M` (°C) and `PRECTOTCORR` (mm/day). Keep dates, query coordinates, units, retrieval date, and missing-value metadata. Start with the five summers already supported by the prototype. | [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) |
| Soil texture and drainage | Mapped topsoil texture and natural drainage for the parcel, plus coverage and source date. Where mapping is absent, record grower observations or a soil report and label the evidence source. | [NIBIO Kilden soil area reports](https://www.nibio.no/tjenester/kilden/veiledning-arealrapport) |
| Farm records and priorities | Previous crop at minimum, ideally several years of crop history, plus irrigation access and weights for soil health, water resilience, diversity, and yield stability. Record unknowns explicitly. | Grower or adviser |
| Regional crop reference | Crop families, broad water needs, drainage constraints, and locally suitable crop choices. Record the evidence and review date for each scoring assumption. | Local agronomist or documented regional guidance |

NASA POWER supplies regional gridded weather. The app currently uses seasonal rainfall in a prototype scoring rule and displays temperature for context. Validate the crop assumptions and the current 240 mm rainfall cutoff with a local agronomist before using rankings for farm decisions. Yield stability is a proxy score.

## Optional datasets

- **Satellite vegetation comparison.** Use two comparable Sentinel-2 L2A acquisitions over the parcel. Retain acquisition dates, product IDs, valid-pixel coverage, red (B04), near infrared (B08), and the scene classification layer for masking. Compute NDVI after masking and clipping. Interpret changes alongside crop stage and management history. [Copernicus Sentinel-2 L2A](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html)
- **Terrain for geographic 3D.** Obtain a digital elevation model covering the same parcel, with resolution, vertical datum, and usage terms recorded. The current 3D preview uses an illustrative diagram.

## First real-data release checklist

- [ ] Load the verified parcel and attach soil evidence and grower inputs.
- [ ] Fetch and validate daily NASA POWER weather, then preserve a dated copy for offline demos.
- [ ] Show the source, dates, coverage, and missing values next to the data in the UI.
- [ ] Have an agronomist review the scoring assumptions.
- [ ] Verify on the deployed app that changing a crop or priority recalculates the ranking and that the score breakdown identifies the inputs used.
