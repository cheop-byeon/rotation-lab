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

# Illustrative demo field: a real grass field east of Stjørdal (Trøndelag, Norway), outlined on imagery.
# Location and outline are real; soil, drainage, irrigation and crop are made-up example values.
DEMO_FIELD = {
    "name": "Stjørdal 01", "lat": 63.4695, "lon": 10.9679, "soil": "Loamy", "drainage": "Moderate", "irrigation": "No",
    "previous_crop": "Grass–clover ley",
    "notes": "Demo field, Trøndelag, Norway. Real location and outline; illustrative farm details, not a real farm.",
    "boundary": {"type": "Polygon", "coordinates": [[[10.966523, 63.470528], [10.970857, 63.470241], [10.970213, 63.467998],
                                                      [10.965836, 63.468956], [10.965965, 63.469551], [10.966523, 63.470528]]]},
}

# Second demo field: rainfed arable land near Orosháza (Békés county, Hungary). The outline is a rectangle drawn
# inside a real field on Esri imagery; farm details are illustrative. It shows the season check catching the
# 2022 drought from NASA data alone.
DEMO_FIELD_HU = {
    "name": "Orosháza 01", "lat": 46.6045, "lon": 20.6571, "soil": "Loamy", "drainage": "Good", "irrigation": "No",
    "previous_crop": "Barley",
    "notes": "Demo field, Békés county, Hungary. Real location; outline drawn inside a real field; illustrative farm details, not a real farm.",
    "boundary": {"type": "Polygon", "coordinates": [[[20.655155, 46.605582], [20.659125, 46.605582], [20.659125, 46.603371],
                                                      [20.655155, 46.603371], [20.655155, 46.605582]]]},
}
DEMO_FIELDS = [DEMO_FIELD, DEMO_FIELD_HU]

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
        d = DEMO_FIELD
        values = (d["name"], d["lat"], d["lon"], d["soil"], d["drainage"], d["irrigation"], d["previous_crop"],
                  d["notes"], json.dumps(d["boundary"]))
        if con.execute("SELECT COUNT(*) FROM fields").fetchone()[0] == 0:
            con.execute("INSERT INTO fields(name, lat, lon, soil, drainage, irrigation, previous_crop, notes, boundary, demo) "
                        "VALUES (?,?,?,?,?,?,?,?,?,1)", values)
        else:
            # Move an untouched older demo field (the point on Værnes airport) to the outlined grass field.
            con.execute("UPDATE fields SET name=?, lat=?, lon=?, soil=?, drainage=?, irrigation=?, previous_crop=?, notes=?, boundary=? "
                        "WHERE demo = 1 AND boundary IS NULL AND lat = 63.46 AND lon = 10.92", values)
        # Later demo fields are added once to existing databases too.
        for d in DEMO_FIELDS[1:]:
            if not con.execute("SELECT 1 FROM fields WHERE demo = 1 AND name = ?", (d["name"],)).fetchone():
                con.execute("INSERT INTO fields(name, lat, lon, soil, drainage, irrigation, previous_crop, notes, boundary, demo) "
                            "VALUES (?,?,?,?,?,?,?,?,?,1)", (d["name"], d["lat"], d["lon"], d["soil"], d["drainage"], d["irrigation"],
                                                              d["previous_crop"], d["notes"], json.dumps(d["boundary"])))


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()
