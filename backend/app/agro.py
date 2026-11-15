"""Agroclimatic indicators derived from NASA POWER daily data.

All functions are pure and work on a DailySeries so they are easy to test.
Methods:
  * Reference evapotranspiration: Hargreaves–Samani (FAO-56, eq. 52) with
    extraterrestrial radiation from FAO-56 eq. 21.
  * Growing degree days: simple average method, Σ max(0, Tmean − Tbase).
  * Frost dates: daily minimum 2 m air temperature at or below a threshold.
    POWER is a regional grid (~50 km); ground-level frost is more frequent
    than 2 m air frost, so dates are indicative.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from statistics import mean

from .power import DailySeries

GDD_BASE = 5.0  # general-purpose base temperature for the "thermal time" headline
HEAT_DAY_C = 30.0
DRY_DAY_MM = 1.0


# ---------------------------------------------------------------- helpers
def quantile(values: list[float], q: float) -> float | None:
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    pos = (len(vals) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def percentile_rank(value: float, sample: list[float]) -> float | None:
    sample = [v for v in sample if v is not None]
    if not sample or value is None:
        return None
    below = sum(1 for v in sample if v < value)
    equal = sum(1 for v in sample if v == value)
    return 100.0 * (below + 0.5 * equal) / len(sample)


def r1(v, n=1):
    return None if v is None else round(v, n)


def extraterrestrial_radiation(lat: float, doy: int) -> float:
    """Ra in MJ m-2 day-1 (FAO-56 eq. 21)."""
    phi = math.radians(lat)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    delta = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)
    x = max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta)))
    ws = math.acos(x)
    return (24 * 60 / math.pi) * 0.0820 * dr * (
        ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws)
    )


def hargreaves_et0(lat: float, d: date, tmean, tmax, tmin) -> float | None:
    if None in (tmean, tmax, tmin):
        return None
    ra = extraterrestrial_radiation(lat, d.timetuple().tm_yday)
    return max(0.0, 0.0023 * (tmean + 17.8) * math.sqrt(max(tmax - tmin, 0.0)) * 0.408 * ra)


def detect_source_break(dates: list[date], wet: list[float | None], rain: list[float | None] | None = None,
                        lookback: int = 150) -> date | None:
    """Find where POWER splices MERRA-2 reanalysis onto the GEOS-IT near-real-time feed.

    POWER fills the most recent 1–3 months from GEOS-IT, whose land model has a
    different soil-wetness baseline. The splice shows up as a one-day jump far
    larger than root-zone moisture can physically change (it drains over weeks).
    Returns the first day of the near-real-time segment, or None.
    """
    rain = rain or [None] * len(dates)
    triples = [(d, v, r or 0) for d, v, r in zip(dates[-lookback:], wet[-lookback:], rain[-lookback:]) if v is not None]
    if len(triples) < 30:
        return None
    steps = [(triples[i][0], triples[i][1] - triples[i - 1][1]) for i in range(1, len(triples))
             # a downpour can legitimately wet the soil overnight; never treat that as a splice
             if not (triples[i][1] > triples[i - 1][1] and triples[i][2] + triples[i - 1][2] >= 20)]
    typical = sorted(abs(x) for _, x in steps)[len(steps) // 2] or 0.005
    day, jump = max(steps, key=lambda t: abs(t[1]))
    return day if abs(jump) >= 0.08 and abs(jump) >= 8 * typical else None


class Climate:
    """Convenience wrapper: indexes a DailySeries by date and season."""

    def __init__(self, series: DailySeries):
        self.s = series
        self.lat = series.lat
        self.north = series.lat >= 0
        self.idx = {d: i for i, d in enumerate(series.dates)}
        v = series.values
        self.tmean, self.tmax, self.tmin = v["T2M"], v["T2M_MAX"], v["T2M_MIN"]
        self.prec, self.gwr, self.gwt = v["PRECTOTCORR"], v["GWETROOT"], v["GWETTOP"]
        self.et0 = [hargreaves_et0(self.lat, d, a, b, c) for d, a, b, c in zip(series.dates, self.tmean, self.tmax, self.tmin)]
        self.last = series.last_valid_date("T2M") or series.dates[-1]
        self.doys = [d.timetuple().tm_yday for d in series.dates]
        self.years = [d.year for d in series.dates]
        self.soil_break = detect_source_break(series.dates, self.gwr, self.prec)


    # A "season" starts at mid-winter: 1 Jan in the north, 1 Jul in the south.
    def season_start(self, year: int) -> date:
        return date(year, 1, 1) if self.north else date(year - 1, 7, 1)

    def season_of(self, d: date) -> int:
        return d.year if self.north else (d.year + 1 if d.month >= 7 else d.year)

    def season_days(self, year: int) -> list[date]:
        start = self.season_start(year)
        end = self.season_start(year + 1)
        return [start + timedelta(n) for n in range((end - start).days)]

    def complete_seasons(self) -> list[int]:
        out = []
        for y in range(self.season_of(self.s.dates[0]), self.season_of(self.last) + 1):
            days = self.season_days(y)
            if days[0] < self.s.dates[0] or days[-1] > self.last:
                continue
            gaps = sum(1 for d in days if self.tmin[self.idx[d]] is None)
            if gaps <= 0.05 * len(days):
                out.append(y)
        return out

    def val(self, arr, d: date):
        i = self.idx.get(d)
        return None if i is None else arr[i]


# ---------------------------------------------------------------- frost & seasons
def frost_dates(c: Climate, year: int, threshold: float = 0.0) -> dict:
    days = c.season_days(year)
    mid = len(days) // 2
    spring = [d for d in days[:mid] if (t := c.val(c.tmin, d)) is not None and t <= threshold]
    autumn = [d for d in days[mid:] if (t := c.val(c.tmin, d)) is not None and t <= threshold]
    last_spring = spring[-1] if spring else None
    first_fall = autumn[0] if autumn else None
    start = last_spring + timedelta(1) if last_spring else days[0]
    end = first_fall - timedelta(1) if first_fall else days[-1]
    return {"last_spring": last_spring, "first_fall": first_fall, "start": start, "end": end,
            "frost_free_days": (end - start).days + 1}


def longest_run(flags: list[bool]) -> int:
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def _season_summary(c: Climate, y: int) -> dict:
    fd = frost_dates(c, y)
    window = [fd["start"] + timedelta(n) for n in range(fd["frost_free_days"])]
    gdd = sum(max(0.0, (c.val(c.tmean, d) or 0) - GDD_BASE) for d in c.season_days(y))
    rain = sum(c.val(c.prec, d) or 0 for d in window)
    et0 = sum(c.val(c.et0, d) or 0 for d in window)
    heat = sum(1 for d in window if (t := c.val(c.tmax, d)) is not None and t >= HEAT_DAY_C)
    dry = longest_run([(c.val(c.prec, d) or 0) < DRY_DAY_MM for d in window if d <= c.last])
    soil = [v for d in window if (v := c.val(c.gwr, d)) is not None]
    return {
        "season": y,
        "label": str(y) if c.north else f"{y - 1}/{str(y)[2:]}",
        "gdd5": round(gdd),
        "last_spring_frost": fd["last_spring"].isoformat() if fd["last_spring"] else None,
        "first_fall_frost": fd["first_fall"].isoformat() if fd["first_fall"] else None,
        "frost_free_days": fd["frost_free_days"],
        "season_rain_mm": round(rain),
        "season_et0_mm": round(et0),
        "water_balance_mm": round(rain - et0),
        "heat_days": heat,
        "longest_dry_spell": dry,
        "mean_root_wetness": r1(mean(soil), 2) if soil else None,
    }


def growing_months_over(c: Climate) -> bool:
    """True once the current season's growing months (Apr–Oct north, Oct–Apr south) have passed."""
    if abs(c.lat) < 23.5:
        return False
    y = c.season_of(c.last)
    return c.last >= (date(y, 11, 1) if c.north else date(y, 5, 1))


