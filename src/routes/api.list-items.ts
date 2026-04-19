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

// Compute the cached features (gas/power/school distance) for a point.
async function computeFeatures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  lat: number,
  lon: number,
) {
  const [gasRes, powerRes, schoolRes] = await Promise.all([
    supabase.rpc("nearby_pipelines", { lat, lon, radius_m: 100000 }),
    supabase.rpc("nearest_transmission" as never, { lat, lon, radius_m: 100000 } as never),
    supabase.rpc("nearest_school_v2" as never, { lat, lon } as never),
  ]);
  const pipes = (gasRes.data ?? []) as Array<{ pipe_type: string | null; distance_m: number }>;
  const nearestGas = pipes.length ? pipes.reduce((m, p) => (p.distance_m < m.distance_m ? p : m), pipes[0]) : null;
  const power = (powerRes.data ?? []) as Array<{ distance_m: number }>;
  const school = (schoolRes.data ?? []) as Array<{ distance_m: number }>;
  return {
    gas_m: nearestGas ? Number(nearestGas.distance_m) : null,
    pipe_type: nearestGas?.pipe_type ?? null,
    power_m: power[0] ? Number(power[0].distance_m) : null,
    school_m: school[0] ? Number(school[0].distance_m) : null,
  };
}

export const Route = createFileRoute("/api/list-items")({
  server: {
    handlers: {
      // List items for a list
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const listId = url.searchParams.get("list_id");
        if (!listId) return Response.json({ error: "Missing list_id" }, { status: 400 });
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("places_list_items" as never)
            .select("*")
            .eq("list_id", listId)
            .order("created_at", { ascending: true });
          if (error) throw new Error(error.message);
          return Response.json({ items: data ?? [] });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
      // Add an item (computes features server-side)
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            list_id: string;
            client_id: string;
            lat: number;
            lon: number;
            label?: string;
          };
          if (!body.list_id || !body.client_id) {
            return Response.json({ error: "Missing list_id or client_id" }, { status: 400 });
          }
          const supabase = getSupabase();
          const features = await computeFeatures(supabase, body.lat, body.lon);
          const { data, error } = await supabase
            .from("places_list_items" as never)
            .insert({
              list_id: body.list_id,
              client_id: body.client_id,
              lat: body.lat,
              lon: body.lon,
              label: body.label ?? null,
              ...features,
            } as never)
            .select("*")
            .single();
          if (error) throw new Error(error.message);
          // Bump parent updated_at
          await supabase
            .from("places_lists" as never)
            .update({ title: undefined } as never) // no-op; trigger fires on UPDATE
            .eq("id", body.list_id);
          return Response.json({ item: data });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
      // Delete a single item
      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
          const supabase = getSupabase();
          const { error } = await supabase.from("places_list_items" as never).delete().eq("id", id);
          if (error) throw new Error(error.message);
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
    },
  },
});
