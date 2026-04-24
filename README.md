# BTM Datacenter Siting Dashboard

Interactive US map for evaluating land sites for datacenters. Click anywhere on the map
and the backend returns nearby natural-gas pipelines, the nearest electric
transmission line, the nearest public school, an OpenStreetMap-derived place
type (urban / suburban / rural), a redundancy score (min-cut + diversity), and
an operator reliability score (PHMSA-derived) for the nearest gas operator.

The repo is the instructions; Supabase is the data. **Anyone who clones this
repo and follows the setup below ends up with a fully working app — no
credentials committed, no multi-hundred-MB datasets committed.**

A live demo runs on Lovable Cloud (managed Supabase) but the project does NOT
require Lovable to run. You can host it on your own Supabase + any Node host.

---

## Usage

Once the app is running (see Setup below), here's what each tool does:

### Click anywhere on the map
Drops a marker, fetches the nearest gas line / transmission line / public
school, queries OpenStreetMap for the surrounding land use (urban / suburban /
rural), computes a min-cut redundancy estimate from the nearby pipelines, and
looks up the **operator reliability score** for the nearest gas operator using
a fuzzy-matched PHMSA dataset. Results render in the marker popup.

### Tools sidebar (top-right)
- **Place Settings** — fly to specific lat/lon, adjust the analysis radius,
  toggle "Show gas pipelines" or "Show electrical grid pipelines" overlays
  (loaded for the visible viewport only).
- **Search for optimal places** — pick a region and pipeline class, set
  max-distance-from-gas, max-distance-from-power, and min-distance-from-school
  sliders, then **Search**. Green pins drop on every grid cell that satisfies
  the constraints. The Search Results panel (top-left) lists each pin and
  exposes a `+` button to add it to one of your places lists.
- **Places List Analyzer** — create named lists, add points either by typing
  coordinates or by toggling **Add by click** (an "Add to list" button then
  appears under each map-click popup). Hit **View Data** to open the analysis
  dashboard.

### Analysis dashboard (`/analyze/<listId>`)
Runs k-means + PCA on your saved points using their cached gas/power/school
features. Renders a 2D PCA scatter, a CONUS mini-map, cluster archetype
summaries, and the top-10 most central sites. Export to CSV.

### Operator reliability score
The score is the PHMSA-derived `reliability_score` (0 = worst, 100 = best),
looked up from `src/server/operator-reliability-data.ts`. Because the GIS
layer's operator names rarely match PHMSA exactly, lookup uses a three-stage
fuzzy match (exact-normalized → substring → token Jaccard). Operators with no
match show "—" instead of a fake score.

> **Known data mismatch.** The bundled PHMSA reliability CSV is dominated by
> *local distribution utilities* (city gas companies), while the pipelines
> GeoJSON is the *interstate / intrastate transmission* network. Only a
> handful of names appear in both datasets (e.g. Atmos, West Texas Gas), so
> most clicks will show "—" for operator reliability. To get broad coverage,
> swap `src/data/operator_reliability_scores.csv` for a transmission-operator
> dataset (e.g. PHMSA *gas transmission* incident data aggregated by operator)
> and re-run the app — `operator-reliability-data.ts` is regenerated from the
> CSV on import.

---

## Operator Reliability Model

### What the score represents

Each operator receives a `reliability_score` from 0 (worst) to 100 (best).
The score reflects the **material composition of that operator's pipe
network**, weighted by statistically derived failure risk multipliers. An
operator whose network is dominated by modern polyethylene plastic scores near
100; one with a high proportion of aging unprotected bare steel scores lower.

### Where it lives in this repo

The training pipeline is **not committed** — only its output is:

```
src/
  data/
    operator_reliability_scores.csv   # Pre-computed scores — edit this to change scores
  server/
    operator-reliability-data.ts      # Imports the CSV and exports it as a typed object
    operator-reliability.ts           # Runtime fuzzy-match lookup (reads the above)
```

To swap in different scores — whether from a newer PHMSA download, a different
state, or a different model entirely — replace `operator_reliability_scores.csv`
with a file that has the same two columns:

```
OPERATOR_NAME,reliability_score
ATMOS ENERGY CORPORATION - MID-TEX,77.3
CPS ENERGY,78.7
...
```

`operator-reliability-data.ts` is auto-generated from the CSV on import and
does not need to be edited manually.

