#!/usr/bin/env python3

import argparse
import csv
import io
import json
import math
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

NASA_API_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
EXOMAST_IDENTIFIERS_URL = "https://exo.mast.stsci.edu/api/v0.1/exoplanets/identifiers/"

DEFAULT_OUTPUT_CSV = Path("valid_planets.csv")
DEFAULT_REPORT_CSV = Path("nasa_exomast_name_crosscheck.csv")
DEFAULT_CACHE_JSON = Path("exomast_name_cache.json")
JSON_BUILD_SCRIPT = Path("build_planets_json.py")

R_JUP_PER_R_EARTH = 11.2089807309
M_JUP_PER_M_EARTH = 317.8284065947
AU_PER_R_SUN = 215.032
STASSUN_TOKEN = "STASSUN"

NASA_COLUMNS = [
    "pl_name",
    "hostname",
    "default_flag",
    "tran_flag",
    "soltype",
    "pl_refname",
    "pl_pubdate",
    "pl_orbper",
    "pl_orbsmax",
    "pl_rade",
    "pl_radj",
    "pl_bmasse",
    "pl_bmassj",
    "pl_insol",
    "pl_eqt",
    "pl_ratdor",
    "st_teff",
    "st_rad",
    "sy_dist",
]

VALID_PLANET_FIELDS = [
    "Planet_Name",
    "Rp",
    "Mp",
    "Teq",
    "Period",
    "Teff",
    "Distance",
    "Transit_Flag",
    "Catalog_Name",
    "NASA_Name",
    "Canonical_Name",
    "Canonical_Name_Status",
    "ExoMAST_Query_Name",
]

NAME_SUFFIX_RE = re.compile(r"^(?P<base>.+?)\s(?P<suffix>[bcdefghijklmnopqrstuvwxyz])$", re.IGNORECASE)


def log(message: str) -> None:
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build valid_planets.csv from NASA Exoplanet Archive and cross-check names against ExoMAST."
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_CSV, help="Output CSV path")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_CSV, help="Name cross-check report CSV path")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE_JSON, help="ExoMAST lookup cache JSON path")
    parser.add_argument("--max-workers", type=int, default=8, help="Concurrent ExoMAST lookup workers")
    parser.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout in seconds")
    parser.add_argument("--retries", type=int, default=2, help="HTTP retry count")
    parser.add_argument("--refresh-cache", action="store_true", help="Ignore cached ExoMAST results")
    return parser.parse_args()


