"""Field-level vegetation record from NASA HLS v2.0.

HLS (Harmonized Landsat Sentinel-2) is NASA's 30 m surface-reflectance product
combining Landsat 8/9 (L30) and Sentinel-2 A/B/C (S30), produced by NASA LP DAAC.
We read the copy hosted openly on Microsoft Planetary Computer (no login), and
only the pixels inside the field boundary, straight from the cloud-optimised
GeoTIFFs via HTTP range requests.

Per image: pixels flagged by HLS Fmask as cloud, cloud-adjacent, cloud shadow,
snow/ice or water are removed; if fewer than MIN_CLEAR of the field's pixels
are clear, the image is counted but gives no value. NDVI and NDMI are the
median over the clear pixels.
"""
from __future__ import annotations

import hashlib
import json
import calendar
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import httpx
import numpy as np

from pathlib import Path

from .db import connect

SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "data" / "snapshots"

STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/{collection}"
COLLECTIONS = {
    "hls2-s30": {"sensor": "Sentinel-2", "blue": "B02", "red": "B04", "nir": "B8A", "swir": "B11"},
    "hls2-l30": {"sensor": "Landsat", "blue": "B02", "red": "B04", "nir": "B05", "swir": "B06"},
}
ATTRIBUTION = "NASA HLS v2.0 (LP DAAC), accessed via Microsoft Planetary Computer"
ARCHIVE_START = date(2020, 1, 1)  # Planetary Computer's HLS v2.0 collections start here (NASA LP DAAC goes back to 2013)
SCENE_CLOUD_MAX = 80      # skip images whose whole-tile cloud cover is above this
MIN_CLEAR = 0.6           # share of the field that must be clear to use an image
FILL = -9999
SCALE = 0.0001
GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
            "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "1", "VSI_CACHE": "TRUE"}

_tokens: dict[str, tuple[str, float]] = {}


class HLSUnavailable(RuntimeError):
    pass


# ---------------------------------------------------------------- geometry
def _ring(geom: dict) -> list[list[float]]:
    return geom["coordinates"][0]


def area_ha(geom: dict) -> float:
    """Polygon area via a local equal-area approximation (fine for field-sized shapes)."""
    ring = _ring(geom)
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    pts = [(p[0] * 111320 * math.cos(lat0), p[1] * 110540) for p in ring]
    s = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:]))
    return abs(s) / 2 / 10_000


def centroid(geom: dict) -> tuple[float, float]:
    ring = _ring(geom)[:-1]
    return sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)


def _segments_cross(a, b, c, d) -> bool:
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return (orient(a, b, c) * orient(a, b, d) < 0) and (orient(c, d, a) * orient(c, d, b) < 0)


def validate_boundary(geom: dict) -> str | None:
    """Return a problem description, or None if the boundary is usable."""
    if not isinstance(geom, dict) or geom.get("type") != "Polygon":
        return "Boundary must be a GeoJSON Polygon."
    try:
        ring = [[float(x), float(y)] for x, y in _ring(geom)]
    except (KeyError, IndexError, TypeError, ValueError):
        return "Boundary coordinates are malformed."
    if len(ring) < 4 or ring[0] != ring[-1]:
        return "Boundary needs at least 3 points and must be closed."
    if len(ring) > 301:
        return "Boundary has too many points (max 300)."
    if not all(-180 <= x <= 180 and -60 <= y <= 75 for x, y in ring):
        return "Boundary is outside the supported area (latitude −60 to 75)."
    segs = list(zip(ring, ring[1:]))
    for i in range(len(segs)):
        for j in range(i + 2, len(segs)):
            if i == 0 and j == len(segs) - 1:
                continue  # first and last segments share the closing point
            if _segments_cross(*segs[i], *segs[j]):
                return "Boundary crosses itself."
    ha = area_ha({"coordinates": [ring]})
    if ha < 0.3:
        return f"Field is too small for 30 m satellite pixels ({ha:.2f} ha; minimum 0.3 ha)."
    if ha > 2000:
        return f"Field is too large ({ha:.0f} ha; maximum 2000 ha)."
    return None


