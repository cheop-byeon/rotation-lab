"""Save dated copies of NASA data to data/snapshots so the demo works without internet.

With no arguments: the demo fields (NASA POWER weather, NASA HLS satellite record for its outline, SoilGrids soil and
the Kartverket property lookup for its reported crops).
With "lat lon" pairs: NASA POWER weather for those points.

    .venv/bin/python scripts/snapshot.py
    .venv/bin/python scripts/snapshot.py 63.46 10.92 -33.89 -60.57

The API falls back to these copies when NASA POWER or the HLS catalogue cannot be reached.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import hls, neighbourhood, power, publicdata  # noqa: E402
from app.db import DEMO_FIELDS, init_db  # noqa: E402


async def weather(lat, lon):
    await power.fetch_daily(lat, lon)
    await power.fetch_climatology(lat, lon)
    for kind in (power.DAILY_KIND, "clim"):
        print("saved", power.save_snapshot(kind, lat, lon))


def main(points):
    init_db()
    if points:
        for lat, lon in points:
            asyncio.run(weather(lat, lon))
        return
    for f in DEMO_FIELDS:
        lat, lon = hls.centroid(f["boundary"])
        asyncio.run(weather(lat, lon))
        record = hls.field_record(f["boundary"], seasons=None)
        print(f"{f['name']} HLS: {record['stats']['images_found']} images, {record['stats']['clear_images']} clear ({record['delivery']})")
        zones = hls.field_zones(f["boundary"], seasons=hls.ZONE_SEASONS)  # the same seasons the views ask for
        print(f"{f['name']} zones: {zones.get('status')} ({zones.get('delivery')})")
        print("saved", hls.save_snapshot(f["boundary"], zones))
        nb = neighbourhood.neighbourhood(f["boundary"])
        print(f"{f['name']} area around: {nb.get('farmland_ha')} ha farmland ({nb.get('delivery')})")
        print("saved", neighbourhood.save_snapshot(f["boundary"]))
        print(f"{f['name']} soil: {asyncio.run(publicdata.soil(f['lat'], f['lon'])).get('soil')}")
        print("saved", publicdata.save_snapshot(publicdata.soil_key(f["lat"], f["lon"])))
        print(f"{f['name']} farm crops: {asyncio.run(publicdata.farm_crops(f['lat'], f['lon']))['status']}")
        print("saved", publicdata.save_snapshot(publicdata.property_key(f["lat"], f["lon"])))
    # the example farm (Find my farm → 81/5 in Stjørdal): its property outlines
    print(f"example farm: {asyncio.run(publicdata.farm('5035', 81, 5))['status']}")
    print("saved", publicdata.save_snapshot("teig:5035-81-5-0"))


if __name__ == "__main__":
    args = [float(a) for a in sys.argv[1:]]
    main(list(zip(args[::2], args[1::2])))
