"""What's grown around you: the likely crop of every 30 m farmland pixel within ~2 km of the field, each season since 2020.

Satellite only (NASA HLS), using the same curve-shape rules as the field's own crop hints, so it gives broad crop
types (grass/ley, autumn-sown, spring-sown, late crop), never named crops. Farmland is taken from ESA WorldCover 2021
(cropland or grassland; leys are often mapped as grassland). The field itself is left out.
"""
from __future__ import annotations

import hashlib
import json
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform as warp_transform, transform_geom
from rasterio.windows import from_bounds

from . import hls
from .db import connect

HALF_M = 2000                  # half-width of the square around the field
FARMLAND = (40, 30)            # WorldCover: cropland, grassland
MIN_SEEN = 0.3                 # share of farmland pixels that must be classified for a season to count
NOTABLE_PP = 5                 # total change (percentage points) worth mentioning
MIN_TREND = 5                  # usable seasons needed before talking about a shift
CLASSES = ["unknown", "bare", "grass", "winter_crop", "spring_crop", "late_crop", "unclear"]
WORLDCOVER = "esa-worldcover"
SNAP_DIR = Path(__file__).resolve().parents[2] / "data" / "snapshots"


def area_bbox(lat: float, lon: float, half_m: float = HALF_M) -> list[float]:
    d = half_m / 111_320
    dl = d / max(0.2, np.cos(np.radians(lat)))
    return [lon - dl, lat - d, lon + dl, lat + d]


def _poly(b):
    return {"type": "Polygon", "coordinates": [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]}


# ---------------------------------------------------------------- vectorised crop hints (same rules as hls.crop_hint)
def classify(ndvi: np.ndarray, dates: list[date], lat: float) -> np.ndarray:
    """ndvi: (images × pixels) with NaN where cloudy. Returns one class index per pixel (see CLASSES)."""
    md = [hls._md(d, lat) for d in dates]
    early = np.array([hls.EARLY[0] <= m <= hls.EARLY[1] for m in md])
    late = np.array([hls.LATE[0] <= m <= hls.LATE[1] for m in md])
    before_aug = np.array([m < (8, 1) for m in md])
    summer = np.array([hls.SUMMER[0] <= m <= hls.SUMMER[1] for m in md])
    ok = ~np.isnan(ndvi)
    n_good, n_early, n_late = ok.sum(0), ok[early].sum(0), ok[late].sum(0)
    e = np.nanmedian(ndvi[early], 0) if early.any() else np.full(ndvi.shape[1], np.nan)
    lmax = np.nanmax(ndvi[late], 0) if late.any() else np.full(ndvi.shape[1], np.nan)
    lmax = np.where(n_late >= 2, lmax, np.nan)
    filled = np.where(ok, ndvi, -np.inf)
    peak_i = filled.argmax(0)                       # first maximum, like max() in crop_hint
    peak = filled[peak_i, np.arange(ndvi.shape[1])]
    out = np.full(ndvi.shape[1], 6, dtype=np.int8)  # unclear
    out[e < hls.BARE] = np.where(before_aug[peak_i], 4, 5)[e < hls.BARE]
    green = e >= hls.GREEN
    out[green] = np.where(np.isnan(lmax), 0, np.where(lmax >= 0.45, 2, 3))[green]
    # grass/ley that missed the early test: never below green in late summer, still green in autumn (see hls.crop_hint)
    n_sum = ok[summer].sum(0)
    lmed = np.nanmedian(ndvi[late], 0) if late.any() else np.full(ndvi.shape[1], np.nan)
    smin = np.nanmin(ndvi[summer], 0) if summer.any() else np.full(ndvi.shape[1], np.nan)
    stays = (n_late >= 2) & (n_sum >= 2) & (lmed >= hls.GREEN) & (smin >= hls.GREEN)
    out[((out == 5) | (out == 6)) & stays] = 2
    out[peak < hls.GREEN] = 1
    out[(n_good < 6) | (n_early < 2)] = 0
    return out


