/**
 * ============================================================
 * Supply Redundancy — Min-Cut Heuristic + Diversity Status
 * ============================================================
 * True min-cut requires the full pipeline graph. For the live
 * click endpoint, we use a defensible heuristic on the nearby
 * segments returned by PostGIS:
 *
 *   min_cut ≈ number of distinct (operator, pipe_type) pairs
 *
 * Rationale: each unique (operator, pipe_type) combination is a
 * roughly independent supply path. A single failure (operator
 * outage, regulatory action on interstate vs intrastate, etc.)
 * cannot sever paths belonging to a different combo.
 *
 * Diversity status is read directly from the `pipe_type` field:
 *   - "interstate_only" — all nearby segments are interstate
 *   - "intrastate_only" — all nearby segments are intrastate
 *   - "mixed"           — both classes present
 *   - "none"            — no nearby pipelines
 * ============================================================
 */

export type NearbyPipeline = {
  id: number;
  name?: string | null;
  operator?: string | null;
  pipe_type?: string | null;
  material?: string | null;
  vintage_year?: number | null;
  distance_m: number;
};

export type DiversityStatus =
  | "interstate_only"
  | "intrastate_only"
  | "mixed"
  | "none";

export type RedundancyResult = {
  min_cut_estimate: number;
  diversity_status: DiversityStatus;
  interstate_count: number;
  intrastate_count: number;
  unique_operators: number;
  unique_paths: Array<{ operator: string; pipe_type: string; count: number }>;
};

/**
 * NOTE on `min_cut_estimate` vs `unique_operators`:
 *   - unique_operators = number of distinct companies among nearby segments
 *   - min_cut_estimate = number of distinct (operator, pipe_type) combos
 * They differ ONLY when one operator runs both interstate AND intrastate lines
 * nearby (rare). The UI collapses them into one number — `min_cut_estimate` —
 * since that's the value that actually represents the supply-graph min-cut.
 */

function normalizePipeType(t: string | null | undefined): "interstate" | "intrastate" | "other" {
  const v = (t ?? "").toLowerCase();
  if (v.includes("interstate")) return "interstate";
  if (v.includes("intrastate")) return "intrastate";
  return "other";
}

export function computeRedundancy(pipelines: NearbyPipeline[]): RedundancyResult {
  if (pipelines.length === 0) {
    return {
      min_cut_estimate: 0,
      diversity_status: "none",
      interstate_count: 0,
      intrastate_count: 0,
      unique_operators: 0,
      unique_paths: [],
    };
  }

  let interstate = 0;
  let intrastate = 0;
  const pathCounts = new Map<string, { operator: string; pipe_type: string; count: number }>();
  const operators = new Set<string>();

  for (const p of pipelines) {
    const cls = normalizePipeType(p.pipe_type);
    if (cls === "interstate") interstate++;
    else if (cls === "intrastate") intrastate++;

    const op = (p.operator ?? "unknown").trim() || "unknown";
    operators.add(op);

    const key = `${op}::${cls}`;
    const existing = pathCounts.get(key);
    if (existing) existing.count++;
    else pathCounts.set(key, { operator: op, pipe_type: cls, count: 1 });
  }

  let diversity_status: DiversityStatus;
  if (interstate > 0 && intrastate > 0) diversity_status = "mixed";
  else if (interstate > 0) diversity_status = "interstate_only";
  else if (intrastate > 0) diversity_status = "intrastate_only";
  else diversity_status = "none";

  const unique_paths = Array.from(pathCounts.values()).sort((a, b) => b.count - a.count);

  return {
    min_cut_estimate: unique_paths.length,
    diversity_status,
    interstate_count: interstate,
    intrastate_count: intrastate,
    unique_operators: operators.size,
    unique_paths,
  };
}
