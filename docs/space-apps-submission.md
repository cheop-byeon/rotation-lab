# Rotation Lab: NASA Space Apps 2026 submission

Challenge: **Field Shift: Adapting Farms with NASA Data**
Repository: https://github.com/cheop-byeon/rotation-lab
Live demo: https://rotation-lab-tawny.vercel.app

---

## Q1. Provide a summary of your project. What did you develop? How does it address the challenge? Why is it important? (50–200 words)

Rotation Lab shows what farms in any Norwegian municipality grow, how that is changing, and how the climate there has changed, so that people who work with farms (suppliers, advisers, planners) can understand a place without knowing the land. Type a municipality and one page answers three questions: crop shares since 2017 from Norway's open farm records, climate change since 1981 from NASA POWER, and a map of farms. Click a farm to see its land from space: every NASA HLS Landsat/Sentinel-2 image since 2020, likely crops each season, weak seasons set against that year's weather, and stronger and weaker parts of the field.

In Stjørdal, barley fell from 44% to 36% of farmland while wheat doubled. The frost-free season is 18 days longer than in the 1990s, but potato-blight weather rose from 9 to 13 days a season.

Every number links to its source, satellite crop hints were checked against farms' own reported crops, and unknowns are left unknown. The farmer stays the expert.

*(165 words)*

---

## Q2. Provide details about your project.

Rotation Lab shows what farms in any Norwegian municipality grow, how that is changing, and how the climate there has changed since the 1990s. It is built for people who work with farms but do not know the land: a fertiliser or seed supplier, a machinery dealer, an adviser, a planner, or a judge trying the app for the first time. You do not need to find a field on a map or tell farmland from a school or a stadium. You type the name of a municipality, such as Stjørdal, and one page answers three questions. The first is what farms grow: each crop's share of the farmland in 2026, and whether that share has changed steadily since 2017. The second is how the climate is changing, from NASA POWER's daily weather record since 1981. The third is where the farms are, shown as dots on a satellite map. Clicking a dot opens that piece of farm land. Its outline comes from the national property map, its soil from a global soil model, and its crops from what the farm itself reported. The land then gets the NASA view: every Landsat and Sentinel-2 image of it since 2020 from NASA HLS, a likely crop for each season, weak seasons set against the weather of that year, stronger and weaker parts of the field, and which crops have reliably ripened there. A trail at the top (All areas › Stjørdal › Farm land in Stjørdal) shows where you are, and a Simple | Detailed switch moves between a plain-language summary and the full charts, tables, methods and sources for the same land.

Under the hood, the app joins open NASA data with Norway's own public records. NASA POWER gives the weather, soil wetness and long-term normals for any location. NASA HLS gives the field's satellite record, read pixel by pixel with clouds masked. Landbruksdirektoratet, the Norwegian Agriculture Agency, publishes every farm's yearly subsidy application as open data. That is the crop area each farm grew in each year from 2017 to 2026, and we sum it by today's municipalities using Statistics Norway's list of municipal mergers. Kartverket's property service gives the parcel under a point, and ISRIC SoilGrids gives an estimate of the soil texture. A change is only reported when the whole record trends the same way, tested with Theil–Sen slopes and Mann–Kendall tests, so two decades that merely differ are not presented as climate change.

The main benefit is that someone who has never been to a place can understand its farming in a minute, with every number traceable to its source. In Stjørdal, for example, the app shows that barley fell from 44% to 36% of the farmland between 2017 and 2026 while wheat rose from 3% to 6%. It also shows that the number of farms fell from 311 to 265. Over the same period, the frost-free season grew 18 days longer than in the 1990s, the last spring frost now comes 12 days earlier, and the growing season is 1.3 °C warmer. At field level, potatoes now ripen in about 6 of 10 seasons instead of 1, while days with weather that favours potato blight rose from 9 to 13 a season. Grass, oats and potatoes show no steady change in share, and the app says so plainly instead of inventing a trend. When it cannot tell, it says why: too few seasons, too much cloud, or the crop changed.

The intended impact is better-matched advice and products for farms that are adapting to a shifting climate. A supplier who can see that a region is moving from barley towards wheat and has more blight-friendly weather can plan stock, advice and trials around what farms there actually face. The same evidence helps an adviser start a conversation with a grower. In every case the farmer remains the expert and the decision-maker. The app gives evidence and options, never orders.