def boundary_key(geom: dict) -> str:
    ring = [[round(x, 6), round(y, 6)] for x, y in _ring(geom)]
    return hashlib.sha1(json.dumps(ring).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- seasons (same convention as agro.Climate)
def season_of(d: date, lat: float) -> tuple[int, str]:
    if lat >= 0:
        return d.year, str(d.year)
    y = d.year + 1 if d.month >= 7 else d.year
    return y, f"{y - 1}/{str(y)[2:]}"


def in_growing_months(d: date, lat: float) -> bool:
    if abs(lat) < 23.5:
        return True  # tropics: crops can grow all year
    return 4 <= d.month <= 10 if lat > 0 else (d.month >= 10 or d.month <= 4)


def default_seasons(lat: float, today: date) -> int:
    """Every season the openly hosted HLS archive covers."""
    current, _ = season_of(today, lat)
    first, _ = season_of(ARCHIVE_START, lat)
    if lat < 0:
        first += 1  # the first southern season (Jul–Jun) that starts after the archive does
    return current - first + 1


def season_range(lat: float, seasons: int | None, today: date) -> tuple[str, str]:
    current, _ = season_of(today, lat)
    first = current - (seasons or default_seasons(lat, today)) + 1
    start = date(first, 1, 1) if lat >= 0 else date(first - 1, 7, 1)
    return max(start, ARCHIVE_START).isoformat(), today.isoformat()


# ---------------------------------------------------------------- catalogue + access
def _token(collection: str, client: httpx.Client) -> str:
    tok, exp = _tokens.get(collection, ("", 0.0))
    if time.time() < exp - 300:
        return tok
    r = client.get(SAS_TOKEN.format(collection=collection))
    r.raise_for_status()
    body = r.json()
    expiry = datetime.fromisoformat(body["msft:expiry"].replace("Z", "+00:00")).timestamp()
    _tokens[collection] = (body["token"], expiry)
    return body["token"]


def search(geom: dict, start: str, end: str, client: httpx.Client) -> list[dict]:
    body = {"collections": list(COLLECTIONS), "intersects": geom, "datetime": f"{start}/{end}",
            "limit": 250, "query": {"eo:cloud_cover": {"lt": SCENE_CLOUD_MAX}}}
    items, url = [], STAC_SEARCH
    for _ in range(20):  # pagination guard
        r = client.post(url, json=body)
        if r.status_code != 200:
            raise HLSUnavailable(f"HLS catalogue search failed: HTTP {r.status_code}")
        page = r.json()
        items += page.get("features", [])
        nxt = next((l for l in page.get("links", []) if l.get("rel") == "next"), None)
        if not nxt:
            break
        url, body = nxt["href"], nxt.get("body", body)
    return items


# ---------------------------------------------------------------- per-image reading
def _clear(fmask: np.ndarray) -> np.ndarray:
    bad = 0
    for bit in (1, 2, 3, 4, 5):  # cloud, adjacent to cloud/shadow, cloud shadow, snow/ice, water
        bad |= (fmask >> bit) & 1
    return (bad == 0) & (fmask != 255)


def read_item(item: dict, geom: dict, token: str) -> dict:
    import rasterio  # imported here: only live reads need it (it is not installed on the hosted version)
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_geom
    from rasterio.windows import from_bounds
    spec = COLLECTIONS[item["collection"]]
    href = lambda band: f"{item['assets'][band]['href']}?{token}"  # noqa: E731
    obs = {"id": item["id"], "date": item["properties"]["datetime"][:10], "sensor": spec["sensor"],
           "scene_cloud": item["properties"].get("eo:cloud_cover"), "ndvi": None, "ndmi": None, "evi": None,
           "clear_pct": 0.0, "pixels": 0}
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(href("Fmask")) as src:
            shape = transform_geom("EPSG:4326", src.crs, geom)
            xs = [p[0] for p in shape["coordinates"][0]]
            ys = [p[1] for p in shape["coordinates"][0]]
            win = from_bounds(min(xs) - 30, min(ys) - 30, max(xs) + 30, max(ys) + 30, src.transform)
            win = win.round_offsets().round_lengths()
            fmask = src.read(1, window=win, boundless=True, fill_value=255)
            inside = geometry_mask([shape], out_shape=fmask.shape, transform=src.window_transform(win), invert=True)
        n_inside = int(inside.sum())
        if n_inside == 0:
            return obs
        clear = inside & _clear(fmask)
        obs["pixels"], obs["clear_pct"] = n_inside, round(float(clear.sum()) / n_inside, 3)
        if obs["clear_pct"] < MIN_CLEAR:
            return obs
        bands = {}
        for key in ("blue", "red", "nir", "swir"):
            with rasterio.open(href(spec[key])) as src:
                bands[key] = src.read(1, window=win, boundless=True, fill_value=FILL).astype("float32")
    # Reflectance must be positive: HLS has a few slightly negative values (dark water, shadow, atmospheric
    # over-correction), and a negative red band pushes NDVI above 1.
    valid = clear & np.all([(bands[k] != FILL) & (bands[k] > 0) for k in ("blue", "red", "nir", "swir")], axis=0)
    if valid.sum() < 3:
        return obs
    blue, red, nir, swir = (bands[k][valid] * SCALE for k in ("blue", "red", "nir", "swir"))
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (nir - red) / (nir + red)
        ndmi = (nir - swir) / (nir + swir)
        evi = 2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)
    evi = evi[(evi > -1) & (evi < 1.5)]
    obs["ndvi"] = round(float(np.nanmedian(ndvi)), 3)
    obs["ndmi"] = round(float(np.nanmedian(ndmi)), 3)
    obs["evi"] = round(float(np.nanmedian(evi)), 3) if evi.size else None
    return obs


# ---------------------------------------------------------------- per-pixel reading (productivity zones)
def read_item_pixels(item: dict, geom: dict, token: str) -> dict:
    """EVI per clear pixel inside the field, on the image's native 30 m MGRS grid."""
    import rasterio  # imported here: only live reads need it (it is not installed on the hosted version)
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_geom
    from rasterio.windows import from_bounds
    spec = COLLECTIONS[item["collection"]]
    href = lambda band: f"{item['assets'][band]['href']}?{token}"  # noqa: E731
    out = {"id": item["id"], "date": item["properties"]["datetime"][:10], "tile": item["id"].split(".")[2], "evi": None}
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(href("Fmask")) as src:
            shape = transform_geom("EPSG:4326", src.crs, geom)
            xs = [p[0] for p in shape["coordinates"][0]]
            ys = [p[1] for p in shape["coordinates"][0]]
            win = from_bounds(min(xs) - 30, min(ys) - 30, max(xs) + 30, max(ys) + 30, src.transform)
            win = win.round_offsets().round_lengths()
            fmask = src.read(1, window=win, boundless=True, fill_value=255)
            transform = src.window_transform(win)
            out.update(crs=str(src.crs), transform=[round(v, 4) for v in list(transform)[:6]], shape=list(fmask.shape))
            inside = geometry_mask([shape], out_shape=fmask.shape, transform=transform, invert=True)
        clear = inside & _clear(fmask)
        if clear.sum() < 3:
            return out
        bands = {}
        for key in ("blue", "red", "nir"):
            with rasterio.open(href(spec[key])) as src:
                bands[key] = src.read(1, window=win, boundless=True, fill_value=FILL).astype("float32")
    valid = clear & (bands["blue"] != FILL) & (bands["red"] != FILL) & (bands["nir"] != FILL)
    b, r, n = (bands[k] * SCALE for k in ("blue", "red", "nir"))
    with np.errstate(divide="ignore", invalid="ignore"):
        evi = 2.5 * (n - r) / (n + 6 * r - 7.5 * b + 1)
    evi = np.where(valid & (evi > -1) & (evi < 1.5), evi, np.nan)
    out["evi"] = [[None if np.isnan(v) else round(float(v), 3) for v in row] for row in evi]
    return out


