"""Convert a regional GIBDD camera table (.xlsx) into assets/cameras.json.

Usage:
    python -I scripts/convert_xlsx.py <table.xlsx> [more.xlsx ...] [-o assets/cameras.json]

Expected columns (as published on госавтоинспекция.рф, e.g. Stavropol region):
    0 №, 1 Тип ТСАФ, 2 Адрес, 3 Км, 4 Широта, 5 Долгота,
    6 Контролируемые условия (Встречное/Попутное/Перекресток), 7 Режим, 8 Нарушения
"""

import argparse
import json
import re
import sys
from pathlib import Path

import openpyxl

# Keyword -> tag. Checked against the lower-cased violations text.
TAGS = [
    ("speed", ("10.2", "10.3", "3.24", "скорост")),
    ("redlight", ("6.2", "6.13", "запрещающ", "светофор")),
    ("crossing", ("15.3", "переезд")),
    ("lane", ("18.2", "маршрутн")),
    ("shoulder", ("9.9", "обочин")),
    ("parking", ("3.27", "3.28", "стоянк")),
    ("pedestrian", ("14.1", "пешеход")),
    ("oncoming_lane", ("9.1.1", "встречн")),
]


def clean(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_coord(value):
    try:
        return float(str(value).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None


def parse_direction(text):
    t = text.lower()
    if "перекр" in t:
        return "intersection"
    oncoming, same = "встреч" in t, "попут" in t
    if oncoming and same:
        return "both"
    if oncoming:
        return "oncoming"
    if same:
        return "same"
    return "unknown"


def parse_tags(text):
    t = text.lower()
    return [tag for tag, keys in TAGS if any(k in t for k in keys)]


# The violations column quotes traffic rules rather than stating the limit, but the
# quoted rule tells us which limit applies:
#   п. 10.2 - inside a settlement, no sign       -> 60 km/h
#   п. 10.3 - outside a settlement, no sign      -> 90 km/h (passenger cars)
#   знак 3.24 - limit set by a sign; the number is not in the table -> unknown
RULE_10_2 = re.compile(r"(?<![\d.])10\.2(?![\d])")
RULE_10_3 = re.compile(r"(?<![\d.])10\.3(?![\d])")
SIGN_3_24 = re.compile(r"(?<![\d.])3\.24(?![\d])")


def parse_speed_limit(text):
    """Return (limit_kmh or None, by_sign)."""
    if SIGN_3_24.search(text):
        return None, True
    if RULE_10_2.search(text):
        return 60, False
    if RULE_10_3.search(text):
        return 90, False
    return None, False


def is_data_row(row):
    return isinstance(row[0], (int, float)) and len(row) > 8


def convert(path, region):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    cameras, skipped = [], []
    for row in ws.iter_rows(values_only=True):
        if not row or not is_data_row(row):
            continue
        num = int(row[0])
        # Column-number header row is "1, 2, 3, ..." - skip it.
        if num == 1 and row[1] == 2:
            continue
        lat, lon = parse_coord(row[4]), parse_coord(row[5])
        if lat is None or lon is None or not (40 < lat < 82 and 19 < lon < 191):
            skipped.append(num)
            continue
        kind = clean(row[1]).lower()
        violations = clean(row[8])
        speed_limit, limit_by_sign = parse_speed_limit(violations)
        cameras.append({
            "id": f"{region}-{num}",
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "address": clean(row[2]),
            "km": clean(row[3]),
            "mobile": kind.startswith("передвиж"),
            "direction": parse_direction(clean(row[6])),
            "schedule": clean(row[7]),
            "tags": parse_tags(violations),
            "speedLimit": speed_limit,
            "limitBySign": limit_by_sign,
            "violations": violations,
        })
    return cameras, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("assets/cameras.json"))
    ap.add_argument("--region", default="26", help="region code used in ids")
    args = ap.parse_args()

    all_cams = []
    for f in args.files:
        cams, skipped = convert(f, args.region)
        print(f"{f.name}: {len(cams)} cameras, skipped (no coords): {skipped}", file=sys.stderr)
        all_cams.extend(cams)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(all_cams, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(all_cams)} cameras -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