def season_summaries(c: Climate, include_current: bool = False) -> list[dict]:
    """Per-season weather. With include_current, the current season is added (marked partial) once its
    growing months are over, so this year's crop can be checked against this year's weather."""
    out = [_season_summary(c, y) for y in c.complete_seasons()]
    y = c.season_of(c.last)
    if include_current and growing_months_over(c) and y not in c.complete_seasons():
        out.append({**_season_summary(c, y), "partial": True, "through": c.last.isoformat()})
    return out

def _offset_to_date(c: Climate, offsets: list[int], q: float) -> date | None:
    v = quantile(offsets, q)
    if v is None:
        return None
    return c.season_start(c.season_of(c.last)) + timedelta(int(round(v)))


def frost_climatology(c: Climate) -> dict:
    """Median and 'safe' (1-in-5 risk) frost dates expressed for the current season."""
    seasons = c.complete_seasons()
    springs, falls, lengths = [], [], []
    for y in seasons:
        fd = frost_dates(c, y)
        start = c.season_start(y)
        springs.append((fd["last_spring"] - start).days if fd["last_spring"] else 0)
        falls.append((fd["first_fall"] - start).days if fd["first_fall"] else len(c.season_days(y)) - 1)
        lengths.append(fd["frost_free_days"])
    frost_years = sum(1 for y in seasons if frost_dates(c, y)["last_spring"] or frost_dates(c, y)["first_fall"])
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {
        "seasons": len(seasons),
        "frost_years": frost_years,
        "last_spring_median": iso(_offset_to_date(c, springs, 0.5)) if frost_years else None,
        "last_spring_safe": iso(_offset_to_date(c, springs, 0.8)) if frost_years else None,
        "first_fall_median": iso(_offset_to_date(c, falls, 0.5)) if frost_years else None,
        "first_fall_early": iso(_offset_to_date(c, falls, 0.2)) if frost_years else None,
        "frost_free_days_median": r1(quantile(lengths, 0.5), 0),
        "frost_free_days_short": r1(quantile(lengths, 0.2), 0),
    }