import warnings  # noqa: E402
warnings.filterwarnings("ignore", message="All-NaN slice encountered", category=RuntimeWarning)

ZONE_LOW, ZONE_HIGH = 0.95, 1.05   # relative to the field median of the same season
MIN_INTERIOR = 8                   # whole pixels away from the edge needed to map zones
MAX_ZONE_PIXELS = 3000             # ≈ 270 ha at 30 m
ZONE_SEASONS = 5                   # seasons the views ask for (frontend api.zones); snapshots save zones for the same


def compute_zones(px_obs: list[dict], geom: dict, lat: float) -> dict:
    """Per pixel: peak EVI each season relative to the field median, averaged over seasons."""
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine
    from rasterio.warp import transform as warp, transform_geom

    good = [o for o in px_obs if o.get("evi") is not None]
    if not good:
        return {"status": "no_data", "message": "No clear satellite images of this field."}
    groups: dict[tuple, list[dict]] = {}
    for o in good:  # Landsat and Sentinel-2 HLS share the MGRS 30 m grid; keep one tile's grid
        groups.setdefault((o["tile"], tuple(o["transform"]), tuple(o["shape"])), []).append(o)
    (tile, tf, shp), obs = max(groups.items(), key=lambda kv: len(kv[1]))
    h, w = shp
    if h * w > MAX_ZONE_PIXELS * 2:
        return {"status": "too_large", "message": "Field too large for zone mapping in this demo (about 270 ha maximum)."}
    transform = Affine(*tf)
    crs = obs[0]["crs"]
    shape = transform_geom("EPSG:4326", crs, geom)
    inside = geometry_mask([shape], out_shape=(h, w), transform=transform, invert=True)
    # Edge pixels overlap hedges, roads and neighbouring fields; they are shown but never classified.
    padded = np.pad(inside, 1, constant_values=False)
    edge = inside & ~(padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:])
    interior = inside & ~edge
    if interior.sum() < MIN_INTERIOR:
        return {"status": "too_small", "message": f"Only {int(interior.sum())} whole 30 m pixels lie inside the field, away from its edges; "
                                                  f"at least {MIN_INTERIOR} are needed to map zones."}
    by_season: dict[int, list[np.ndarray]] = {}
    for o in obs:
        y, _ = season_of(date.fromisoformat(o["date"]), lat)
        by_season.setdefault(y, []).append(np.array(o["evi"], dtype="float32"))
    rel_layers, used = [], []
    for y, arrs in sorted(by_season.items()):
        stack = np.stack(arrs)
        count = np.sum(~np.isnan(stack), axis=0)
        with np.errstate(all="ignore"):
            peak = np.where(count >= 3, np.nanpercentile(stack, 90, axis=0), np.nan)
        cover = np.sum(~np.isnan(peak[interior])) / max(1, interior.sum())
        if cover < 0.5:
            continue  # too cloudy this season to map the field
        median = np.nanmedian(peak[interior])
        rel_layers.append(peak / median)
        used.append({"season": y, "images": len(arrs), "field_median_peak_evi": round(float(median), 3)})
    if len(rel_layers) < 2:
        return {"status": "too_few_seasons", "message": "Fewer than two seasons with enough clear images to map zones."}
    rel = np.stack(rel_layers)
    import warnings
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        mean_rel = np.nanmean(rel, axis=0)
        n_seasons = np.sum(~np.isnan(rel), axis=0)
        side = np.sign(rel - 1)
        mean_side = np.sign(mean_rel - 1)
        consistency = np.nansum(side == mean_side, axis=0) / np.maximum(1, n_seasons)
    zone = np.full((h, w), "", dtype=object)
    zone[mean_rel < ZONE_LOW] = "weaker"
    zone[(mean_rel >= ZONE_LOW) & (mean_rel <= ZONE_HIGH)] = "average"
    zone[mean_rel > ZONE_HIGH] = "stronger"
    zone[edge] = "edge"
    cells, counts = [], {"weaker": 0, "average": 0, "stronger": 0}
    rows, cols = np.where(inside & ~np.isnan(mean_rel) & (n_seasons >= 2))
    for r_, c_ in zip(rows, cols):
        xs, ys = [], []
        for dc, dr in ((0, 0), (1, 0), (1, 1), (0, 1), (0, 0)):
            col, row = c_ + dc, r_ + dr
            x, y = transform.c + transform.a * col + transform.b * row, transform.f + transform.d * col + transform.e * row
            xs.append(x); ys.append(y)
        lons, lats = warp(crs, "EPSG:4326", xs, ys)
        z = zone[r_, c_]
        if z in counts:
            counts[z] += 1
        cells.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[round(a, 6), round(b, 6)] for a, b in zip(lons, lats)]]},
                      "properties": {"zone": z, "relative": round(float(mean_rel[r_, c_]), 3),
                                     "consistency": round(float(consistency[r_, c_]), 2), "seasons": int(n_seasons[r_, c_]),
                                     "edge": bool(edge[r_, c_])}})
    total = sum(counts.values())
    vals = mean_rel[interior & ~np.isnan(mean_rel)]
    cv = float(np.std(vals) / np.mean(vals)) if vals.size else 0.0
    share = {k: round(v / total, 3) for k, v in counts.items()} if total else counts
    uniform = (share.get("weaker", 0) + share.get("stronger", 0)) < 0.10
    return {"status": "ok", "tile": tile, "pixels": total, "interior_pixels": total, "pixel_size_m": 30, "seasons_used": used,
            "share": share, "cv": round(cv, 3), "uniform": uniform, "edge_pixels": int(edge[rows, cols].sum()),
            "thresholds": {"weaker_below": ZONE_LOW, "stronger_above": ZONE_HIGH},
            "cells": {"type": "FeatureCollection", "features": cells},
            "method": "Per season: 90th-percentile EVI per 30 m pixel (≥3 clear images), divided by the median of the field's interior pixels that season; "
                      "averaged over seasons (≥2). Weaker < 0.95, stronger > 1.05 of the field median. Consistency = share of seasons "
                      "on the same side of the median. Edge pixels overlap neighbouring land and are not classified. "
                      "Uncalibrated: satellite greenness, not measured yield."}


