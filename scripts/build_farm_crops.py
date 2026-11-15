"""Build data/farm_crops.json.gz: the crops every Norwegian farm reported, year by year, keyed by the property it is based on.

Source: Landbruksdirektoratet, "Produksjons- og avløsertilskudd til jordbruksforetak" (production-subsidy applications),
open data under NLOD: https://github.com/LandbruksdirektoratetGIT/opendata (datasets/produksjon-og-avlosertilskudd/<year>).

The applications are per farm, not per field. Each farm is filed under the property (kommunenr-gårdsnr-bruksnr) its
latest application names as its base, because municipal mergers renumber properties. Farm names and organisation
numbers are left out: the app shows crop areas, not who grew them.

    .venv/bin/python scripts/build_farm_crops.py
"""
import csv
import gzip
import io
import json
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

YEARS = range(2017, 2027)
URL = "https://raw.githubusercontent.com/LandbruksdirektoratetGIT/opendata/main/datasets/produksjon-og-avlosertilskudd/{y}/dataset.csv"
OUT = Path(__file__).resolve().parents[1] / "data" / "farm_crops.json.gz"

# Area codes (daa) and the crop names the app uses. Fully and surface-cultivated grass are both grass leys.
CROPS = {
    "p210": "Grass ley", "p211": "Grass ley", "p212": "Pasture", "p213": "Other fodder", "p230": "Potato",
    "p231": "Other cereal", "p235": "Seed crops", "p236": "Peas and beans", "p237": "Oilseed", "p238": "Rye",
    "p239": "Cereal for crushing", "p240": "Spring wheat", "p242": "Barley", "p243": "Oats", "p247": "Winter wheat",
    "p223": "Green manure", "p264": "Vegetables", "p290": "Fallow",
}


def read(year: int) -> list[dict]:
    with urllib.request.urlopen(URL.format(y=year), timeout=120) as r:
        return list(csv.DictReader(io.TextIOWrapper(r, encoding="utf-8", errors="replace"), delimiter=";"))


def main() -> None:
    history, base = defaultdict(dict), {}
    for y in YEARS:
        rows = read(y)
        for r in rows:
            areas = {}
            for code, name in CROPS.items():
                v = float((r.get(code) or "0").replace(",", ".") or 0)
                if v > 0:
                    areas[name] = areas.get(name, 0) + v
            if not areas:
                continue
            history[r["orgnr"]][str(y)] = {k: round(v) for k, v in areas.items() if round(v) > 0}
            base[r["orgnr"]] = f'{r["kommunenr"].zfill(4)}-{r["gaardsnummer"]}-{r["bruksnummer"]}'
        print(y, len(rows), "applications", file=sys.stderr)
    by_property = defaultdict(list)
    for org, years in history.items():
        by_property[base[org]].append(years)
    out = {"source": "Landbruksdirektoratet, production-subsidy applications (open data, NLOD)",
           "url": "https://github.com/LandbruksdirektoratetGIT/opendata", "years": [str(y) for y in YEARS],
           "unit": "daa", "properties": by_property}
    OUT.write_bytes(gzip.compress(json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()))
    print(f"{len(history)} farms on {len(by_property)} properties -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
