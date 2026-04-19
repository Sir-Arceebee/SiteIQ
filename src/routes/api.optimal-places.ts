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
    db: { schema: "public" },
    global: { headers: { "x-statement-timeout": "120s" } },
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

/**
 * Split a bbox into N×N tiles. Smaller tiles keep each PostGIS RPC call
 * under the database statement_timeout — we run them sequentially and merge.
 */
function tileBbox(bbox: [number, number, number, number], n: number): Array<[number, number, number, number]> {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const dLat = (maxLat - minLat) / n;
  const dLon = (maxLon - minLon) / n;
  const tiles: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    tiles.push([minLat + i * dLat, minLon + j * dLon, minLat + (i + 1) * dLat, minLon + (j + 1) * dLon]);
  }
  return tiles;
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
        const maxGasKm = body.max_gas_km ?? 50;
        const maxPowerKm = body.max_power_km ?? 50;
        const maxGasM = maxGasKm * 1000;
        const maxPowerM = maxPowerKm * 1000;
        const minSchoolM = (body.max_school_km ?? 0) * 1000;
        const bbox = REGIONS[region] ?? REGIONS.all;
        // Grid step in degrees. 1° ≈ 111 km. We sample at ~half the smaller
        // distance constraint so candidate cells can't all fall outside a
        // narrow buffer (e.g. 10km gas with 1° step would skip valid sites).
        // Floor at 0.1° (~11 km) so very tight thresholds don't blow up the
        // grid size and timeout the DB.
        const minConstraintKm = Math.min(maxGasKm, maxPowerKm);
        const stepDeg = Math.max(0.1, Math.min(1.0, minConstraintKm / 222));
        // Tile count scales inversely with step: smaller step → more cells per
        // tile → need smaller tiles to stay under DB statement_timeout.
        const tileN = stepDeg <= 0.2 ? 6 : stepDeg <= 0.5 ? 4 : region === "all" ? 4 : 2;
        const tiles = tileBbox(bbox, tileN);

        try {
          const supabase = getSupabase();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allRows: any[] = [];
          for (const [minLat, minLon, maxLat, maxLon] of tiles) {
            const { data, error } = await supabase.rpc(
              "find_optimal_sites" as never,
              {
                min_lat: minLat,
                min_lon: minLon,
                max_lat: maxLat,
                max_lon: maxLon,
                step_deg: stepDeg,
                max_gas_m: maxGasM,
                max_power_m: maxPowerM,
                min_school_m: minSchoolM,
                pipe_class: pipeClass,
                max_results: 200,
              } as never,
            );
            if (error) {
              // Soft-fail a single tile so partial results still come back.
              console.warn(`tile ${minLat},${minLon} failed: ${error.message}`);
              continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const r of (data ?? []) as any[]) allRows.push(r);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const points: OptimalPoint[] = allRows.map((r) => ({
            lat: Number(r.lat),
            lon: Number(r.lon),
            gas_km: +(Number(r.gas_m) / 1000).toFixed(2),
            power_km: +(Number(r.power_m) / 1000).toFixed(2),
            school_km:
              r.school_m == null ? null : +(Number(r.school_m) / 1000).toFixed(2),
            pipe_type: r.pipe_type ?? null,
          }))
            // Best-first by min(gas, power) so the user sees strongest sites first.
            .sort((a, b) => Math.min(a.gas_km, a.power_km) - Math.min(b.gas_km, b.power_km))
            .slice(0, 500);

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
