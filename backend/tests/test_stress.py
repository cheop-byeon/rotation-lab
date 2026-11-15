from app.stress import season_check, weather_standouts


def veg(label, crop, evi):
    return {"season": int(label), "label": label, "crop_hint": {"type": crop}, "season_evi_mean": evi}


def wx(label, dry=10, rain=300, heat=0, gdd=1200, frost="2020-05-10", soil=0.6):
    y = int(label)
    return {"season": y, "label": label, "longest_dry_spell": dry, "season_rain_mm": rain, "heat_days": heat,
            "gdd5": gdd, "last_spring_frost": frost.replace("2020", label), "mean_root_wetness": soil}


WEATHER = [wx(str(y)) for y in range(2016, 2026)]


def test_weak_season_flagged_against_same_crop_only():
    seasons = [veg("2020", "spring_crop", 0.33), veg("2021", "spring_crop", 0.34), veg("2022", "spring_crop", 0.27),
               veg("2023", "grass", 0.45), veg("2024", "spring_crop", 0.33)]
    out = season_check(seasons, WEATHER)
    rows = {r["label"]: r for r in out["seasons"]}
    assert out["flagged"] == ["2022"]
    assert rows["2022"]["status"] == "lower" and rows["2022"]["diff_pct"] < -10
    # a greener grass year is not compared with cereals
    assert rows["2023"]["status"] == "too_few_same_crop"


def test_unjudgeable_seasons_say_why():
    seasons = [veg("2020", "unclear", 0.3), {**veg("2021", "spring_crop", None)}, veg("2022", "spring_crop", 0.3)]
    rows = {r["label"]: r["status"] for r in season_check(seasons, WEATHER)["seasons"]}
    assert rows == {"2020": "crop_unclear", "2021": "no_value", "2022": "too_few_same_crop"}


def test_weather_standout_needs_extreme_rank_and_real_difference():
    pool = [wx(str(y), dry=10 + (y % 3)) for y in range(2016, 2026)]
    target = wx("2022", dry=25)
    pool = [p for p in pool if p["label"] != "2022"] + [target]
    codes = {w["code"] for w in weather_standouts(target, pool)}
    assert "dry_spell" in codes
    # longest dry spell, but only one day above normal: not called unusual
    mild = wx("2022", dry=13)
    pool2 = [p for p in pool if p["label"] != "2022"] + [mild]
    assert "dry_spell" not in {w["code"] for w in weather_standouts(mild, pool2)}


def test_no_weather_still_compares_greenness():
    seasons = [veg(str(y), "grass", 0.4) for y in range(2020, 2024)]
    out = season_check(seasons, None)
    assert out["judged"] == 4 and all(r["weather"] is None for r in out["seasons"])


# ---- fixes found in the drought-field test
from datetime import date, timedelta  # noqa: E402

from app import hls  # noqa: E402


def _season(season, crop, evi):
    return {"season": season, "season_evi_mean": evi, "crop_hint": {"type": crop}}


def test_trend_gives_no_overall_direction_when_crops_change():
    # a perennial ley followed by cereals is "less green" without the field getting worse
    seasons = [_season(2020, "grass", 0.55), _season(2021, "grass", 0.50), _season(2022, "grass", 0.48),
               _season(2023, "winter_crop", 0.32), _season(2024, "winter_crop", 0.30), _season(2025, "winter_crop", 0.29)]
    tr = hls.productivity_trend(seasons)
    assert tr["status"] == "mixed_crops" and tr["direction"] is None
    assert "same_crop" not in tr  # no crop has 4 seasons


def test_trend_reports_same_crop_seasons_when_crops_change():
    seasons = [_season(2020 + i, "spring_crop", 0.40 - 0.02 * i) for i in range(5)] + [_season(2025, "late_crop", 0.45)]
    tr = hls.productivity_trend(seasons)
    assert tr["status"] == "mixed_crops"
    assert tr["same_crop"]["crop"] == "spring_crop" and tr["same_crop"]["n"] == 5 and tr["same_crop"]["direction"] == "falling"


def test_single_crop_trend_still_has_a_direction():
    tr = hls.productivity_trend([_season(2020 + i, "grass", 0.50 + 0.02 * i) for i in range(6)])
    assert tr["status"] == "ok" and tr["direction"] == "rising" and len(tr["fit"]) == 2


def test_winter_crop_window_ends_before_stubble():
    a, b, _, _ = hls.season_window(2023, 46.6, "winter_crop")
    assert (a, b) == (date(2023, 4, 1), date(2023, 7, 15))
    # stubble after harvest must not change a winter crop's value
    obs = [{"date": (date(2023, 4, 1) + timedelta(7 * k)).isoformat(), "evi": 0.6} for k in range(16)]
    stubble = [{"date": (date(2023, 7, 20) + timedelta(7 * k)).isoformat(), "evi": 0.1} for k in range(10)]
    assert hls.season_evi_mean(obs + stubble, 2023, 46.6, "winter_crop") == 0.6
    # southern hemisphere: shifted six months, with valid month ends
    a, b, _, _ = hls.season_window(2023, -34.0, None)
    assert (a, b) == (date(2022, 10, 1), date(2023, 4, 30))


def test_current_season_weather_only_after_growing_months():
    from app import agro

    class FakeClimate:
        north, lat = True, 46.6
        def __init__(self, last): self.last = last
        def season_of(self, d): return d.year
    assert agro.growing_months_over(FakeClimate(date(2026, 11, 13)))
    assert not agro.growing_months_over(FakeClimate(date(2026, 8, 1)))
    assert not agro.growing_months_over(type("T", (FakeClimate,), {"lat": 10.0})(date(2026, 12, 1)))


