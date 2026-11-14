"""Unit tests for the agronomy engine on synthetic, fully-known weather."""
import math
from datetime import date, timedelta

import pytest

from app import agro, crops
from app.power import DAILY_PARAMS, DailySeries


def synthetic(lat=60.0, years=6, splice=None, end=date(2026, 11, 10)):
    start = date(end.year - years, 1, 1)
    dates = [start + timedelta(n) for n in range((end - start).days + 1)]
    v = {p: [] for p in DAILY_PARAMS}
    for d in dates:
        doy = d.timetuple().tm_yday
        phase = math.cos(2 * math.pi * (doy - 200) / 365) * (1 if lat >= 0 else -1)
        t = 5 + 12 * phase                       # −7 … 17 °C seasonal cycle
        v["T2M"].append(t); v["T2M_MAX"].append(t + 5); v["T2M_MIN"].append(t - 5)
        v["PRECTOTCORR"].append(2.0); v["RH2M"].append(80.0); v["ALLSKY_SFC_SW_DWN"].append(10.0)
        wet = 0.8 if not (splice and d >= splice) else 0.5
        v["GWETROOT"].append(wet); v["GWETTOP"].append(wet); v["WS2M"].append(2.0)
    return DailySeries(lat, 10.0, 100.0, dates, v, "2026-11-14T00:00:00+00:00", "test", "test://", {})


def test_extraterrestrial_radiation_matches_fao56_example():
    # FAO-56 Example 8: 20°S on 3 September -> Ra = 32.2 MJ m-2 day-1
    assert agro.extraterrestrial_radiation(-20, 246) == pytest.approx(32.2, abs=0.1)


def test_quantile_and_percentile():
    assert agro.quantile([1, 2, 3, 4, 5], 0.5) == 3
    assert agro.percentile_rank(3, [1, 2, 3, 4, 5]) == 50


def test_frost_dates_and_season_length():
    c = agro.Climate(synthetic())
    fd = agro.frost_dates(c, 2024)
    # Tmin = 12cos(...) <= 0 when cos <= 0 -> frost-free roughly doy 109..291
    assert 100 <= fd["start"].timetuple().tm_yday <= 120
    assert 170 <= fd["frost_free_days"] <= 195
    assert agro.frost_climatology(c)["frost_years"] == len(c.complete_seasons())


def test_southern_hemisphere_seasons_span_new_year():
    c = agro.Climate(synthetic(lat=-35))
    assert c.season_start(2025) == date(2024, 7, 1)
    fd = agro.frost_dates(c, 2025)
    assert fd["start"].year == 2024 and fd["end"].year == 2025


def test_gdd_progress_current_matches_history():
    c = agro.Climate(synthetic())
    g = agro.gdd_progress(c)
    assert g["to_date_normal"] == pytest.approx(g["to_date"], rel=0.02)  # identical synthetic years


def test_source_break_detected_and_excluded():
    c = agro.Climate(synthetic(splice=date(2026, 10, 2)))
    assert c.soil_break == date(2026, 10, 2)
    now = agro.current_conditions(c)
    assert now["soil_date"] == "2026-10-01" and now["root_wetness"] == 0.8
    assert now["nrt_root_wetness"] == 0.5


def test_no_break_on_smooth_series():
    assert agro.Climate(synthetic()).soil_break is None


def test_rotation_ranking_prefers_diverse_sequences():
    profile = {"soil": "Loamy", "drainage": "Good", "irrigation": "No", "previous_crop": "Barley"}
    ranked = crops.rank_rotations(profile, [1, 1, 1, 1], crops.DEFAULT_ROTATIONS, None)
    assert ranked[-1]["name"] == "Cereal baseline"
    assert all(0 <= v <= 100 for r in ranked for v in r["components"])


def test_suitability_thermal_limits():
    c = agro.Climate(synthetic())
    suit = {s["name"]: s for s in crops.crop_suitability(c)}
    assert suit["Barley"]["thermal_reliability"] > suit["Grain maize"]["thermal_reliability"]
    assert suit["Grain maize"]["status"] == "Poor fit"


def test_unviable_crop_sinks_rotation():
    profile = {"soil": "Loamy", "drainage": "Good", "irrigation": "No", "previous_crop": "Barley"}
    suit = [{"name": n, "thermal_reliability": 100, "water_ratio": 1.2} for n in crops.CROPS]
    suit = [dict(s, thermal_reliability=10) if s["name"] == "Oilseed rape" else s for s in suit]
    ranked = {r["name"]: r for r in crops.rank_rotations(profile, [4, 3, 2, 3], crops.DEFAULT_ROTATIONS, suit)}
    assert ranked["Forage and oilseed"]["viability"] == 0.6
    assert ranked["Forage and oilseed"]["score"] < ranked["Legume break"]["score"]
