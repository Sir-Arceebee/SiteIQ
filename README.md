# BTM Datacenter Siting Dashboard

Interactive US map. Click a location → backend computes a weighted siting score
based on natural-gas pipeline data, water access, supply redundancy, school
proximity, and grid cost.

## Architecture

```
Frontend (Leaflet, src/components/SiteMap.tsx)
        │  POST /api/analyze {lat, lon}
        ▼
Server route (src/routes/api.analyze.ts)
        │
        ├─► Spatial engine    ── PostGIS RPCs: nearby_pipelines, nearest_water, …
        ├─► Risk model        ── src/server/risk-model.ts        ◀── PLUG-IN #1
        ├─► Redundancy proxy  ── src/server/redundancy.ts        ◀── PLUG-IN #2
        └─► Water/school/grid ── src/server/water-access.ts      ◀── PLUG-IN #3
```

## Plug-in points

| File | What to change |
|------|----------------|
| `src/server/risk-model.ts` | Replace `predictFailureProbability` with your real ML model. Either edit the formula or fetch an external model API. |
| `src/server/water-access.ts` | When you load a real water dataset (e.g. USGS NHD) into the `water_bodies` table, no code change needed — only the scoring curve lives here. |
| `src/server/redundancy.ts` | Today's value is a fast heuristic. Upgrade to a precomputed min-cut by adding a `redundancy_cache` table and looking it up here. |
| `src/routes/api.analyze.ts` | Adjust the `WEIGHTS` constant to rebalance the final score. |

## Loading the real ArcGIS pipeline dataset

The DB ships with ~12 mock pipelines so the UI works immediately. To load the
real dataset (~hundreds of thousands of segments):

1. Download GeoJSON from
   <https://hub.arcgis.com/datasets/fedmaps::natural-gas-interstate-and-intrastate-pipelines/about>
   and save as `data/pipelines.geojson`.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your shell (find them
   in the Lovable Cloud project settings).
3. Run:
   ```bash
   bun run scripts/import-pipelines.ts ./data/pipelines.geojson
   ```

The script inserts in batches of 500 and uses the existing `pipelines` table
+ GIST index, so all spatial queries continue to work unchanged.

You can use the same pattern to bulk-load `water_bodies`, `schools`, and
`grid_cost_points`.
