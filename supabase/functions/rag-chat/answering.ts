import { buildContext } from "./sources.ts";
import type { ChatMessage, MatchRow, PlannerResult, UsageShape } from "./types.ts";

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("");
  }
  return "";
}

export function buildRetrievalInstructions({
  matches,
  isAgentPipeline,
  planner,
  queriesUsed,
}: {
  matches: MatchRow[];
  isAgentPipeline: boolean;
  planner: PlannerResult;
  queriesUsed: string[];
}) {
  if (matches.length) {
    return [
      isAgentPipeline ? "You are the answer step in an agentic retrieval pipeline." : "",
      "Use the retrieved context as high-priority evidence.",
      "Prefer the retrieved context when it conflicts with your background knowledge.",
      "Cite factual claims with bracketed source references like [1] or [2].",
      "Use only source numbers that appear in the retrieved context.",
      "Every factual paragraph or bullet should include at least one retrieved-source citation.",
      "If the retrieved context does not support an answer, say so plainly.",
      isAgentPipeline ? `Planning intent: ${planner.intent}` : "",
      isAgentPipeline ? `Retrieval goal: ${planner.retrieval_goal}` : "",
      isAgentPipeline ? `Queries used: ${queriesUsed.join(" | ")}` : "",
      "",
      "# Retrieved context",
      buildContext(matches),
    ].filter(Boolean).join("\n");
  }

  return [
    isAgentPipeline ? "You are the answer step in an agentic retrieval pipeline." : "",
    "No matching retrieval context was found.",
    "Answer carefully and say that no supporting sources were retrieved.",
    isAgentPipeline ? `Planning intent: ${planner.intent}` : "",
  ].filter(Boolean).join("\n");
}

export function buildCitationRetryInstructions({
  matches,
  isAgentPipeline,
  planner,
  queriesUsed,
  previousAnswer,
}: {
  matches: MatchRow[];
  isAgentPipeline: boolean;
  planner: PlannerResult;
  queriesUsed: string[];
  previousAnswer: string;
}) {
  return [
    "The previous answer did not cite retrieved sources correctly.",
    "Rewrite the answer using only the retrieved context below.",
    "Include bracket citations that exactly match the retrieved source numbers, such as [1].",
    "Do not cite source numbers that are not present in the retrieved context.",
    "Do not mention the rewrite instruction in the final answer.",
    "",
    "# Previous answer",
    previousAnswer,
    "",
    buildRetrievalInstructions({
      matches,
      isAgentPipeline,
      planner,
      queriesUsed,
    }),
  ].join("\n");
}

export async function callOpenRouterChat({
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
