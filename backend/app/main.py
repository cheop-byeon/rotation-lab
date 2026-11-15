"""Rotation Lab API — NASA Earth data for farm decisions."""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

import json

from . import agro, change, cropcheck, crops, hls, neighbourhood, power, stress
from .advisor import build_advisories
from .db import connect, init_db

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"

app = FastAPI(title="Rotation Lab", version="1.0.0",
              description="Crop and climate decision support built on NASA POWER and NASA GIBS.")

Soil = Literal["Unknown", "Loamy", "Sandy", "Clayey", "Silty", "Peat"]
Drainage = Literal["Unknown", "Good", "Moderate", "Poor"]
Irrigation = Literal["Unknown", "No", "Yes"]


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    # Make browsers re-check JS/CSS on every load (cheap 304 when unchanged), so an update
    # never leaves an old module cached next to a new one.
    response = await call_next(request)
    if request.url.path.endswith((".js", ".css", ".html")) or request.url.path in ("/", "/data"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.on_event("startup")
def _startup() -> None:
    init_db()


# Serverless runtimes may skip ASGI startup events, so make sure the tables exist as soon as the app is imported
# (init_db is idempotent).
init_db()


# ------------------------------------------------------------------ models
class FieldIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lat: float = Field(ge=-60, le=75)
    lon: float = Field(ge=-180, le=180)
    soil: Soil = "Unknown"
    drainage: Drainage = "Unknown"
    irrigation: Irrigation = "Unknown"
    previous_crop: str = "Barley"
    notes: str = Field(default="", max_length=500)
    boundary: dict | None = None  # GeoJSON Polygon of the field outline (optional)

    @field_validator("boundary")
    @classmethod
    def _check_boundary(cls, v):
        if v is not None and (problem := hls.validate_boundary(v)):
            raise ValueError(problem)
        return v


class VegetationRequest(BaseModel):
    boundary: dict
    seasons: int | None = Field(default=None, ge=1, le=12)  # None = every season in the archive (2020 onward)

    @field_validator("boundary")
    @classmethod
    def _check_boundary(cls, v):
        if problem := hls.validate_boundary(v):
            raise ValueError(problem)
        return v


class Plan(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    years: list[str] = Field(min_length=1, max_length=6)


class RankRequest(BaseModel):
    lat: float | None = Field(default=None, ge=-60, le=75)
    lon: float | None = Field(default=None, ge=-180, le=180)
    soil: Soil = "Unknown"
    drainage: Drainage = "Unknown"
    irrigation: Irrigation = "Unknown"
    previous_crop: str = "Barley"
    priorities: list[float] = Field(default=[4, 3, 2, 3], min_length=4, max_length=4)
    plans: list[Plan] = Field(default_factory=lambda: [Plan(**p) for p in crops.DEFAULT_ROTATIONS], max_length=8)


# ------------------------------------------------------------------ helpers
async def _climate(lat: float, lon: float) -> tuple[agro.Climate, dict | None]:
    try:
        series = await power.fetch_daily(lat, lon)
    except power.PowerUnavailable as exc:
        raise HTTPException(503, f"NASA POWER is unavailable and no cached data exists for this location: {exc}")
    try:
        clim = await power.fetch_climatology(lat, lon)
    except power.PowerUnavailable:
        clim = None
    return _climate_obj(series.lat, series.lon, series.retrieved_at, series), clim


_climate_cache: dict[tuple, agro.Climate] = {}


def _climate_obj(lat, lon, stamp, series) -> agro.Climate:
    key = (round(lat, 2), round(lon, 2), stamp)
    if key not in _climate_cache:
        if len(_climate_cache) > 32:
            _climate_cache.clear()
        _climate_cache[key] = agro.Climate(series)
    return _climate_cache[key]


@lru_cache(maxsize=64)
def _suitability_cached(key: tuple, irrigation: str) -> list[dict]:
    return crops.crop_suitability(_climate_cache[key], irrigation)


def _suitability(c: agro.Climate, irrigation: str) -> list[dict]:
    key = (round(c.lat, 2), round(c.s.lon, 2), c.s.retrieved_at)
    return _suitability_cached(key, irrigation)


def _analyze(c: agro.Climate, clim: dict | None, profile: dict) -> dict:
    now = agro.current_conditions(c)
    frost = agro.frost_climatology(c)
    phase = agro.season_phase(c, frost)
    gdd = agro.gdd_progress(c)
    seasons = agro.season_summaries(c)
    suit = _suitability(c, profile["irrigation"])
    s = c.s
    return {
        "location": {"lat": s.lat, "lon": s.lon, "elevation_m": s.elevation,
                     "hemisphere": "north" if c.north else "south"},
        "provenance": {
            "dataset": "NASA POWER Daily (Agroclimatology community), v2 API",
            "sources": "MERRA-2 reanalysis, GEOS-IT near-real-time (latest weeks), CERES SYN1deg solar"
                       + (f" · response header: {', '.join(s.sources)}" if s.sources else ""),
            "grid": "0.5° × 0.625° (meteorology)",
            "request_url": s.request_url,
            "retrieved_at": s.retrieved_at,
            "delivery": s.source,
            "period": f"{s.dates[0].isoformat()} → {c.last.isoformat()}",
            "days": len(s.dates),
            "interior_missing_days": s.missing,
            "parameters": {k: {"name": n, "unit": u} for k, (n, u) in power.DAILY_PARAMS.items()},
            "climatology": {"period": clim["period"], "delivery": clim["source"]} if clim else None,
            "methods": {
                "ET0": "Hargreaves–Samani (FAO-56 eq. 52)",
                "GDD": "Σ max(0, Tmean − Tbase)",
                "Frost": "2 m daily minimum ≤ 0 °C (−3 °C for frost-tolerant crops)",
                "Seasons": "Mid-winter to mid-winter (1 Jan north, 1 Jul south)",
            },
        },
        "phase": phase,
        "now": now,
        "frost": frost,
        "gdd": gdd,
        "recent": agro.recent_series(c),
        "soil": agro.soil_series(c),
        "monthly": agro.monthly_anomalies(c, clim),
        "seasons": seasons,
        "suitability": suit,
        "advisories": build_advisories(now, frost, gdd, phase, suit, seasons, profile),
    }


# ------------------------------------------------------------------ routes
@app.get("/api/health")
def health():
    with connect() as con:
        cached = con.execute("SELECT COUNT(*) FROM power_cache").fetchone()[0]
    return {"status": "ok", "cached_locations": cached, "today": date.today().isoformat()}


@app.get("/api/crops")
def crop_catalog():
    return {"crops": [{"name": c.name, "family": c.family, "note": c.note, "n_fixing": c.n_fixing,
                       "perennial": c.perennial, "frost_tolerant": c.frost_tolerant}
                      for c in crops.CROPS.values()],
            "goals": crops.GOALS, "default_rotations": crops.DEFAULT_ROTATIONS}


@app.get("/api/layers")
def gibs_layers():
    """NASA GIBS WMTS layers (Web Mercator) with sensible default dates."""
    today = date.today()
    root = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"

    def layer(id_, title, matrix, ext, lag, max_zoom, desc, legend=None, dated=True):
        time = "/{time}" if dated else ""
        return {"id": id_, "title": title, "max_native_zoom": max_zoom, "dated": dated,
                "default_date": (today - timedelta(lag)).isoformat() if dated else None,
                "description": desc, "legend": legend,
                "url": f"{root}/{id_}/default{time}/{matrix}/{{z}}/{{y}}/{{x}}.{ext}"}
    return {"layers": [
        layer("MODIS_Terra_NDVI_8Day", "Vegetation greenness · NDVI (MODIS 8-day)", "GoogleMapsCompatible_Level9", "png", 10, 9,
              "8-day NDVI composite (250 m). Higher = denser, healthier vegetation.",
              legend={"low": "Bare", "high": "Dense", "colors": ["#a5743a", "#e9d68a", "#8fc35b", "#2f7d32", "#0b4a1a"]}),
        layer("SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", "Root-zone soil moisture (SMAP L4)", "GoogleMapsCompatible_Level6", "png", 5, 6,
              "SMAP Level-4 analysed root-zone soil moisture (~9 km).",
              legend={"low": "Dry", "high": "Wet", "colors": ["#ce8d3b", "#f2dc8c", "#9fd5b8", "#3d8ec9", "#1c3f94"]}),
        layer("IMERG_Precipitation_Rate", "Precipitation (GPM IMERG daily)", "GoogleMapsCompatible_Level6", "png", 2, 6,
              "GPM IMERG satellite precipitation estimate (~10 km).",
              legend={"low": "Light", "high": "Heavy", "colors": ["#b3e5fc", "#4fc3f7", "#1e88e5", "#7b1fa2", "#e91e63"]}),
        layer("MODIS_Terra_Land_Surface_Temp_Day", "Land surface temperature · day (MODIS)", "GoogleMapsCompatible_Level7", "png", 2, 7,
              "Daytime land-surface temperature (1 km).",
              legend={"low": "Cold", "high": "Hot", "colors": ["#2c3e99", "#4fb3d9", "#f5e663", "#f28b30", "#b2182b"]}),
        layer("MODIS_Terra_CorrectedReflectance_TrueColor", "True color (MODIS Terra)", "GoogleMapsCompatible_Level9", "jpg", 1, 9,
              "Daily natural-colour imagery (250 m), clouds included."),
        layer("BlueMarble_ShadedRelief_Bathymetry", "Blue Marble relief", "GoogleMapsCompatible_Level8", "jpeg", 0, 8,
              "NASA Blue Marble shaded relief and bathymetry.", dated=False),
        layer("VIIRS_Black_Marble", "Night lights (VIIRS Black Marble 2016)", "GoogleMapsCompatible_Level8", "png", 0, 8,
              "VIIRS night-time lights composite.", dated=False),
    ], "labels": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
       "attribution": "NASA EOSDIS GIBS / Worldview"}


@app.get("/api/analysis")
async def analysis(
    lat: float = Query(ge=-60, le=75), lon: float = Query(ge=-180, le=180),
    soil: Soil = "Unknown", drainage: Drainage = "Unknown", irrigation: Irrigation = "Unknown",
    previous_crop: str = "Barley",
):
    c, clim = await _climate(lat, lon)
    profile = {"soil": soil, "drainage": drainage, "irrigation": irrigation, "previous_crop": previous_crop}
    return await run_in_threadpool(_analyze, c, clim, profile)


@app.post("/api/rotations/rank")
async def rank(req: RankRequest):
    unknown = {n for p in req.plans for n in p.years} - set(crops.CROPS)
    if unknown:
        raise HTTPException(422, f"Unknown crop(s): {', '.join(sorted(unknown))}")
    suit = None
    if req.lat is not None and req.lon is not None:
        c, _ = await _climate(req.lat, req.lon)
        suit = await run_in_threadpool(_suitability, c, req.irrigation)
    profile = req.model_dump(include={"soil", "drainage", "irrigation", "previous_crop"})
    return {"goals": crops.GOALS,
            "rankings": crops.rank_rotations(profile, req.priorities, [p.model_dump() for p in req.plans], suit)}


@app.get("/api/change")
async def what_changed(lat: float = Query(ge=-60, le=75), lon: float = Query(ge=-180, le=180)):
    """Then (1991–2000) versus now (last ten seasons) from the full NASA POWER record since 1981."""
    try:
        series = await power.fetch_daily(lat, lon, full=True)
    except power.PowerUnavailable as exc:
        raise HTTPException(503, f"NASA POWER is unavailable and no cached data exists for this location: {exc}")
    return {**change.what_changed(agro.Climate(series)),
            "provenance": {"delivery": series.source, "retrieved_at": series.retrieved_at, "request_url": series.request_url}}


@app.get("/api/crop-check")
async def crop_check(lat: float = Query(ge=-60, le=75), lon: float = Query(ge=-180, le=180), crop: str = Query(min_length=1)):
    """Is this crop still a good choice here? Then (1991–2000) versus now, from the full NASA POWER record."""
    if crop not in crops.CROPS:
        raise HTTPException(404, f"Unknown crop: {crop}")
    try:
        series = await power.fetch_daily(lat, lon, full=True)
    except power.PowerUnavailable as exc:
        raise HTTPException(503, f"NASA POWER is unavailable and no cached data exists for this location: {exc}")
    return cropcheck.crop_then_now(agro.Climate(series), crop)


@app.post("/api/vegetation")
async def vegetation(req: VegetationRequest):
    """NDVI / NDMI record for a field outline from NASA HLS (30 m), clouds masked, by season."""
    try:
        rec = await run_in_threadpool(hls.field_record, req.boundary, req.seasons)
    except hls.HLSUnavailable as exc:
        raise HTTPException(503, str(exc))
    # Season check: join each satellite season with the NASA POWER weather of the same season.
    try:
        c, _ = await _climate(rec["centroid"]["lat"], rec["centroid"]["lon"])
        weather = agro.season_summaries(c, include_current=True)
    except HTTPException:
        weather = None  # weather unavailable: still compare greenness, just without the weather check
    rec["season_check"] = stress.season_check(rec["seasons"], weather)
    return rec


@app.post("/api/neighbourhood")
async def neighbourhood_crops(req: VegetationRequest):
    """Broad crop types on farmland within ~2 km of the field, each season since 2020 (NASA HLS + ESA WorldCover)."""
    try:
        return await run_in_threadpool(neighbourhood.neighbourhood, req.boundary)
    except hls.HLSUnavailable as exc:
        raise HTTPException(503, str(exc))


@app.post("/api/zones")
async def zones(req: VegetationRequest):
    """Within-field productivity zones from multi-season NASA HLS EVI (30 m pixels, edges excluded)."""
    try:
        return await run_in_threadpool(hls.field_zones, req.boundary, req.seasons)
    except hls.HLSUnavailable as exc:
        raise HTTPException(503, str(exc))


@app.get("/api/export.csv")
async def export_csv(lat: float = Query(ge=-60, le=75), lon: float = Query(ge=-180, le=180)):
    c, _ = await _climate(lat, lon)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"# NASA POWER daily, lat {c.s.lat}, lon {c.s.lon}, retrieved {c.s.retrieved_at}; ET0 = Hargreaves"])
    params = list(power.DAILY_PARAMS)
    w.writerow(["date", *params, "ET0_HARGREAVES"])
    for i, d in enumerate(c.s.dates):
        w.writerow([d.isoformat(), *("" if c.s.values[p][i] is None else c.s.values[p][i] for p in params),
                    "" if c.et0[i] is None else round(c.et0[i], 2)])
    buf.seek(0)
    name = f"nasa_power_{c.s.lat:.2f}_{c.s.lon:.2f}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---- saved fields
