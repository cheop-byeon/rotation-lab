"""Save dated copies of NASA data to data/snapshots so the demo works without internet.

With no arguments: the demo field (NASA POWER weather + NASA HLS satellite record for its outline).
With "lat lon" pairs: NASA POWER weather for those points.

    .venv/bin/python scripts/snapshot.py
    .venv/bin/python scripts/snapshot.py 63.46 10.92 -33.89 -60.57

The API falls back to these copies when NASA POWER or the HLS catalogue cannot be reached.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import hls, power  # noqa: E402
from app.db import DEMO_FIELD, init_db  # noqa: E402


async def weather(lat, lon):
    await power.fetch_daily(lat, lon)
    await power.fetch_climatology(lat, lon)
    for kind in ("daily", "clim"):
        print("saved", power.save_snapshot(kind, lat, lon))


def main(points):
    init_db()
    if points:
        for lat, lon in points:
            asyncio.run(weather(lat, lon))
        return
    asyncio.run(weather(DEMO_FIELD["lat"], DEMO_FIELD["lon"]))
    record = hls.field_record(DEMO_FIELD["boundary"], seasons=None)
    print(f"HLS: {record['stats']['images_found']} images, {record['stats']['clear_images']} clear ({record['delivery']})")
    print("saved", hls.save_snapshot(DEMO_FIELD["boundary"]))


if __name__ == "__main__":
    args = [float(a) for a in sys.argv[1:]]
    main(list(zip(args[::2], args[1::2])))
