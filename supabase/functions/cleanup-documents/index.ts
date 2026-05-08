import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type DocumentRow = {
  id: string;
  title: string;
  source_path: string;
  source_type: string;
  metadata: Record<string, unknown> | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const ingestToken = Deno.env.get("INGEST_TOKEN") ?? "";
    const providedToken = req.headers.get("x-ingest-token") ?? "";
    if (!ingestToken || providedToken !== ingestToken) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const sourcePaths = normalizeStringArray(body.source_paths);
    const sourcePathPrefix = String(body.source_path_prefix ?? "").trim();
    const titlePrefix = String(body.title_prefix ?? "").trim();
    const dryRun = Boolean(body.dry_run);

    if (!sourcePaths.length && !sourcePathPrefix && !titlePrefix) {
      return json({
        error: "Provide at least one cleanup filter: source_paths, source_path_prefix, or title_prefix",
      }, 400);
    }

    const { data: documents, error: selectError } = await supabase
      .from("documents")
      .select("id, title, source_path, source_type, metadata");

    if (selectError) return json({ error: selectError.message }, 500);

    const matched = (documents ?? []).filter((doc: DocumentRow) => {
      if (sourcePaths.length && sourcePaths.includes(doc.source_path)) return true;
      if (sourcePathPrefix && doc.source_path.startsWith(sourcePathPrefix)) return true;
      if (titlePrefix && doc.title.startsWith(titlePrefix)) return true;
      return false;
    });

    if (!matched.length) {
      return json({
        ok: true,
        dry_run: dryRun,
        deleted_documents: 0,
        matched_documents: [],
      });
    }

    const matchedIds = matched.map((doc) => doc.id);

    const { count: chunkCount, error: chunkCountError } = await supabase
      .from("document_chunks")
      .select("*", { count: "exact", head: true })
      .in("document_id", matchedIds);

    if (chunkCountError) return json({ error: chunkCountError.message }, 500);

    if (!dryRun) {
      const { error: deleteError } = await supabase
        .from("documents")
        .delete()
        .in("id", matchedIds);
      if (deleteError) return json({ error: deleteError.message }, 500);
    }

    return json({
      ok: true,
      dry_run: dryRun,
      deleted_documents: dryRun ? 0 : matched.length,
      matched_documents: matched.map((doc) => ({
        id: doc.id,
        title: doc.title,
        source_path: doc.source_path,
        source_type: doc.source_type,
        metadata: doc.metadata ?? {},
      })),
      matched_chunk_count: chunkCount ?? 0,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
