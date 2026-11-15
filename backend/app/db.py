"""SQLite storage for the NASA POWER cache and saved farm fields."""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# On Vercel (and other serverless hosts) the code folder is read-only: keep the database in /tmp. It is a per-instance
# cache there, so saved fields do not persist between cold starts; the demo fields are recreated on every start.
SERVERLESS = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
_default_db = Path("/tmp/rotation_lab.db") if SERVERLESS else Path(__file__).resolve().parents[2] / "data" / "rotation_lab.db"
DB_PATH = Path(os.environ.get("ROTATION_LAB_DB", _default_db))

# Demo field: a real arable field near Stjørdal (Trøndelag, Norway), filled from public records only:
# - outline: the property parcel from Kartverket's open property service (it follows the field's edges);
# - soil: "Loamy", the ISRIC SoilGrids estimate for the location (loam, ~52% sand, 10% clay; a 250 m model);
# - crops: not stored here; /api/farm-crops reads what the farm based on this property reported to
#   Landbruksdirektoratet (one crop on all its arable land every year 2017–2026, so also this field's crop);
# - drainage and irrigation: no public source reached, so left unknown rather than invented.
# The farm is not named in the app.
DEMO_FIELD = {
    "name": "Stjørdal 01", "lat": 63.4806, "lon": 10.8756, "soil": "Loamy", "drainage": "Unknown", "irrigation": "Unknown",
    "previous_crop": "Grass–clover ley",
    "notes": "Demo field, Trøndelag, Norway. Real field from public records: outline from Kartverket, soil estimated by "
             "SoilGrids, crops as reported by its farm to Landbruksdirektoratet. Drainage and irrigation not known.",
    "boundary": {"type": "Polygon", "coordinates": [[[10.876296, 63.480376], [10.876188, 63.480341], [10.875655, 63.48018], [10.875261, 63.480043], [10.874719, 63.479882], [10.873836, 63.479605], [10.873578, 63.47952], [10.873542, 63.479536], [10.873382, 63.479607], [10.872323, 63.480731], [10.875705, 63.48146], [10.875844, 63.481404], [10.875954, 63.481358], [10.876041, 63.481318], [10.876115, 63.481271], [10.876181, 63.481228], [10.876247, 63.481174], [10.876296, 63.481105], [10.876327, 63.481028], [10.876358, 63.480947], [10.876368, 63.480854], [10.876369, 63.480766], [10.876364, 63.480674], [10.876344, 63.480575], [10.876303, 63.480488], [10.87628, 63.480416], [10.8763, 63.480377], [10.876296, 63.480376]]]},
}
DEMO_FIELDS = [DEMO_FIELD]
RETIRED_DEMOS = ("Orosháza 01",)  # demo fields removed from the app; dropped from existing databases

SCHEMA = """
CREATE TABLE IF NOT EXISTS power_cache (
    key TEXT PRIMARY KEY,
    fetched_at REAL NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    soil TEXT NOT NULL DEFAULT 'Unknown',
    drainage TEXT NOT NULL DEFAULT 'Unknown',
    irrigation TEXT NOT NULL DEFAULT 'Unknown',
    previous_crop TEXT NOT NULL DEFAULT 'Barley',
    notes TEXT NOT NULL DEFAULT '',
    demo INTEGER NOT NULL DEFAULT 0,
    boundary TEXT,
    reported_crops TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hls_cache (
    key TEXT PRIMARY KEY,
    fetched_at REAL NOT NULL,
    payload TEXT NOT NULL
);
"""


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)
        cols = {r[1] for r in con.execute("PRAGMA table_info(fields)")}
        if "demo" not in cols:  # migrate databases created before the demo flag existed
            con.execute("ALTER TABLE fields ADD COLUMN demo INTEGER NOT NULL DEFAULT 0")
            con.execute("UPDATE fields SET demo = 1 WHERE notes LIKE 'Demo field%'")
        if "boundary" not in cols:  # migrate: optional GeoJSON field outline
            con.execute("ALTER TABLE fields ADD COLUMN boundary TEXT")
        if "reported_crops" not in cols:  # migrate: crops reported for the field, year by year (JSON)
            con.execute("ALTER TABLE fields ADD COLUMN reported_crops TEXT")
        con.executemany("DELETE FROM fields WHERE demo = 1 AND name = ?", [(n,) for n in RETIRED_DEMOS])
        for d in DEMO_FIELDS:
            values = (d["lat"], d["lon"], d["soil"], d["drainage"], d["irrigation"], d["previous_crop"], d["notes"],
                      json.dumps(d["boundary"]), None, d["name"])
            # An untouched demo field (editing clears the demo flag) always follows the current definition.
            if not con.execute("UPDATE fields SET lat=?, lon=?, soil=?, drainage=?, irrigation=?, previous_crop=?, notes=?, "
                               "boundary=?, reported_crops=? WHERE demo = 1 AND name = ?", values).rowcount:
                con.execute("INSERT INTO fields(lat, lon, soil, drainage, irrigation, previous_crop, notes, boundary, "
                            "reported_crops, name, demo) VALUES (?,?,?,?,?,?,?,?,?,?,1)", values)


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()
