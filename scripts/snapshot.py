"""Fetch NASA POWER data for demo locations and store dated copies in data/snapshots.

The API falls back to these snapshots when NASA POWER is unreachable, so the
demo keeps working offline.   Usage:  .venv/bin/python scripts/snapshot.py [lat lon ...]
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import power  # noqa: E402
from app.db import init_db  # noqa: E402

DEMO = [(63.46, 10.92)]  # Stjørdal, Norway


async def main(points):
    init_db()
    for lat, lon in points:
        await power.fetch_daily(lat, lon)
        await power.fetch_climatology(lat, lon)
        for kind in ("daily", "clim"):
            print("saved", power.save_snapshot(kind, lat, lon))


if __name__ == "__main__":
    args = [float(a) for a in sys.argv[1:]]
    asyncio.run(main(list(zip(args[::2], args[1::2])) or DEMO))