def parse_float(value: object) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_pubdate(value: object) -> datetime:
    text = str(value or "").strip()
    if not text:
        return datetime.min
    for fmt in ("%Y-%m", "%Y-%m-%d", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return datetime.min


def has_value(value: object) -> bool:
    if value is None:
        return False
    return str(value).strip() != ""


def normalize_name(name: object) -> str:
    return " ".join(str(name or "").split()).casefold()


def format_number(value: Optional[float], decimals: int = 6) -> str:
    if value is None or not math.isfinite(value):
        return ""
    text = f"{value:.{decimals}f}".rstrip("0").rstrip(".")
    return text if text else "0"


def positive_or_none(value: Optional[float]) -> Optional[float]:
    if value is None or not math.isfinite(value) or value <= 0:
        return None
    return value


def http_get_text(url: str, timeout: float, retries: int) -> str:
    last_error = None
    request = Request(url, headers={"User-Agent": "ExoWorldle/1.0"})
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= retries:
                break
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Request failed for {url}: {last_error}") from last_error


def fetch_nasa_rows(default_flag: int, timeout: float, retries: int) -> List[Dict[str, str]]:
    log(f"Starting NASA fetch for default_flag={default_flag}")
    query = (
        f"select {','.join(NASA_COLUMNS)} from ps "
        f"where default_flag={default_flag} and upper(soltype) like '%CONF%'"
    )
    url = f"{NASA_API_URL}?{urlencode({'query': query, 'format': 'csv'})}"
    text = http_get_text(url, timeout=timeout, retries=retries)
    rows = list(csv.DictReader(io.StringIO(text)))
    log(f"Finished NASA fetch for default_flag={default_flag}: {len(rows)} rows")
    return rows


def choose_first_numeric(*values: object) -> Optional[float]:
    for value in values:
        parsed = parse_float(value)
        if parsed is not None:
            return parsed
    return None


def earth_radius_to_jupiter(value: object) -> Optional[float]:
    parsed = parse_float(value)
    if parsed is None:
        return None
    return parsed / R_JUP_PER_R_EARTH


def earth_mass_to_jupiter(value: object) -> Optional[float]:
    parsed = parse_float(value)
    if parsed is None:
        return None
    return parsed / M_JUP_PER_M_EARTH


def derive_equilibrium_temperature(row: Dict[str, str]) -> Optional[float]:
    insol = parse_float(row.get("pl_insol"))
    if insol is not None and insol > 0:
        return 278.0 * (insol ** 0.25)

    eqt = parse_float(row.get("pl_eqt"))
    if eqt is not None and eqt > 0:
        return eqt

    teff = parse_float(row.get("st_teff"))
    if teff is None or teff <= 0:
        return None

    a_over_rs = parse_float(row.get("pl_ratdor"))
    if a_over_rs is None or a_over_rs <= 0:
        semi_major_axis = parse_float(row.get("pl_orbsmax"))
        stellar_radius = parse_float(row.get("st_rad"))
        if semi_major_axis is not None and semi_major_axis > 0 and stellar_radius is not None and stellar_radius > 0:
            a_over_rs = (semi_major_axis / stellar_radius) * AU_PER_R_SUN

    if a_over_rs is None or a_over_rs <= 0:
        return None

    return teff / math.sqrt(2.0 * a_over_rs)


def select_latest_rows(rows: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    log("Aggregating latest non-Stassun rows with per-column fallback")
    filtered = [
        row for row in rows
        if (row.get("pl_name") or "").strip()
        and STASSUN_TOKEN not in (row.get("pl_refname") or "").upper()
    ]
    filtered.sort(key=lambda row: parse_pubdate(row.get("pl_pubdate")), reverse=True)

    latest_by_name: Dict[str, Dict[str, str]] = {}
    for row in filtered:
        name = (row.get("pl_name") or "").strip()
        if not name:
            continue

        if name not in latest_by_name:
            latest_by_name[name] = dict(row)
            continue

        aggregate_row = latest_by_name[name]
        for key, value in row.items():
            if not has_value(aggregate_row.get(key)) and has_value(value):
                aggregate_row[key] = value

    log(f"Latest-row selection complete: {len(latest_by_name)} unique planets")
    return list(latest_by_name.values())


def candidate_query_names(nasa_name: str) -> List[str]:
    candidates = [nasa_name]

    if "TOI " in nasa_name:
        candidates.append(nasa_name.replace("TOI ", "TOI-"))

    match = NAME_SUFFIX_RE.match(nasa_name)
    if match and " A " not in nasa_name:
        candidates.append(f"{match.group('base')} A {match.group('suffix')}")

    seen = set()
    unique_candidates = []
    for candidate in candidates:
        normalized = normalize_name(candidate)
        if normalized and normalized not in seen:
            unique_candidates.append(candidate)
            seen.add(normalized)
    return unique_candidates


def fetch_exomast_identifiers(name: str, timeout: float, retries: int) -> Optional[Dict[str, object]]:
    url = f"{EXOMAST_IDENTIFIERS_URL}?name={quote(name)}"
    text = http_get_text(url, timeout=timeout, retries=retries)
    payload = json.loads(text)
    if isinstance(payload, dict) and payload:
        return payload
    return None


def resolve_canonical_name(nasa_name: str, timeout: float, retries: int) -> Dict[str, str]:
    for candidate in candidate_query_names(nasa_name):
        try:
            identifiers = fetch_exomast_identifiers(candidate, timeout=timeout, retries=retries)
        except Exception:  # noqa: BLE001
            continue

        canonical_name = (identifiers or {}).get("canonicalName")
        if not canonical_name:
            continue

        canonical_name = str(canonical_name).strip()
        status = "exact" if normalize_name(canonical_name) == normalize_name(nasa_name) else "resolved"
        return {
            "Canonical_Name": canonical_name,
            "Canonical_Name_Status": status,
            "ExoMAST_Query_Name": candidate,
        }

    return {
        "Canonical_Name": "",
        "Canonical_Name_Status": "unresolved",
        "ExoMAST_Query_Name": "",
    }


def load_cache(path: Path) -> Dict[str, Dict[str, str]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {}
    return {
        str(key): value
        for key, value in payload.items()
        if isinstance(value, dict)
    }


def save_cache(path: Path, cache: Dict[str, Dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(cache, handle, indent=2, sort_keys=True, ensure_ascii=True)


def build_planet_rows(rows: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    row_list = list(rows)
    total_rows = len(row_list)
    log(f"Building site rows from {total_rows} NASA planets")
    planets = []
    for index, row in enumerate(row_list, start=1):
        nasa_name = (row.get("pl_name") or "").strip()
        radius_rj = positive_or_none(choose_first_numeric(row.get("pl_radj"), earth_radius_to_jupiter(row.get("pl_rade"))))
        mass_mj = positive_or_none(choose_first_numeric(row.get("pl_bmassj"), earth_mass_to_jupiter(row.get("pl_bmasse"))))
        period = positive_or_none(parse_float(row.get("pl_orbper")))
        teq = positive_or_none(derive_equilibrium_temperature(row))
        teff = positive_or_none(parse_float(row.get("st_teff")))
        distance = positive_or_none(parse_float(row.get("sy_dist")))
        transit_flag = str(row.get("tran_flag") or "").strip()

        if not nasa_name:
            continue

        planets.append({
            "Planet_Name": nasa_name,
            "Rp": format_number(radius_rj),
            "Mp": format_number(mass_mj),
            "Teq": format_number(teq),
            "Period": format_number(period),
            "Teff": format_number(teff),
            "Distance": format_number(distance),
            "Transit_Flag": "True" if transit_flag == "1" else "False",
            "Catalog_Name": "NASA Exoplanet Archive",
            "NASA_Name": nasa_name,
            "Canonical_Name": "",
            "Canonical_Name_Status": "",
            "ExoMAST_Query_Name": "",
        })

        if index % 1000 == 0 or index == total_rows:
            log(f"Built {index}/{total_rows} site rows")

    planets.sort(key=lambda row: normalize_name(row["Planet_Name"]))
    log(f"Site row build complete: {len(planets)} planets kept")
    return planets


def apply_canonical_crosscheck(
    planets: List[Dict[str, str]],
    cache: Dict[str, Dict[str, str]],
    max_workers: int,
    timeout: float,
    retries: int,
    refresh_cache: bool,
) -> None:
    names_to_lookup = []
    for planet in planets:
        nasa_name = planet["NASA_Name"]
        if refresh_cache or nasa_name not in cache:
            names_to_lookup.append(nasa_name)

    if names_to_lookup:
        log(f"Resolving ExoMAST canonical names for {len(names_to_lookup)} planets")
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(resolve_canonical_name, name, timeout, retries): name
                for name in names_to_lookup
            }
            for index, future in enumerate(as_completed(futures), start=1):
                name = futures[future]
                try:
                    cache[name] = future.result()
                except Exception:  # noqa: BLE001
                    cache[name] = {
                        "Canonical_Name": "",
                        "Canonical_Name_Status": "unresolved",
                        "ExoMAST_Query_Name": "",
                    }
                if index % 100 == 0 or index == len(futures):
                    log(f"Resolved ExoMAST names: {index}/{len(futures)}")

    for planet in planets:
        result = cache.get(planet["NASA_Name"], {})
        planet["Canonical_Name"] = result.get("Canonical_Name", "")
        planet["Canonical_Name_Status"] = result.get("Canonical_Name_Status", "unresolved")
        planet["ExoMAST_Query_Name"] = result.get("ExoMAST_Query_Name", "")


def write_csv(path: Path, rows: Iterable[Dict[str, str]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def build_crosscheck_report(planets: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return [
        {
            "NASA_Name": planet["NASA_Name"],
            "Canonical_Name": planet["Canonical_Name"],
            "Canonical_Name_Status": planet["Canonical_Name_Status"],
            "ExoMAST_Query_Name": planet["ExoMAST_Query_Name"],
        }
        for planet in planets
    ]


def rebuild_browser_dataset() -> None:
    if not JSON_BUILD_SCRIPT.exists():
        raise FileNotFoundError(f"Missing browser dataset build script: {JSON_BUILD_SCRIPT}")

    log(f"Rebuilding browser dataset via {JSON_BUILD_SCRIPT}")
    subprocess.run([sys.executable, str(JSON_BUILD_SCRIPT)], check=True)
    log("Browser dataset rebuild complete")


def main() -> None:
    args = parse_args()

    log("Downloading NASA Exoplanet Archive rows")
    default_rows = fetch_nasa_rows(default_flag=1, timeout=args.timeout, retries=args.retries)
    supplemental_rows = fetch_nasa_rows(default_flag=0, timeout=args.timeout, retries=args.retries)
    log(f"Fetched {len(default_rows)} default rows and {len(supplemental_rows)} supplemental rows")

    latest_rows = select_latest_rows([*default_rows, *supplemental_rows])
    log(f"Selected {len(latest_rows)} latest non-Stassun rows")

    planets = build_planet_rows(latest_rows)
    log(f"Built {len(planets)} planets with site fields")

    cache = load_cache(args.cache)
    apply_canonical_crosscheck(
        planets=planets,
        cache=cache,
        max_workers=max(1, args.max_workers),
        timeout=args.timeout,
        retries=args.retries,
        refresh_cache=args.refresh_cache,
    )
    save_cache(args.cache, cache)

    write_csv(args.output, planets, VALID_PLANET_FIELDS)
    report_rows = build_crosscheck_report(planets)
    write_csv(args.report, report_rows, ["NASA_Name", "Canonical_Name", "Canonical_Name_Status", "ExoMAST_Query_Name"])

    unresolved = sum(1 for row in report_rows if row["Canonical_Name_Status"] == "unresolved")
    renamed = sum(1 for row in report_rows if row["Canonical_Name_Status"] == "resolved")
    exact = sum(1 for row in report_rows if row["Canonical_Name_Status"] == "exact")

    log(f"Wrote site CSV: {args.output}")
    log(f"Wrote cross-check report: {args.report}")
    log(f"Updated ExoMAST cache: {args.cache}")
    rebuild_browser_dataset()
    log(f"Canonical name status counts -> exact: {exact}, resolved: {renamed}, unresolved: {unresolved}")


if __name__ == "__main__":
    main()