# ---------------------------------------------------------------- reading
def _read_area(item: dict, bbox: list[float], token: str) -> dict | None:
    spec = hls.COLLECTIONS[item["collection"]]
    href = lambda band: f"{item['assets'][band]['href']}?{token}"  # noqa: E731
    with rasterio.Env(**hls.GDAL_ENV):
        with rasterio.open(href("Fmask")) as src:
            sh = transform_geom("EPSG:4326", src.crs, _poly(bbox))
            xs, ys = [p[0] for p in sh["coordinates"][0]], [p[1] for p in sh["coordinates"][0]]
            win = from_bounds(min(xs), min(ys), max(xs), max(ys), src.transform).round_offsets().round_lengths()
            fmask = src.read(1, window=win, boundless=True, fill_value=255)
            meta = {"crs": str(src.crs), "transform": list(src.window_transform(win))[:6]}
        clear = hls._clear(fmask)
        if clear.mean() < 0.05:
            return {**meta, "ndvi": None}
        bands = {}
        for key in ("red", "nir"):
            with rasterio.open(href(spec[key])) as src:
                bands[key] = src.read(1, window=win, boundless=True, fill_value=hls.FILL).astype("float32")
    valid = clear & (bands["red"] != hls.FILL) & (bands["nir"] != hls.FILL)
    r, n = bands["red"] * hls.SCALE, bands["nir"] * hls.SCALE
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (n - r) / (n + r)
    return {**meta, "ndvi": np.where(valid & (ndvi > -1) & (ndvi <= 1), ndvi, np.nan).astype("float32")}


def _farmland(bbox, crs, tf, shape, client) -> tuple[np.ndarray, int]:
    """True for 30 m pixels where most of the 10 m WorldCover 2021 cells inside are cropland or grassland."""
    r = client.post(hls.STAC_SEARCH, json={"collections": [WORLDCOVER], "intersects": _poly(bbox), "limit": 10})
    items = sorted((f for f in r.json().get("features", []) if "2021" in f["id"]), key=lambda f: f["id"])
    if not items:
        raise hls.HLSUnavailable("ESA WorldCover is not available here.")
    tok = client.get(hls.SAS_TOKEN.format(collection=WORLDCOVER)).json()["token"]
    rows, cols = shape
    a, _, c, _, e, f = tf
    offs = (-10.0, 0.0, 10.0)
    xs = np.array([c + (j + 0.5) * a + dx for i in range(rows) for j in range(cols) for dx in offs for _ in offs])
    ys = np.array([f + (i + 0.5) * e + dy for i in range(rows) for j in range(cols) for _ in offs for dy in offs])
    lon, lat = warp_transform(crs, "EPSG:4326", xs, ys)
    lon, lat = np.asarray(lon), np.asarray(lat)
    votes = np.zeros(len(xs), dtype=bool)
    seen = np.zeros(len(xs), dtype=bool)
    with rasterio.Env(**hls.GDAL_ENV):
        for it in items:  # a 4 km square can straddle two 3° WorldCover tiles
            with rasterio.open(it["assets"]["map"]["href"] + "?" + tok) as src:
                win = from_bounds(*bbox, src.transform).round_offsets().round_lengths()
                wc = src.read(1, window=win, boundless=True, fill_value=0)
                wt = src.window_transform(win)
            ci = ((lon - wt.c) / wt.a).astype(int)
            ri = ((lat - wt.f) / wt.e).astype(int)
            inside = (ri >= 0) & (ri < wc.shape[0]) & (ci >= 0) & (ci < wc.shape[1])
            v = np.zeros(len(xs), dtype=np.uint8)
            v[inside] = wc[ri[inside], ci[inside]]
            seen |= inside & (v > 0)
            votes |= np.isin(v, FARMLAND)
    share = votes.reshape(rows * cols, 9).mean(1)
    return (share >= 5 / 9).reshape(rows, cols), int(seen.sum() // 9)


# ---------------------------------------------------------------- summary
def _summarise(cls_by_season, farm, labels):
    rows = []
    n_farm = int(farm.sum())
    for season, cls in cls_by_season:
        c = cls[farm]
        known = c[c > 0]
        counts = Counter(known.tolist())
        seen = len(known) / n_farm if n_farm else 0
        row = {"season": season, "label": labels[season], "farmland_px": n_farm, "classified_share": round(seen, 3),
               "usable": seen >= MIN_SEEN}
        row["shares"] = {CLASSES[k]: round(counts.get(k, 0) / len(known), 3) for k in range(1, 7)} if len(known) else {}
        rows.append(row)
    use = [r for r in rows if r["usable"]]
    change = None
    if len(use) >= MIN_TREND:
        x = [r["season"] for r in use]
        change = {"seasons": f"{use[0]['label']}–{use[-1]['label']}", "n": len(use), "classes": {}}
        for k in CLASSES[1:]:
            y = [100 * r["shares"].get(k, 0) for r in use]
            slope, p = hls._theil_sen(x, y), hls._mann_kendall_p(y)
            total = slope * (x[-1] - x[0])
            change["classes"][k] = {"first": round(y[0]), "last": round(y[-1]), "pp_per_year": round(slope, 1),
                                    "p_value": round(p, 3), "consistent": p < 0.1 and abs(total) >= NOTABLE_PP}
        change["notable"] = [k for k, v in change["classes"].items() if v["consistent"]]
    return rows, change


def _cells(cls, farm, crs, tf, step=3):
    """Latest usable season as 90 m cells (majority class of the farmland pixels inside), for the map."""
    a, _, c, _, e, f = tf
    rows, cols = cls.shape
    feats = []
    for i in range(0, rows - step + 1, step):
        for j in range(0, cols - step + 1, step):
            block = cls[i:i + step, j:j + step][farm[i:i + step, j:j + step]]
            block = block[block > 0]
            if len(block) < 5:
                continue
            k = Counter(block.tolist()).most_common(1)[0][0]
            x0, y0 = c + j * a, f + i * e
            x1, y1 = x0 + step * a, y0 + step * e
            lon, lat = warp_transform(crs, "EPSG:4326", [x0, x1, x1, x0, x0], [y0, y0, y1, y1, y0])
            feats.append({"type": "Feature", "properties": {"class": CLASSES[k]},
                          "geometry": {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in zip(lon, lat)]]}})
    return {"type": "FeatureCollection", "features": feats}