def field_zones(geom: dict, seasons: int | None = None, today: date | None = None, workers: int = 12) -> dict:
    today = today or date.today()
    lat, _ = centroid(geom)
    start, end = season_range(lat, seasons, today)
    bkey = boundary_key(geom)
    prefix = f"px:{bkey}:"
    t0 = time.time()
    if _snapshot_first() and _snapshot_path(bkey).exists():
        saved = json.loads(_snapshot_path(bkey).read_text())
        z = saved.get("zones")
        # Saved zones are computed when the snapshot is made (no raster library needed here), but only for the seasons
        # they were made with; another request is computed from the saved pixels below.
        if z and z.get("seasons_requested", "all") == (seasons or "all"):
            return {**z, "delivery": "snapshot", "seconds": round(time.time() - t0, 1)}
        px = [o for o in saved.get("pixels", [])
              if start <= o["date"] <= end and in_growing_months(date.fromisoformat(o["date"]), lat)]
        if px:
            try:
                return {**compute_zones(px, geom, lat), "seasons_requested": seasons or "all", "delivery": "snapshot",
                        "seconds": round(time.time() - t0, 1)}
            except ImportError:  # hosted version without a raster library: say which seasons the saved zones cover
                if z:
                    return {**z, "delivery": "snapshot", "seconds": round(time.time() - t0, 1),
                            "note": "Only the saved zones are available on the hosted version; see seasons_used for the seasons they cover."}
                _require_rasterio()
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            items = search(geom, start, end, client)
            tokens = {c: _token(c, client) for c in COLLECTIONS}
    except (httpx.HTTPError, HLSUnavailable) as exc:
        with connect() as con:
            cached = [json.loads(p) for (p,) in con.execute("SELECT payload FROM hls_cache WHERE key LIKE ?", (prefix + "%",))]
        delivery = "offline-cache"
        if not cached and _snapshot_path(bkey).exists():
            cached, delivery = json.loads(_snapshot_path(bkey).read_text()).get("pixels", []), "snapshot"
        if not cached:
            raise HLSUnavailable(f"Could not reach the HLS catalogue and no saved copy exists for this outline: {exc}") from exc
        cached = [o for o in cached if start <= o["date"] <= end and in_growing_months(date.fromisoformat(o["date"]), lat)]
        return {**compute_zones(cached, geom, lat), "seasons_requested": seasons or "all", "delivery": delivery, "seconds": round(time.time() - t0, 1)}
    items = [it for it in items if in_growing_months(date.fromisoformat(it["properties"]["datetime"][:10]), lat)]
    keys = {it["id"]: prefix + it["id"] for it in items}
    cached = _cache_get(list(keys.values()))
    todo = [it for it in items if keys[it["id"]] not in cached]
    if todo:
        _require_rasterio()

    def work(it):
        try:
            return it, read_item_pixels(it, geom, tokens[it["collection"]])
        except Exception:
            return it, None

    fresh = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for it, o in pool.map(work, todo):
            if o is not None:
                fresh.append((keys[it["id"]], o))
    _cache_put(fresh)
    px = list(cached.values()) + [o for _, o in fresh]
    return {**compute_zones(px, geom, lat), "seasons_requested": seasons or "all", "delivery": "live", "images": len(px), "seconds": round(time.time() - t0, 1)}


# ---------------------------------------------------------------- cache
def _cache_get(keys: list[str]) -> dict[str, dict]:
    if not keys:
        return {}
    out = {}
    with connect() as con:
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            rows = con.execute(f"SELECT key, payload FROM hls_cache WHERE key IN ({','.join('?' * len(chunk))})", chunk)
            out.update({k: json.loads(p) for k, p in rows})
    return out


def _cache_for_boundary(bkey: str) -> list[dict]:
    with connect() as con:
        return [json.loads(p) for (p,) in con.execute("SELECT payload FROM hls_cache WHERE key LIKE ?", (bkey + ":%",))]


def _snapshot_path(bkey: str) -> Path:
    return SNAPSHOT_DIR / f"hls_{bkey}.json"


def save_snapshot(geom: dict, zones: dict | None = None) -> Path | None:
    """Copy every cached image reading for this outline into data/snapshots (for offline demos)."""
    bkey = boundary_key(geom)
    obs = _cache_for_boundary(bkey)
    if not obs:
        return None
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = _snapshot_path(bkey)
    with connect() as con:
        pixels = [json.loads(p) for (p,) in con.execute("SELECT payload FROM hls_cache WHERE key LIKE ?", (f"px:{bkey}:%",))]
    path.write_text(json.dumps({"saved_at": time.time(), "boundary": geom, "observations": obs, "pixels": pixels,
                                "zones": {k: v for k, v in (zones or {}).items() if k not in ("delivery", "seconds")} or None}))
    return path


def _cache_put(rows: list[tuple[str, dict]]) -> None:
    with connect() as con:
        con.executemany("INSERT OR REPLACE INTO hls_cache(key, fetched_at, payload) VALUES (?, ?, ?)",
                        [(k, time.time(), json.dumps(v)) for k, v in rows])


