import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const embeddingSession = new Supabase.ai.Session("gte-small");

type ChunkPayload = {
  chunk_index: number;
  content: string;
  metadata?: Record<string, unknown>;
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

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
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

    const body = await req.json();
    const document = body.document ?? {};
    const title = String(document.title ?? "").trim();
    const sourcePath = String(document.source_path ?? "").trim();
    const sourceType = String(document.source_type ?? "file").trim();
    const docMetadata = document.metadata ?? {};
    const replace = Boolean(body.replace);
    const chunks = Array.isArray(body.chunks) ? body.chunks as ChunkPayload[] : [];

    if (!title || !sourcePath) return json({ error: "Missing document title or source path" }, 400);
    if (!chunks.length) return json({ error: "No chunks to ingest" }, 400);

    const { data: docRows, error: upsertError } = await supabase
      .from("documents")
      .upsert({
        title,
        source_path: sourcePath,
        source_type: sourceType,
        metadata: docMetadata,
      }, {
        onConflict: "source_path",
      })
      .select("id")
      .limit(1);

    if (upsertError) return json({ error: upsertError.message }, 500);
    const documentId = docRows?.[0]?.id;
    if (!documentId) return json({ error: "Failed to resolve document id" }, 500);

    if (replace) {
      const { error: deleteError } = await supabase
        .from("document_chunks")
        .delete()
        .eq("document_id", documentId);
      if (deleteError) return json({ error: deleteError.message }, 500);
    }

    const rows = [];
    for (const chunk of chunks) {
      const content = String(chunk.content ?? "").trim();
      if (!content) continue;
      const embedding = await embeddingSession.run(content, {
        mean_pool: true,
        normalize: true,
      });
      rows.push({
        document_id: documentId,
        chunk_index: Number(chunk.chunk_index),
        content,
        token_estimate: estimateTokens(content),
        metadata: chunk.metadata ?? {},
        embedding,
      });
    }

    if (!rows.length) return json({ error: "All chunks were empty after normalization" }, 400);

    const { error: insertError } = await supabase
      .from("document_chunks")
      .upsert(rows, {
        onConflict: "document_id,chunk_index",
      });

    if (insertError) return json({ error: insertError.message }, 500);

    return json({
      ok: true,
      document_id: documentId,
      inserted_chunks: rows.length,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
