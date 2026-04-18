import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { computeRedundancy, type NearbyPipeline } from "@/server/redundancy";

type NearbyPipelineGeo = NearbyPipeline & {
  diameter_in?: number | null;
  geom_geojson: string;
};

// Use anon key server-side — pipelines table has public read RLS,
// and nearby_pipelines_geojson is granted to anon. No service role needed.
function getSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < -90 || lat > 90 ||
          lon < -180 || lon > 180
        ) {
          return Response.json({ error: "lat/lon out of range" }, { status: 400 });
        }

        try {
          const supabase = getSupabase();
          const pipesRes = await supabase.rpc("nearby_pipelines_geojson", {
            lat,
            lon,
            radius_m: 80_000,
          });
          if (pipesRes.error) throw pipesRes.error;

          const pipelines = (pipesRes.data ?? []) as NearbyPipelineGeo[];
          const redundancy = computeRedundancy(pipelines);

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
