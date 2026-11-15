"""Farming in a Norwegian municipality: what farms reported growing each year (2017–2026), and what is changing.

Built from data/areas/ (scripts/build_areas.py: Landbruksdirektoratet production-subsidy applications and farm register,
open data under NLOD). Totals per municipality, plus farm centres as dots without names.
"""
from __future__ import annotations

import functools
import json
from pathlib import Path

from . import hls

AREAS_DIR = Path(__file__).resolve().parents[2] / "data" / "areas"
MIN_CHANGE_PP = 3   # total change in share (percentage points) worth naming
P_CONSISTENT = 0.05


@functools.lru_cache(maxsize=1)
def index() -> dict:
    return json.loads((AREAS_DIR / "index.json").read_text())


@functools.lru_cache(maxsize=64)
def _raw(code: str) -> dict | None:
    path = AREAS_DIR / f"{code}.json"
    return json.loads(path.read_text()) if code.isdigit() and path.exists() else None


def _trend(years: list[int], shares: list[float]) -> dict:
    slope = hls._theil_sen(years, shares)
    p = hls._mann_kendall_p(shares)
    total = slope * (years[-1] - years[0])
    return {"pp_per_year": round(slope, 2), "change_pp": round(total, 1), "p_value": round(p, 3),
            "consistent": p < P_CONSISTENT and abs(total) >= MIN_CHANGE_PP}


def area(code: str) -> dict | None:
    d = _raw(code)
    if d is None:
        return None
    meta = index()
    rows = [y for y in d["years"] if y["farms"]]
    arable = [sum(v for k, v in y["areas"].items() if k != "Pasture") for y in rows]
    groups = [g for g in meta["groups"] if g != "Pasture"]
    crops = []
    for g in groups:
        series = [y["areas"].get(g, 0) for y in rows]
        if not any(series):
            continue
        shares = [100 * a / t if t else 0 for a, t in zip(series, arable)]
        crops.append({"group": g, "daa": series, "share_pct": [round(s, 1) for s in shares],
                      **(_trend([y["year"] for y in rows], shares) if len(rows) >= 6 else {"consistent": False})})
    crops.sort(key=lambda c: -c["daa"][-1])
    first, last = rows[0], rows[-1]
    return {
        "code": d["code"], "name": d["name"], "centre": d["centre"], "years": [y["year"] for y in rows],
        "farms": [y["farms"] for y in rows], "arable_daa": [round(a) for a in arable],
        "pasture_daa": [y["areas"].get("Pasture", 0) for y in rows], "crops": crops,
        "farms_change": {"from": first["farms"], "to": last["farms"], "first": first["year"], "last": last["year"]},
        "dots": d["dots"], "dot_fields": ["lat", "lon", "arable_daa", "main_crop", "year"],
        "source": meta["source"], "url": meta["url"],
        "method": f"Areas each farm reported in its production-subsidy application, summed by today's municipality "
                  f"(SSB KLASS for mergers). Shares are of arable land (pasture left out). A change is named only when the "
                  f"share trends the same way across all years (Theil–Sen, Mann–Kendall p < {P_CONSISTENT}) and moves at "
                  f"least {MIN_CHANGE_PP} percentage points. Dots are farm centres from the farm register, not fields.",
    }
