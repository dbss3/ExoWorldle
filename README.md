# ExoWorldle (GitHub Pages Version)

This repository now includes a static daily ExoWorldle build in the `docs/` folder.

## What it does

- Uses only planets from `valid_planets.csv`
- Picks one global target planet per UTC day
- Allows up to 6 guesses
- Uses standard mode only
- Stores daily progress in `localStorage`
- Builds `valid_planets.csv` from the NASA Exoplanet Archive and cross-checks names against ExoMAST canonical names

## Files

- `build_valid_planets_csv.py`: downloads NASA Archive transit planets, derives site fields, and writes `valid_planets.csv`
- `build_planets_json.py`: builds browser dataset from `valid_planets.csv`
- `docs/index.html`: static app shell
- `docs/style.css`: UI styles
- `docs/game.js`: game logic (daily target, compare, guesses)
- `docs/planets.json`: generated planet dataset for the site
- `nasa_exomast_name_crosscheck.csv`: report of NASA names vs ExoMAST canonical names
- `exomast_name_cache.json`: cached ExoMAST lookup results for faster rebuilds

## Rebuild data

Run from repository root:

```bash
python3 build_valid_planets_csv.py
python3 build_planets_json.py
```

The first command refreshes `valid_planets.csv` from NASA and writes the ExoMAST cross-check report. The second command rebuilds the browser dataset in `docs/planets.json`.

## Run locally

```bash
cd docs
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In GitHub repository settings, open Pages.
3. Set source to `Deploy from a branch`.
4. Select your branch (for example `main`) and folder `docs`.
5. Save.

GitHub Pages will publish the static site from `docs/`.
