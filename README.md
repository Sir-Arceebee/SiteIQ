# BTM Datacenter Siting Dashboard

Interactive US map for evaluating datacenter sites. Click anywhere on the map
and the backend returns nearby natural-gas pipelines, the nearest electric
transmission line, the nearest public school, an OpenStreetMap-derived place
type (urban / suburban / rural), and a redundancy score (min-cut + diversity).

The repo is the instructions; Supabase is the data. **Anyone who clones this
repo and follows the setup below ends up with a fully working app — no
credentials committed, no multi-hundred-MB datasets committed.**

A live demo runs on Lovable Cloud (managed Supabase) but the project does NOT
require Lovable to run. You can host it on your own Supabase + any Node host.

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

## Plug-in points

| File                              | Purpose                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/server/risk-model.ts`        | Replace `predictFailureProbability` with a real ML model or external API. Currently returns `"NYI"`.                   |
| `src/server/redundancy.ts`        | Min-cut heuristic over nearby pipelines. Could be precomputed into a `redundancy_cache` table.                         |
| `src/server/water-access.ts`      | Scoring curve once a real water dataset (e.g. USGS NHD) is loaded into `water_bodies`.                                 |
| `src/routes/api.analyze.ts`       | Orchestrator. Tweak which RPCs are called and how the response is shaped.                                              |
| `src/routes/api.optimal-places.ts`| Coarse-grid candidate search. Tune the grid resolution and filter logic here.                                          |

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

**Gitignored** (the data — fetch and import yourself):

- `data/` — all downloaded GeoJSON / shapefiles / XLSX
- `EDGE_GEOCODE_PUBLICSCH_2425/` — NCES schools dump
- `*.geojson`, `*.sas7bdat`, `*.shp`, `*.dbf`, `*.xlsx` anywhere in the tree
- `.env`, `.env.local` — credentials
