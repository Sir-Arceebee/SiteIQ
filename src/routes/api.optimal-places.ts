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

type Body = {
  region?: "all" | "northeast" | "southeast" | "midwest" | "southwest" | "west";
  pipe_class?: "interstate" | "intrastate" | "both";
  max_gas_km?: number;
  max_power_km?: number;
  max_school_km?: number;
};

export type OptimalPoint = {
  lat: number;
  lon: number;
  gas_km: number;
  power_km: number;
  school_km: number | null;
};

// Coarse US grid (~1° spacing) over the contiguous US.
function usGrid(region: NonNullable<Body["region"]>): Array<{ lat: number; lon: number }> {
  const bounds: Record<string, [number, number, number, number]> = {
    all:       [25, -125, 49, -67],
    northeast: [37, -82,  47, -67],
    southeast: [25, -92,  37, -75],
    midwest:   [37, -104, 49, -82],
    southwest: [27, -115, 37, -94],
    west:      [32, -125, 49, -110],
  };
  const [minLat, minLon, maxLat, maxLon] = bounds[region] ?? bounds.all;
  const step = 1.0;
  const pts: Array<{ lat: number; lon: number }> = [];
  for (let lat = minLat; lat <= maxLat; lat += step) {
    for (let lon = minLon; lon <= maxLon; lon += step) {
      pts.push({ lat, lon });
    }
  }
  return pts;
}

export const Route = createFileRoute("/api/optimal-places")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const region = body.region ?? "all";
        const pipeClass = body.pipe_class ?? "both";
        const maxGasM = (body.max_gas_km ?? 50) * 1000;
        const maxPowerM = (body.max_power_km ?? 50) * 1000;
        const maxSchoolKm = body.max_school_km ?? 50;
        const maxSchoolM = maxSchoolKm * 1000;

        try {
          const supabase = getSupabase();
          const grid = usGrid(region);

          const results: OptimalPoint[] = [];

          const CONCURRENCY = 16;
          let idx = 0;
          async function worker() {
            while (idx < grid.length) {
              const myIdx = idx++;
              const { lat, lon } = grid[myIdx];
              const [pipesRes, powerRes, schoolRes] = await Promise.all([
                supabase.rpc("nearby_pipelines", { lat, lon, radius_m: maxGasM }),
                supabase.rpc("nearest_transmission" as never, { lat, lon, radius_m: maxPowerM } as never),
                supabase.rpc("nearest_school_v2" as never, { lat, lon } as never),
              ]);
              const pipes = (pipesRes.data ?? []) as Array<{ pipe_type: string | null; distance_m: number }>;
              if (pipes.length === 0) continue;
              const nearestGas = pipes.reduce((m, p) => Math.min(m, p.distance_m), Infinity);
              if (nearestGas > maxGasM) continue;

              if (pipeClass !== "both") {
                const ok = pipes.some((p) => (p.pipe_type ?? "").toLowerCase().includes(pipeClass));
                if (!ok) continue;
              }

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const power = (powerRes.data ?? []) as any[];
              if (!power || power.length === 0) continue;
              const powerDist = Number(power[0].distance_m);
              if (!Number.isFinite(powerDist) || powerDist > maxPowerM) continue;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const school = (schoolRes.data ?? []) as any[];
              const schoolDistRaw = school?.[0]?.distance_m;
              const schoolDist = Number.isFinite(Number(schoolDistRaw)) ? Number(schoolDistRaw) : null;
              // Filter: site must be at least maxSchoolKm AWAY from any school (min distance).
              // i.e., reject if a school is closer than maxSchoolM.
              if (schoolDist !== null && schoolDist < maxSchoolM) continue;

              results.push({
                lat,
                lon,
                gas_km: +(nearestGas / 1000).toFixed(2),
                power_km: +(powerDist / 1000).toFixed(2),
                school_km: schoolDist === null ? null : +(schoolDist / 1000).toFixed(2),
              });
            }
          }
          await Promise.all(Array.from({ length: CONCURRENCY }, worker));

          // Sort by combined proximity (lower gas+power is better).
          results.sort((a, b) => (a.gas_km + a.power_km) - (b.gas_km + b.power_km));

          return Response.json({
            count: results.length,
            points: results,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("optimal-places error:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