### How the bundled scores were generated

The scores were produced offline using two PHMSA datasets downloaded from
[phmsa.dot.gov](https://phmsa.dot.gov/data-and-statistics/pipeline/source-data):

| Dataset | Format | Years | Key columns used |
|---|---|---|---|
| Gas Distribution Incident Data | Tab-separated `.txt` | 2010–2026 | `IYEAR`, `INSTALLATION_YEAR`, `MATERIAL_INVOLVED`, `CAUSE` |
| Gas Distribution Annual Report (Form 7100.1-1) | CSV, one file per year | 2017–2025 | `OPERATOR_NAME`, `MMILES_*` material columns, `STOP` (state) |

**Step 1 — Train a Cox proportional hazards model on incident data.**

A Cox survival model (from the Python `lifelines` library) was fitted to
predict time-to-failure as a function of pipe material. Incidents caused by
excavation damage, outside force, and natural force were excluded first —
those failures are random with respect to pipe material, since a backhoe hits
plastic and steel equally. Only material-driven failures were used (~304
incidents after filtering and cleaning).

Years in service at time of incident was computed as
`IYEAR − INSTALLATION_YEAR`. Pipe material was one-hot encoded with
**plastic as the baseline** (most reliable) category.

The model outputs hazard ratios — how quickly each material fails relative to
plastic. Because a lower hazard ratio means *shorter* time to failure, the
ratios were inverted (`1 / hazard_ratio`) to produce risk weights where higher
= more dangerous:

| Material | Hazard ratio | Risk weight (inverted) |
|---|---|---|
| Plastic (PE) | 1.00 (baseline) | 1.00 |
| Other / Unknown | 0.64 | 1.56 |
| Steel (all) | 0.20 | 4.98 |
| Cast / Wrought Iron | 0.13 | 7.83 |

**Step 2 — Score each Texas operator from their annual report data.**

For each operator's most recent annual report, a weighted average risk was
computed across all pipe material columns divided by total mains mileage.
Steel was further subdivided by cathodic protection and coating status:

| Annual report column | Risk weight applied |
|---|---|
| `MMILES_CI` / `MMILES_CI_WR_TOTAL` | 7.83 |
| `MMILES_STEEL_UNP_BARE` | 7.46 |
| `MMILES_STEEL_UNP_COATED` | 5.47 |
| `MMILES_STEEL_CP_BARE` | 3.98 |
| `MMILES_STEEL_CP_COATED` | 2.49 |
| `MMILES_PE_TOTAL` | 1.00 |

```
raw_risk = Σ (miles_of_material × risk_weight) / total_miles
reliability_score = 100 × (1 − (raw_risk − min) / (max − min))
```

Raw risk was min-max normalized and inverted so 100 = most reliable, 0 = least.

### Limitations of the bundled scores

- **Texas operators only.** Annual report data was filtered to Texas (`STOP = TX`),
  yielding 143 scored operators. Operators outside Texas return "—" in the UI.
- **Distribution vs. transmission mismatch.** PHMSA data covers local
  distribution companies; the pipeline GeoJSON layer is the interstate /
  intrastate *transmission* network. Match rates are low — see the Known Data
  Mismatch note under Operator Reliability Score above.
- **No censored observations.** A fully rigorous survival model would include
  pipe-years that did *not* fail as censored data. This model trains only on
  failures, which slightly biases the age-at-failure estimates.

### Replacing the scores with a different dataset

To generate scores for a different state or from a newer PHMSA download:

1. Download the Gas Distribution Annual Report CSVs from phmsa.dot.gov for
   your target state and years.
2. Concatenate the yearly CSVs, filter to your state (`STOP == 'XX'`), and
   keep the most recent report per operator.
3. Apply the risk weights from the table above (or re-derive them by
   re-running the Cox model on the incident data).
4. Produce a two-column CSV with `OPERATOR_NAME` and `reliability_score`
   (0–100 scale, higher = more reliable).
5. Overwrite `src/data/operator_reliability_scores.csv` and restart the app.

---

## Architecture

```
Frontend (Leaflet + TanStack Start)
   src/components/SiteMap.tsx
   src/components/ToolsSidebar.tsx
        │
        │  POST /api/analyze        {lat, lon, radius_m}
        │  GET  /api/pipelines-bbox ?min_lat&...
        │  POST /api/optimal-places
        ▼
Server routes (src/routes/api.*.ts)
        │
        ├─► PostGIS RPCs ──── nearby_pipelines_geojson, nearest_school_v2,
        │                     nearest_transmission, pipelines_in_bbox
        ├─► Overpass API ──── live landuse query → urban/suburban/rural
        ├─► Redundancy ────── src/server/redundancy.ts (min-cut heuristic)
        ├─► Operator score ── src/server/operator-reliability.ts (fuzzy match)
        └─► Risk model ────── src/server/risk-model.ts (placeholder, NYI)
```

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/<you>/btm-siting-dashboard
cd btm-siting-dashboard
```

### 2. Install dependencies

```bash
npm install            # or: bun install
```

### 3. Create a Supabase project

1. Go to <https://supabase.com> and create a free project.
2. From **Project Settings → API**, copy:
   - **Project URL**
   - **anon / publishable key** (safe in the browser)
   - **service_role key** (SECRET — used only by the import scripts)

### 4. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the three values from step 3. The `service_role` key
is only needed for the bulk imports in step 6 — never commit it and never
expose it to the browser.

### 5. Run database migrations

Install the Supabase CLI (<https://supabase.com/docs/guides/local-development/cli/getting-started>),
then:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This applies every file in `supabase/migrations/` to your project, creating:

- Tables: `pipelines`, `transmission_lines`, `schools`, `water_bodies`,
  `grid_cost_points`
- PostGIS spatial indexes on every `geom` column
- RLS policies (public read, no public write)
- RPC functions: `nearby_pipelines_geojson`, `pipelines_in_bbox`,
  `nearest_school_v2`, `nearest_transmission`, `nearest_water`,
  `nearest_grid_cost`

### 6. Download and import the data

The DB ships empty. Three scripts populate it (idempotent on a fresh table —
re-running duplicates rows, so `TRUNCATE` first if you re-import). All scripts
cache their downloads to `./data/` (gitignored).

```bash
mkdir -p data

# 6a. Electric transmission lines (~150 MB) — auto-downloaded from HIFLD
npx tsx scripts/import-transmission.ts

# 6b. Public schools (~100k rows)
#   Download EDGE_GEOCODE_PUBLICSCH_2425 from
#   https://nces.ed.gov/programs/edge/Geographic/SchoolLocations
#   Either the .TXT (pipe-delimited) or .xlsx works:
npx tsx scripts/import-schools.ts data/EDGE_GEOCODE_PUBLICSCH_2425.TXT

# 6c. Natural-gas pipelines (~33k segments)
#   Download from
#   https://hub.arcgis.com/datasets/fedmaps::natural-gas-interstate-and-intrastate-pipelines/about
#   Save as ./data/pipelines.geojson, then:
npx tsx scripts/import-pipelines.ts ./data/pipelines.geojson
```

Each script reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env`.

Expected row counts when finished:

| Table                | Rows     |
| -------------------- | -------- |
| `schools`            | ~102,000 |
| `transmission_lines` | ~95,000  |
| `pipelines`          | ~33,000  |

### 7. Start the app

```bash
npm run dev
```

Open <http://localhost:3000>. Click anywhere on the map; the popup shows
gas / electric / school distances, area type, and redundancy.

---

## Running on Lovable Cloud (alternative to step 3–5)

If you fork the project on [Lovable](https://lovable.dev) instead of using
your own Supabase account:

1. Lovable Cloud auto-provisions a Supabase project and applies all migrations.
2. `.env` is generated for you with the correct URL and publishable key.
3. Skip to step 6 (data import). For the import scripts you still need a
   `service_role` key — find it in the Cloud panel under **Settings → API**.

---

## What's gitignored vs committed

**Committed** (the instructions):

- All source code (`src/`, `scripts/`, `supabase/migrations/`)
- `package.json`, configs, this README, `.env.example`
- `src/data/operator_reliability_scores.csv` — pre-computed operator scores (see Operator Reliability Model above for how to regenerate)

**Gitignored** (the data — fetch and import yourself):

- `data/` — all downloaded GeoJSON / shapefiles / XLSX / PHMSA source files
- `EDGE_GEOCODE_PUBLICSCH_2425/` — NCES schools dump
- `*.geojson`, `*.sas7bdat`, `*.shp`, `*.dbf`, `*.xlsx` anywhere in the tree
- `.env`, `.env.local` — credentials
