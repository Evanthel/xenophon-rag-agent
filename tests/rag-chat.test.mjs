import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRetrievalQuery,
  parsePlannerResult,
  uniqueQueries,
} from "../supabase/functions/rag-chat/planner.ts";
import {
  analyzeSourceCitations,
  buildRetryQueries,
  citationIssueNote,
  extractUsedSourceCitations,
  parseVerificationResult,
} from "../supabase/functions/rag-chat/verification.ts";
import { normalizeSource, sourceLabel } from "../supabase/functions/rag-chat/sources.ts";
import { sumUsage } from "../supabase/functions/rag-chat/usage.ts";
import {
  MAX_RAG_QUERY_CHARS,
  PROTECTED_ENDPOINTS,
  PUBLIC_ENDPOINTS,
  createRateLimiter,
  normalizeChatMessages,
  parseModelAllowlist,
  readOpenRouterApiKey,
  validateRagChatInput,
} from "../supabase/functions/rag-chat/security.ts";

const baseRow = {
  chunk_id: "chunk-1",
  document_id: "doc-1",
  title: "Manual",
  source_path: "docs/manual.pdf",
  chunk_index: 3,
  content: "A grounded excerpt.",
  metadata: { page_start: 4, page_end: 5, matched_queries: ["alpha"] },
  similarity: 0.82,
};

test("planner parses strict JSON and deduplicates rewritten queries", () => {
  const result = parsePlannerResult(
    '```json\n{"action":"answer_now","intent":"Find policy","retrieval_goal":"policy evidence","rewritten_queries":[" alpha  beta ","alpha beta","gamma","delta"],"clarifying_question":""}\n```',
    "fallback",
  );

  assert.equal(result.action, "answer_now");
  assert.equal(result.intent, "Find policy");
  assert.deepEqual(result.rewritten_queries, ["alpha beta", "gamma", "delta"]);
  assert.equal(result.used_fallback, false);
});

test("planner falls back safely when output is not JSON", () => {
  const result = parsePlannerResult("not json", "raw question");

  assert.equal(result.action, "answer_now");
  assert.deepEqual(result.rewritten_queries, ["raw question"]);
  assert.equal(result.used_fallback, true);
});

test("planner only asks for clarification when a question is present", () => {
  const result = parsePlannerResult(
    '{"action":"ask_clarifying_question","intent":"unclear","retrieval_goal":"","rewritten_queries":[],"clarifying_question":""}',
    "raw question",
  );

  assert.equal(result.action, "answer_now");
  assert.equal(result.clarifying_question, null);
});

test("extractRetrievalQuery removes the embedded Xenophon prompt wrapper", () => {
  assert.equal(extractRetrievalQuery("prompt\n\n# User message\nWhat now?"), "What now?");
});

test("uniqueQueries preserves order, trims whitespace, and limits to three", () => {
  assert.deepEqual(uniqueQueries([" a ", "a", "b", "c", "d"], "fallback"), ["a", "b", "c"]);
});

test("verifier parses grounded output and trims claim arrays", () => {
  const result = parseVerificationResult(
    '{"status":"grounded","supported_claims":[" A ","B","C","D","E"],"unsupported_claims":[""],"note":" ok "}',
    true,
    true,
  );

  assert.equal(result.status, "grounded");
  assert.deepEqual(result.supported_claims, ["A", "B", "C", "D"]);
  assert.deepEqual(result.unsupported_claims, []);
  assert.equal(result.note, "ok");
});

test("verifier fallback marks weak evidence without sources or citations", () => {
  const result = parseVerificationResult("not json", false, false);

  assert.equal(result.status, "weak_evidence");
  assert.equal(result.parse_failed, true);
  assert.ok(result.unsupported_claims.length > 0);
});

test("citation extraction only returns known cited sources", () => {
  const citations = extractUsedSourceCitations("Use [2], ignore [9], repeat [2].", [
    { index: 1, citation: "[1] First" },
    { index: 2, citation: "[2] Second" },
  ]);

  assert.deepEqual(citations, ["[2] Second"]);
});

test("citation analysis flags missing and invalid source references", () => {
  const sources = [
    { index: 1, citation: "[1] First" },
    { index: 2, citation: "[2] Second" },
  ];

  assert.deepEqual(analyzeSourceCitations("Use [1] and [2].", sources), {
    cited_indexes: [1, 2],
    unique_valid_cited_indexes: [1, 2],
    invalid_citation_indexes: [],
    has_valid_citations: true,
    has_invalid_citations: false,
    pass: true,
  });

  const invalid = analyzeSourceCitations("Use [2] and [9].", sources);
  assert.equal(invalid.pass, false);
  assert.deepEqual(invalid.invalid_citation_indexes, [9]);
  assert.match(citationIssueNote(invalid), /not present/);

  const missing = analyzeSourceCitations("No brackets here.", sources);
  assert.equal(missing.pass, false);
  assert.match(citationIssueNote(missing), /did not include/);
});

