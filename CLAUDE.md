# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The companion site for the Packt book "Geospatial Data Analytics on AWS." A static site (no build step, no framework, no bundler) deployed via AWS Amplify Hosting (app `geospatial-aws-book`, id `d1c8gk3kltchw6`, account `654700647887`), connected to this GitHub repo and served under a custom domain (`book.bateman.link`). Every push to `main` triggers an automatic Amplify build/deploy (usually done within ~90 seconds); check status with `aws amplify list-jobs --app-id d1c8gk3kltchw6 --branch-name main --max-results 5`. Amplify's edge cache is aggressive (`s-maxage=31536000`), so a check made in the same breath as a push can catch the previous build's stale cached response -- if content looks stale right after pushing, wait for the job to reach `SUCCEED` before concluding something is wrong.

## Running locally

```bash
python -m http.server 8000
# or
npx http-server
```

Then open `http://localhost:8000`. `serve.ps1` is an alternative PowerShell static server (bound to port 8743) — it is gitignored and exists only for local Windows use.

There is no test suite, linter, or build process for the site itself. Verify changes by loading the relevant HTML page in a browser.

## Repo structure

- `index.html` — landing page (authors, book overview)
- `data-samples.html` — free dataset browser, driven by `data/catalog.json`
- `css/style.css` — single shared stylesheet (dark theme) used by every page
- `js/main.js` — shared site-wide behavior (smooth scroll, lightbox, navbar shadow)
- `data/` — sample datasets referenced by the book and playgrounds. Large vector formats (`*.geojson`, `*.shp`, `*.dbf`) are gitignored and instead hosted on S3 (see `data/catalog.json` `url` fields, bucket `geospatial-on-aws.s3.amazonaws.com`); CSVs are checked in directly.
- `data/GPS/` — synthetic field-ops dataset for the Field Operator Efficiency playground: technician roster, work orders, per-technician-per-day GPS breadcrumb tracks, and the KGFCU wellhead list (`katy_field_wells.csv`).
- `data/cmms/` — SQL DDL/DML and a Lambda handler (`index.js`) for seeding an Aurora CMMS (maintenance) database via the RDS Data API. Unrelated to the static site; used for a separate book chapter's backend example.
- `playgrounds/` — standalone, self-contained interactive demos (each is a single HTML file with inline `<script>`/`<style>`, no shared JS bundle beyond `css/style.css`)
- `amplify/agents/maintenance/` — AWS Amplify agent example (`maintenanceAgent.ts` + `lambda/`) referenced elsewhere in the book, not wired into the site
- `assets/wells/` — generated satellite snapshot PNGs, one per wellhead (`WH-####.png`), produced by `tools/well_satellite_snapshot.js`
- `tools/` — standalone Node scripts for building/auditing map assets (see below)
- `screenshots/` — gitignored

## Playgrounds

Each file under `playgrounds/` is fully self-contained: markup, styles, and logic live in one `.html` file, loaded via `<script>`/`<link>` tags against `../css/style.css` and CDN libraries (Leaflet, PapaParse). There is no shared playground framework — copy-paste-and-adapt is the convention when starting a new one.

- **Field Operator Efficiency** (`field-operator-efficiency.html`) is the largest and most actively developed playground. It's a Leaflet-based dispatch board simulating Hilcorp lease operators servicing KGFCU (Katy Gas Field Consolidated Unit) wellheads:
  - Loads `data/GPS/technician_roster.csv` and `data/GPS/work_orders.csv` via PapaParse (`Papa.parse(url, { download: true, header: true })`)
  - Uses the public OSRM demo server (`router.project-osrm.org`) for driving-time/distance tables and route geometry — no API key, but rate-limited and not for production use
  - Renders a KPI row (including a clickable "Compliance Flags" KPI with a detail table), day tabs, and a GPS playback scrubber over per-technician daily breadcrumb tracks (`data/GPS/<TechName>_<date>.csv`)
  - Technician assignment/backlog data (which tech/day owns which wellhead) is hardcoded inline in the script (search for the `WH-####` well-to-tech mapping) rather than derived from the CSVs
  - CSS custom properties can't be read from Leaflet's `divIcon` HTML, so technician accent colors are defined once in JS (`techColorHex`) and applied as inline styles instead

## Tools (`tools/`)

Node scripts for one-off/repeatable geospatial asset generation, kept as standalone scripts rather than inline snippets (see project convention: reusable geospatial tasks belong here). Install deps with `npm install` inside `tools/` (currently just `sharp`).

- `well_satellite_snapshot.js` — fetches a labeled satellite image (ArcGIS World_Imagery export) centered on each KGFCU wellhead's coordinates and writes it to `assets/wells/WH-####.png`. Run with no args to regenerate all wells from `data/GPS/katy_field_wells.csv`, or pass specific `well_number`/`api_number` values to target a subset:
  ```bash
  node tools/well_satellite_snapshot.js                 # all wells
  node tools/well_satellite_snapshot.js 4401 9 3505      # specific well_number(s)
  node tools/well_satellite_snapshot.js 42-473-00109     # specific api_number
  ```
  EquipIDs zero-pad short well numbers to 4 digits (e.g. well `9` → `WH-0009`) to match the convention used elsewhere on the site — mirror this if adding similar tooling.

## Working conventions

- Don't do a blanket find-replace on "gas" terminology (natural gas vs. gasoline/vehicle fuel) — only disambiguate where the surrounding context is genuinely ambiguous.
- New repeatable geospatial/data-generation tasks should be added as standalone scripts under `tools/`, not one-off inline snippets.
- File a GitHub issue per user request or bug, and close it via `Fixes #N` in the commit that resolves it, so the repo builds a full issue timeline.
- No confirmation is needed before editing files, committing, pushing, or merging in this repo — proceed directly.
- Always document changes made and tie to a GitHub issue.  Use pull requests for big changes and commit to main directly for small tweaks.
