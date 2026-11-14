"""HLS helpers and the fields/vegetation API. Synthetic observations are used here only."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import hls
from app.main import app


def square(lat, lon, dlat=0.0009, dlon=0.0025):
    return {"type": "Polygon", "coordinates": [[[lon - dlon, lat - dlat], [lon + dlon, lat - dlat],
                                                [lon + dlon, lat + dlat], [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]]]}


def test_area_of_known_square():
    # 0.0009° lat x 0.0025° lon at 63.46° N is about 199 m x 249 m = 4.95 ha
    assert hls.area_ha(square(63.4647, 10.9637)) == pytest.approx(4.95, abs=0.1)


def test_boundary_validation():
    assert hls.validate_boundary(square(63.46, 10.96)) is None
    bowtie = {"type": "Polygon", "coordinates": [[[0, 60], [0.01, 60.01], [0, 60.01], [0.01, 60], [0, 60]]]}
    assert "crosses itself" in hls.validate_boundary(bowtie)
    assert "too small" in hls.validate_boundary(square(60, 10, 0.0001, 0.0002))
    assert "Polygon" in hls.validate_boundary({"type": "Point", "coordinates": [10, 60]})


def test_fmask_clear_bits():
    fm = np.array([0, 2, 4, 8, 16, 32, 64, 255], dtype=np.uint8)  # clear, cloud, adjacent, shadow, snow, water, aerosol, fill
    assert hls._clear(fm).tolist() == [True, False, False, False, False, False, True, False]


def test_seasons_follow_hemisphere():
    from datetime import date
    assert hls.season_of(date(2025, 8, 1), 63) == (2025, "2025")
    assert hls.season_of(date(2025, 8, 1), -34) == (2026, "2025/26")
    assert hls.in_growing_months(date(2025, 1, 15), -34) and not hls.in_growing_months(date(2025, 1, 15), 63)


def obs(d, v):
    return {"date": d, "ndvi": v, "ndmi": v - 0.3}


def test_summary_greenup_and_cloud_gap():
    s = hls.summarise_season([obs("2025-05-01", .15), obs("2025-06-01", .3), obs("2025-06-12", .7), obs("2025-07-15", .9)])
    assert s["peak_ndvi"] == .9 and s["greenup_date"] == "2025-06-12" and not s["greenup_cloud_gap"]
    gap = hls.summarise_season([obs("2025-05-01", .15), obs("2025-05-10", .16), obs("2025-07-06", .92)])
    assert gap["greenup_date"] is None and gap["greenup_cloud_gap"]


def test_fields_api_round_trips_boundary_and_rejects_bad_ones():
    with TestClient(app) as cl:
        body = {"name": "Test", "lat": 63.4647, "lon": 10.9637, "boundary": square(63.4647, 10.9637)}
        r = cl.post("/api/fields", json=body)
        assert r.status_code == 201 and r.json()["boundary"]["type"] == "Polygon"
        bad = {**body, "boundary": {"type": "Polygon", "coordinates": [[[0, 60], [0.01, 60.01], [0, 60.01], [0.01, 60], [0, 60]]]}}
        assert cl.post("/api/fields", json=bad).status_code == 422
        assert cl.post("/api/vegetation", json={"boundary": bad["boundary"]}).status_code == 422
        cl.delete(f"/api/fields/{r.json()['id']}")


def curve(points):
    return [{"date": d, "ndvi": v, "ndmi": v - 0.3} for d, v in points]


SPRING = [("2025-04-20", .18), ("2025-05-10", .17), ("2025-05-20", .2), ("2025-06-10", .5), ("2025-07-10", .9), ("2025-08-20", .4), ("2025-09-20", .3), ("2025-10-10", .3)]
GRASS = [("2025-04-20", .55), ("2025-05-15", .75), ("2025-06-10", .85), ("2025-07-01", .5), ("2025-07-25", .8), ("2025-09-20", .6), ("2025-10-10", .55)]
WINTER = [("2025-04-20", .6), ("2025-05-15", .8), ("2025-06-20", .88), ("2025-08-01", .4), ("2025-09-20", .25), ("2025-10-10", .22)]
LATE = [("2025-04-20", .15), ("2025-05-15", .18), ("2025-06-20", .3), ("2025-07-20", .6), ("2025-08-15", .85), ("2025-09-20", .5), ("2025-10-10", .3)]


@pytest.mark.parametrize("pts,kind", [(SPRING, "spring_crop"), (GRASS, "grass"), (WINTER, "winter_crop"), (LATE, "late_crop")])
def test_crop_hints(pts, kind):
    assert hls.crop_hint(curve(pts), 63)["type"] == kind


def test_crop_hint_honest_when_unsure():
    assert hls.crop_hint(curve(SPRING[:3]), 63)["type"] == "unknown"     # too few images
    assert hls.crop_hint(curve(SPRING), -0.3)["type"] == "unavailable"   # tropics
    south = [("2025-" + d[5:].replace("04-", "10-").replace("05-", "11-").replace("06-", "12-"), v) for d, v in SPRING[:4]]
    assert hls.crop_hint(curve(south + [("2026-01-10", .9), ("2026-02-20", .4), ("2026-03-20", .3), ("2026-04-10", .3)]), -34)["type"] == "spring_crop"


def test_demo_field_works_offline_from_snapshots(monkeypatch):
    """A fresh install with no internet still shows the demo field's weather and satellite record."""
    from app import power
    from app.db import DEMO_FIELD
    monkeypatch.setattr(power, "DAILY_URL", "https://power.invalid/api")
    monkeypatch.setattr(power, "CLIMATOLOGY_URL", "https://power.invalid/api")
    monkeypatch.setattr(hls, "STAC_SEARCH", "https://stac.invalid/search")
    with TestClient(app) as cl:
        a = cl.get("/api/analysis", params={"lat": DEMO_FIELD["lat"], "lon": DEMO_FIELD["lon"]})
        assert a.status_code == 200 and a.json()["provenance"]["delivery"] in ("snapshot", "stale-cache", "cache")
        v = cl.post("/api/vegetation", json={"boundary": DEMO_FIELD["boundary"]})
        assert v.status_code == 200 and v.json()["delivery"] in ("snapshot", "offline-cache")
        assert v.json()["stats"]["clear_images"] > 50