Rotation Lab is written in Python 3.11 and plain JavaScript, with HTML and CSS and no front-end framework. The backend uses FastAPI, httpx, NumPy, rasterio and GDAL to read cloud-optimised satellite images, pydantic, and an SQLite cache. It is covered by 46 pytest tests. The maps use Leaflet and the charts use Chart.js and hand-built SVG. Satellite data are read from NASA HLS through Microsoft Planetary Computer. Scripts turn the Landbruksdirektoratet data into small files (one per municipality, 2.3 MB in total) that ship with the app, so the start page loads instantly. The app runs on an ordinary laptop, including offline from saved snapshots, and is also hosted on Vercel. No special hardware was used. It was developed with the help of an AI coding assistant (Claude Code).

We think the project is creative in how it makes public data trustworthy at the level of a single field. Norway publishes crops per farm, not per field. However, in a year when a farm grew one crop on all its land, that crop was on every one of its fields. We used this to check the satellite crop hints against real records. On the example field the hints matched the farm's reported crop in every checkable season. The one first miss, barley in 2020, exposed a real pattern: grass sown under a barley crop to start the next year's ley. That led to a new "new ley" rule. In the same spirit, we compared the satellite reading of the farmland around a field with what nearby farms reported. That revealed that northern grass leys were being misread, and we fixed it. We also compare a crop only with earlier seasons of the same crop, so a grass year is never judged against a cereal year. Finally, we put the satellite record and the weather side by side, so that a weak season comes with the dry spell, heat or late frost of that year, or with the honest note that the weather was normal.

We considered several factors throughout. On privacy, the app shows totals and crop areas but no farm names, organisation numbers or property numbers. It is not meant to produce lists of individual farmers to target. On honesty, sources, dates, grid sizes and cloud gaps are shown, and values that cannot be known are left as unknown instead of filled in. Drainage and irrigation, for example, have no public source we could reach. On usability for non-experts, the start is a place name rather than a map, one question is answered per section, and the details sit behind a single click. On accessibility, the plain-language view is mobile-first and high-contrast, colour is never the only signal, and all text sits in one file, ready for a Norwegian translation. On robustness, the demo works without internet, and the hosted version stays within serverless limits. On scope, the app focuses on Norway, and its crop-type rules are tuned for northern seasons. The 13 crop profiles are planning-grade values that still need review by an agronomist, and the app says so.

---

## Q3. NASA data and resources used

The NASA sources are unchanged. The first four carry the whole NASA analysis: POWER gives the climate for each area and each piece of farm land (including "then and now" since 1981), and HLS gives every field's satellite record since 2020. The GIBS layers are map backdrops in the detailed view (its "Satellite layer" menu), and nothing is calculated from them.

| Link Text | Link Url |
|---|---|
| NASA POWER Daily API (daily weather and soil wetness, 1981–today) | https://power.larc.nasa.gov/docs/services/api/temporal/daily/ |
| NASA POWER Climatology API (long-term monthly normals) | https://power.larc.nasa.gov/docs/services/api/temporal/climatology/ |
| NASA HLS Sentinel-2 surface reflectance, HLSS30 v2.0 | https://lpdaac.usgs.gov/products/hlss30v002/ |
| NASA HLS Landsat surface reflectance, HLSL30 v2.0 | https://lpdaac.usgs.gov/products/hlsl30v002/ |
| NASA GIBS map layers (MODIS, SMAP, GPM IMERG, Black Marble) | https://nasa-gibs.github.io/gibs-api-docs/ |

Supporting, non-NASA sources are listed under Q4: ESA WorldCover, Norway's public records (Landbruksdirektoratet, Kartverket, Statistics Norway), ISRIC SoilGrids, Microsoft Planetary Computer (hosts the HLS copy we read) and Esri basemaps.

---

## Q4. Other data, resources and tools (space agency partners and other sources)

All links checked and publicly accessible (15 Nov 2026). New since the first draft: Norway's public farm, property and municipality records and ISRIC SoilGrids, which now fill in each area and piece of farm land, so no example values are made up. No images, icons or text were copied from other sources: the logo and charts are drawn in our own SVG/code, and crop icons are the device's standard emoji.

### Data from space agency partners
| Link Text | Link Url |
|---|---|
| ESA WorldCover 2021, 10 m land cover (European Space Agency, CC BY 4.0), used as the farmland mask | https://esa-worldcover.org/en |
| Copernicus Sentinel-2 (ESA), the source of the Sentinel-2 half of NASA HLS | https://sentiwiki.copernicus.eu/web/s2-mission |

