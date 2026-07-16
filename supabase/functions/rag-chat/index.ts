import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildCitationRetryInstructions, buildRetrievalInstructions, callOpenRouterChat } from "./answering.ts";
import { buildPlannerMessages, defaultPlanner, extractRetrievalQuery, parsePlannerResult } from "./planner.ts";
import { retrieveMatchesForQueries } from "./retrieval.ts";
import {
  clampNumber,
  clientFingerprint,
  createRateLimiter,
  normalizeChatMessages,
  parseModelAllowlist,
  readOpenRouterApiKey,
  validateRagChatInput,
} from "./security.ts";
import { normalizeSource } from "./sources.ts";
import { sumUsage } from "./usage.ts";
import {
  analyzeSourceCitations,
  buildRetryQueries,
  buildVerifierMessages,
  citationIssueNote,
  extractUsedSourceCitations,
  parseVerificationResult,
} from "./verification.ts";
import type { NormalizedSource, PlannerResult, TraceStep, UsageShape, VerificationResult } from "./types.ts";

const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function verifyAnswer({
  reply,
  answerSources,
  openrouterApiKey,
  model,
  referer,
}: {
  reply: string;
  answerSources: NormalizedSource[];
  openrouterApiKey: string;
  model: string;
  referer: string;
}): Promise<{
  usedSourceCitations: string[];
  verification: VerificationResult;
  usage: UsageShape | null;
}> {
  const usedSourceCitations = extractUsedSourceCitations(reply, answerSources);
  const citationCheck = analyzeSourceCitations(reply, answerSources);
  const hasCitations = citationCheck.has_valid_citations;

  if (!answerSources.length) {
    return {
      usedSourceCitations,
      usage: null,
      verification: {
        status: "weak_evidence",
        supported_claims: [],
        unsupported_claims: ["No retrieved chunks were available to support the answer."],
        note: "No retrieval evidence was available, so the answer should be treated cautiously.",
      },
    };
  }

  try {
    const verifyResult = await callOpenRouterChat({
      openrouterApiKey,
      model,
      temperature: 0.1,
      topP: 0.9,
      maxTokens: 260,
      referer,
      title: "Xenophon Agent Verify",
      messages: buildVerifierMessages(reply, answerSources),
    });

    const verification = parseVerificationResult(verifyResult.reply, answerSources.length > 0, hasCitations);

    return {
      usedSourceCitations,
      usage: verifyResult.usage,
      verification: citationCheck.pass
        ? verification
        : {
          ...verification,
          status: "weak_evidence",
          unsupported_claims: [
            citationIssueNote(citationCheck),
            ...verification.unsupported_claims,
          ].slice(0, 4),
          note: citationIssueNote(citationCheck),
        },
    };
  } catch {
    return {
      usedSourceCitations,
      usage: null,
      verification: {
        status: citationCheck.pass ? "grounded" : "weak_evidence",
        supported_claims: hasCitations ? ["The answer contains explicit citations to retrieved sources."] : [],
        unsupported_claims: citationCheck.pass ? [] : [citationIssueNote(citationCheck)],
        note: citationCheck.pass
          ? "Verifier call failed; using a citation-based fallback."
          : `Verifier call failed; ${citationIssueNote(citationCheck)}`,
        parse_failed: true,
      },
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rate = rateLimiter.check(clientFingerprint(req));
  if (!rate.allowed) {
    return json(
      { error: "Rate limit exceeded", retry_after_seconds: rate.retryAfterSeconds },
      429,
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const openrouterApiKey = readOpenRouterApiKey(req, body);
    const model = String(body.model ?? "").trim();
    const messages = normalizeChatMessages(body.messages);
    const temperature = clampNumber(body.temperature ?? 0.8, 0.8, 0, 2);
    const topP = clampNumber(body.top_p ?? 1, 1, 0, 1);
    const maxTokens = Math.round(clampNumber(body.max_tokens ?? 1024, 1024, 1, 4096));
    const matchCount = Math.round(clampNumber(body.match_count ?? 4, 4, 1, 8));
    const matchThreshold = clampNumber(body.match_threshold ?? 0.55, 0.55, 0, 1);
    const pipelineMode = String(body.pipeline_mode ?? "rag").trim().toLowerCase();
    const isAgentPipeline = pipelineMode === "agent";
    const userMessage = extractRetrievalQuery(messages.at(-1)?.content ?? "");
    const referer = req.headers.get("origin") ?? Deno.env.get("SUPABASE_URL") ?? "";
    const allowedModels = parseModelAllowlist(Deno.env.get("OPENROUTER_MODEL_ALLOWLIST"));

    const validationError = validateRagChatInput({
      openrouterApiKey,
      model,
      messages,
      userMessage,
      pipelineMode,
      allowedModels,
    });
    if (validationError) return json({ error: validationError }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase storage is not configured" }, 500);
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { persistSession: false } },
    );

    let planner: PlannerResult = defaultPlanner(userMessage);
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
          messages: buildPlannerMessages(userMessage, messages),
        });
        usageParts.push(plannerResult.usage);
        planner = parsePlannerResult(plannerResult.reply, userMessage);
      } catch {
        planner = {
          action: "answer_now",
          intent: "Planner call failed; fallback to direct retrieval.",
          retrieval_goal: "Retrieve evidence for the raw user question only.",
          rewritten_queries: [userMessage],
          clarifying_question: null,
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

    if (isAgentPipeline && planner.action === "ask_clarifying_question" && planner.clarifying_question) {
      traceSteps.push({
        id: "retrieve",
        label: "Retrieve",
        status: "skipped",
        summary: "Retrieval skipped until the user clarifies the request.",
      });
      traceSteps.push({
        id: "answer",
        label: "Answer",
        status: "done",
        summary: "The agent returned a clarifying question instead of a grounded answer.",
      });
      traceSteps.push({
        id: "verify",
        label: "Verify",
        status: "skipped",
        summary: "Verification skipped because no factual answer was produced yet.",
      });

      return json({
        reply: planner.clarifying_question,
        usage: sumUsage(usageParts),
        finish_reason: "clarification_requested",
        model_snapshot: model,
        id: null,
        sources: [],
        retrieved_count: 0,
        trace: {
          badge: "Needs clarification",
          badge_tone: "weak",
          decision: "clarify",
          intent: planner.intent,
          retrieval_goal: planner.retrieval_goal,
          clarifying_question: planner.clarifying_question,
          retrieved_count: 0,
          rewritten_queries: planner.rewritten_queries,
          used_sources: [],
          retry_queries: [],
          steps: traceSteps,
          verification: null,
        },
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
    ragMessages.push({
      role: "system",
      content: buildRetrievalInstructions({
        matches,
        isAgentPipeline,
        planner,
        queriesUsed: planner.rewritten_queries,
      }),
    });
    ragMessages.push(messages[messages.length - 1]);

    let answerResult = await callOpenRouterChat({
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
    let citationRetryUsed = false;

    if (sources.length) {
      const citationCheck = analyzeSourceCitations(answerResult.reply, sources);
      if (!citationCheck.pass) {
        const citationRetryMessages = messages.slice(0, -1);
        citationRetryMessages.push({
          role: "system",
          content: buildCitationRetryInstructions({
            matches,
            isAgentPipeline,
            planner,
            queriesUsed: isAgentPipeline ? planner.rewritten_queries : [userMessage],
            previousAnswer: answerResult.reply,
          }),
        });
        citationRetryMessages.push(messages[messages.length - 1]);

        answerResult = await callOpenRouterChat({
          openrouterApiKey,
          model,
          messages: citationRetryMessages,
          temperature: Math.min(temperature, 0.4),
          topP,
          maxTokens,
          referer,
          title: isAgentPipeline ? "Xenophon Agent Citation Retry" : "Xenophon RAG Citation Retry",
        });
        usageParts.push(answerResult.usage);
        citationRetryUsed = true;

        if (isAgentPipeline) {
          traceSteps.push({
            id: "citation_retry",
            label: "Citation retry",
            status: "done",
            summary: citationIssueNote(citationCheck),
          });
        }
      }
    }

    let trace = null;
    if (isAgentPipeline) {
      let finalAnswerResult = answerResult;
      let finalSources = sources;
      let {
        usedSourceCitations: usedSources,
        verification,
        usage: verifierUsage,
      } = await verifyAnswer({
        reply: answerResult.reply,
        answerSources: sources,
        openrouterApiKey,
        model,
        referer,
      });
      usageParts.push(verifierUsage);
      let retryQueries: string[] = [];
      let retried = false;

      if (verification.status === "weak_evidence") {
        retryQueries = buildRetryQueries({
          userMessage,
          planner,
          verification,
        });

        const retryMatchThreshold = Math.max(0.3, matchThreshold - 0.1);
        const retryMatchCount = Math.min(Math.max(matchCount + 2, matchCount), 8);
        const retryMatches = await retrieveMatchesForQueries({
          supabase,
          queries: retryQueries,
          matchCount: retryMatchCount,
          matchThreshold: retryMatchThreshold,
        });
        const retrySources = retryMatches.map((row, idx) => normalizeSource(row, idx + 1));
        retried = true;

        if (retrySources.length) {
          const retryMessages = messages.slice(0, -1);
          retryMessages.push({
            role: "system",
            content: buildRetrievalInstructions({
              matches: retryMatches,
              isAgentPipeline: true,
              planner,
              queriesUsed: retryQueries,
            }),
          });
          retryMessages.push(messages[messages.length - 1]);

          const retryAnswerResult = await callOpenRouterChat({
            openrouterApiKey,
            model,
            messages: retryMessages,
            temperature,
            topP,
            maxTokens,
            referer,
            title: "Xenophon Agent Answer Retry",
          });
          usageParts.push(retryAnswerResult.usage);

          finalAnswerResult = retryAnswerResult;
          finalSources = retrySources;
          ({
            usedSourceCitations: usedSources,
            verification,
            usage: verifierUsage,
          } = await verifyAnswer({
            reply: retryAnswerResult.reply,
            answerSources: retrySources,
            openrouterApiKey,
            model,
            referer,
          }));
          usageParts.push(verifierUsage);
        }

        traceSteps.push({
          id: "retrieve_retry",
          label: "Retrieve retry",
          status: retrySources.length ? "done" : "low_confidence",
          summary: retrySources.length
            ? `Retry broadened retrieval with ${retryQueries.length} fallback query path(s) and found ${retrySources.length} chunk(s).`
            : "Retry broadened retrieval, but still did not find stronger evidence.",
        });
      } else {
        traceSteps.push({
          id: "retrieve_retry",
          label: "Retrieve retry",
          status: "skipped",
          summary: "Retry was unnecessary because the first pass was grounded enough.",
        });
      }

      traceSteps.push({
        id: "answer",
        label: "Answer",
        status: "done",
        summary: usedSources.length
          ? `Answer generated with ${usedSources.length} cited source reference(s)${
            citationRetryUsed ? " after citation retry" : retried ? " after retrieval retry" : ""
          }.`
          : `Answer generated without explicit source citations${
            citationRetryUsed || retried ? " even after retry" : ""
          }.`,
      });

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
        decision: "answer",
        intent: planner.intent,
        retrieval_goal: planner.retrieval_goal,
        clarifying_question: null,
        retrieved_count: finalSources.length,
        rewritten_queries: planner.rewritten_queries,
        used_sources: usedSources,
        retry_queries: retryQueries,
        steps: traceSteps,
        verification,
      };

      return json({
        reply: finalAnswerResult.reply,
        usage: sumUsage(usageParts),
        finish_reason: finalAnswerResult.finish_reason ?? null,
        model_snapshot: finalAnswerResult.model_snapshot ?? model,
        id: finalAnswerResult.id ?? null,
        sources: finalSources,
        retrieved_count: finalSources.length,
        trace,
      });
    }

    return json({
      reply: answerResult.reply,
      usage: sumUsage(usageParts),
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
