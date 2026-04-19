# BTM Datacenter Siting Dashboard

Interactive US map for evaluating datacenter sites. Click anywhere → the backend
returns nearby natural-gas pipelines, nearest electric transmission line,
nearest school, an OpenStreetMap-derived place type (urban/suburban/rural), and
a redundancy score (min-cut + diversity).

The repo is the instructions. The database (Lovable Cloud / Supabase) is the
data. Anyone who clones this repo can follow this README, run the scripts in
order, and end up with a fully working app — no credentials committed, no
multi-hundred-MB files committed.

---

## Architecture

```
Frontend (Leaflet + TanStack Start)
   src/components/SiteMap.tsx
   src/components/ToolsSidebar.tsx
        │
        │  POST /api/analyze   {lat, lon, radius_m}
        │  GET  /api/pipelines-bbox?...
        │  POST /api/optimal-places
        ▼
Server routes (src/routes/api.*.ts)
        │
        ├─► PostGIS RPCs ──── nearby_pipelines_geojson, nearest_school_v2,
        │                     nearest_transmission, pipelines_in_bbox
        ├─► Overpass API ──── live landuse query → urban/suburban/rural
        ├─► Redundancy ────── src/server/redundancy.ts (min-cut heuristic)
        └─► Risk model ────── src/server/risk-model.ts  (placeholder, NYI)
```

---

## 1. Cloud / database setup

This project uses **Lovable Cloud**, which provisions a managed Supabase
project automatically. You have two options:

### Option A — Fork on Lovable (easiest)

1. Open the project in [Lovable](https://lovable.dev) and remix/fork it.
2. Lovable Cloud automatically provisions a new database with the schema from
   `supabase/migrations/` already applied.
3. Skip to **section 3 (load data)**.

### Option B — Self-hosted Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. Apply the migrations:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   This creates: `pipelines`, `transmission_lines`, `schools`, `water_bodies`,
   `grid_cost_points`, plus all the `nearby_*` / `nearest_*` PostGIS RPCs.
3. Copy your URL + anon key into `.env` (see next section).

---

## 2. Local environment

Two env files, both gitignored:

### `.env` (used by the Vite frontend + dev server — Lovable creates this for you)

```
VITE_SUPABASE_URL="https://<ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon-key>"
SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<anon-key>"
```

These are **publishable** (anon) keys — safe to ship to the browser, protected
by RLS.

### `.env.local` (only needed if you run import scripts locally)

```
SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

The **service role key** bypasses RLS and is needed to bulk-insert data.
Get it from:

- **Lovable Cloud**: Cloud panel → Settings → API → `service_role` key.
- **Supabase**: Dashboard → Project Settings → API → `service_role`.

⚠️ Never commit `.env.local`. Never expose the service role key to the browser.
It is gitignored in this repo.

Load it before running scripts:

```bash
export $(cat .env.local | xargs)
# or, with bun:
bun --env-file=.env.local run scripts/import-pipelines.ts ...
```

---

## 3. Load data

The DB ships empty. Run these three scripts in any order to populate it.
Each script is idempotent on a fresh table — re-running will duplicate rows,
so `TRUNCATE` first if re-importing.

All scripts cache their downloads to `./data/` (gitignored).

### 3a. Natural-gas pipelines (~hundreds of thousands of segments)

Source: EIA / ArcGIS — *Natural Gas Interstate and Intrastate Pipelines*.

```bash
mkdir -p data
# Download manually from:
#   https://hub.arcgis.com/datasets/fedmaps::natural-gas-interstate-and-intrastate-pipelines/about
# Save as ./data/pipelines.geojson

bun --env-file=.env.local run scripts/import-pipelines.ts ./data/pipelines.geojson
```

### 3b. Electric transmission lines (~150 MB, auto-downloaded)

Source: HIFLD — *Electric Power Transmission Lines* (public ArcGIS endpoint).

```bash
bun --env-file=.env.local run scripts/import-transmission.ts
```

The script downloads the GeoJSON to `./data/transmission.geojson` on first run
and reuses the cache on subsequent runs.

### 3c. Public schools (~100k rows)

Source: NCES *EDGE_GEOCODE_PUBLICSCH_2425* (pipe-delimited TXT).

1. Download the dataset from
   <https://nces.ed.gov/programs/edge/Geographic/SchoolLocations>.
2. Extract and locate `EDGE_GEOCODE_PUBLICSCH_2425.TXT`.
3. Import:
   ```bash
   bun --env-file=.env.local run scripts/import-schools.ts \
     ./data/EDGE_GEOCODE_PUBLICSCH_2425.TXT
   ```

---

## 4. Run the app

```bash
bun install
bun dev
```

Open <http://localhost:3000>. Click anywhere on the map; the popup shows
gas/electric/school distances, area type, and redundancy.

---

## Plug-in points

| File | Purpose |
|------|---------|
| `src/server/risk-model.ts` | Replace `predictFailureProbability` with a real ML model or external API. Currently returns `"NYI"` in the analyze response. |
| `src/server/redundancy.ts` | Min-cut heuristic over nearby pipelines. Upgrade by precomputing into a `redundancy_cache` table and looking it up here. |
| `src/server/water-access.ts` | Scoring curve once you load a real water dataset (e.g. USGS NHD) into `water_bodies`. |
| `src/routes/api.analyze.ts` | The orchestrator. Adjust which RPCs are called and how the response is shaped. |
| `src/routes/api.optimal-places.ts` | Coarse-grid candidate search. Tune the grid resolution and filter logic here. |

---

## What's gitignored vs committed

**Committed** (the instructions):
- All source code (`src/`, `scripts/`, `supabase/migrations/`)
- `package.json`, `bunfig.toml`, configs
- This README

**Gitignored** (the data — fetch/import yourself):
- `data/` — all downloaded GeoJSON / shapefiles
- `EDGE_GEOCODE_PUBLICSCH_2425/` — NCES schools dump
- `*.geojson`, `*.sas7bdat`, `*.shp`, `*.dbf` anywhere in the tree
- `.env`, `.env.local` — credentials
