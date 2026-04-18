
## Plan

I'll do three things:

### 1. Add a new RPC `nearby_pipelines_geojson` (migration)
Returns the same fields as `nearby_pipelines` plus a `geom_geojson` column so the map can draw the actual line geometries. Keeps `nearby_pipelines` intact so nothing breaks.

### 2. Rewrite `src/server/redundancy.ts` to compute a real min-cut–style number
The min-cut of a supply network = the smallest number of pipelines you'd need to sever to disconnect a candidate site from upstream supply. With only nearby segments (no full graph), the standard proxy in industry tools is:

> **min-cut ≈ number of distinct independent supply paths reaching the site**

We approximate "independent supply paths" by grouping nearby pipelines into clusters that are spatially distinct (different bearings/operators). The cleanest heuristic that genuinely uses the dataset:

- **min_cut = unique (operator, pipe_type) combinations among nearby pipelines** — each combo is a roughly independent supply path. Different operators or different transport classes (interstate vs intrastate) cannot be cut by a single failure.
- **diversity status**: `interstate_only` / `intrastate_only` / `mixed` / `none` — directly from `pipe_type` field.

This is honest about being a heuristic but actually uses the spatial query result (not a stub). I'll keep it pure-TS (operates on the rows the API already fetches), so no extra DB round trip.

### 3. Update `/api/analyze` and `SiteMap.tsx`
- **API**: call the new RPC, return `nearby_pipelines_geo` with GeoJSON for the map. Comment out `failure_probability`, `water_score`, `school_penalty`, `grid_score`, and `final_score` from the response (they stay computed but are excluded so the popup focuses on min-cut + diversity).
- **Map**: after analyze response, draw nearby pipeline lines on the map (interstate=orange, intrastate=cyan), and rewrite the popup to focus on **min-cut estimate** + **diversity status** + **nearby pipeline count**. Comment out the rows for water/school/grid/failure-prob.

### Files
1. New migration: add `nearby_pipelines_geojson` RPC
2. `src/server/redundancy.ts` — rewrite with real min-cut heuristic + diversity status
3. `src/routes/api.analyze.ts` — use new RPC, comment out non-working scores
4. `src/components/SiteMap.tsx` — draw pipelines + simplified popup

Sound good?