# ---------------------------------------------------------------- current conditions
def window_sum(c: Climate, arr, end: date, days: int) -> float | None:
    vals = [c.val(arr, end - timedelta(n)) for n in range(days)]
    vals = [v for v in vals if v is not None]
    return sum(vals) if len(vals) >= 0.8 * days else None


def same_window_history(c: Climate, arr, end: date, days: int) -> list[float]:
    out = []
    for back in range(1, 40):
        try:
            e = end.replace(year=end.year - back)
        except ValueError:  # 29 Feb
            e = (end - timedelta(1)).replace(year=end.year - back)
        if e - timedelta(days) < c.s.dates[0]:
            break
        v = window_sum(c, arr, e, days)
        if v is not None:
            out.append(v)
    return out


def doy_sample(c: Climate, arr, d: date, half_width: int = 15, exclude_year: int | None = None) -> list[float]:
    """All historical values within ±half_width days of d's calendar day."""
    target = d.timetuple().tm_yday
    out = []
    for doy, yr, v in zip(c.doys, c.years, arr):
        if v is None or yr == exclude_year:
            continue
        diff = abs(doy - target)
        if min(diff, 365 - diff) <= half_width:
            out.append(v)
    return out


def current_conditions(c: Climate) -> dict:
    last = c.last
    nrt_date = c.s.last_valid_date("GWETROOT")
    soil_date = (c.soil_break - timedelta(1)) if c.soil_break else nrt_date
    rain30 = window_sum(c, c.prec, last, 30)
    rain30_hist = same_window_history(c, c.prec, last, 30)
    rain90 = window_sum(c, c.prec, last, 90)
    rain90_hist = same_window_history(c, c.prec, last, 90)
    et030 = window_sum(c, c.et0, last, 30)
    root = c.val(c.gwr, soil_date) if soil_date else None
    top = c.val(c.gwt, soil_date) if soil_date else None
    root_sample = doy_sample(c, c.gwr, soil_date, exclude_year=soil_date.year) if soil_date else []
    tmean7 = [v for n in range(7) if (v := c.val(c.tmean, last - timedelta(n))) is not None]
    t7_hist = doy_sample(c, c.tmean, last, 3, exclude_year=last.year)
    frost_7 = sum(1 for n in range(7) if (v := c.val(c.tmin, last - timedelta(n))) is not None and v <= 0)
    return {
        "date": last.isoformat(),
        "lag_days": (date.today() - last).days,
        "tmean": r1(c.val(c.tmean, last)),
        "tmax": r1(c.val(c.tmax, last)),
        "tmin": r1(c.val(c.tmin, last)),
        "tmean_7d": r1(mean(tmean7)) if tmean7 else None,
        "tmean_7d_normal": r1(mean(t7_hist)) if t7_hist else None,
        "frost_nights_7d": frost_7,
        "rain_7d": r1(window_sum(c, c.prec, last, 7)),
        "rain_30d": r1(rain30),
        "rain_30d_normal": r1(mean(rain30_hist)) if rain30_hist else None,
        "rain_30d_pct": r1(percentile_rank(rain30, rain30_hist), 0) if rain30 is not None else None,
        "rain_90d": r1(rain90),
        "rain_90d_normal": r1(mean(rain90_hist)) if rain90_hist else None,
        "et0_30d": r1(et030),
        "balance_30d": r1(rain30 - et030) if None not in (rain30, et030) else None,
        "soil_date": soil_date.isoformat() if soil_date else None,
        "root_wetness": r1(root, 2),
        "top_wetness": r1(top, 2),
        "root_wetness_pct": r1(percentile_rank(root, root_sample), 0) if root is not None else None,
        "root_wetness_normal": r1(mean(root_sample), 2) if root_sample else None,
        "nrt_break": c.soil_break.isoformat() if c.soil_break else None,
        "nrt_date": nrt_date.isoformat() if c.soil_break and nrt_date else None,
        "nrt_root_wetness": r1(c.val(c.gwr, nrt_date), 2) if c.soil_break and nrt_date else None,
        "humidity": r1(c.val(c.s.values["RH2M"], last), 0),
        "radiation": r1(c.val(c.s.values["ALLSKY_SFC_SW_DWN"], last)),
        "wind": r1(c.val(c.s.values["WS2M"], last)),
    }


