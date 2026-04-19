import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { computeRedundancy, type NearbyPipeline } from "@/server/redundancy";

type NearbyPipelineGeo = NearbyPipeline & {
  diameter_in?: number | null;
  geom_geojson: string;
};

function getSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env vars (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Classify a point as urban / suburban / rural using OpenStreetMap Overpass API.
 * Uses landuse tags within ~2km. Falls back to "unknown" on failure / timeout.
 */
async function classifyPlaceType(
  lat: number,
  lon: number,
): Promise<"urban" | "suburban" | "rural" | "unknown"> {
  const radius = 2000; // meters
  const query = `
    [out:json][timeout:8];
    (
      way["landuse"~"residential|commercial|industrial|retail"](around:${radius},${lat},${lon});
      relation["landuse"~"residential|commercial|industrial|retail"](around:${radius},${lat},${lon});
    );
    out tags 50;
  `.trim();

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9_000);
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { elements?: Array<{ tags?: { landuse?: string } }> };
    const counts = { residential: 0, commercial: 0, industrial: 0, retail: 0 };
    for (const el of data.elements ?? []) {
      const lu = el.tags?.landuse;
      if (lu && lu in counts) counts[lu as keyof typeof counts]++;
    }
    const total = counts.residential + counts.commercial + counts.industrial + counts.retail;
    if (total === 0) return "rural";
    // Heuristic: dense residential + commercial = urban; mostly residential = suburban
    if (counts.commercial + counts.retail + counts.industrial >= 3 && counts.residential >= 2) {
      return "urban";
    }
    if (counts.residential >= 1) return "suburban";
    return "rural";
  } catch {
    return "unknown";
  }
}

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { lat?: number; lon?: number; radius_m?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const lat = Number(body.lat);
        const lon = Number(body.lon);
        const radius_m = Number.isFinite(Number(body.radius_m))
          ? Math.min(Math.max(Number(body.radius_m), 1_000), 500_000)
          : 80_000;
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

          // Run all four lookups in parallel.
          const [pipesRes, schoolRes, transRes, placeType] = await Promise.all([
            supabase.rpc("nearby_pipelines_geojson", { lat, lon, radius_m }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.rpc("nearest_school_v2" as any, { lat, lon }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.rpc("nearest_transmission" as any, { lat, lon, radius_m: 200_000 }),
            classifyPlaceType(lat, lon),
          ]);

          if (pipesRes.error) throw pipesRes.error;

          const pipelines = (pipesRes.data ?? []) as NearbyPipelineGeo[];
          const redundancy = computeRedundancy(pipelines);

          const nearestGasM = pipelines.length
            ? Math.round(Math.min(...pipelines.map((p) => p.distance_m)))
            : null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const schoolRow = (schoolRes.data as any[] | null)?.[0] ?? null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const transRow = (transRes.data as any[] | null)?.[0] ?? null;

          return Response.json({
            input: { lat, lon },
            radius_m,
            redundancy,
            nearby_pipeline_count: pipelines.length,
            gas_distance_m: nearestGasM,
            electricity_distance_m: transRow ? Math.round(transRow.distance_m) : null,
            nearest_school: schoolRow
              ? { name: schoolRow.name as string | null, distance_m: Math.round(schoolRow.distance_m) }
              : null,
            place_type: placeType,
            predicted_reliability: "NYI",
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
