#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, XENOPHON_PROMPT, estimateCost } from "../src/config.js";
import { analyzeSourceCitations } from "../supabase/functions/rag-chat/verification.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const questionsPath = resolve(rootDir, process.env.XENOPHON_QUESTIONS_FILE || "docs/portfolio/evaluation-questions.json");
const outputDir = resolve(rootDir, process.env.XENOPHON_BENCHMARK_OUTPUT_DIR || "docs/portfolio/results");

const config = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
  supabaseUrl: process.env.SUPABASE_URL?.trim() || DEFAULTS.supabase_url,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || DEFAULTS.supabase_key,
  model: process.env.XENOPHON_MODEL?.trim() || DEFAULTS.model,
  temperature: Number(process.env.XENOPHON_TEMPERATURE ?? DEFAULTS.temperature),
  topP: Number(process.env.XENOPHON_TOP_P ?? DEFAULTS.top_p),
  maxTokens: Number(process.env.XENOPHON_MAX_TOKENS ?? DEFAULTS.max_tokens),
  matchCount: Number(process.env.XENOPHON_MATCH_COUNT ?? DEFAULTS.rag_match_count),
  matchThreshold: Number(process.env.XENOPHON_MATCH_THRESHOLD ?? DEFAULTS.rag_threshold),
  limit: Number(process.env.XENOPHON_BENCHMARK_LIMIT ?? 0),
};

function buildFirstUserMessage(question) {
  return `${XENOPHON_PROMPT}\n\n# User message\n${question}`;
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join("");
  return "";
}

async function postJson(url, { headers, body }) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return { payload, latencyMs };
}

async function callOpenRouter(messages) {
  const { payload, latencyMs } = await postJson("https://openrouter.ai/api/v1/chat/completions", {
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      "HTTP-Referer": config.supabaseUrl,
      "X-Title": "Xenophon Portfolio Benchmark",
    },
    body: {
      model: config.model,
      messages,
      temperature: config.temperature,
      top_p: config.topP,
      max_tokens: config.maxTokens,
      stream: false,
    },
  });

  const choice = payload?.choices?.[0];
  return {
    reply: extractTextContent(choice?.message?.content),
    usage: payload?.usage ?? null,
    finish_reason: choice?.finish_reason ?? null,
    model_snapshot: payload?.model ?? config.model,
    id: payload?.id ?? null,
    latency_ms: latencyMs,
  };
}

