import type { ChatMessage } from "./types.ts";

export const PUBLIC_ENDPOINTS = ["rag-chat", "search-knowledge", "list-documents"] as const;
export const PROTECTED_ENDPOINTS = ["ingest-chunks", "cleanup-documents"] as const;

export const DEFAULT_ALLOWED_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
];

export const MAX_RAG_QUERY_CHARS = 4_000;
export const MAX_CHAT_MESSAGES = 24;
export const MAX_MESSAGE_CHARS = 12_000;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export function parseModelAllowlist(rawValue: string | null | undefined) {
  const configured = String(rawValue ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_MODELS;
}

export function isAllowedModel(model: string, allowlist: string[]) {
  return allowlist.includes(model);
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export function normalizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_CHAT_MESSAGES)
    .map((message) => {
      const role = String(message?.role ?? "");
      const content = String(message?.content ?? "").slice(0, MAX_MESSAGE_CHARS);
      if (role !== "system" && role !== "user" && role !== "assistant") return null;
      if (!content.trim()) return null;
      return { role, content } satisfies ChatMessage;
    })
    .filter(Boolean) as ChatMessage[];
}

export function readOpenRouterApiKey(req: Request, body: Record<string, unknown>) {
  return String(req.headers.get("x-openrouter-api-key") ?? body.openrouterApiKey ?? "").trim();
}

export function validateRagChatInput({
  openrouterApiKey,
  model,
  messages,
  userMessage,
  pipelineMode,
  allowedModels,
}: {
  openrouterApiKey: string;
  model: string;
  messages: ChatMessage[];
  userMessage: string;
  pipelineMode: string;
  allowedModels: string[];
}) {
  if (!openrouterApiKey) return "Missing OpenRouter API key";
  if (!model) return "Missing model";
  if (!isAllowedModel(model, allowedModels)) {
    return `Model is not allowed. Allowed models: ${allowedModels.join(", ")}`;
  }
  if (pipelineMode !== "rag" && pipelineMode !== "agent") {
    return "Invalid pipeline mode";
  }
  if (!messages.length || !userMessage) return "Missing chat messages";
  if (userMessage.length > MAX_RAG_QUERY_CHARS) {
    return `Query is too long. Maximum length is ${MAX_RAG_QUERY_CHARS} characters`;
  }
  return null;
}

export function clientFingerprint(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return [
    forwardedFor ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown-ip",
    req.headers.get("origin") || "unknown-origin",
  ].join("|");
}

export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const buckets = new Map<string, RateLimitBucket>();

  return {
    check(key: string, now = Date.now()) {
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        const next = { count: 1, resetAt: now + windowMs };
        buckets.set(key, next);
        return {
          allowed: true,
          remaining: max - 1,
          resetAt: next.resetAt,
          retryAfterSeconds: 0,
        };
      }

      existing.count += 1;
      const allowed = existing.count <= max;
      return {
        allowed,
        remaining: Math.max(0, max - existing.count),
        resetAt: existing.resetAt,
        retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
      };
    },
    clear() {
      buckets.clear();
    },
  };
}
