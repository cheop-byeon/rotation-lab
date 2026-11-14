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
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import httpx
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from rasterio.windows import from_bounds

from .db import connect

STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/{collection}"
COLLECTIONS = {
    "hls2-s30": {"sensor": "Sentinel-2", "red": "B04", "nir": "B8A", "swir": "B11"},
    "hls2-l30": {"sensor": "Landsat", "red": "B04", "nir": "B05", "swir": "B06"},
}
ATTRIBUTION = "NASA HLS v2.0 (LP DAAC), accessed via Microsoft Planetary Computer"
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


def season_range(lat: float, seasons: int, today: date) -> tuple[str, str]:
    current, _ = season_of(today, lat)
    first = current - seasons + 1
    start = date(first, 1, 1) if lat >= 0 else date(first - 1, 7, 1)
    return start.isoformat(), today.isoformat()


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
    spec = COLLECTIONS[item["collection"]]
    href = lambda band: f"{item['assets'][band]['href']}?{token}"  # noqa: E731
    obs = {"id": item["id"], "date": item["properties"]["datetime"][:10], "sensor": spec["sensor"],
           "scene_cloud": item["properties"].get("eo:cloud_cover"), "ndvi": None, "ndmi": None,
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
        for key in ("red", "nir", "swir"):
            with rasterio.open(href(spec[key])) as src:
                bands[key] = src.read(1, window=win, boundless=True, fill_value=FILL).astype("float32")
    valid = clear & (bands["red"] != FILL) & (bands["nir"] != FILL) & (bands["swir"] != FILL)
    if valid.sum() < 3:
        return obs
    red, nir, swir = (bands[k][valid] * SCALE for k in ("red", "nir", "swir"))
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (nir - red) / (nir + red)
        ndmi = (nir - swir) / (nir + swir)
    obs["ndvi"] = round(float(np.nanmedian(ndvi)), 3)
    obs["ndmi"] = round(float(np.nanmedian(ndmi)), 3)
    return obs


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


def _cache_put(rows: list[tuple[str, dict]]) -> None:
    with connect() as con:
        con.executemany("INSERT OR REPLACE INTO hls_cache(key, fetched_at, payload) VALUES (?, ?, ?)",
                        [(k, time.time(), json.dumps(v)) for k, v in rows])


# ---------------------------------------------------------------- crop-type hints
# Transparent rules on the shape of the greenness curve, for temperate seasons only.
# Dates are expressed in "northern" months: southern-hemisphere dates are shifted by six months.
EARLY = ((4, 15), (5, 25))   # late April – late May: is the field already green?
LATE = ((9, 10), (10, 31))   # September – October: is it still green after summer?
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
    return {"type": kind, "evidence": ev}


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


def field_record(geom: dict, seasons: int = 5, today: date | None = None, workers: int = 12) -> dict:
    today = today or date.today()
    lat, lon = centroid(geom)
    start, end = season_range(lat, seasons, today)
    t0 = time.time()
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        try:
            items = search(geom, start, end, client)
            tokens = {c: _token(c, client) for c in COLLECTIONS}
        except httpx.HTTPError as exc:
            raise HLSUnavailable(f"Could not reach the HLS catalogue: {exc}") from exc
    items = [it for it in items if in_growing_months(date.fromisoformat(it["properties"]["datetime"][:10]), lat)]
    bkey = boundary_key(geom)
    keys = {it["id"]: f"{bkey}:{it['id']}" for it in items}
    cached = _cache_get(list(keys.values()))
    todo = [it for it in items if keys[it["id"]] not in cached]
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

    # Same date + sensor from neighbouring tiles: keep the reading with the most clear pixels.
    best: dict[tuple, dict] = {}
    for o in all_obs:
        k = (o["date"], o["sensor"])
        if k not in best or (o["clear_pct"] * o["pixels"]) > (best[k]["clear_pct"] * best[k]["pixels"]):
            best[k] = o
    obs = sorted(best.values(), key=lambda o: o["date"])

    by_season: dict[int, dict] = {}
    for o in obs:
        y, label = season_of(date.fromisoformat(o["date"]), lat)
        by_season.setdefault(y, {"season": y, "label": label, "obs": []})["obs"].append(o)
    season_list = [{"season": s["season"], "label": s["label"], **summarise_season(s["obs"]), "crop_hint": crop_hint(s["obs"], lat)}
                   for s in sorted(by_season.values(), key=lambda s: s["season"])]
    return {
        "boundary_key": bkey, "area_ha": round(area_ha(geom), 2), "centroid": {"lat": round(lat, 5), "lon": round(lon, 5)},
        "period": {"start": start, "end": end}, "seasons": season_list,
        "observations": [{k: o[k] for k in ("date", "sensor", "ndvi", "ndmi", "clear_pct", "scene_cloud")} for o in obs],
        "stats": {"images_found": len(items), "images_read_now": len(fresh), "images_from_cache": len(cached),
                  "images_failed": failed, "clear_images": sum(1 for o in obs if o["ndvi"] is not None),
                  "seconds": round(time.time() - t0, 1)},
        "method": {"cloud_mask": "HLS Fmask: cloud, adjacent cloud, shadow, snow/ice, water removed",
                   "min_clear_share": MIN_CLEAR, "statistic": "median over clear pixels in the field",
                   "ndvi": "(NIR − Red) / (NIR + Red)", "ndmi": "(NIR − SWIR1) / (NIR + SWIR1)",
                   "bands": {v["sensor"]: {k: v[k] for k in ("red", "nir", "swir")} for v in COLLECTIONS.values()},
                   "growing_months": "Apr–Oct (north), Oct–Apr (south), all year (tropics)",
                   "crop_hint": "Rules on the curve: green in late Apr–May and again in Sep–Oct (highest value) = grass/ley; green in spring, bare in autumn = "
                                "winter-sown; bare in spring, peak before Aug = spring-sown; peak Aug or later = late crop; "
                                "peak NDVI < 0.5 = bare/fallow/failed. Temperate only; southern dates shifted six months."},
        "attribution": ATTRIBUTION,
    }
