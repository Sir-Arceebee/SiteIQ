import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { siteFailureRisk, type PipelineFeature } from "@/server/risk-model";
import { computeRedundancy } from "@/server/redundancy";
import { waterScore, schoolPenalty } from "@/server/water-access";

/**
 * Final weighted site score. Tweak weights here to match your priorities.
 * Each component is normalized to 0..1 first.
 */
const WEIGHTS = {
  redundancy: 0.30,
  failureRisk: 0.30, // subtracted
  water: 0.20,
  schoolPenalty: 0.10, // subtracted
  gridCost: 0.10,      // subtracted (cheaper grid -> better)
};

function gridCostScore(costPerMwh: number | null | undefined): number {
  if (costPerMwh == null) return 0.5;
  // Map $30..$90 -> 1..0
  const c = Math.max(30, Math.min(90, Number(costPerMwh)));
  return Number(((90 - c) / 60).toFixed(3));
}

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { lat?: number; lon?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const lat = Number(body.lat);
        const lon = Number(body.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          return Response.json({ error: "lat/lon out of range" }, { status: 400 });
        }

        try {
          const [pipesRes, waterRes, schoolRes, gridRes] = await Promise.all([
            supabaseAdmin.rpc("nearby_pipelines", { lat, lon, radius_m: 80_000 }),
            supabaseAdmin.rpc("nearest_water", { lat, lon, radius_m: 200_000 }),
            supabaseAdmin.rpc("nearest_school", { lat, lon }),
            supabaseAdmin.rpc("nearest_grid_cost", { lat, lon }),
          ]);

          if (pipesRes.error) throw pipesRes.error;
          if (waterRes.error) throw waterRes.error;
          if (schoolRes.error) throw schoolRes.error;
          if (gridRes.error) throw gridRes.error;

          const pipelines = (pipesRes.data ?? []) as (PipelineFeature & { operator?: string | null; name?: string })[];
          const water = (waterRes.data ?? [])[0] ?? null;
          const school = (schoolRes.data ?? [])[0] ?? null;
          const grid = (gridRes.data ?? [])[0] ?? null;

          const redundancy = computeRedundancy(pipelines);
          const failure_probability = siteFailureRisk(pipelines);
          const water_score = waterScore(water?.distance_m);
          const school_penalty = schoolPenalty(school?.distance_m);
          const grid_score = gridCostScore(grid?.cost_per_mwh);

          const final_score = Number(
            (
              WEIGHTS.redundancy * redundancy.score
              - WEIGHTS.failureRisk * Math.min(1, failure_probability * 50) // scale prob into 0..1 band
              + WEIGHTS.water * water_score
              - WEIGHTS.schoolPenalty * school_penalty
              + WEIGHTS.gridCost * grid_score
            ).toFixed(3),
          );

          return Response.json({
            input: { lat, lon },
            final_score,
            weights: WEIGHTS,
            redundancy,
            failure_probability,
            nearest_water: water,
            nearest_school: school,
            nearest_grid: grid,
            water_score,
            school_penalty,
            grid_score,
            nearby_pipeline_count: pipelines.length,
            top_pipelines: pipelines.slice(0, 5).map((p) => ({
              id: p.id,
              name: (p as { name?: string }).name ?? null,
              operator: p.operator ?? null,
              pipe_type: p.pipe_type,
              material: p.material,
              vintage_year: p.vintage_year,
              distance_m: Math.round(p.distance_m),
            })),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("analyze error:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