# ---------------------------------------------------------------- crop-type hints
# Transparent rules on the shape of the greenness curve, for temperate seasons only.
# Dates are expressed in "northern" months: southern-hemisphere dates are shifted by six months.
EARLY = ((4, 15), (5, 25))   # late April – late May: is the field already green?
LATE = ((9, 10), (10, 31))   # September – October: is it still green after summer?
SUMMER = ((7, 20), (9, 9))   # late July – early September: when cereals are harvested and grass keeps growing
GREEN, BARE = 0.5, 0.4


def _md(d: date, lat: float) -> tuple[int, int]:
    if lat < 0:
        m = (d.month + 5) % 12 + 1  # shift six months so October behaves like April
        return m, d.day
    return d.month, d.day


def crop_hint(obs: list[dict], lat: float) -> dict:
    """Classify a season's curve into a broad crop type, with the evidence used."""
    if abs(lat) < 23.5:
        return {"type": "unavailable", "evidence": "Crop-type hints are calibrated for temperate seasons only."}
    good = [o for o in obs if o["ndvi"] is not None]
    def window(w):
        return [o["ndvi"] for o in good if w[0] <= _md(date.fromisoformat(o["date"]), lat) <= w[1]]
    early, late = window(EARLY), window(LATE)
    if len(good) < 6 or len(early) < 2:
        return {"type": "unknown", "evidence": f"Too few clear images ({len(good)} in the season, {len(early)} in late April–May)."}
    e = float(np.median(early))
    peak = max(good, key=lambda o: o["ndvi"])
    # Highest autumn value: regrowth after a late cut is still a living perennial crop.
    l = float(np.max(late)) if len(late) >= 2 else None
    pm = _md(date.fromisoformat(peak["date"]), lat)
    ev = f"late April–May NDVI {e:.2f}; peak {peak['ndvi']:.2f} on {peak['date']}" + (f"; highest Sep–Oct NDVI {l:.2f}" if l is not None else "; Sep–Oct too cloudy")
    if peak["ndvi"] < GREEN:
        kind = "bare"
    elif e >= GREEN:
        kind = "unknown" if l is None else ("grass" if l >= 0.45 else "winter_crop")
    elif e < BARE:
        kind = "spring_crop" if pm < (8, 1) else "late_crop"
    else:
        kind = "unclear"
    # Northern leys green up late after snow and are cut, so they can miss the early test. A curve that never drops
    # below green through late summer and is still green in autumn has had no harvest: grass or ley (incl. newly sown).
    # A field that was bare in spring (sown this year) and then stayed green into autumn is a new ley: often grass
    # sown under a spring cereal, which is harvested while the grass keeps growing (common in Trøndelag). Checked on a
    # real Stjørdal field: reported barley in 2020, grass from 2021; the satellite curve was bare in May 2020 and
    # green from July into October.
    if kind in ("unclear", "late_crop", "spring_crop"):
        summer = window(SUMMER)
        if len(late) >= 2 and len(summer) >= 2 and float(np.median(late)) >= GREEN and min(summer) >= GREEN:
            ev += f"; stayed green all summer (lowest {min(summer):.2f}) and into autumn (median {float(np.median(late)):.2f})"
            kind = "new_ley" if e < BARE else "grass"
    return {"type": kind, "evidence": ev}


# ---------------------------------------------------------------- season-long greenness and long-term trend
MAX_GAP_DAYS = 40      # longest cloud gap allowed inside the core of the season when integrating
MIN_TREND_SEASONS = 6


# Growing window and its core, as northern (month, day), per likely crop. A winter cereal is harvested in July,
# so averaging it over May–September would mostly measure stubble and harvest timing, not the crop.
WINDOWS = {
    "winter_crop": ((4, 1), (7, 15), (4, 10), (6, 20)),
    "spring_crop": ((5, 1), (8, 31), (5, 25), (8, 10)),
    "late_crop": ((5, 15), (10, 15), (6, 10), (9, 20)),
    None: ((4, 1), (10, 31), (5, 15), (9, 15)),  # grass and anything not classified
}


def _season_date(season: int, md: tuple[int, int], lat: float) -> date:
    m, d = md
    if lat >= 0:
        y = season
    else:  # shift six months: northern April is southern October of the previous calendar year
        y, m = (season, m - 6) if m >= 7 else (season - 1, m + 6)
    return date(y, m, min(d, calendar.monthrange(y, m)[1]))


def season_window(season: int, lat: float, crop: str | None = None) -> tuple[date, date, date, date]:
    """(start, end, core start, core end) of the window used for a season's greenness."""
    return tuple(_season_date(season, md, lat) for md in WINDOWS.get(crop, WINDOWS[None]))


def max_gap(season: int, lat: float, crop: str | None = None) -> int:
    _, _, ca, cb = season_window(season, lat, crop)
    return min(MAX_GAP_DAYS, round(0.45 * (cb - ca).days))  # shorter windows tolerate shorter gaps


def season_evi_mean(obs: list[dict], season: int, lat: float, crop: str | None = None) -> float | None:
    """Mean EVI over the crop's growing window from a linearly interpolated curve (an area-under-curve proxy).

    Interpolation avoids bias from when the clear images happened to fall. Seasons with a long cloud gap
    inside the core of the window are skipped rather than guessed.
    """
    if abs(lat) < 23.5:
        return None
    a, b, core_a, core_b = season_window(season, lat, crop)
    pts = sorted((date.fromisoformat(o["date"]), o["evi"]) for o in obs if o.get("evi") is not None and a <= date.fromisoformat(o["date"]) <= b)
    if len(pts) < 8:
        return None
    gap = core_gap_days(obs, season, lat, crop)
    if gap is None or gap > max_gap(season, lat, crop):
        return None
    t = np.array([(d - a).days for d, _ in pts], dtype=float)
    v = np.array([e for _, e in pts], dtype=float)
    grid = np.arange(0, (b - a).days + 1, dtype=float)
    return round(float(np.mean(np.interp(grid, t, v))), 4)  # flat beyond the first/last image


