import csv
import json
from pathlib import Path

INPUT_CSV = Path("valid_planets.csv")
OUTPUT_JSON = Path("docs/planets.json")


def to_float(value):
    if value is None:
        return None
    value = str(value).strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def teff_to_spectral(teff):
    if teff is None:
        return "?"
    if teff >= 25000:
        return "O"
    if teff >= 10000:
        return "B"
    if teff >= 7500:
        return "A"
    if teff >= 6000:
        return "F"
    if teff >= 5000:
        return "G"
    if teff >= 3500:
        return "K"
    return "M"


def main():
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Missing input file: {INPUT_CSV}")

    planets = []
    seen = set()

    with INPUT_CSV.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("Planet_Name") or "").strip()
            if not name or name in seen:
                continue

            rp = to_float(row.get("Rp"))
            mp = to_float(row.get("Mp"))
            period = to_float(row.get("Period"))
            teq = to_float(row.get("Teq"))
            teff = to_float(row.get("Teff"))

            planets.append({
                "name": name,
                "properties": {
                    "Mp": mp,
                    "Rp": rp,
                    "Period": period,
                    "StarType": teff_to_spectral(teff),
                    "Teq": teq,
                },
            })
            seen.add(name)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON.open("w", encoding="utf-8") as f:
        json.dump({"planets": planets}, f, ensure_ascii=True)

    print(f"Wrote {len(planets)} planets to {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