def _field_row(r) -> dict:
    d = dict(r)
    d["boundary"] = json.loads(d["boundary"]) if d.get("boundary") else None
    d["reported_crops"] = json.loads(d["reported_crops"]) if d.get("reported_crops") else None
    if d["reported_crops"]:
        from .db import REPORTED_SOURCE
        d["reported_source"] = REPORTED_SOURCE
    return d


@app.get("/api/fields")
def list_fields():
    with connect() as con:
        return [_field_row(r) for r in con.execute("SELECT * FROM fields ORDER BY id")]


@app.post("/api/fields", status_code=201)
def create_field(f: FieldIn):
    with connect() as con:
        cur = con.execute(
            "INSERT INTO fields(name, lat, lon, soil, drainage, irrigation, previous_crop, notes, boundary) VALUES (?,?,?,?,?,?,?,?,?)",
            (f.name, f.lat, f.lon, f.soil, f.drainage, f.irrigation, f.previous_crop, f.notes,
             json.dumps(f.boundary) if f.boundary else None))
        return _field_row(con.execute("SELECT * FROM fields WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.put("/api/fields/{field_id}")
def update_field(field_id: int, f: FieldIn):
    with connect() as con:
        cur = con.execute(
            "UPDATE fields SET name=?, lat=?, lon=?, soil=?, drainage=?, irrigation=?, previous_crop=?, notes=?, boundary=?, demo=0 WHERE id=?",
            (f.name, f.lat, f.lon, f.soil, f.drainage, f.irrigation, f.previous_crop, f.notes,
             json.dumps(f.boundary) if f.boundary else None, field_id))
        if not cur.rowcount:
            raise HTTPException(404, "Field not found")
        return _field_row(con.execute("SELECT * FROM fields WHERE id = ?", (field_id,)).fetchone())


@app.delete("/api/fields/{field_id}", status_code=204)
def delete_field(field_id: int):
    with connect() as con:
        if not con.execute("DELETE FROM fields WHERE id = ?", (field_id,)).rowcount:
            raise HTTPException(404, "Field not found")


# ------------------------------------------------------------------ frontend
@app.get("/", include_in_schema=False)
def field_view():
    """Field view: plain-language overview of one field."""
    return FileResponse(FRONTEND / "index.html")


@app.get("/data", include_in_schema=False)
def data_view():
    """Data view: full analysis, charts and provenance."""
    return FileResponse(FRONTEND / "data.html")


@app.get("/specialist", include_in_schema=False)
@app.get("/farmer", include_in_schema=False)
def old_view_links(request: Request):
    # Earlier URLs, kept so shared links keep working.
    return RedirectResponse("/data" if request.url.path == "/specialist" else "/", status_code=301)


app.mount("/", StaticFiles(directory=FRONTEND), name="frontend")
