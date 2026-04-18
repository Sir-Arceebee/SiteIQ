/**
 * ============================================================
 * PLUG-IN POINT #3 — Water Access
 * ============================================================
 * Today: nearest entry from the `water_bodies` table (seeded
 * with a handful of major rivers/lakes).
 *
 * To upgrade with a real dataset (e.g. USGS NHD):
 *   1. Load polygons/lines into the `water_bodies` table using
 *      the same import pattern as scripts/import-pipelines.ts.
 *   2. No code changes needed here — the RPC already returns
 *      the nearest feature by GIST index.
 * ============================================================
 */

export function waterScore(distance_m: number | null | undefined): number {
  if (distance_m == null) return 0;
  // Full score within 5km, decays to 0 by 50km.
  if (distance_m <= 5_000) return 1;
  if (distance_m >= 50_000) return 0;
  return Number(((50_000 - distance_m) / 45_000).toFixed(3));
}

/** Negative proximity: closer school = worse. Within 1km is a hard penalty. */
export function schoolPenalty(distance_m: number | null | undefined): number {
  if (distance_m == null) return 0;
  if (distance_m <= 1_000) return 1;
  if (distance_m >= 10_000) return 0;
  return Number(((10_000 - distance_m) / 9_000).toFixed(3));
}
