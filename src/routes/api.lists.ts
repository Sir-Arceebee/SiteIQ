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

export const Route = createFileRoute("/api/lists")({
  server: {
    handlers: {
      // List all lists for a client_id
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const clientId = url.searchParams.get("client_id");
        if (!clientId) return Response.json({ error: "Missing client_id" }, { status: 400 });
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("places_lists" as never)
            .select("id,title,created_at,updated_at")
            .eq("client_id", clientId)
            .order("updated_at", { ascending: false });
          if (error) throw new Error(error.message);
          return Response.json({ lists: data ?? [] });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
      // Create a new list
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { client_id: string; title?: string };
          if (!body.client_id) return Response.json({ error: "Missing client_id" }, { status: 400 });
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("places_lists" as never)
            .insert({ client_id: body.client_id, title: body.title ?? "Untitled" } as never)
            .select("id,title,created_at,updated_at")
            .single();
          if (error) throw new Error(error.message);
          return Response.json({ list: data });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
      // Rename a list
      PATCH: async ({ request }) => {
        try {
          const body = (await request.json()) as { id: string; title: string };
          const supabase = getSupabase();
          const { error } = await supabase
            .from("places_lists" as never)
            .update({ title: body.title } as never)
            .eq("id", body.id);
          if (error) throw new Error(error.message);
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
      // Delete a list
      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
          const supabase = getSupabase();
          const { error } = await supabase.from("places_lists" as never).delete().eq("id", id);
          if (error) throw new Error(error.message);
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
        }
      },
    },
  },
});