def gdd_progress(c: Climate, base: float = GDD_BASE) -> dict:
    """Cumulative GDD for the current season vs. the historical envelope."""
    current = c.season_of(c.last)
    seasons = c.complete_seasons()
    curves = {}
    for y in seasons + [current]:
        total, curve = 0.0, []
        for d in c.season_days(y):
            if d > c.last:
                break
            total += max(0.0, (c.val(c.tmean, d) or 0) - base)
            curve.append(total)
        curves[y] = curve
    n = max((len(v) for k, v in curves.items() if k != current), default=0)
    hist = [curves[y] for y in seasons]
    env = {"mean": [], "p10": [], "p90": []}
    for i in range(0, n, 3):  # every 3rd day keeps payload small
        col = [h[i] for h in hist if i < len(h)]
        env["mean"].append(round(mean(col)))
        env["p10"].append(round(quantile(col, 0.1)))
        env["p90"].append(round(quantile(col, 0.9)))
    cur = curves[current]
    today_i = len(cur) - 1
    same_day = [h[today_i] for h in hist if today_i < len(h)]
    return {
        "base": base,
        "season": current,
        "season_start": c.season_start(current).isoformat(),
        "step_days": 3,
        "current": [round(v) for v in cur[::3]] + ([round(cur[-1])] if (len(cur) - 1) % 3 else []),
        "envelope": env,
        "to_date": round(cur[-1]) if cur else 0,
        "to_date_normal": round(mean(same_day)) if same_day else None,
        "season_total_normal": round(mean([h[-1] for h in hist])) if hist else None,
    }