### Norwegian public records
| Link Text | Link Url |
|---|---|
| Landbruksdirektoratet (Norwegian Agriculture Agency): production-subsidy applications 2017–2026, crop areas each farm reported per year (open data, NLOD); the crop shares and trends for each municipality, and each farm's reported crops | https://github.com/LandbruksdirektoratetGIT/opendata/tree/main/datasets/produksjon-og-avlosertilskudd |
| Landbruksdirektoratet: farm register with farm-centre coordinates (open data, NLOD); the farm dots on the area map (no names shown) | https://github.com/LandbruksdirektoratetGIT/opendata/tree/main/datasets/foretak |
| Kartverket property service (eiendom API): the property parcel under a point, used as the outline of a piece of farm land and to find the farm based there | https://ws.geonorge.no/eiendom/v1/ |
| Kartverket municipality service (kommuneinfo API): today's municipality names and numbers for the place search | https://ws.geonorge.no/kommuneinfo/v1/ |
| Statistics Norway KLASS 131: municipality changes since 2017, to count every year under today's municipalities | https://www.ssb.no/klass/klassifikasjoner/131 |

### Other data and data access
| Link Text | Link Url |
|---|---|
| ISRIC SoilGrids 2.0: 250 m global soil model (sand, silt, clay; CC BY 4.0), the soil-texture estimate for each piece of farm land | https://www.isric.org/explore/soilgrids |
| Microsoft Planetary Computer, open hosting of NASA HLS and ESA WorldCover (STAC API) | https://planetarycomputer.microsoft.com/ |
| Planetary Computer: HLS Sentinel-2 collection (hls2-s30) | https://planetarycomputer.microsoft.com/dataset/hls2-s30 |
| Planetary Computer: ESA WorldCover collection | https://planetarycomputer.microsoft.com/dataset/esa-worldcover |
| Esri World Imagery (basemap) | https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 |
| Esri World Boundaries and Places (map labels) | https://www.arcgis.com/home/item.html?id=a842e359856a4365b1ddf8cc34fde079 |
| Statistics Norway, table 06462: agricultural area by crop, by municipality (an earlier accuracy check of the satellite crop map) | https://www.ssb.no/en/statbank/table/06462/ |

### Methods and reference text
| Link Text | Link Url |
|---|---|
| FAO Irrigation and Drainage Paper 56: crop evapotranspiration (ET₀, crop coefficients) | https://www.fao.org/4/x0490e/x0490e00.htm |

### Code libraries
| Link Text | Link Url |
|---|---|
| Python | https://www.python.org/ |
| FastAPI (web framework) | https://fastapi.tiangolo.com/ |
| Uvicorn (web server) | https://www.uvicorn.dev/ |
| HTTPX (HTTP client) | https://www.python-httpx.org/ |
| Pydantic (data validation) | https://docs.pydantic.dev/ |
| NumPy | https://numpy.org/ |
| Rasterio (satellite image reading) | https://rasterio.readthedocs.io/ |
| GDAL (geospatial library behind Rasterio) | https://gdal.org/ |
| SQLite (local cache) | https://www.sqlite.org/ |
| pytest (tests) | https://docs.pytest.org/ |
| Leaflet 1.9.4 (maps) | https://leafletjs.com/ |
| Chart.js 4.4.1 (charts) | https://www.chartjs.org/ |

### Fonts
| Link Text | Link Url |
|---|---|
| Atkinson Hyperlegible (Google Fonts), field view | https://fonts.google.com/specimen/Atkinson+Hyperlegible |
| Inter (Google Fonts), data view | https://fonts.google.com/specimen/Inter |
| JetBrains Mono (Google Fonts), data view numbers | https://fonts.google.com/specimen/JetBrains+Mono |

### Tools and hosting
| Link Text | Link Url |
|---|---|
| GitHub (code repository) | https://github.com/ |
| Vercel (hosting of the live demo) | https://vercel.com/ |
| Claude Code (AI coding assistant used in development) | https://www.anthropic.com/claude-code |

### Design inspiration (nothing copied)
| Link Text | Link Url |
|---|---|
| DigiFarm: ideas for productivity zones, zone downloads and field indices; no code, text, images or branding used | https://www.digifarm.io/ |
| CropOrbit: ideas for starting from a map of farms and for preparing the farm records ahead of time; no code, text, images or branding used | https://croporbit.larkswombatsystems.no/ |