def _key(geom):
    return "nb:" + hls.boundary_key(geom)


def _snap(geom) -> Path:
    return SNAP_DIR / f"nb_{hashlib.sha1(_key(geom).encode()).hexdigest()[:16]}.json"


def neighbourhood(geom: dict, today: date | None = None, workers: int = 12) -> dict:
    """Shares of broad crop types on farmland within ~2 km of the field, per season since 2020."""
    today = today or date.today()
    lat, lon = hls.centroid(geom)
    if abs(lat) < 23.5:
        return {"status": "unavailable", "reason": "Crop-type hints are calibrated for temperate seasons only."}
    start, end = hls.season_range(lat, None, today)
    key = f"{_key(geom)}:{end[:7]}"
    if hls._snapshot_first() and _snap(geom).exists():
        return {**json.loads(_snap(geom).read_text()), "delivery": "snapshot"}
    with connect() as con:
        row = con.execute("SELECT payload FROM hls_cache WHERE key = ?", (key,)).fetchone()
    if row:
        return {**json.loads(row[0]), "delivery": "cache"}
    bbox = area_bbox(lat, lon)
    t0 = time.time()
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            items = hls.search(_poly(bbox), start, end, client)
            tokens = {c: hls._token(c, client) for c in hls.COLLECTIONS}
            items = [it for it in items if hls.in_growing_months(date.fromisoformat(it["properties"]["datetime"][:10]), lat)]
            if not items:
                raise hls.HLSUnavailable("No HLS images found around this field.")
            tile = Counter(it["id"].split(".")[2] for it in items).most_common(1)[0][0]
            items = [it for it in items if it["id"].split(".")[2] == tile]  # one MGRS grid, so pixels line up

            def work(it):
                try:
                    return it, _read_area(it, bbox, tokens[it["collection"]])
                except Exception:
                    return it, None

            with ThreadPoolExecutor(max_workers=workers) as pool:
                reads = [(it, r) for it, r in pool.map(work, items) if r is not None]
            if not reads:
                raise hls.HLSUnavailable("Could not read the HLS images around this field.")
            crs, tf = reads[0][1]["crs"], reads[0][1]["transform"]
            shape = next(r["ndvi"].shape for _, r in reads if r["ndvi"] is not None)
            farm, _ = _farmland(bbox, crs, tf, shape, client)
    except (httpx.HTTPError, hls.HLSUnavailable) as exc:
        snap = _snap(geom)
        if snap.exists():
            return {**json.loads(snap.read_text()), "delivery": "snapshot"}
        raise hls.HLSUnavailable(f"Could not read the area around the field and no saved copy exists: {exc}") from exc

    field_px = geometry_mask([transform_geom("EPSG:4326", crs, geom)], out_shape=shape,
                             transform=rasterio.Affine(*tf), invert=True)
    farm &= ~field_px
    by_season: dict[int, list] = {}
    labels = {}
    for it, r in reads:
        if r["ndvi"] is None or r["ndvi"].shape != shape:
            continue
        d = date.fromisoformat(it["properties"]["datetime"][:10])
        y, label = hls.season_of(d, lat)
        labels[y] = label
        by_season.setdefault(y, []).append((d, r["ndvi"].ravel()))
    cls_by_season = []
    for y in sorted(by_season):
        obs = sorted(by_season[y], key=lambda t: t[0])
        cls = classify(np.vstack([v for _, v in obs]), [d for d, _ in obs], lat).reshape(shape)
        cls_by_season.append((y, cls))
    seasons, change = _summarise(cls_by_season, farm, labels)
    latest = next((cls for (y, cls), s in zip(reversed(cls_by_season), reversed(seasons)) if s["usable"]), None)
    out = {
        "status": "ok", "bbox": [round(v, 5) for v in bbox], "half_m": HALF_M, "tile": tile,
        "farmland_ha": round(float(farm.sum()) * 0.09, 1), "seasons": seasons, "change": change,
        "map": {"season": next((s["label"] for s in reversed(seasons) if s["usable"]), None),
                "cells": _cells(latest, farm, crs, tf) if latest is not None else None},
        "images": len(reads), "seconds": round(time.time() - t0, 1),
        "method": (f"Every NASA HLS image of one MGRS tile ({tile}) over a {2 * HALF_M / 1000:.0f} km square around the field, "
                   "cloud-masked with Fmask; each 30 m pixel's NDVI curve classified per season with the same rules as the field's "
                   "crop hints (grass/ley, autumn-sown, spring-sown, late crop, bare). Farmland = ESA WorldCover 2021 cropland or "
                   f"grassland (majority of 10 m cells); the field itself is excluded. A season counts when at least {int(MIN_SEEN * 100)}% "
                   f"of farmland pixels could be classified. A shift is mentioned only when a share trends the same way across the seasons "
                   f"(Theil–Sen, Mann–Kendall p < 0.1) and adds up to {NOTABLE_PP} percentage points or more. "
                   "Broad crop types only, not named crops; not checked against farm records."),
        "attribution": "NASA HLS v2.0 (LP DAAC) and ESA WorldCover 2021 (CC BY 4.0), via Microsoft Planetary Computer.",
    }
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO hls_cache(key, fetched_at, payload) VALUES (?,?,?)", (key, time.time(), json.dumps(out)))
    return {**out, "delivery": "live"}


def save_snapshot(geom: dict) -> Path | None:
    lat, _ = hls.centroid(geom)
    with connect() as con:
        row = con.execute("SELECT payload FROM hls_cache WHERE key LIKE ? ORDER BY fetched_at DESC", (_key(geom) + ":%",)).fetchone()
    if not row:
        return None
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    _snap(geom).write_text(row[0])
    return _snap(geom)