async function callRagChat(messages) {
  const { payload, latencyMs } = await postJson(`${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/rag-chat`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${config.supabaseAnonKey}`,
      "x-openrouter-api-key": config.openrouterApiKey,
    },
    body: {
      openrouterApiKey: config.openrouterApiKey,
      model: config.model,
      messages,
      temperature: config.temperature,
      top_p: config.topP,
      max_tokens: config.maxTokens,
      match_count: config.matchCount,
      match_threshold: config.matchThreshold,
      pipeline_mode: "rag",
    },
  });

  return {
    ...payload,
    latency_ms: latencyMs,
  };
}

function citationStats(answer, sources, requiresCitations) {
  const sourceIndexes = new Set((sources || []).map((source) => Number(source.index)));
  const analysis = analyzeSourceCitations(answer, sources || []);
  const citations = analysis.cited_indexes;
  const invalid = analysis.invalid_citation_indexes;
  const uniqueValid = analysis.unique_valid_cited_indexes;
  const validity = citations.length
    ? citations.filter((index) => sourceIndexes.has(index)).length / citations.length
    : null;
  const pass = requiresCitations ? analysis.pass : invalid.length === 0;

  return {
    cited_count: citations.length,
    unique_valid_cited_count: uniqueValid.length,
    invalid_citations: invalid,
    citation_validity: validity,
    citation_pass: pass,
  };
}

function expectedTermCoverage(answer, expectedTerms = []) {
  const normalized = String(answer || "").toLowerCase();
  const hits = expectedTerms.filter((term) => normalized.includes(String(term).toLowerCase()));
  return {
    expected_terms: expectedTerms,
    expected_terms_hit: hits,
    expected_term_coverage: expectedTerms.length ? hits.length / expectedTerms.length : null,
  };
}

function normalizeExpectedSource(source) {
  if (typeof source === "string") {
    const value = source.trim().toLowerCase();
    return value ? { title: value, source_path: value } : null;
  }
  if (!source || typeof source !== "object") return null;
  const title = String(source.title || "").trim().toLowerCase();
  const sourcePath = String(source.source_path || "").trim().toLowerCase();
  return title || sourcePath ? { title, source_path: sourcePath } : null;
}

function expectedSourceCoverage(sources = [], expectedSources = []) {
  const expected = expectedSources.map(normalizeExpectedSource).filter(Boolean);
  const returned = sources.map((source) => ({
    title: String(source.title || "").trim().toLowerCase(),
    source_path: String(source.source_path || "").trim().toLowerCase(),
  }));
  const hits = expected.filter((expectedSource) =>
    returned.some((source) =>
      (expectedSource.title && source.title === expectedSource.title) ||
      (expectedSource.source_path && source.source_path === expectedSource.source_path)
    )
  );

  return {
    expected_sources: expectedSources,
    expected_sources_hit: hits,
    expected_source_coverage: expected.length ? hits.length / expected.length : null,
    expected_source_pass: expected.length ? hits.length === expected.length : null,
  };
}

function sourceStats(sources = []) {
  const similarities = sources
    .map((source) => Number(source.similarity))
    .filter((similarity) => Number.isFinite(similarity));

  return {
    retrieved_count: sources.length,
    max_similarity: similarities.length ? Math.max(...similarities) : null,
    avg_similarity: similarities.length
      ? similarities.reduce((total, value) => total + value, 0) / similarities.length
      : null,
    top_sources: sources.slice(0, 3).map((source) => ({
      citation: source.citation,
      title: source.title,
      source_path: source.source_path,
      similarity: source.similarity,
    })),
  };
}

function roundMetric(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

function toCsv(rows) {
  const headers = [
    "id",
    "category",
    "retrieved_count",
    "max_similarity",
    "citation_pass",
    "citation_validity",
    "expected_source_pass",
    "expected_source_coverage",
    "expected_term_coverage",
    "standard_latency_ms",
    "rag_latency_ms",
    "standard_cost_usd",
    "rag_cost_usd",
  ];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row.metrics[header] ?? row[header])).join(",")),
  ].join("\n");
}

function toMarkdown(rows, summary) {
  const lines = [
    "# Xenophon Portfolio Benchmark Results",
    "",
    `Generated at: ${summary.generated_at}`,
    `Model: \`${summary.model}\``,
    `Questions: ${summary.question_count}`,
    "",
    "## Summary",
    "",
    `- Average retrieved chunks: ${roundMetric(summary.average_retrieved_count, 2)}`,
    `- Citation pass rate: ${roundMetric(summary.citation_pass_rate * 100, 1)}%`,
    `- Expected-source pass rate: ${roundMetric(summary.expected_source_pass_rate * 100, 1)}%`,
    `- Average expected-term coverage: ${roundMetric(summary.average_expected_term_coverage * 100, 1)}%`,
    `- Average Standard latency: ${roundMetric(summary.average_standard_latency_ms, 0)} ms`,
    `- Average RAG latency: ${roundMetric(summary.average_rag_latency_ms, 0)} ms`,
    `- Estimated total cost: $${roundMetric(summary.total_cost_usd, 6)}`,
    "",
    "## Per Question",
    "",
    "| ID | Category | Retrieved | Citation pass | Source pass | Term coverage | Standard ms | RAG ms | Cost |",
    "| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |",
  ];

  for (const row of rows) {
    lines.push([
      row.id,
      row.category,
      row.metrics.retrieved_count,
      row.metrics.citation_pass ? "yes" : "no",
      row.metrics.expected_source_pass === null ? "n/a" : row.metrics.expected_source_pass ? "yes" : "no",
      `${roundMetric((row.metrics.expected_term_coverage ?? 0) * 100, 1)}%`,
      row.metrics.standard_latency_ms,
      row.metrics.rag_latency_ms,
      `$${roundMetric(row.metrics.standard_cost_usd + row.metrics.rag_cost_usd, 6)}`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  if (!config.openrouterApiKey) {
    console.error("Missing OPENROUTER_API_KEY. Provide it to run live Standard and RAG comparisons.");
    process.exitCode = 1;
    return;
  }

  const questions = JSON.parse(await readFile(questionsPath, "utf8"));
  const selectedQuestions = config.limit > 0 ? questions.slice(0, config.limit) : questions;
  const rows = [];

  for (const question of selectedQuestions) {
    const messages = [{ role: "user", content: buildFirstUserMessage(question.question) }];
    const standard = await callOpenRouter(messages);
    const rag = await callRagChat(messages);
    const citations = citationStats(rag.reply, rag.sources || [], question.requires_citations !== false);
    const terms = expectedTermCoverage(rag.reply, question.expected_answer_terms || []);
    const sources = sourceStats(rag.sources || []);
    const expectedSources = expectedSourceCoverage(rag.sources || [], question.expected_sources || []);
    const standardCost = estimateCost(standard.usage, config.model);
    const ragCost = estimateCost(rag.usage, config.model);

    rows.push({
      id: question.id,
      question: question.question,
      category: question.category,
      standard,
      rag,
      metrics: {
        ...sources,
        ...citations,
        ...expectedSources,
        ...terms,
        standard_latency_ms: standard.latency_ms,
        rag_latency_ms: rag.latency_ms,
        standard_cost_usd: standardCost,
        rag_cost_usd: ragCost,
      },
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    model: config.model,
    question_count: rows.length,
    average_retrieved_count: rows.reduce((total, row) => total + row.metrics.retrieved_count, 0) / rows.length,
    citation_pass_rate: rows.filter((row) => row.metrics.citation_pass).length / rows.length,
    expected_source_pass_rate: rows.filter((row) => row.metrics.expected_source_pass !== false).length / rows.length,
    average_expected_term_coverage: rows.reduce((total, row) => total + (row.metrics.expected_term_coverage || 0), 0) / rows.length,
    average_standard_latency_ms: rows.reduce((total, row) => total + row.metrics.standard_latency_ms, 0) / rows.length,
    average_rag_latency_ms: rows.reduce((total, row) => total + row.metrics.rag_latency_ms, 0) / rows.length,
    total_cost_usd: rows.reduce((total, row) => total + row.metrics.standard_cost_usd + row.metrics.rag_cost_usd, 0),
  };

  const outputConfig = {
    ...config,
    openrouterApiKey: config.openrouterApiKey ? "[redacted]" : "",
    supabaseAnonKey: config.supabaseAnonKey ? "[redacted]" : "",
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "latest.json"), `${JSON.stringify({ config: outputConfig, summary, rows }, null, 2)}\n`);
  await writeFile(resolve(outputDir, "latest.csv"), `${toCsv(rows)}\n`);
  await writeFile(resolve(outputDir, "latest.md"), toMarkdown(rows, summary));

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
    if (error.cause) {
      console.error(JSON.stringify({
        cause: error.cause.message,
        code: error.cause.code,
        hostname: error.cause.hostname,
      }, null, 2));
    }
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