# ---- then versus now (full NASA POWER record)
def test_what_changed_on_demo_record_offline(monkeypatch):
    from fastapi.testclient import TestClient
    from app import power
    from app.main import app
    monkeypatch.setattr(power, "DAILY_URL", "https://power.invalid/api")
    with TestClient(app) as cl:
        r = cl.get("/api/change", params={"lat": 63.4806, "lon": 10.8756})
    assert r.status_code == 200
    d = r.json()
    assert d["then"] == "1991–2000" and d["seasons"] >= 40
    m = {x["code"]: x for x in d["metrics"]}
    # shown values and change agree, and "consistent" needs the whole-record test
    assert all(x["change"] == round(x["now"] - x["then"], 2) for x in d["metrics"])
    assert m["gs_temp"]["consistent"] and m["gs_temp"]["change"] > 0 and m["gdd5"]["consistent"]
    assert not m["frost_free_days"]["consistent"]   # longer on average, but too uneven year to year to call
    assert all(x["consistent"] == (x["p_value"] < 0.05) for x in d["metrics"] if x["per_decade"] != 0)


def test_potato_check_offline_reports_blight_weather_and_ripening(monkeypatch):
    from fastapi.testclient import TestClient
    from app import power
    from app.main import app
    monkeypatch.setattr(power, "DAILY_URL", "https://power.invalid/api")
    with TestClient(app) as cl:
        r = cl.get("/api/crop-check", params={"lat": 63.4806, "lon": 10.8756, "crop": "Potato"})
        assert cl.get("/api/crop-check", params={"lat": 63.4806, "lon": 10.8756, "crop": "Banana"}).status_code == 404
    d = r.json()
    assert r.status_code == 200 and d["crop"] == "Potato"
    codes = {m["code"] for m in d["measures"]}
    assert "blight_days" in codes and "heat_days" in codes
    assert d["ripened"]["then_of"] == 10 and d["ripened"]["now_of"] == 10
    assert "not modelled" in d["method"] and "prices" in d["method"]


# ---- what's grown around you
def test_vectorised_crop_hints_match_the_field_rules():
    import numpy as np
    from datetime import date, timedelta
    from app import neighbourhood as nb
    rng = np.random.default_rng(7)
    dates = sorted({date(2023, 4, 1) + timedelta(int(x)) for x in rng.integers(0, 213, 40)})
    v = rng.uniform(0.1, 0.95, (len(dates), 600)).astype("float32")
    v[:, :50] = rng.uniform(0.1, 0.45, (len(dates), 50))  # never green: bare
    v[rng.random(v.shape) < 0.3] = np.nan
    got = nb.classify(v, dates, 60.0)
    codes = {k: i for i, k in enumerate(nb.CLASSES)}
    for p in range(v.shape[1]):
        obs = [{"date": d.isoformat(), "ndvi": None if np.isnan(v[i, p]) else float(v[i, p])} for i, d in enumerate(dates)]
        assert codes[hls.crop_hint(obs, 60.0)["type"]] == got[p]
    assert (got == codes["bare"]).sum() > 0


def test_neighbourhood_shift_needs_a_consistent_trend():
    from app import neighbourhood as nb
    import numpy as np
    farm = np.ones((4, 4), dtype=bool)
    noisy = [(2020 + i, np.full((4, 4), c, dtype=np.int8)) for i, c in enumerate([2, 3, 2, 3, 2, 3])]
    rows, change = nb._summarise(noisy, farm, {y: str(y) for y in range(2020, 2026)})
    assert all(r["usable"] for r in rows) and change["notable"] == []   # alternating: no shift
    steady = [(2020 + i, np.where(np.arange(16).reshape(4, 4) < 2 * i + 2, 2, 4).astype(np.int8)) for i in range(6)]
    _, change = nb._summarise(steady, farm, {y: str(y) for y in range(2020, 2026)})
    assert "grass" in change["notable"] and change["classes"]["grass"]["pp_per_year"] > 0


# ---- this season against the field's usual range
def test_usual_range_compares_with_same_crop_seasons_inside_the_crop_window():
    from datetime import date, timedelta
    from app import hls

    def season(y, peak, crop="winter_crop", harvest_ndvi=0.25):
        obs = []
        for k in range(0, 210, 6):  # Apr–Oct, a clear image every 6 days
            d = date(y, 4, 1) + timedelta(k)
            v = peak if d <= date(y, 7, 10) else harvest_ndvi  # green until harvest, then stubble
            obs.append({"date": d.isoformat(), "ndvi": v})
        return obs
    by = {2023: season(2023, 0.85), 2024: season(2024, 0.80), 2025: season(2025, 0.55)}
    sl = [{"season": y, "label": str(y), "crop_hint": {"type": "winter_crop"}} for y in by]
    u = hls.usual_range(by, sl, 46.6)
    assert u["seasons"] == ["2023", "2024"] and u["status"] == "below"           # weak only before harvest
    assert u["judged_window"] == ["2025-04-01", "2025-07-15"]                     # stubble weeks not counted
    by[2025] = season(2025, 0.82)
    assert hls.usual_range(by, sl, 46.6)["status"] == "within"
    sl[0]["crop_hint"]["type"] = "grass"                                          # only one earlier winter crop left
    assert hls.usual_range(by, sl, 46.6)["status"] == "too_few"
