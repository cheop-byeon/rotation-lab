"""Public records about a field beyond NASA: soil texture (SoilGrids) and the crops farms reported (Norway).

- Soil texture: ISRIC SoilGrids 2.0, a global 250 m model of clay, sand, silt and organic carbon (CC BY 4.0).
  It is an estimate for the area, not a measurement of the field. Drainage is not in it.
- Reported crops: Landbruksdirektoratet's production-subsidy applications (open data, NLOD), built into
  data/farm_crops.json.gz by scripts/build_farm_crops.py. They are per farm, not per field. The farm is found through
  the property under the field (Kartverket's open property service). In a year when the farm grew one crop on all its
  arable land, that crop was on every one of its fields; otherwise the field's crop is not known from these records.
"""
from __future__ import annotations

import functools
import gzip
import json
import time
from pathlib import Path

import httpx

from . import power

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
FARM_CROPS = DATA_DIR / "farm_crops.json.gz"
SOILGRIDS = "https://rest.isric.org/soilgrids/v2.0/properties/query"
EIENDOM = "https://ws.geonorge.no/eiendom/v1/punkt"
ONE_CROP = 0.95          # share of the farm's arable land in one crop for "one crop on all its land"
NOT_ARABLE = {"Pasture"}  # infield pasture (innmarksbeite) is not ploughed, so it is left out of the arable total


class Unavailable(Exception):
    pass


async def _cached_json(key: str, url: str, params: dict | list, max_age_days: float = 365) -> tuple[dict, str]:
    """GET JSON with the app's cache and saved snapshots, like NASA POWER."""
    hit = power._cache_get(key)
    if hit and time.time() - hit[0] < max_age_days * 86400:
        return hit[1], "cache"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        if hit:
            return hit[1], "stale-cache"
        snap = power._snapshot(key)
        if snap is not None:
            return snap, "snapshot"
        raise Unavailable(str(exc)) from exc
    power._cache_put(key, payload)
    return payload, "live"


def save_snapshot(key: str) -> Path | None:
    hit = power._cache_get(key)
    if not hit:
        return None
    power.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = power.SNAPSHOT_DIR / (key.replace(":", "_") + ".json")
    path.write_text(json.dumps(hit[1], ensure_ascii=False))
    return path


# ---------------------------------------------------------------- soil texture (SoilGrids)
def soil_key(lat: float, lon: float) -> str:
    return f"soilgrids:{lat:.3f}:{lon:.3f}"


def usda_class(sand: float, silt: float, clay: float) -> str:
    """USDA soil texture class from percentages."""
    if clay >= 40:
        return "silty clay" if silt >= 40 else ("sandy clay" if sand > 45 else "clay")
    if clay >= 35 and sand > 45:
        return "sandy clay"
    if clay >= 27:
        return "silty clay loam" if sand <= 20 else ("clay loam" if sand <= 45 else "sandy clay loam")
    if clay >= 20 and silt < 28 and sand > 45:
        return "sandy clay loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if silt >= 50:
        return "silt loam"
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 2 * clay < 30:
        return "loamy sand"
    if clay >= 7 and silt >= 28 and sand <= 52:
        return "loam"
    return "sandy loam"


APP_SOIL = {"sand": "Sandy", "loamy sand": "Sandy", "sandy loam": "Loamy", "loam": "Loamy", "sandy clay loam": "Loamy",
            "silt loam": "Silty", "silt": "Silty", "clay loam": "Clayey", "silty clay loam": "Clayey",
            "sandy clay": "Clayey", "silty clay": "Clayey", "clay": "Clayey"}


