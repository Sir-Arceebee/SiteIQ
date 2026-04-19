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
 * Returns pipelines whose geometry intersects the given bounding box.
 * Used by the map's "Show all pipelines" toggle for viewport-based loading.
 *
 * Query: ?min_lat=&min_lon=&max_lat=&max_lon=
 */
export const Route = createFileRoute("/api/pipelines-bbox")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const min_lat = Number(u.searchParams.get("min_lat"));
        const min_lon = Number(u.searchParams.get("min_lon"));
        const max_lat = Number(u.searchParams.get("max_lat"));
        const max_lon = Number(u.searchParams.get("max_lon"));
        if (
          ![min_lat, min_lon, max_lat, max_lon].every(Number.isFinite) ||
          min_lat >= max_lat ||
          min_lon >= max_lon
        ) {
          return Response.json({ error: "Invalid bbox" }, { status: 400 });
        }

        try {
          const supabase = getSupabase();
          // Use rpc for typed access; pg function is defined in the migration.
          const { data, error } = await supabase.rpc(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "pipelines_in_bbox" as any,
            { min_lat, min_lon, max_lat, max_lon, max_rows: 5000 },
          );
          if (error) throw error;
          return Response.json({
            count: data?.length ?? 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pipelines: (data ?? []).map((p: any) => ({
              id: p.id,
              pipe_type: p.pipe_type ?? null,
              geom_geojson: p.geom_geojson,
            })),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("pipelines-bbox error:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
