import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function getSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns ALL pipelines as a single GeoJSON FeatureCollection so the map can
 * render the full network when the user toggles "Show all pipelines".
 *
 * We use the existing `nearby_pipelines_geojson` RPC with a center near the
 * geographic center of the contiguous US and a huge radius (~5000 km), which
 * covers the whole dataset. This keeps us on the existing PostGIS pathway and
 * avoids needing a new RPC.
 */
export const Route = createFileRoute("/api/pipelines-all")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase.rpc("nearby_pipelines_geojson", {
            lat: 39.5,
            lon: -98.35,
            radius_m: 5_000_000,
          });
          if (error) throw error;
          return Response.json({
            count: data?.length ?? 0,
            pipelines: (data ?? []).map((p) => ({
              id: p.id,
              operator: p.operator ?? null,
              pipe_type: p.pipe_type ?? null,
              geom_geojson: p.geom_geojson,
            })),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("pipelines-all error:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
