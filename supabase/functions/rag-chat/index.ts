import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const embeddingSession = new Supabase.ai.Session("gte-small");

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("");
  }
  return "";
}

function extractRetrievalQuery(text: string) {
  const marker = "# User message";
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex === -1) return text.trim();
  return text.slice(markerIndex + marker.length).trim();
}

function sourceLabel(row: MatchRow, index: number) {
  const pageStart = Number(row.metadata?.page_start ?? 0);
  const pageEnd = Number(row.metadata?.page_end ?? 0);
  if (pageStart > 0 && pageEnd > 0) {
    return pageStart === pageEnd
      ? `[${index}] ${row.title}, p. ${pageStart}`
      : `[${index}] ${row.title}, pp. ${pageStart}-${pageEnd}`;
  }
  return `[${index}] ${row.title}`;
}

function buildContext(matches: MatchRow[]) {
  return matches
    .map((row, index) => {
      const label = sourceLabel(row, index + 1);
      return `${label}\n${row.content}`;
    })
    .join("\n\n");
}

function normalizeSource(row: MatchRow, index: number) {
  const pageStart = Number(row.metadata?.page_start ?? 0);
  const pageEnd = Number(row.metadata?.page_end ?? 0);
  const pageLabel = pageStart > 0 && pageEnd > 0
    ? pageStart === pageEnd
      ? `p. ${pageStart}`
      : `pp. ${pageStart}-${pageEnd}`
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
    citation: sourceLabel(row, index),
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body = await req.json();
    const openrouterApiKey = String(body.openrouterApiKey ?? "").trim();
    const model = String(body.model ?? "").trim();
    const messages = Array.isArray(body.messages) ? body.messages as ChatMessage[] : [];
    const temperature = Number(body.temperature ?? 0.8);
    const topP = Number(body.top_p ?? 1);
    const maxTokens = Number(body.max_tokens ?? 1024);
    const matchCount = Number(body.match_count ?? 4);
    const matchThreshold = Number(body.match_threshold ?? 0.55);
    const userMessage = extractRetrievalQuery(messages.at(-1)?.content ?? "");

    if (!openrouterApiKey) return json({ error: "Missing OpenRouter API key" }, 400);
    if (!model) return json({ error: "Missing model" }, 400);
    if (!messages.length || !userMessage) return json({ error: "Missing chat messages" }, 400);

    const queryEmbedding = await embeddingSession.run(userMessage, {
      mean_pool: true,
      normalize: true,
    });

    const { data, error } = await supabase
      .rpc("match_document_chunks", {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        match_threshold: matchThreshold,
      });

    if (error) {
      return json({ error: error.message }, 500);
    }

    const matches = (data ?? []) as MatchRow[];
    const sources = matches.map((row, idx) => normalizeSource(row, idx + 1));
    const ragMessages = messages.slice(0, -1);
    const retrievalInstructions = matches.length
      ? [
          "Use the retrieved context as high-priority evidence.",
          "Prefer the retrieved context when it conflicts with your background knowledge.",
          "Cite factual claims with bracketed source references like [1] or [2].",
          "If the retrieved context does not support an answer, say so plainly.",
          "",
          "# Retrieved context",
          buildContext(matches),
        ].join("\n")
      : [
          "No matching retrieval context was found.",
          "Answer carefully and say that no supporting sources were retrieved.",
        ].join("\n");

    ragMessages.push({ role: "system", content: retrievalInstructions });
    ragMessages.push(messages[messages.length - 1]);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterApiKey}`,
        "HTTP-Referer": req.headers.get("origin") ?? Deno.env.get("SUPABASE_URL") ?? "",
        "X-Title": "Xenophon RAG",
      },
      body: JSON.stringify({
        model,
        messages: ragMessages,
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
      }),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = responseBody?.error?.message ?? `OpenRouter HTTP ${response.status}`;
      return json({ error: message }, response.status);
    }

    const choice = responseBody?.choices?.[0];
    return json({
      reply: extractTextContent(choice?.message?.content),
      usage: responseBody?.usage ?? null,
      finish_reason: choice?.finish_reason ?? null,
      model_snapshot: responseBody?.model ?? model,
      id: responseBody?.id ?? null,
      sources,
      retrieved_count: sources.length,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