def core_gap_days(obs: list[dict], season: int, lat: float, crop: str | None = None) -> int | None:
    """Longest run without a clear EVI image inside the core of the season (for explaining skipped seasons)."""
    if abs(lat) < 23.5:
        return None
    _, _, core_a, core_b = season_window(season, lat, crop)
    inner = sorted(date.fromisoformat(o["date"]) for o in obs if o.get("evi") is not None and core_a <= date.fromisoformat(o["date"]) <= core_b)
    edges = [core_a] + inner + [core_b]
    return max((y - x).days for x, y in zip(edges, edges[1:]))


def _theil_sen(x: list[float], y: list[float]) -> float:
    slopes = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(len(x)) for j in range(i + 1, len(x)) if x[j] != x[i]]
    return float(np.median(slopes))


def _mann_kendall_p(y: list[float]) -> float:
    n = len(y)
    s_ = sum(np.sign(y[j] - y[i]) for i in range(n) for j in range(i + 1, n))
    var = n * (n - 1) * (2 * n + 5) / 18
    z = (s_ - np.sign(s_)) / math.sqrt(var) if s_ else 0.0
    return 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))


def productivity_trend(season_list: list[dict]) -> dict:
    """Long-term direction of season-long greenness (the idea behind DigiFarm's Sustainability Index)."""
    pts = [(s["season"], s["season_evi_mean"], s.get("crop_hint", {}).get("type")) for s in season_list if s.get("season_evi_mean") is not None]
    skipped = [{"season": s["season"], "gap_days": s.get("core_gap_days")} for s in season_list if s.get("season_evi_mean") is None]
    out = {"seasons": [{"season": a, "evi_mean": b, "crop": c} for a, b, c in pts], "skipped": skipped, "min_seasons": MIN_TREND_SEASONS,
           "max_gap_days": MAX_GAP_DAYS,
           "method": "Season-long mean EVI (interpolated curve over each likely crop's growing window); Theil–Sen slope; Mann–Kendall test. "
                     "A trend is reported only with p < 0.1 and a slope of at least 1% of the mean per year, and only between seasons "
                     "with the same likely crop when the crop changed."}
    if len(pts) < MIN_TREND_SEASONS:
        return {**out, "status": "too_few", "direction": None}
    kinds = [c for _, _, c in pts if c in ("grass", "new_ley", "spring_crop", "winter_crop", "late_crop")]
    # A perennial ley followed by cereals is "less green" without the field getting worse: with mixed crops the
    # overall line is not a fair comparison, so only same-crop seasons are judged.
    if kinds:
        top = max(set(kinds), key=kinds.count)
        same = [(a, b) for a, b, c in pts if c == top]
        if len(same) >= 4:
            out["same_crop"] = {"crop": top, **_fit([a for a, _ in same], [b for _, b in same])}
    mixed = len(set(kinds)) > 1 or len(kinds) < len(pts) - 1  # more than one crop type, or several seasons unclassified
    if mixed:
        return {**out, "status": "mixed_crops", "direction": None, "crops": sorted(set(kinds))}
    out.update(status="ok", **_fit([p[0] for p in pts], [p[1] for p in pts]))
    return out


def _fit(x: list[int], y: list[float]) -> dict:
    slope = _theil_sen(x, y)
    pct = 100 * slope / float(np.mean(y))
    p = _mann_kendall_p(y)
    b0 = float(np.median([b - slope * a for a, b in zip(x, y)]))
    return {"direction": ("rising" if pct > 0 else "falling") if (p < 0.1 and abs(pct) >= 1) else "none",
            "slope_per_year": round(slope, 4), "pct_per_year": round(pct, 1), "p_value": round(p, 3),
            "first": x[0], "last": x[-1], "n": len(x),
            "fit": [[a, round(b0 + slope * a, 4)] for a in (x[0], x[-1])]}  # endpoints: rounding the slope would shift the line


# ---------------------------------------------------------------- this season against the field's usual range
BAND_TOL = 0.05        # NDVI tolerance around the range (sensor and mixed-pixel noise)
BAND_MAX_GAP = 30      # days: no range is drawn across longer cloud gaps


def _growing_window(season: int, lat: float) -> tuple[date, date]:
    return (date(season, 4, 1), date(season, 10, 31)) if lat >= 0 else (date(season - 1, 10, 1), date(season, 4, 30))


def _daily_curve(obs: list[dict], season: int, lat: float) -> np.ndarray | None:
    """NDVI per day of the growing window, interpolated between clear images; NaN outside them or across long gaps."""
    a, b = _growing_window(season, lat)
    pts = sorted(((date.fromisoformat(o["date"]) - a).days, o["ndvi"]) for o in obs
                 if o["ndvi"] is not None and a <= date.fromisoformat(o["date"]) <= b)
    if len(pts) < 8:
        return None
    t = np.array([p[0] for p in pts], float)
    v = np.array([p[1] for p in pts], float)
    grid = np.arange((b - a).days + 1, dtype=float)
    out = np.interp(grid, t, v)
    out[(grid < t[0]) | (grid > t[-1])] = np.nan
    gaps = np.diff(t)
    for i in np.where(gaps > BAND_MAX_GAP)[0]:
        out[(grid > t[i]) & (grid < t[i + 1])] = np.nan
    return out


