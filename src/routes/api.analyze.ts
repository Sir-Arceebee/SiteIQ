import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeRedundancy, type NearbyPipeline } from "@/server/redundancy";
// import { siteFailureRisk, type PipelineFeature } from "@/server/risk-model";
// import { waterScore, schoolPenalty } from "@/server/water-access";

/**
 * NOTE: For now this endpoint focuses on what actually works against the
 * pipeline dataset: nearby pipelines, min-cut estimate, and supply
 * diversity status. Failure risk, water, school, and grid scores are
 * intentionally commented out below — they'll come back online once
 * those datasets / models are wired in.
 */

type NearbyPipelineGeo = NearbyPipeline & {
  diameter_in?: number | null;
  geom_geojson: string;
};

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
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < -90 || lat > 90 ||
          lon < -180 || lon > 180
        ) {
          return Response.json({ error: "lat/lon out of range" }, { status: 400 });
        }

        try {
          const pipesRes = await supabaseAdmin.rpc("nearby_pipelines_geojson", {
            lat,
            lon,
            radius_m: 80_000,
          });
          if (pipesRes.error) throw pipesRes.error;

          const pipelines = (pipesRes.data ?? []) as NearbyPipelineGeo[];
          const redundancy = computeRedundancy(pipelines);

          // --- temporarily disabled scores -------------------------------
          // const [waterRes, schoolRes, gridRes] = await Promise.all([
          //   supabaseAdmin.rpc("nearest_water", { lat, lon, radius_m: 200_000 }),
          //   supabaseAdmin.rpc("nearest_school", { lat, lon }),
          //   supabaseAdmin.rpc("nearest_grid_cost", { lat, lon }),
          // ]);
          // const failure_probability = siteFailureRisk(pipelines);
          // const water_score = waterScore(...);
          // const school_penalty = schoolPenalty(...);
          // const grid_score = gridCostScore(...);
          // const final_score = ...;
          // ---------------------------------------------------------------

          return Response.json({
            input: { lat, lon },
            redundancy,
            nearby_pipeline_count: pipelines.length,
            nearby_pipelines_geo: pipelines.map((p) => ({
              id: p.id,
              name: p.name ?? null,
              operator: p.operator ?? null,
              pipe_type: p.pipe_type ?? null,
              material: p.material ?? null,
              vintage_year: p.vintage_year ?? null,
              distance_m: Math.round(p.distance_m),
              geom_geojson: p.geom_geojson,
            })),
            top_pipelines: pipelines.slice(0, 5).map((p) => ({
              id: p.id,
              name: p.name ?? null,
              operator: p.operator ?? null,
              pipe_type: p.pipe_type ?? null,
              material: p.material ?? null,
              vintage_year: p.vintage_year ?? null,
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
