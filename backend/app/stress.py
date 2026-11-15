"""Season check: was a season clearly less green than the field's other seasons with the same likely crop,
and did that season's weather stand out?

Season level only. Within-season dips are not flagged: grass cuts and harvests look exactly like damage from orbit.
Weather is reported as coinciding with a weak season, never as its proven cause.
"""
from __future__ import annotations

from datetime import date
from statistics import median

COMPARABLE = ("grass", "new_ley", "spring_crop", "winter_crop", "late_crop")
DEFICIT = -0.10          # flag a season at least 10% below its same-crop reference
MIN_OTHERS = 2           # same-crop seasons needed besides the one judged
MIN_WEATHER = 5          # weather seasons needed to call something unusual
TOP_RANK = 2             # "stands out" = among the two most extreme seasons on record


def _doy(iso: str | None, season: int) -> int | None:
    """Days from 1 Jan of the season year (works across the southern year boundary too)."""
    if not iso:
        return None
    return (date.fromisoformat(iso) - date(season, 1, 1)).days


# code, field, direction (+1 = higher is worse), test that the difference from normal is meaningful
FACTORS = [
    ("dry_spell", "longest_dry_spell", +1, lambda v, m: v >= m + 3),
    ("low_rain", "season_rain_mm", -1, lambda v, m: m > 0 and v <= 0.8 * m),
    ("wet", "season_rain_mm", +1, lambda v, m: m > 0 and v >= 1.25 * m),
    ("heat", "heat_days", +1, lambda v, m: v >= max(2, m + 2)),
    ("cool", "gdd5", -1, lambda v, m: m > 0 and v <= 0.92 * m),
    ("late_frost", "_last_frost_doy", +1, lambda v, m: v >= m + 7),
    ("dry_soil", "mean_root_wetness", -1, lambda v, m: v <= m - 0.05),
    ("wet_soil", "mean_root_wetness", +1, lambda v, m: v >= m + 0.05),
]


def weather_standouts(target: dict, pool: list[dict]) -> list[dict]:
    """Weather factors in which `target` ranks among the TOP_RANK most extreme seasons of `pool` and differs
    meaningfully from the median. `pool` should include `target`."""
    def val(s, field):
        return _doy(s.get("last_spring_frost"), s["season"]) if field == "_last_frost_doy" else s.get(field)

    out = []
    for code, field, sign, meaningful in FACTORS:
        vals = [v for s in pool if (v := val(s, field)) is not None]
        v = val(target, field)
        if v is None or len(vals) < MIN_WEATHER:
            continue
        m = median(vals)
        rank = 1 + sum(1 for x in vals if sign * x > sign * v)
        if rank <= TOP_RANK and meaningful(v, m):
            out.append({"code": code, "value": v, "normal": round(m, 2) if isinstance(m, float) else m,
                        "rank": rank, "of": len(vals)})
    return out


def season_check(veg_seasons: list[dict], weather_seasons: list[dict] | None) -> dict:
    wx = {w["label"]: w for w in (weather_seasons or [])}
    pool = list(wx.values())
    rows, flagged = [], []
    for s in veg_seasons:
        crop = (s.get("crop_hint") or {}).get("type")
        v = s.get("season_evi_mean")
        row = {"season": s["season"], "label": s["label"], "crop": crop, "evi_mean": v,
               "reference": None, "diff_pct": None, "status": None, "weather": None}
        if v is None:
            row["status"] = "no_value"          # cloud gap or too few clear images
        elif crop not in COMPARABLE:
            row["status"] = "crop_unclear"
        else:
            others = [o["season_evi_mean"] for o in veg_seasons if o is not s and o.get("season_evi_mean") is not None
                      and (o.get("crop_hint") or {}).get("type") == crop]
            if len(others) < MIN_OTHERS:
                row["status"] = "too_few_same_crop"
            else:
                ref = median(others)
                diff = (v - ref) / ref
                row.update(reference=round(ref, 3), diff_pct=round(100 * diff, 1), n_same_crop=len(others))
                row["status"] = "lower" if diff <= DEFICIT else "normal"
        w = wx.get(s["label"])
        if w is not None and len(pool) >= MIN_WEATHER:
            row["weather"] = weather_standouts(w, pool)
            if w.get("partial"):
                row["weather_through"] = w["through"]  # this season's weather so far (growing months are over)
        if row["status"] == "lower":
            flagged.append(row["label"])
        rows.append(row)
    judged = sum(1 for r in rows if r["status"] in ("lower", "normal"))
    return {
        "seasons": rows, "flagged": flagged, "judged": judged, "weather_seasons": len(pool),
        "method": ("Each season's season-long EVI is compared with the median of the field's other seasons with the same "
                   f"likely crop (at least {MIN_OTHERS}); {int(-DEFICIT * 100)}% or more below is flagged. Weather "
                   f"stands out when the season is among the {TOP_RANK} most extreme of the {len(pool)} NASA POWER "
                   "seasons on record and clearly differs from the median. Season level only: grass cuts and harvests "
                   "look like damage within a season. Weather that coincides with a weak season is not proof it caused it."),
    }
