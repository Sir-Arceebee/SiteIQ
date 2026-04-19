import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { analyze, type RawPoint } from "@/server/similarity";

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

export const Route = createFileRoute("/api/list-analyze")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const listId = url.searchParams.get("list_id");
        if (!listId) return Response.json({ error: "Missing list_id" }, { status: 400 });
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("places_list_items" as never)
            .select("id,lat,lon,label,gas_m,power_m,school_m")
            .eq("list_id", listId);
          if (error) throw new Error(error.message);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = (data ?? []) as any[];
          const points: RawPoint[] = rows.map((r) => ({
            id: String(r.id),
            lat: Number(r.lat),
            lon: Number(r.lon),
            label: r.label ?? null,
            gas_m: r.gas_m == null ? null : Number(r.gas_m),
            power_m: r.power_m == null ? null : Number(r.power_m),
            school_m: r.school_m == null ? null : Number(r.school_m),
          }));
          const result = analyze(points, 4);
          return Response.json(result);
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
    },
  },
});
