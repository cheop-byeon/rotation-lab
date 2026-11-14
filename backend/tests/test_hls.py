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
