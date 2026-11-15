"""What has changed here: the field's weather now compared with the 1990s, from the NASA POWER record since 1981.

A change is stated only when the whole record shows a consistent trend (Mann–Kendall p < 0.05), so one unusual
decade is not reported as climate change. Values are for a ~50 km grid cell, not the field itself.
"""
from __future__ import annotations

from datetime import date, timedelta
from statistics import mean

from . import agro
from .hls import _mann_kendall_p, _theil_sen

THEN = (1991, 2000)
NOW_YEARS = 10
P_MAX = 0.05
HEAVY_MM = 20.0
WARM_C, HOT_C = 25.0, 30.0

# code, label, unit, decimals, which direction is a risk for crops ("+" = higher is a risk, "-" lower, "" neither)
METRICS = [
    ("frost_free_days", "Frost-free season", "days", 0, "-"),
    ("last_spring_frost", "Last spring frost", "date", 0, "+"),
    ("first_autumn_frost", "First autumn frost", "date", 0, "-"),
    ("gdd5", "Warmth for crops (GDD above 5 °C)", "°C·days", 0, ""),
    ("gs_temp", "Growing-season mean temperature", "°C", 1, ""),
    ("gs_rain", "Growing-season rain", "mm", 0, ""),
    ("dry_spell", "Longest dry spell", "days", 0, "+"),
    ("heavy_rain_days", f"Heavy-rain days (≥ {HEAVY_MM:.0f} mm)", "days", 1, "+"),
    ("warm_days", f"Warm days (≥ {WARM_C:.0f} °C)", "days", 1, ""),
    ("hot_days", f"Hot days (≥ {HOT_C:.0f} °C)", "days", 1, "+"),
]


def growing_days(c: agro.Climate, y: int) -> list[date]:
    """Growing months of a season: Apr–Sep in the north, Oct–Mar in the south."""
    a = date(y, 4, 1) if c.north else date(y - 1, 10, 1)
    b = date(y, 9, 30) if c.north else date(y, 3, 31)
    return [a + timedelta(n) for n in range((b - a).days + 1)]


def season_metrics(c: agro.Climate, y: int) -> dict:
    start = c.season_start(y)
    fd = agro.frost_dates(c, y)
    g = growing_days(c, y)
    tmax = [v for d in g if (v := c.val(c.tmax, d)) is not None]
    tmean = [v for d in g if (v := c.val(c.tmean, d)) is not None]
    rain = [c.val(c.prec, d) or 0 for d in g]
    tropics = abs(c.lat) < 23.5
    return {
        "season": y,
        "frost_free_days": None if tropics else fd["frost_free_days"],
        "last_spring_frost": None if tropics or not fd["last_spring"] else (fd["last_spring"] - start).days,
        "first_autumn_frost": None if tropics or not fd["first_fall"] else (fd["first_fall"] - start).days,
        "gdd5": round(sum(max(0.0, (c.val(c.tmean, d) or 0) - agro.GDD_BASE) for d in c.season_days(y))),
        "gs_temp": round(mean(tmean), 2) if tmean else None,
        "gs_rain": round(sum(rain)),
        "dry_spell": agro.longest_run([r < agro.DRY_DAY_MM for r in rain]),
        "heavy_rain_days": sum(1 for r in rain if r >= HEAVY_MM),
        "warm_days": sum(1 for t in tmax if t >= WARM_C),
        "hot_days": sum(1 for t in tmax if t >= HOT_C),
    }


def _doy_label(c: agro.Climate, offset: float) -> str:
    d = c.season_start(2001) + timedelta(int(round(offset)))  # a non-leap reference year
    return d.strftime("%-d %b")


def what_changed(c: agro.Climate) -> dict:
    seasons = [y for y in c.complete_seasons()]
    rows = [season_metrics(c, y) for y in seasons]
    now = seasons[-NOW_YEARS:]
    then = [y for y in seasons if THEN[0] <= y <= THEN[1]]
    out = []
    for code, label, unit, dec, risk in METRICS:
        pts = [(r["season"], r[code]) for r in rows if r[code] is not None]
        if len(pts) < 20 or len(then) < 8:
            continue
        x, v = [p[0] for p in pts], [p[1] for p in pts]
        m_then = mean(val for y, val in pts if y in then)
        m_now = mean(val for y, val in pts if y in now)
        slope = _theil_sen(x, v)
        p = _mann_kendall_p(v)
        change = m_now - m_then
        r = (lambda v: int(round(v))) if dec == 0 else (lambda v: round(v, dec))
        item = {"code": code, "label": label, "unit": unit, "then": r(m_then), "now": r(m_now),
                "change": r(r(m_now) - r(m_then)),  # from the shown values, so "19 → 17" reads as −2
                "per_decade": round(10 * slope, dec + 1), "p_value": round(p, 3),
                "consistent": p < P_MAX and slope != 0, "risk": risk,
                "series": [[y, val] for y, val in pts]}
        if unit == "date":
            item.update(then_label=_doy_label(c, m_then), now_label=_doy_label(c, m_now))
        # does the change make conditions harder (+1), easier (-1) for crops, or neither (0)?
        sign = (1 if change > 0 else -1) if item["consistent"] else 0
        item["harder"] = 0 if not risk or not sign else (sign if risk == "+" else -sign)
        out.append(item)
    return {
        "then": f"{THEN[0]}–{THEN[1]}", "now": f"{now[0]}–{now[-1]}", "record": f"{seasons[0]}–{seasons[-1]}",
        "seasons": len(seasons), "metrics": out,
        "method": (f"NASA POWER daily weather (MERRA-2) for the ~50 km grid cell, every complete season {seasons[0]}–{seasons[-1]}. "
                   f"Averages for {THEN[0]}–{THEN[1]} compared with the last {NOW_YEARS} seasons. A change is called consistent only "
                   f"when the whole record trends the same way (Theil–Sen slope, Mann–Kendall p < {P_MAX}). Growing months: "
                   "Apr–Sep north, Oct–Mar south. Frost = daily minimum air temperature at 2 m ≤ 0 °C; ground frost is more frequent. "
                   "Grid-cell rain smooths out local downpours, so heavy-rain days are undercounted."),
    }