async def soil(lat: float, lon: float) -> dict:
    params = [("lon", round(lon, 4)), ("lat", round(lat, 4)), ("value", "mean")]
    params += [("property", p) for p in ("clay", "sand", "silt", "soc")]
    params += [("depth", d) for d in ("0-5cm", "5-15cm", "15-30cm")]
    try:
        payload, delivery = await _cached_json(soil_key(lat, lon), SOILGRIDS, params)
    except Unavailable as exc:
        return {"status": "unavailable", "message": f"SoilGrids could not be reached: {exc}"}
    layers, deepest = {}, {}
    for layer in payload.get("properties", {}).get("layers", []):
        d = layer.get("unit_measure", {}).get("d_factor", 10) or 10
        vals = [x["values"].get("mean") for x in layer.get("depths", [])]
        vals = [v / d for v in vals if v is not None]
        layers[layer["name"]] = sum(vals) / len(vals) if vals else None
        deepest[layer["name"]] = vals[-1] if vals else None
    sand, silt, clay = (layers.get(k) for k in ("sand", "silt", "clay"))
    soc = deepest.get("soc")  # 15–30 cm: topsoil organic carbon is very uncertain in SoilGrids (e.g. 16–506 g/kg in Trøndelag)
    if None in (sand, silt, clay):
        return {"status": "no_data", "message": "SoilGrids has no soil estimate here (water, rock or built-up land)."}
    total = sand + silt + clay  # g/kg → %, normalised to 100
    sand, silt, clay = (100 * v / total for v in (sand, silt, clay))
    usda = usda_class(sand, silt, clay)
    peat = soc is not None and soc >= 200  # still ≥ 20% organic carbon at 15–30 cm: an organic (peat) soil
    return {"status": "ok", "soil": "Peat" if peat else APP_SOIL[usda], "usda_class": "organic (peat)" if peat else usda,
            "sand_pct": round(sand), "silt_pct": round(silt), "clay_pct": round(clay),
            "organic_carbon_15_30cm_g_kg": round(soc) if soc is not None else None, "depth": "0–30 cm", "delivery": delivery,
            "source": "ISRIC SoilGrids 2.0 (250 m model, CC BY 4.0)",
            "note": "A modelled estimate for the area around the field, not a measurement of the field. Drainage is not included."}


# ---------------------------------------------------------------- crops reported by the farm (Norway)
@functools.lru_cache(maxsize=1)
def _farm_index() -> dict:
    return json.loads(gzip.decompress(FARM_CROPS.read_bytes()))


def property_key(lat: float, lon: float) -> str:
    return f"eiendom:{lat:.5f}:{lon:.5f}"


def in_norway(lat: float, lon: float) -> bool:
    return 57.9 <= lat <= 71.3 and 4.4 <= lon <= 31.3


def _years(farm: dict) -> list[dict]:
    out = []
    for year, areas in sorted(farm.items()):
        arable = {k: v for k, v in areas.items() if k not in NOT_ARABLE}
        total = sum(arable.values())
        main = max(arable, key=arable.get) if arable else None
        out.append({"year": int(year), "areas": areas, "arable_daa": total, "main": main,
                    "one_crop": bool(main) and arable[main] >= ONE_CROP * total})
    return out


async def farm_crops(lat: float, lon: float) -> dict:
    idx = _farm_index()
    base = {"source": idx["source"], "url": idx["url"], "years": idx["years"],
            "note": "Reported per farm, not per field. In a year with one crop on all the farm's arable land, that crop was "
                    "on each of its fields. The farm may also rent land elsewhere, and this field may be rented to another farm."}
    if not in_norway(lat, lon):
        return {**base, "status": "outside", "message": "Reported crops are available for fields in Norway only."}
    try:
        payload, delivery = await _cached_json(property_key(lat, lon), EIENDOM,
                                               {"nord": lat, "ost": lon, "koordsys": 4326, "radius": 1, "treffPerSide": 10})
    except Unavailable as exc:
        return {**base, "status": "unavailable", "message": f"Kartverket's property service could not be reached: {exc}"}
    hits = sorted(payload.get("eiendom") or [], key=lambda e: e.get("meterFraPunkt", 0))
    if not hits:
        return {**base, "status": "no_property", "message": "No property was found under this point.", "delivery": delivery}
    e = hits[0]
    key = f'{e["kommunenummer"]}-{e["gardsnummer"]}-{e["bruksnummer"]}'
    farms = idx["properties"].get(key, [])
    prop = {"kommunenummer": e["kommunenummer"], "matrikkel": e.get("matrikkelnummertekst")}
    if not farms:
        return {**base, "status": "no_farm", "property": prop, "delivery": delivery,
                "message": "No farm reported this property as its base in 2017–2024. The land may be farmed from another property."}
    return {**base, "status": "ok", "property": prop, "delivery": delivery, "farms": [{"years": _years(f)} for f in farms]}
