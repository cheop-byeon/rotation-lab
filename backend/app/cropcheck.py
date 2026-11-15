"""Is this crop still a good choice here? One crop, every season since 1981, then (1991–2000) versus now.

Uses the same crop-season simulation as "Crops in your climate" (sowing after the last damaging frost once the soil
is warm, growth to maturity or a killing frost), run over the full NASA POWER record, plus crop-specific risks
while the crop is in the ground. Climate side only: prices, contracts and costs are the grower's to weigh.
"""
from __future__ import annotations

from statistics import mean

from . import agro
from .change import NOW_YEARS, P_MAX, THEN
from .crops import CROPS, _crop_season
from .hls import _mann_kendall_p, _theil_sen

BLIGHT_TMIN_C, BLIGHT_RH = 10.0, 85.0


def _blight_days(c: agro.Climate, y: int, sow: int, end: int) -> int:
    """Warm, humid days while the crop is in the ground: a daily stand-in for the hourly Smith/Hutton
    late-blight rules (which need many hours of humidity near 90% on nights above 10 °C)."""
    rh = c.s.values.get("RH2M")
    if not rh:
        return 0
    days = c.season_days(y)[sow:end + 1]
    return sum(1 for d in days if (i := c.idx.get(d)) is not None and (c.tmin[i] or -99) >= BLIGHT_TMIN_C
               and (rh[i] or 0) >= BLIGHT_RH)


def season_rows(c: agro.Climate, crop_name: str) -> list[dict]:
    crop = CROPS[crop_name]
    rows = []
    for y in c.complete_seasons():
        r = _crop_season(c, crop, y)
        if r is None:
            continue
        row = {"season": y, "sown": r["sow"] is not None, "matured": bool(r.get("matured"))}
        if r["sow"] is not None:
            end = r["sow"] + r["cycle_days"] - 1
            row.update(sow_day=r["sow"], cycle_days=r["cycle_days"], heat_days=r["heat"],
                       water_pct=round(100 * r["ratio"]))
            if crop.family == "Solanaceae":
                row["blight_days"] = _blight_days(c, y, r["sow"], end)
        rows.append(row)
    return rows


def _measure(rows, code, label, unit, then, now, dec=0, risk=""):
    pts = [(r["season"], r[code]) for r in rows if r.get(code) is not None]
    if len(pts) < 20:
        return None
    x, v = [p[0] for p in pts], [p[1] for p in pts]
    a = [val for y, val in pts if y in then]
    b = [val for y, val in pts if y in now]
    if len(a) < 8 or len(b) < 8:
        return None
    rd = (lambda z: int(round(z))) if dec == 0 else (lambda z: round(z, dec))
    slope, p = _theil_sen(x, v), _mann_kendall_p(v)
    return {"code": code, "label": label, "unit": unit, "then": rd(mean(a)), "now": rd(mean(b)),
            "change": rd(rd(mean(b)) - rd(mean(a))), "per_decade": round(10 * slope, dec + 1), "p_value": round(p, 3),
            "consistent": p < P_MAX and slope != 0, "risk": risk, "series": [[y, val] for y, val in pts]}


def crop_then_now(c: agro.Climate, crop_name: str) -> dict:
    crop = CROPS[crop_name]
    rows = season_rows(c, crop_name)
    seasons = [r["season"] for r in rows]
    now = seasons[-NOW_YEARS:]
    then = [y for y in seasons if THEN[0] <= y <= THEN[1]]
    ripe = lambda ys: sum(1 for r in rows if r["season"] in ys and r["matured"])  # noqa: E731
    sown = [r for r in rows if r["sown"]]
    measures = [m for m in [
        _measure(sown, "cycle_days", "Days from sowing to maturity (or frost)", "days", then, now),
        _measure(sown, "heat_days", f"Heat-stress days in the crop (≥ {crop.heat_limit_c:.0f} °C)", "days", then, now, 1, "+"),
        _measure(sown, "water_pct", "Rain as a share of the crop's water use", "%", then, now, 0, "-"),
        _measure(sown, "blight_days", f"Blight-weather days (min ≥ {BLIGHT_TMIN_C:.0f} °C, humidity ≥ {BLIGHT_RH:.0f}%)", "days",
                 then, now, 1, "+") if crop.family == "Solanaceae" else None,
    ] if m]
    return {
        "crop": crop_name, "family": crop.family, "note": crop.note,
        "then": f"{THEN[0]}–{THEN[1]}", "now": f"{now[0]}–{now[-1]}", "record": f"{seasons[0]}–{seasons[-1]}",
        "ripened": {"then": ripe(then), "then_of": len(then), "now": ripe(now), "now_of": len(now),
                    "series": [[r["season"], int(r["matured"])] for r in rows]},
        "measures": measures,
        "params": {"base_c": crop.base_c, "gdd": crop.gdd, "sow_c": crop.sow_c, "heat_limit_c": crop.heat_limit_c, "kc": crop.kc},
        "method": ("The crop-season simulation behind \"Crops in your climate\" run over every complete season of the NASA POWER "
                   f"record ({seasons[0]}–{seasons[-1]}), {THEN[0]}–{THEN[1]} compared with the last {NOW_YEARS} seasons; measures are "
                   "counted while the crop is in the ground. A change is called consistent only when the whole record trends the same "
                   f"way (Mann–Kendall p < {P_MAX})."
                   + (" Blight-weather days are a daily stand-in for the hourly Smith/Hutton late-blight rules, from grid-cell "
                      "humidity; they show how often the weather favours blight, not a warning. Use the national warning service "
                      "(VIPS in Norway) for spraying decisions." if crop.family == "Solanaceae" else "")
                   + " \"Ripened\" means the simulated crop reached its full thermal time before a killing frost: early "
                   "varieties and lifting or cutting before full maturity are not modelled, so it understates where the crop is "
                   "grown in practice; the change over time is the more useful signal."
                   + " Climate side only: prices, contracts and costs are not included."),
    }
