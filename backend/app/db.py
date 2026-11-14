"""SQLite storage for the NASA POWER cache and saved farm fields."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("ROTATION_LAB_DB", Path(__file__).resolve().parents[2] / "data" / "rotation_lab.db"))

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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)
        if con.execute("SELECT COUNT(*) FROM fields").fetchone()[0] == 0:
            con.execute(
                "INSERT INTO fields(name, lat, lon, soil, drainage, irrigation, previous_crop, notes) "
                "VALUES (?,?,?,?,?,?,?,?)",
                ("Stjørdal 01", 63.46, 10.92, "Loamy", "Moderate", "No", "Barley", "Demo field, Trøndelag, Norway"),
            )


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()