test("citation analysis supports grouped sources and ignores bibliography years", () => {
  const sources = [1, 2, 3, 4].map((index) => ({ index, citation: `[${index}] Source` }));
  const result = analyzeSourceCitations(
    "The method follows Ho et al. [2020], with evidence in [2, 4] and an invalid source [9].",
    sources,
  );

  assert.deepEqual(result.cited_indexes, [2, 4, 9]);
  assert.deepEqual(result.unique_valid_cited_indexes, [2, 4]);
  assert.deepEqual(result.invalid_citation_indexes, [9]);
  assert.equal(result.pass, false);

  const valid = analyzeSourceCitations("Ho et al. [2020] is supported by [1, 3].", sources);
  assert.deepEqual(valid.cited_indexes, [1, 3]);
  assert.equal(valid.pass, true);
});

test("retry queries prioritize unsupported claims and preserve fallback query", () => {
  const queries = buildRetryQueries({
    userMessage: "fallback question",
    planner: {
      action: "answer_now",
      intent: "intent",
      retrieval_goal: "goal query",
      rewritten_queries: ["rewritten"],
      clarifying_question: null,
      used_fallback: false,
    },
    verification: {
      status: "weak_evidence",
      supported_claims: [],
      unsupported_claims: ["missing support"],
      note: "weak",
    },
  });

  assert.deepEqual(queries, ["missing support", "fallback question", "goal query"]);
});

test("source normalization includes pages, citation, metadata, and matched queries", () => {
  const source = normalizeSource(baseRow, 2);

  assert.equal(sourceLabel(baseRow, 2), "[2] Manual, pp. 4-5");
  assert.equal(source.citation, "[2] Manual, pp. 4-5");
  assert.equal(source.page_label, "pp. 4-5");
  assert.deepEqual(source.matched_queries, ["alpha"]);
  assert.equal(source.excerpt, "A grounded excerpt.");
});

test("usage summing includes cached and reasoning tokens", () => {
  const usage = sumUsage([
    { prompt_tokens: 10, total_tokens: 20, prompt_tokens_details: { cached_tokens: 3 } },
    { prompt_tokens: 5, total_tokens: 9, completion_tokens_details: { reasoning_tokens: 2 } },
  ]);

  assert.deepEqual(usage, {
    prompt_tokens: 15,
    total_tokens: 29,
    prompt_tokens_details: { cached_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 2 },
  });
});

test("security normalizes chat messages and rejects invalid rag-chat input", () => {
  const messages = normalizeChatMessages([
    { role: "system", content: "rules" },
    { role: "bad", content: "drop" },
    { role: "user", content: "hello" },
  ]);
  const allowedModels = parseModelAllowlist("");

  assert.deepEqual(messages, [
    { role: "system", content: "rules" },
    { role: "user", content: "hello" },
  ]);
  assert.equal(validateRagChatInput({
    openrouterApiKey: "sk-test",
    model: allowedModels[0],
    messages,
    userMessage: "hello",
    pipelineMode: "rag",
    allowedModels,
  }), null);
  assert.match(validateRagChatInput({
    openrouterApiKey: "",
    model: allowedModels[0],
    messages,
    userMessage: "hello",
    pipelineMode: "rag",
    allowedModels,
  }), /Missing OpenRouter/);
  assert.match(validateRagChatInput({
    openrouterApiKey: "sk-test",
    model: "unlisted/model",
    messages,
    userMessage: "hello",
    pipelineMode: "rag",
    allowedModels,
  }), /not allowed/);
  assert.match(validateRagChatInput({
    openrouterApiKey: "sk-test",
    model: allowedModels[0],
    messages,
    userMessage: "x".repeat(MAX_RAG_QUERY_CHARS + 1),
    pipelineMode: "rag",
    allowedModels,
  }), /too long/);
});

test("rate limiter blocks after the configured request count and resets by window", () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });

  assert.equal(limiter.check("client", 0).allowed, true);
  assert.equal(limiter.check("client", 100).allowed, true);
  const blocked = limiter.check("client", 200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.check("client", 1001).allowed, true);
});

test("OpenRouter key prefers header over legacy body fallback", () => {
  const req = new Request("https://example.test", {
    headers: { "x-openrouter-api-key": "from-header" },
  });

  assert.equal(readOpenRouterApiKey(req, { openrouterApiKey: "from-body" }), "from-header");
  assert.equal(readOpenRouterApiKey(new Request("https://example.test"), { openrouterApiKey: "from-body" }), "from-body");
});

test("endpoint visibility is explicit", () => {
  assert.deepEqual([...PUBLIC_ENDPOINTS], ["rag-chat", "search-knowledge", "list-documents"]);
  assert.deepEqual([...PROTECTED_ENDPOINTS], ["ingest-chunks", "cleanup-documents"]);
});