def recent_series(c: Climate, days: int = 120) -> dict:
    end = c.last
    ds = [end - timedelta(n) for n in range(days - 1, -1, -1)]
    pick = lambda arr: [r1(c.val(arr, d)) for d in ds]  # noqa: E731
    return {"dates": [d.isoformat() for d in ds], "tmean": pick(c.tmean), "tmax": pick(c.tmax),
            "tmin": pick(c.tmin), "prec": pick(c.prec), "et0": pick(c.et0)}


def soil_series(c: Climate, days: int = 365) -> dict:
    end = c.s.last_valid_date("GWETROOT") or c.last
    ds = [end - timedelta(n) for n in range(days - 1, -1, -1)]
    step = 2
    sampled = ds[::step]
    p10, p50, p90 = [], [], []
    for d in sampled:
        sample = doy_sample(c, c.gwr, d, 7, exclude_year=d.year)
        p10.append(r1(quantile(sample, 0.1), 3))
        p50.append(r1(quantile(sample, 0.5), 3))
        p90.append(r1(quantile(sample, 0.9), 3))
    brk = c.soil_break
    is_nrt = lambda d: brk is not None and d >= brk  # noqa: E731
    return {"dates": [d.isoformat() for d in sampled],
            "nrt_break": brk.isoformat() if brk else None,
            "root": [None if is_nrt(d) else r1(c.val(c.gwr, d), 3) for d in sampled],
            "root_nrt": [r1(c.val(c.gwr, d), 3) if is_nrt(d) else None for d in sampled],
            "top": [None if is_nrt(d) else r1(c.val(c.gwt, d), 3) for d in sampled],
            "normal_p10": p10, "normal_median": p50, "normal_p90": p90}


def monthly_anomalies(c: Climate, clim: dict | None, months: int = 24) -> list[dict]:
    if not clim:
        return []
    out = []
    y, m = c.last.year, c.last.month
    for _ in range(months):
        start = date(y, m, 1)
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        ds = [start + timedelta(n) for n in range((nxt - start).days)]
        temps = [v for d in ds if (v := c.val(c.tmean, d)) is not None]
        rains = [v for d in ds if (v := c.val(c.prec, d)) is not None]
        n_days = len(ds)
        t_norm = clim["monthly"]["T2M"][m - 1]
        p_norm = clim["monthly"]["PRECTOTCORR"][m - 1] * n_days  # climatology is mm/day
        complete = len(rains) >= n_days - 1
        out.append({
            "month": start.strftime("%Y-%m"),
            "complete": complete,
            "tmean": r1(mean(temps)) if temps else None,
            "t_anomaly": r1(mean(temps) - t_norm) if temps else None,
            "rain": r1(sum(rains)) if rains else None,
            "rain_normal": r1(p_norm),
            "rain_anomaly_pct": r1(100 * (sum(rains) - p_norm) / p_norm, 0) if complete and p_norm > 0 else None,
        })
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(out))


def season_phase(c: Climate, frost: dict) -> str:
    if frost["frost_years"] == 0:
        return "year-round"
    today = c.last
    ls, ff = date.fromisoformat(frost["last_spring_median"]), date.fromisoformat(frost["first_fall_median"])
    safe = date.fromisoformat(frost["last_spring_safe"])
    if today < ls - timedelta(30):
        return "winter"
    if today < safe + timedelta(21):
        return "planting"
    if today < ff - timedelta(21):
        return "growing"
    if today <= ff + timedelta(21):
        return "harvest"
    return "winter"
