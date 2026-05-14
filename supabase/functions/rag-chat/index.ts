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

type UsageShape = {
  prompt_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

type PlannerResult = {
  intent: string;
  retrieval_goal: string;
  rewritten_queries: string[];
  used_fallback: boolean;
};

type VerificationResult = {
  status: "grounded" | "weak_evidence";
  supported_claims: string[];
  unsupported_claims: string[];
  note: string;
  parse_failed?: boolean;
};

type TraceStep = {
  id: string;
  label: string;
  status: "done" | "skipped" | "low_confidence";
  summary: string;
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
    matched_queries: Array.isArray(row.metadata?.matched_queries) ? row.metadata?.matched_queries : [],
    metadata: row.metadata ?? {},
  };
}

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function uniqueQueries(queries: string[], fallback: string) {
  const deduped = new Set<string>();
  for (const query of queries) {
    const normalized = String(query ?? "").replace(/\s+/g, " ").trim();
    if (normalized) deduped.add(normalized);
    if (deduped.size >= 3) break;
  }
  if (!deduped.size) deduped.add(fallback.trim());
  return Array.from(deduped).slice(0, 3);
}

function parsePlannerResult(rawText: string, fallbackQuery: string): PlannerResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return {
      intent: "Could not parse planner output reliably.",
      retrieval_goal: "Fallback to the raw user question for retrieval.",
      rewritten_queries: [fallbackQuery.trim()],
      used_fallback: true,
    };
  }

  const rawQueries = Array.isArray(parsed.rewritten_queries)
    ? parsed.rewritten_queries.map((item) => String(item ?? ""))
    : [];
  const rewrittenQueries = uniqueQueries(rawQueries, fallbackQuery);
  const fallbackNormalized = fallbackQuery.trim();
  const usedFallback = !rawQueries.length ||
    (rewrittenQueries.length === 1 && rewrittenQueries[0] === fallbackNormalized);

  return {
    intent: String(parsed.intent ?? "Clarify the user's request before retrieval.").trim(),
    retrieval_goal: String(parsed.retrieval_goal ?? "Retrieve evidence that directly answers the user's question.").trim(),
    rewritten_queries: rewrittenQueries,
    used_fallback: usedFallback,
  };
}

function parseVerificationResult(rawText: string, hasSources: boolean, hasCitations: boolean): VerificationResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return {
      status: hasSources && hasCitations ? "grounded" : "weak_evidence",
      supported_claims: hasSources && hasCitations ? ["The answer references retrieved sources with inline citations."] : [],
      unsupported_claims: hasSources || hasCitations ? [] : ["The answer does not provide strong evidence grounding."],
      note: "Verifier output could not be parsed; using a heuristic fallback.",
      parse_failed: true,
    };
  }

  const status = String(parsed.status ?? "").trim() === "grounded" ? "grounded" : "weak_evidence";
  const supportedClaims = Array.isArray(parsed.supported_claims)
    ? parsed.supported_claims.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 4)
    : [];
  const unsupportedClaims = Array.isArray(parsed.unsupported_claims)
    ? parsed.unsupported_claims.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 4)
    : [];

  return {
    status,
    supported_claims: supportedClaims,
    unsupported_claims: unsupportedClaims,
    note: String(parsed.note ?? "").trim() || (status === "grounded"
      ? "Most core claims appear supported by retrieved evidence."
      : "Some claims are unsupported, missing citations, or weakly grounded."),
  };
}

function extractUsedSourceCitations(answer: string, sources: Array<{ index: number; citation: string }>) {
  const citedIndexes = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const index = Number(match[1]);
    if (Number.isFinite(index)) citedIndexes.add(index);
  }
  return sources
    .filter((source) => citedIndexes.has(source.index))
    .map((source) => source.citation);
}

function sumUsage(usages: Array<UsageShape | null | undefined>): UsageShape | null {
  const valid = usages.filter(Boolean) as UsageShape[];
  if (!valid.length) return null;

  let promptTokens = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;

  for (const usage of valid) {
    promptTokens += Number(usage.prompt_tokens ?? 0);
    totalTokens += Number(usage.total_tokens ?? 0);
    cachedTokens += Number(usage.prompt_tokens_details?.cached_tokens ?? 0);
    reasoningTokens += Number(usage.completion_tokens_details?.reasoning_tokens ?? 0);
  }

  return {
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: { cached_tokens: cachedTokens },
    completion_tokens_details: { reasoning_tokens: reasoningTokens },
  };
}

