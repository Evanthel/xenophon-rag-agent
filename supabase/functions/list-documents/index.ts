import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const search = String(body.search ?? url.searchParams.get("search") ?? "").trim();
    const limit = Math.min(
      Math.max(Number(body.limit ?? url.searchParams.get("limit") ?? 20), 1),
      100,
    );
    const offset = Math.max(Number(body.offset ?? url.searchParams.get("offset") ?? 0), 0);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    let query = supabase
      .from("documents")
      .select("id, title, source_path, source_type, metadata, created_at, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      const escaped = search.replace(/[%_,]/g, (char) => `\\${char}`);
      query = query.or(`title.ilike.%${escaped}%,source_path.ilike.%${escaped}%`);
    }

    const { data, error, count } = await query;
    if (error) return json({ error: error.message }, 500);

    return json({
      documents: data ?? [],
      limit,
      offset,
      search,
      total: count ?? (data?.length ?? 0),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
