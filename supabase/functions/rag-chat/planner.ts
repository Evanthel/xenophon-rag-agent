import type { ChatMessage, PlannerResult } from "./types.ts";

export function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
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

export function uniqueQueries(queries: string[], fallback: string) {
  const deduped = new Set<string>();
  for (const query of queries) {
    const normalized = String(query ?? "").replace(/\s+/g, " ").trim();
    if (normalized) deduped.add(normalized);
    if (deduped.size >= 3) break;
  }
  if (!deduped.size) deduped.add(fallback.trim());
  return Array.from(deduped).slice(0, 3);
}

export function defaultPlanner(
  userMessage: string,
  intent = "Direct retrieval from the latest user question.",
): PlannerResult {
  return {
    action: "answer_now",
    intent,
    retrieval_goal: "Retrieve evidence relevant to the latest user question.",
    rewritten_queries: [userMessage],
    clarifying_question: null,
    used_fallback: true,
  };
}

export function parsePlannerResult(rawText: string, fallbackQuery: string): PlannerResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return {
      action: "answer_now",
      intent: "Could not parse planner output reliably.",
      retrieval_goal: "Fallback to the raw user question for retrieval.",
      rewritten_queries: [fallbackQuery.trim()],
      clarifying_question: null,
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
  const requestedAction = String(parsed.action ?? "").trim();
  const clarifyingQuestion = String(parsed.clarifying_question ?? "").trim();
  const action = requestedAction === "ask_clarifying_question" && clarifyingQuestion
    ? "ask_clarifying_question"
    : "answer_now";

  return {
    action,
    intent: String(parsed.intent ?? "Clarify the user's request before retrieval.").trim(),
    retrieval_goal: String(parsed.retrieval_goal ?? "Retrieve evidence that directly answers the user's question.")
      .trim(),
    rewritten_queries: rewrittenQueries,
    clarifying_question: action === "ask_clarifying_question" ? clarifyingQuestion : null,
    used_fallback: usedFallback,
  };
}

export function buildPlannerMessages(userMessage: string, messages: ChatMessage[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are the planning step in a retrieval agent.",
        "Return strict JSON with keys: action, intent, retrieval_goal, rewritten_queries, clarifying_question.",
        "action must be answer_now or ask_clarifying_question.",
        "Choose ask_clarifying_question only when the user's request is too vague to answer responsibly.",
        "If action is ask_clarifying_question, provide exactly one short clarifying_question and keep rewritten_queries minimal.",
        "If action is answer_now, rewritten_queries must be an array of 2 or 3 short search queries and clarifying_question must be empty.",
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
  ];
}

export function extractRetrievalQuery(text: string) {
  const marker = "# User message";
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex === -1) return text.trim();
  return text.slice(markerIndex + marker.length).trim();
}