def usual_range(by_season: dict[int, list[dict]], season_list: list[dict], lat: float) -> dict | None:
    """The field's usual greenness for this season's likely crop (min–max of earlier same-crop seasons, day by day),
    and where this season's clear images fall against it."""
    if abs(lat) < 23.5 or len(season_list) < 2:
        return None
    cur = season_list[-1]
    crop = (cur.get("crop_hint") or {}).get("type")
    known = crop in ("grass", "new_ley", "spring_crop", "winter_crop", "late_crop")
    pool = [s for s in season_list[:-1] if known and (s.get("crop_hint") or {}).get("type") == crop]
    basis = "same_crop"
    if not known:  # crop not clear yet (early in the season): compare with every earlier season
        pool, basis = season_list[:-1], "all"
    curves = [(s["label"], c) for s in pool if (c := _daily_curve(by_season[s["season"]], s["season"], lat)) is not None]
    out = {"season": cur["label"], "crop": crop if known else None, "basis": basis, "seasons": [l for l, _ in curves]}
    if len(curves) < 2:
        return {**out, "status": "too_few"}
    stack = np.vstack([c for _, c in curves])
    n_ok = (~np.isnan(stack)).sum(0)
    lo = np.where(n_ok >= 2, np.nanmin(stack, 0), np.nan)
    hi = np.where(n_ok >= 2, np.nanmax(stack, 0), np.nan)
    a, _ = _growing_window(cur["season"], lat)
    # Judge only inside the crop's own window (as the season check does): after a July harvest every winter-crop year
    # looks alike, and those weeks would dilute a weak season.
    wa, wb = season_window(cur["season"], lat, crop if known else None)[:2]
    counts = {"below": 0, "within": 0, "above": 0}
    last = None
    for o in sorted(by_season[cur["season"]], key=lambda o: o["date"]):
        d = (date.fromisoformat(o["date"]) - a).days
        if o["ndvi"] is None or not 0 <= d < len(lo) or np.isnan(lo[d]) or not wa <= date.fromisoformat(o["date"]) <= wb:
            continue
        state = "below" if o["ndvi"] < lo[d] - BAND_TOL else "above" if o["ndvi"] > hi[d] + BAND_TOL else "within"
        counts[state] += 1
        last = {"date": o["date"], "ndvi": o["ndvi"], "state": state}
    n = sum(counts.values())
    if not n:
        return {**out, "status": "no_images"}
    status = "within" if counts["within"] >= 0.6 * n else ("below" if counts["below"] > counts["above"] else "above")
    band = [[d, round(float(lo[d]), 3), round(float(hi[d]), 3)] for d in range(0, len(lo), 3) if not np.isnan(lo[d])]
    return {**out, "status": status, "counts": counts, "last": last, "band": band, "tolerance": BAND_TOL,
            "judged_window": [wa.isoformat(), wb.isoformat()],
            "method": ("Usual range = lowest to highest NDVI, day by day, of the field's earlier seasons with the same likely crop "
                       f"(curves interpolated between clear images; no range across cloud gaps over {BAND_MAX_GAP} days). This "
                       f"season's clear images inside the crop's growing window are compared with it, allowing ±{BAND_TOL} for sensor "
                       "noise; 'within' when at least 60% of them fall inside.")}


# ---------------------------------------------------------------- summary
def summarise_season(obs: list[dict]) -> dict:
    good = sorted((o for o in obs if o["ndvi"] is not None), key=lambda o: o["date"])
    out = {"images": len(obs), "clear_images": len(good)}
    if len(good) < 3:
        return {**out, "peak_ndvi": None, "peak_date": None, "greenup_date": None, "greenup_cloud_gap": False,
                "mean_ndvi": None, "peak_ndmi": None}
    peak = max(good, key=lambda o: o["ndvi"])
    before = [o for o in good if o["date"] <= peak["date"]]
    low = min(o["ndvi"] for o in before)
    half = low + 0.5 * (peak["ndvi"] - low)
    greenup, gap = None, False
    if peak["ndvi"] - low >= 0.15:
        i = next(i for i, o in enumerate(before) if o["ndvi"] >= half)
        if i > 0 and (date.fromisoformat(before[i]["date"]) - date.fromisoformat(before[i - 1]["date"])).days > 21:
            gap = True  # clouds hid the green-up: no clear image in the three weeks before it was first seen
        else:
            greenup = before[i]["date"]
    return {**out, "peak_ndvi": peak["ndvi"], "peak_date": peak["date"], "greenup_date": greenup, "greenup_cloud_gap": gap,
            "mean_ndvi": round(float(np.mean([o["ndvi"] for o in good])), 3),
            "peak_ndmi": max(o["ndmi"] for o in good if o["ndmi"] is not None)}


def _require_rasterio() -> None:
    try:
        import rasterio  # noqa: F401
    except ImportError as exc:  # the hosted version ships without it (Vercel lacks the GDAL system libraries)
        raise HLSUnavailable("Live satellite reading is not available on the hosted version: use the demo fields, or run "
                             "Rotation Lab on a laptop to read a new field.") from exc


def _snapshot_first() -> bool:
    """On serverless hosts a live read of hundreds of images outlasts the function time limit: use saved copies first."""
    from .db import SERVERLESS
    return SERVERLESS or bool(os.environ.get("ROTATION_LAB_SNAPSHOT_FIRST"))


