import type { UsageShape } from "./types.ts";

export function sumUsage(usages: Array<UsageShape | null | undefined>): UsageShape | null {
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