async function callOpenRouterChat({
  openrouterApiKey,
  model,
  messages,
  temperature,
  topP,
  maxTokens,
  referer,
  title,
}: {
  openrouterApiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  topP: number;
  maxTokens: number;
  referer: string;
  title: string;
}) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openrouterApiKey}`,
      "HTTP-Referer": referer,
      "X-Title": title,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
    }),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = responseBody?.error?.message ?? `OpenRouter HTTP ${response.status}`;
    throw new Error(message);
  }

  const choice = responseBody?.choices?.[0];
  return {
    reply: extractTextContent(choice?.message?.content),
    usage: (responseBody?.usage ?? null) as UsageShape | null,
    finish_reason: choice?.finish_reason ?? null,
    model_snapshot: responseBody?.model ?? model,
    id: responseBody?.id ?? null,
  };
}

async function retrieveMatchesForQueries({
  supabase,
  queries,
  matchCount,
  matchThreshold,
}: {
  supabase: ReturnType<typeof createClient>;
  queries: string[];
  matchCount: number;
  matchThreshold: number;
}) {
  const byChunk = new Map<string, MatchRow>();

  for (const query of queries) {
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

    if (error) throw new Error(error.message);

    for (const rawRow of (data ?? []) as MatchRow[]) {
      const matchedQueries = Array.isArray(rawRow.metadata?.matched_queries)
        ? rawRow.metadata?.matched_queries as string[]
        : [];
      const row: MatchRow = {
        ...rawRow,
        metadata: {
          ...(rawRow.metadata ?? {}),
          matched_queries: uniqueQueries([...matchedQueries, query], query),
        },
      };
      const existing = byChunk.get(row.chunk_id);
      if (!existing || row.similarity > existing.similarity) {
        byChunk.set(row.chunk_id, row);
      } else if (existing.metadata) {
        const existingQueries = Array.isArray(existing.metadata.matched_queries)
          ? existing.metadata.matched_queries as string[]
          : [];
        existing.metadata = {
          ...existing.metadata,
          matched_queries: uniqueQueries([...existingQueries, query], query),
        };
      }
    }
  }

  return Array.from(byChunk.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
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
    const pipelineMode = String(body.pipeline_mode ?? "rag").trim().toLowerCase();
    const isAgentPipeline = pipelineMode === "agent";
    const userMessage = extractRetrievalQuery(messages.at(-1)?.content ?? "");
    const referer = req.headers.get("origin") ?? Deno.env.get("SUPABASE_URL") ?? "";

    if (!openrouterApiKey) return json({ error: "Missing OpenRouter API key" }, 400);
    if (!model) return json({ error: "Missing model" }, 400);
    if (!messages.length || !userMessage) return json({ error: "Missing chat messages" }, 400);

    let planner = {
      intent: "Direct retrieval from the latest user question.",
      retrieval_goal: "Retrieve evidence relevant to the latest user question.",
      rewritten_queries: [userMessage],
      used_fallback: true,
    } satisfies PlannerResult;
    const traceSteps: TraceStep[] = [];
    const usageParts: Array<UsageShape | null | undefined> = [];

    if (isAgentPipeline) {
      try {
        const plannerResult = await callOpenRouterChat({
          openrouterApiKey,
          model,
          temperature: Math.min(temperature, 0.4),
          topP: Math.min(topP, 0.9),
          maxTokens: 320,
          referer,
          title: "Xenophon Agent Planner",
          messages: [
            {
              role: "system",
              content: [
                "You are the planning step in a retrieval agent.",
                "Return strict JSON with keys: intent, retrieval_goal, rewritten_queries.",
                "rewritten_queries must be an array of 2 or 3 short search queries.",
                "Focus on terms that will help semantic retrieval find grounded evidence.",
                "Do not add markdown fences or commentary.",
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                "# Latest user question",
                userMessage,
                "",
                "# Recent conversation",
                messages
                  .slice(-4)
                  .map((message) => {
                    const content = message.role === "user" ? extractRetrievalQuery(message.content) : message.content;
                    return `${message.role.toUpperCase()}: ${content}`;
                  })
                  .join("\n\n"),
              ].join("\n"),
            },
          ],
        });
        usageParts.push(plannerResult.usage);
        planner = parsePlannerResult(plannerResult.reply, userMessage);
      } catch {
        planner = {
          intent: "Planner call failed; fallback to direct retrieval.",
          retrieval_goal: "Retrieve evidence for the raw user question only.",
          rewritten_queries: [userMessage],
          used_fallback: true,
        };
      }

      traceSteps.push({
        id: "plan",
        label: "Plan",
        status: planner.used_fallback ? "low_confidence" : "done",
        summary: planner.intent,
      });
      traceSteps.push({
        id: "query_rewrite",
        label: "Query rewrite",
        status: planner.used_fallback ? "skipped" : "done",
        summary: planner.used_fallback
          ? "Planner fallback used the raw question as the only retrieval query."
          : `${planner.rewritten_queries.length} retrieval queries prepared.`,
      });
    }

    const matches = await retrieveMatchesForQueries({
      supabase,
      queries: isAgentPipeline ? planner.rewritten_queries : [userMessage],
      matchCount,
      matchThreshold,
    });
    const sources = matches.map((row, idx) => normalizeSource(row, idx + 1));
    if (isAgentPipeline) {
      traceSteps.push({
        id: "retrieve",
        label: "Retrieve",
        status: sources.length ? "done" : "low_confidence",
        summary: sources.length
          ? `${sources.length} chunks selected from ${planner.rewritten_queries.length} query path(s).`
          : "No retrieved chunks met the similarity threshold.",
      });
    }

    const ragMessages = messages.slice(0, -1);
    const retrievalInstructions = matches.length
      ? [
          isAgentPipeline ? "You are the answer step in an agentic retrieval pipeline." : "",
          "Use the retrieved context as high-priority evidence.",
          "Prefer the retrieved context when it conflicts with your background knowledge.",
          "Cite factual claims with bracketed source references like [1] or [2].",
          "If the retrieved context does not support an answer, say so plainly.",
          isAgentPipeline ? `Planning intent: ${planner.intent}` : "",
          isAgentPipeline ? `Retrieval goal: ${planner.retrieval_goal}` : "",
          isAgentPipeline ? `Queries used: ${planner.rewritten_queries.join(" | ")}` : "",
          "",
          "# Retrieved context",
          buildContext(matches),
        ].filter(Boolean).join("\n")
      : [
          isAgentPipeline ? "You are the answer step in an agentic retrieval pipeline." : "",
          "No matching retrieval context was found.",
          "Answer carefully and say that no supporting sources were retrieved.",
          isAgentPipeline ? `Planning intent: ${planner.intent}` : "",
        ].filter(Boolean).join("\n");

    ragMessages.push({ role: "system", content: retrievalInstructions });
    ragMessages.push(messages[messages.length - 1]);

    const answerResult = await callOpenRouterChat({
      openrouterApiKey,
      model,
      messages: ragMessages,
      temperature,
      topP,
      maxTokens,
      referer,
      title: isAgentPipeline ? "Xenophon Agent Answer" : "Xenophon RAG",
    });
    usageParts.push(answerResult.usage);

    let trace = null;
    if (isAgentPipeline) {
      const usedSources = extractUsedSourceCitations(answerResult.reply, sources);
      const hasCitations = usedSources.length > 0;
      traceSteps.push({
        id: "answer",
        label: "Answer",
        status: "done",
        summary: hasCitations
          ? `Answer generated with ${usedSources.length} cited source reference(s).`
          : "Answer generated without explicit source citations.",
      });

      let verification: VerificationResult;
      if (!sources.length) {
        verification = {
          status: "weak_evidence",
          supported_claims: [],
          unsupported_claims: ["No retrieved chunks were available to support the answer."],
          note: "No retrieval evidence was available, so the answer should be treated cautiously.",
        };
      } else {
        try {
          const verifyResult = await callOpenRouterChat({
            openrouterApiKey,
            model,
            temperature: 0.1,
            topP: 0.9,
            maxTokens: 260,
            referer,
            title: "Xenophon Agent Verify",
            messages: [
              {
                role: "system",
                content: [
                  "You are the verification step in an agentic retrieval pipeline.",
                  "Return strict JSON with keys: status, supported_claims, unsupported_claims, note.",
                  "status must be grounded or weak_evidence.",
                  "Only mark a claim as supported if the retrieved sources clearly back it.",
                  "Keep supported_claims and unsupported_claims short.",
                  "Do not add markdown fences or commentary.",
                ].join("\n"),
              },
              {
                role: "user",
                content: [
                  "# Answer to verify",
                  answerResult.reply,
                  "",
                  "# Retrieved sources",
                  sources
                    .map((source) => `${source.citation}\n${source.excerpt}`)
                    .join("\n\n"),
                ].join("\n"),
              },
            ],
          });
          usageParts.push(verifyResult.usage);
          verification = parseVerificationResult(verifyResult.reply, sources.length > 0, hasCitations);
        } catch {
          verification = {
            status: hasCitations ? "grounded" : "weak_evidence",
            supported_claims: hasCitations ? ["The answer contains explicit citations to retrieved sources."] : [],
            unsupported_claims: hasCitations ? [] : ["The verifier step failed and the answer has no explicit citations."],
            note: "Verifier call failed; using a citation-based fallback.",
            parse_failed: true,
          };
        }
      }

      traceSteps.push({
        id: "verify",
        label: "Verify",
        status: verification.status === "grounded"
          ? "done"
          : verification.parse_failed
            ? "skipped"
            : "low_confidence",
        summary: verification.note,
      });

      trace = {
        badge: verification.status === "grounded" ? "Grounded" : "Weak evidence",
        badge_tone: verification.status === "grounded" ? "grounded" : "weak",
        retrieved_count: sources.length,
        rewritten_queries: planner.rewritten_queries,
        used_sources: usedSources,
        steps: traceSteps,
        verification,
      };
    }

    return json({
      reply: answerResult.reply,
      usage: isAgentPipeline ? sumUsage(usageParts) : answerResult.usage,
      finish_reason: answerResult.finish_reason ?? null,
      model_snapshot: answerResult.model_snapshot ?? model,
      id: answerResult.id ?? null,
      sources,
      retrieved_count: sources.length,
      trace,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