def field_record(geom: dict, seasons: int | None = None, today: date | None = None, workers: int = 12) -> dict:
    today = today or date.today()
    lat, lon = centroid(geom)
    start, end = season_range(lat, seasons, today)
    t0 = time.time()
    bkey = boundary_key(geom)
    if _snapshot_first() and _snapshot_path(bkey).exists():
        snap = [o for o in json.loads(_snapshot_path(bkey).read_text())["observations"]
                if start <= o["date"] <= end and in_growing_months(date.fromisoformat(o["date"]), lat)]
        return _assemble(geom, bkey, lat, lon, start, end, snap, "snapshot",
                         {"images_found": len(snap), "images_read_now": 0, "images_from_cache": len(snap), "images_failed": 0}, t0)
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            items = search(geom, start, end, client)
            tokens = {c: _token(c, client) for c in COLLECTIONS}
    except (httpx.HTTPError, HLSUnavailable) as exc:
        # Offline: fall back to readings cached locally, then to a saved snapshot of this outline.
        offline = _cache_for_boundary(bkey)
        delivery = "offline-cache"
        if not offline and _snapshot_path(bkey).exists():
            offline, delivery = json.loads(_snapshot_path(bkey).read_text())["observations"], "snapshot"
        if not offline:
            raise HLSUnavailable(f"Could not reach the HLS catalogue and no saved copy exists for this outline: {exc}") from exc
        offline = [o for o in offline if start <= o["date"] <= end and in_growing_months(date.fromisoformat(o["date"]), lat)]
        return _assemble(geom, bkey, lat, lon, start, end, offline, delivery,
                         {"images_found": len(offline), "images_read_now": 0, "images_from_cache": len(offline),
                          "images_failed": 0}, t0)
    items = [it for it in items if in_growing_months(date.fromisoformat(it["properties"]["datetime"][:10]), lat)]
    keys = {it["id"]: f"{bkey}:{it['id']}" for it in items}
    cached = {k: v for k, v in _cache_get(list(keys.values())).items() if "evi" in v or v["ndvi"] is None}
    todo = [it for it in items if keys[it["id"]] not in cached]  # readings cached before EVI was added are re-read once
    if todo:
        _require_rasterio()
    fresh, failed = [], 0

    def work(it):
        try:
            return it, read_item(it, geom, tokens[it["collection"]])
        except Exception:  # one unreadable image must not sink the record
            return it, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for it, obs in pool.map(work, todo):
            if obs is None:
                failed += 1
            else:
                fresh.append((keys[it["id"]], obs))
    _cache_put(fresh)
    all_obs = list(cached.values()) + [o for _, o in fresh]
    return _assemble(geom, bkey, lat, lon, start, end, all_obs, "live",
                     {"images_found": len(items), "images_read_now": len(fresh), "images_from_cache": len(cached),
                      "images_failed": failed}, t0)


def _assemble(geom, bkey, lat, lon, start, end, all_obs, delivery, counts, t0) -> dict:
    def hint_type(o):
        return crop_hint(o, lat)["type"]

    # Same date + sensor from neighbouring tiles: keep the reading with the most clear pixels.
    best: dict[tuple, dict] = {}
    for o in all_obs:
        k = (o["date"], o["sensor"])
        if k not in best or (o["clear_pct"] * o["pixels"]) > (best[k]["clear_pct"] * best[k]["pixels"]):
            best[k] = o
    obs = sorted(best.values(), key=lambda o: o["date"])
    for o in obs:  # readings cached before the positive-reflectance check: drop impossible index values
        for k in ("ndvi", "ndmi"):
            if o.get(k) is not None and not -1 <= o[k] <= 1:
                o[k] = None

    by_season: dict[int, dict] = {}
    for o in obs:
        y, label = season_of(date.fromisoformat(o["date"]), lat)
        by_season.setdefault(y, {"season": y, "label": label, "obs": []})["obs"].append(o)
    season_list = [{"season": s["season"], "label": s["label"], **summarise_season(s["obs"]), "crop_hint": crop_hint(s["obs"], lat),
                    "season_evi_mean": season_evi_mean(s["obs"], s["season"], lat, hint_type(s["obs"])), "core_gap_days": core_gap_days(s["obs"], s["season"], lat, hint_type(s["obs"])), "window": [d.isoformat() for d in season_window(s["season"], lat, hint_type(s["obs"]))[:2]], "max_gap_days": max_gap(s["season"], lat, hint_type(s["obs"])), "peak_evi": max((o["evi"] for o in s["obs"] if o.get("evi") is not None), default=None)}
                   for s in sorted(by_season.values(), key=lambda s: s["season"])]
    return {
        "boundary_key": bkey, "area_ha": round(area_ha(geom), 2), "centroid": {"lat": round(lat, 5), "lon": round(lon, 5)},
        "period": {"start": start, "end": end}, "seasons": season_list,
        "observations": [{**{k: o[k] for k in ("date", "sensor", "ndvi", "ndmi", "clear_pct", "scene_cloud")}, "evi": o.get("evi")} for o in obs],
        "trend": productivity_trend(season_list),
        "usual_range": usual_range({s["season"]: s["obs"] for s in by_season.values()}, season_list, lat),
        "archive": {"start": ARCHIVE_START.isoformat(), "note": "Openly hosted HLS v2.0 starts in 2020; NASA LP DAAC (Earthdata login) goes back to 2013."},
        "delivery": delivery,
        "stats": {**counts, "clear_images": sum(1 for o in obs if o["ndvi"] is not None), "seconds": round(time.time() - t0, 1)},
        "method": {"cloud_mask": "HLS Fmask: cloud, adjacent cloud, shadow, snow/ice, water removed",
                   "min_clear_share": MIN_CLEAR, "statistic": "median over clear pixels in the field",
                   "ndvi": "(NIR − Red) / (NIR + Red)", "ndmi": "(NIR − SWIR1) / (NIR + SWIR1)",
                   "bands": {v["sensor"]: {k: v[k] for k in ("red", "nir", "swir")} for v in COLLECTIONS.values()},
                   "growing_months": "Apr–Oct (north), Oct–Apr (south), all year (tropics)",
                   "crop_hint": "Rules on the curve: green in late Apr–May and again in Sep–Oct (highest value) = grass/ley; green in spring, bare in autumn = "
                                "winter-sown; bare in spring, peak before Aug = spring-sown; peak Aug or later = late crop; "
                                "peak NDVI < 0.5 = bare/fallow/failed; an unclear or late curve that never drops below 0.5 from late July to "
                     "early September and is still ≥ 0.5 in Sep–Oct = grass/ley (no harvest), or a new ley if the field was bare in spring "
                     "(often grass sown under a spring cereal). Temperate only; southern dates shifted six months."},
        "attribution": ATTRIBUTION,
    }
