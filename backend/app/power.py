"""NASA POWER client with a SQLite cache and an offline snapshot fallback.

NASA POWER (Prediction Of Worldwide Energy Resources) serves gridded daily
meteorology (MERRA-2 / GEOS) and solar data (CERES / GEOS) for any point on
Earth. Docs: https://power.larc.nasa.gov/docs/services/api/
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

from .db import connect

DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
CLIMATOLOGY_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"

# Parameters requested from the Agroclimatology (AG) community.
DAILY_PARAMS = {
    "T2M": ("Air temperature at 2 m", "°C"),
    "T2M_MAX": ("Max air temperature at 2 m", "°C"),
    "T2M_MIN": ("Min air temperature at 2 m", "°C"),
    "PRECTOTCORR": ("Precipitation (bias-corrected)", "mm/day"),
    "RH2M": ("Relative humidity at 2 m", "%"),
    "ALLSKY_SFC_SW_DWN": ("All-sky surface shortwave irradiance", "MJ/m²/day"),
    "GWETROOT": ("Root-zone soil wetness", "0–1"),
    "GWETTOP": ("Surface soil wetness", "0–1"),
    "WS2M": ("Wind speed at 2 m", "m/s"),
}
CLIMATOLOGY_PARAMS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

HISTORY_YEARS = 10
CACHE_TTL_SECONDS = 12 * 3600
SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "data" / "snapshots"


class PowerUnavailable(RuntimeError):
    pass


@dataclass
class DailySeries:
    lat: float
    lon: float
    elevation: float | None
    dates: list[date]
    values: dict[str, list[float | None]]
    retrieved_at: str
    source: str  # "live", "cache", "stale-cache" or "snapshot"
    request_url: str
    missing: dict[str, int] = field(default_factory=dict)

    def last_valid_date(self, param: str = "T2M") -> date | None:
        for d, v in zip(reversed(self.dates), reversed(self.values[param])):
            if v is not None:
                return d
        return None


def _key(kind: str, lat: float, lon: float) -> str:
    # POWER's meteorology grid is 0.5° × 0.625°, so 2 decimals is plenty for a cache key.
    return f"{kind}:{lat:.2f}:{lon:.2f}"


def _cache_get(key: str) -> tuple[float, dict] | None:
    with connect() as con:
        row = con.execute("SELECT fetched_at, payload FROM power_cache WHERE key = ?", (key,)).fetchone()
    return (row[0], json.loads(row[1])) if row else None


def _cache_put(key: str, payload: dict) -> None:
    with connect() as con:
        con.execute(
            "INSERT OR REPLACE INTO power_cache(key, fetched_at, payload) VALUES (?, ?, ?)",
            (key, time.time(), json.dumps(payload)),
        )


def _snapshot(key: str) -> dict | None:
    path = SNAPSHOT_DIR / (key.replace(":", "_") + ".json")
    return json.loads(path.read_text()) if path.exists() else None


async def _get_json(url: str, params: dict) -> dict:
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        for attempt in range(3):
            try:
                r = await client.get(url, params=params)
                if r.status_code == 200:
                    return r.json()
                last_error = PowerUnavailable(f"NASA POWER HTTP {r.status_code}: {r.text[:200]}")
                if r.status_code < 500 and r.status_code != 429:
                    break
            except httpx.HTTPError as exc:
                last_error = exc
            await _sleep(1.5 * (attempt + 1))
    raise PowerUnavailable(str(last_error))


async def _sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


async def _cached(kind: str, lat: float, lon: float, url: str, params: dict) -> tuple[dict, str, float]:
    key = _key(kind, lat, lon)
    hit = _cache_get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1], "cache", hit[0]
    try:
        payload = await _get_json(url, params)
        _cache_put(key, payload)
        return payload, "live", time.time()
    except PowerUnavailable:
        if hit:
            return hit[1], "stale-cache", hit[0]
        snap = _snapshot(key)
        if snap:
            return snap["payload"], "snapshot", snap["fetched_at"]
        raise


def daily_request(lat: float, lon: float, today: date | None = None) -> tuple[str, dict]:
    today = today or date.today()
    params = {
        "parameters": ",".join(DAILY_PARAMS),
        "community": "AG",
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start": f"{today.year - HISTORY_YEARS}0101",
        "end": today.strftime("%Y%m%d"),
        "format": "JSON",
        "time-standard": "UTC",
    }
    return DAILY_URL, params


async def fetch_daily(lat: float, lon: float) -> DailySeries:
    url, params = daily_request(lat, lon)
    payload, source, fetched_at = await _cached("daily", lat, lon, url, params)
    return parse_daily(payload, lat, lon, source, fetched_at, str(httpx.URL(url, params=params)))


def parse_daily(payload: dict, lat: float, lon: float, source: str, fetched_at: float, request_url: str) -> DailySeries:
    data = payload.get("properties", {}).get("parameter", {})
    fill = payload.get("header", {}).get("fill_value", -999.0)
    coords = payload.get("geometry", {}).get("coordinates", [lon, lat, None])
    if "T2M" not in data:
        raise PowerUnavailable(f"Unexpected NASA POWER payload: {list(payload)[:5]}")
    keys = sorted(data["T2M"])
    dates = [datetime.strptime(k, "%Y%m%d").date() for k in keys]

    def clean(v):
        return None if v is None or v == fill or v <= -99 else float(v)

    values = {p: [clean(data.get(p, {}).get(k)) for k in keys] for p in DAILY_PARAMS}
    # Trailing fills are the normal near-real-time latency, not gaps; count interior gaps only.
    missing = {}
    for p, series in values.items():
        last = max((i for i, v in enumerate(series) if v is not None), default=-1)
        missing[p] = sum(1 for v in series[: last + 1] if v is None)
    return DailySeries(
        lat=lat,
        lon=lon,
        elevation=coords[2] if len(coords) > 2 else None,
        dates=dates,
        values=values,
        retrieved_at=datetime.fromtimestamp(fetched_at, tz=timezone.utc).isoformat(timespec="seconds"),
        source=source,
        request_url=request_url,
        missing=missing,
    )


async def fetch_climatology(lat: float, lon: float) -> dict:
    """Monthly long-term means (2001–2020) from the POWER climatology service."""
    params = {
        "parameters": ",".join(CLIMATOLOGY_PARAMS),
        "community": "AG",
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "format": "JSON",
    }
    payload, source, _ = await _cached("clim", lat, lon, CLIMATOLOGY_URL, params)
    data = payload["properties"]["parameter"]
    header = payload.get("header", {})
    return {
        "source": source,
        "period": f"{header.get('start', '2001')}–{header.get('end', '2020')}",
        "monthly": {p: [data[p].get(m) for m in MONTHS] for p in CLIMATOLOGY_PARAMS if p in data},
        "annual": {p: data[p].get("ANN") for p in CLIMATOLOGY_PARAMS if p in data},
    }


def save_snapshot(kind: str, lat: float, lon: float) -> Path | None:
    """Copy a cached response into data/snapshots so demos work offline."""
    key = _key(kind, lat, lon)
    hit = _cache_get(key)
    if not hit:
        return None
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOT_DIR / (key.replace(":", "_") + ".json")
    path.write_text(json.dumps({"fetched_at": hit[0], "payload": hit[1]}))
    return path
