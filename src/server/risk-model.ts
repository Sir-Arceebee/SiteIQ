/**
 * ============================================================
 * PLUG-IN POINT #1 — Failure Probability Risk Model
 * ============================================================
 * Replace the body of `predictFailureProbability` with a call
 * to your real ML model when ready.
 *
 * Two ways to swap it out later:
 *   (A) Pure-TS rules: just edit the math below.
 *   (B) External model API: replace the body with
 *       `const r = await fetch(process.env.RISK_MODEL_URL!, ...)`
 *       and parse the JSON response.
 *
 * Inputs come from the `pipelines` table (material, vintage_year,
 * diameter, etc.). Add columns there if your model needs more
 * features, then surface them through the `nearby_pipelines` RPC.
 * ============================================================
 */

export type PipelineFeature = {
  id: number;
  material: string | null;
  vintage_year: number | null;
  diameter_in: number | null;
  pipe_type: string | null;
  distance_m: number;
};

// Base annual failure probability per material (rough literature priors).
const MATERIAL_BASE: Record<string, number> = {
  "Cast Iron": 0.018,
  "Steel-Bare": 0.012,
  "Steel-Coated": 0.004,
  "Plastic": 0.002,
  Unknown: 0.008,
};

export function predictFailureProbability(p: PipelineFeature): number {
  const material = p.material ?? "Unknown";
  const base = MATERIAL_BASE[material] ?? MATERIAL_BASE.Unknown;

  // Age multiplier: each decade past install adds ~10% relative risk.
  const currentYear = new Date().getUTCFullYear();
  const age = p.vintage_year ? Math.max(0, currentYear - p.vintage_year) : 30;
  const ageMult = 1 + (age / 10) * 0.1;

  // Diameter: larger pipes slightly less likely to fail per mile.
  const d = p.diameter_in ?? 16;
  const diaMult = Math.max(0.7, 1 - (d - 16) * 0.005);

  const prob = Math.min(1, base * ageMult * diaMult);
  return Number(prob.toFixed(5));
}

/** Aggregate risk for the candidate site = max of nearby pipelines, weighted by inverse distance. */
export function siteFailureRisk(pipelines: PipelineFeature[]): number {
  if (pipelines.length === 0) return 0;
  const weighted = pipelines.map((p) => {
    const w = 1 / Math.max(500, p.distance_m); // closer pipes dominate
    return predictFailureProbability(p) * w;
  });
  const sumW = pipelines.reduce(
    (s, p) => s + 1 / Math.max(500, p.distance_m),
    0,
  );
  return Number((weighted.reduce((a, b) => a + b, 0) / sumW).toFixed(5));
}
