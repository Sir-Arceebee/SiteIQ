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
  max_school_km?: number; // user UI: "min distance from school"
};

export type OptimalPoint = {
  lat: number;
  lon: number;
  gas_km: number;
  power_km: number;
  school_km: number | null;
  pipe_type: string | null;
};

const REGIONS: Record<string, [number, number, number, number]> = {
  all:       [25, -125, 49, -67],
  northeast: [37, -82,  47, -67],
  southeast: [25, -92,  37, -75],
  midwest:   [37, -104, 49, -82],
  southwest: [27, -115, 37, -94],
  west:      [32, -125, 49, -110],
};

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
        const minSchoolM = (body.max_school_km ?? 0) * 1000;
        const [minLat, minLon, maxLat, maxLon] = REGIONS[region] ?? REGIONS.all;

        try {
          const supabase = getSupabase();
          const { data, error } = await supabase.rpc(
            "find_optimal_sites" as never,
            {
              min_lat: minLat,
              min_lon: minLon,
              max_lat: maxLat,
              max_lon: maxLon,
              step_deg: 1.0,
              max_gas_m: maxGasM,
              max_power_m: maxPowerM,
              min_school_m: minSchoolM,
              pipe_class: pipeClass,
              max_results: 500,
            } as never,
          );
          if (error) throw new Error(error.message);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = (data ?? []) as any[];
          const points: OptimalPoint[] = rows.map((r) => ({
            lat: Number(r.lat),
            lon: Number(r.lon),
            gas_km: +(Number(r.gas_m) / 1000).toFixed(2),
            power_km: +(Number(r.power_m) / 1000).toFixed(2),
            school_km:
              r.school_m == null ? null : +(Number(r.school_m) / 1000).toFixed(2),
            pipe_type: r.pipe_type ?? null,
          }));

          return Response.json({ count: points.length, points });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("optimal-places error:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
