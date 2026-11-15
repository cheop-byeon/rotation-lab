"""Build data/areas/: what farms in each Norwegian municipality reported growing, 2017–2026, plus where the farms are.

Sources (all open):
- Landbruksdirektoratet, production-subsidy applications per farm and year (NLOD):
  https://github.com/LandbruksdirektoratetGIT/opendata (datasets/produksjon-og-avlosertilskudd/<year>)
- Landbruksdirektoratet, farm register with the farm centre's coordinates (datasets/foretak)
- SSB KLASS 131, municipality changes, to count every year under today's municipalities
- Kartverket kommuneinfo, today's municipality names

Writes data/areas/index.json (one row per municipality) and data/areas/<kommunenummer>.json (crop areas per year and
farm dots). Farm names and organisation numbers are left out: the app shows areas and totals, not who grew what.

    .venv/bin/python scripts/build_areas.py
"""
import csv
import io
import json
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

from rasterio.warp import transform

YEARS = list(range(2017, 2027))
GH = "https://raw.githubusercontent.com/LandbruksdirektoratetGIT/opendata/main/datasets"
OUT = Path(__file__).resolve().parents[1] / "data" / "areas"

# Crop groups shown in the app (daa). Pasture (innmarksbeite) is not ploughed and is kept apart from arable land.
GROUPS = {
    "Grass and forage": ["p210", "p211", "p213"],
    "Barley": ["p242"], "Oats": ["p243"], "Wheat": ["p240", "p247"],
    "Other cereals": ["p231", "p238", "p239"],
    "Potatoes and vegetables": ["p230", "p264"],
    "Oilseeds, peas and beans": ["p236", "p237", "p245"],
    "Other": ["p223", "p235", "p290", "p272", "p271", "p273", "p274", "p280", "p282", "p283", "p285"],
    "Pasture": ["p212"],
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def rows(url: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(get(url).decode("utf-8", errors="replace")), delimiter=";"))


def num(v) -> float:
    try:
        return float((v or "0").replace(",", "."))
    except ValueError:
        return 0.0


def main() -> None:
    names = {k["kommunenummer"]: k["kommunenavnNorsk"] for k in json.loads(get("https://ws.geonorge.no/kommuneinfo/v1/kommuner"))}
    changes = json.loads(get("https://data.ssb.no/api/klass/v1/classifications/131/changes?from=2017-01-01&to=2026-12-31"))["codeChanges"]
    nxt = defaultdict(set)
    for c in changes:
        if c["oldCode"] != c["newCode"]:
            nxt[c["oldCode"]].add(c["newCode"])

    def current(code: str) -> str | None:
        """Follow municipality changes to today's code; None when it was split (ambiguous) or is unknown."""
        seen = 0
        while code not in names and seen < 6:
            if len(nxt.get(code, ())) != 1:
                return None
            code = next(iter(nxt[code]))
            seen += 1
        return code if code in names else None

    farm_rows = defaultdict(dict)   # orgnr -> year -> {group: daa}
    latest_code = {}
    for y in YEARS:
        for r in rows(f"{GH}/produksjon-og-avlosertilskudd/{y}/dataset.csv"):
            g = {name: sum(num(r.get(c)) for c in codes) for name, codes in GROUPS.items()}
            g = {k: v for k, v in g.items() if v > 0}
            if g:
                farm_rows[r["orgnr"]][y] = g
                latest_code[r["orgnr"]] = r["kommunenr"].zfill(4)  # older files drop the leading zero
        print(y, "read", file=sys.stderr)

    # A farm is counted in the municipality its latest application names (mapped to today's code), in every year.
    areas = defaultdict(lambda: {y: defaultdict(float) for y in YEARS})
    farms_n = defaultdict(lambda: defaultdict(int))
    home = {}
    dropped = 0
    for org, years in farm_rows.items():
        code = current(latest_code[org])
        if code is None:
            dropped += 1
            continue
        home[org] = code
        for y, g in years.items():
            farms_n[code][y] += 1
            for k, v in g.items():
                areas[code][y][k] += v

    # Farm centres (driftssenter) for the map, coloured by the main crop group in the farm's latest year.
    dots = defaultdict(list)
    for r in rows(f"{GH}/foretak/dataset.csv"):
        org = r["ORGNR"].strip('"')
        code = home.get(org)
        if not code or r["NORD"] in ("", "0") or org not in farm_rows:
            continue
        last = max(farm_rows[org])
        g = farm_rows[org][last]
        arable = {k: v for k, v in g.items() if k != "Pasture"}
        try:
            lon, lat = transform(f"EPSG:{r['KOORDSYS']}", "EPSG:4326", [float(r["OST"])], [float(r["NORD"])])
        except Exception:  # a few register coordinates are malformed
            continue
        if not (57.5 < lat[0] < 71.5 and 4 < lon[0] < 32):
            continue
        dots[code].append([round(lat[0], 4), round(lon[0], 4), round(sum(arable.values())),
                           max(arable, key=arable.get) if arable else "Pasture", last])

    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for code, name in sorted(names.items()):
        if code not in areas:
            continue
        d = dots.get(code, [])
        centre = [round(sum(p[0] for p in d) / len(d), 4), round(sum(p[1] for p in d) / len(d), 4)] if d else None
        last = max(y for y in YEARS if farms_n[code].get(y))
        arable_last = round(sum(v for k, v in areas[code][last].items() if k != "Pasture"))
        index.append({"code": code, "name": name, "farms": farms_n[code][last], "arable_daa": arable_last, "centre": centre})
        (OUT / f"{code}.json").write_text(json.dumps({
            "code": code, "name": name, "centre": centre,
            "years": [{"year": y, "farms": farms_n[code].get(y, 0), "areas": {k: round(v) for k, v in areas[code][y].items()}}
                      for y in YEARS],
            "dots": d,
        }, ensure_ascii=False, separators=(",", ":")))
    (OUT / "index.json").write_text(json.dumps({
        "source": "Landbruksdirektoratet, production-subsidy applications and farm register (open data, NLOD); "
                  "SSB KLASS municipality changes; Kartverket municipality names",
        "url": "https://github.com/LandbruksdirektoratetGIT/opendata", "years": YEARS, "unit": "daa",
        "groups": list(GROUPS), "areas": index}, ensure_ascii=False, separators=(",", ":")))
    total = sum(f.stat().st_size for f in OUT.glob("*.json"))
    print(f"{len(index)} municipalities, {sum(len(v) for v in dots.values())} farm dots, {dropped} farms in split "
          f"municipalities left out -> {OUT} ({total / 1e6:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
