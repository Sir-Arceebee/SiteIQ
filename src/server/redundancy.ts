/**
 * ============================================================
 * PLUG-IN POINT #2 — Supply Redundancy / Min-Cut Heuristic
 * ============================================================
 * A true min-cut needs the full pipeline graph in memory.
 * For the live click endpoint we use a fast proxy:
 *   - count of distinct nearby supply lines
 *   - mix of interstate vs intrastate (diversity)
 *   - distinct operators (operator diversity)
 *
 * To upgrade later: precompute min-cut values per region offline,
 * store them in a `redundancy_cache` table, and look them up here.
 * ============================================================
 */
import type { PipelineFeature } from "./risk-model";

export type RedundancyResult = {
  score: number; // 0..1
  min_cut_estimate: number;
  interstate_count: number;
  intrastate_count: number;
  unique_operators: number;
};

export function computeRedundancy(
  pipelines: (PipelineFeature & { operator?: string | null })[],
): RedundancyResult {
  const interstate = pipelines.filter((p) => p.pipe_type === "interstate").length;
  const intrastate = pipelines.filter((p) => p.pipe_type === "intrastate").length;
  const operators = new Set(
    pipelines.map((p) => p.operator ?? "unknown").filter(Boolean),
  );

  // Heuristic min-cut proxy: smaller of the two source classes,
  // bumped by operator diversity.
  const minCut = Math.min(interstate, intrastate) + Math.floor(operators.size / 2);

  // Normalize to a 0..1 score (saturates around 6 redundant paths).
  const score = Math.min(1, (interstate * 0.35 + intrastate * 0.2 + operators.size * 0.15) / 3);

  return {
    score: Number(score.toFixed(3)),
    min_cut_estimate: minCut,
    interstate_count: interstate,
    intrastate_count: intrastate,
    unique_operators: operators.size,
  };
}
