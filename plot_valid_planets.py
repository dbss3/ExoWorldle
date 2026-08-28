import csv
from pathlib import Path

import matplotlib.pyplot as plt

INPUT_CSV = Path("valid_planets.csv")
OUTPUT_DIR = Path("plots")


def parse_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_columns(csv_path):
    period = []
    mass = []
    radius = []
    teq = []

    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            p = parse_float(row.get("Period"))
            m = parse_float(row.get("Mp"))
            r = parse_float(row.get("Rp"))
            t = parse_float(row.get("Teq"))

            if p is not None and m is not None and p > 0 and m > 0:
                period.append(p)
                mass.append(m)

            if r is not None and t is not None:
                radius.append(r)
                teq.append(t)

    return period, mass, radius, teq


def plot_period_vs_mass(period, mass, out_path):
    plt.figure(figsize=(8, 6))
    plt.scatter(period, mass, s=12, alpha=0.45, edgecolors="none")
    plt.xscale("log")
    plt.yscale("log")
    plt.xlabel("Orbital Period (days)")
    plt.ylabel("Planet Mass (Mj)")
    plt.title("Valid Planets: Period vs Mass (log-log)")
    plt.grid(True, which="both", alpha=0.25)
    plt.tight_layout()
    plt.savefig(out_path, dpi=180)
    plt.close()


def plot_radius_vs_teq(radius, teq, out_path):
    plt.figure(figsize=(8, 6))
    plt.scatter(teq, radius, s=12, alpha=0.45, edgecolors="none")
    plt.xscale("log")
    plt.yscale("log")
    plt.xlabel("Equilibrium Temperature (K)")
    plt.ylabel("Planet Radius (Rj)")
    plt.title("Valid Planets: Radius vs Equilibrium Temperature")
    plt.grid(True, alpha=0.25)
    plt.tight_layout()
    plt.savefig(out_path, dpi=180)
    plt.close()


def main():
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Could not find {INPUT_CSV}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    period, mass, radius, teq = load_columns(INPUT_CSV)

    pvm_path = OUTPUT_DIR / "period_vs_mass_loglog.png"
    rvt_path = OUTPUT_DIR / "radius_vs_teq.png"

    plot_period_vs_mass(period, mass, pvm_path)
    plot_radius_vs_teq(radius, teq, rvt_path)

    print(f"Saved: {pvm_path}")
    print(f"Saved: {rvt_path}")
    print(f"Points (period vs mass): {len(period)}")
    print(f"Points (radius vs Teq): {len(radius)}")


if __name__ == "__main__":
    main()
