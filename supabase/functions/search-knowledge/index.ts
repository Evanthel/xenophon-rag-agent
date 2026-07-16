import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const embeddingSession = new Supabase.ai.Session("gte-small");

type MatchRow = {
  chunk_id: string;
  document_id: string;
  title: string;
  source_path: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
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

function normalizeSource(row: MatchRow, index: number) {
  const pageStart = Number(row.metadata?.page_start ?? 0);
  const pageEnd = Number(row.metadata?.page_end ?? 0);
  const pageLabel = pageStart > 0 && pageEnd > 0
    ? pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}-${pageEnd}`
    : null;

  return {
    index,
    title: row.title,
    source_path: row.source_path,
    chunk_index: row.chunk_index,
    similarity: row.similarity,
    page_start: pageStart || null,
    page_end: pageEnd || null,
    page_label: pageLabel,
    excerpt: row.content,
    metadata: row.metadata ?? {},
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query ?? "").trim();
    const matchCount = Math.min(Math.max(Number(body.match_count ?? 5), 1), 10);
    const matchThreshold = Math.min(Math.max(Number(body.match_threshold ?? 0.55), 0), 1);

    if (!query) return json({ error: "Missing query" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const queryEmbedding = await embeddingSession.run(query, {
      mean_pool: true,
      normalize: true,
    });

    const { data, error } = await supabase
      .rpc("match_document_chunks", {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        match_threshold: matchThreshold,
      });

    if (error) return json({ error: error.message }, 500);

    const results = ((data ?? []) as MatchRow[]).map((row, index) => normalizeSource(row, index + 1));

    return json({
      query,
      match_count: matchCount,
      match_threshold: matchThreshold,
      results,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
