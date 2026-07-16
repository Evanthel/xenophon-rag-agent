import { parseJsonObject, uniqueQueries } from "./planner.ts";
import type { ChatMessage, NormalizedSource, PlannerResult, VerificationResult } from "./types.ts";

export function parseVerificationResult(rawText: string, hasSources: boolean, hasCitations: boolean): VerificationResult {
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

export function extractUsedSourceCitations(answer: string, sources: Array<{ index: number; citation: string }>) {
  const citedIndexes = new Set(analyzeSourceCitations(answer, sources).unique_valid_cited_indexes);
  return sources
    .filter((source) => citedIndexes.has(source.index))
    .map((source) => source.citation);
}

export function analyzeSourceCitations(answer: string, sources: Array<{ index: number; citation: string }>) {
  const sourceIndexes = new Set(sources.map((source) => source.index));
  const citedIndexes: number[] = [];

  for (const match of String(answer || "").matchAll(/\[(\d+)\]/g)) {
    const index = Number(match[1]);
    if (Number.isFinite(index)) citedIndexes.push(index);
  }

  const uniqueValid = [...new Set(citedIndexes.filter((index) => sourceIndexes.has(index)))];
  const invalid = [...new Set(citedIndexes.filter((index) => !sourceIndexes.has(index)))];

  return {
    cited_indexes: citedIndexes,
    unique_valid_cited_indexes: uniqueValid,
    invalid_citation_indexes: invalid,
    has_valid_citations: uniqueValid.length > 0,
    has_invalid_citations: invalid.length > 0,
    pass: uniqueValid.length > 0 && invalid.length === 0,
  };
}

export function citationIssueNote(check: ReturnType<typeof analyzeSourceCitations>) {
  if (!check.cited_indexes.length) {
    return "The answer did not include bracket citations to retrieved sources.";
  }
  if (check.invalid_citation_indexes.length) {
    return `The answer cited source index(es) not present in retrieved context: ${
      check.invalid_citation_indexes.map((index) => `[${index}]`).join(", ")
    }.`;
  }
  return "The answer cited retrieved sources correctly.";
}

export function buildRetryQueries({
  userMessage,
  planner,
  verification,
}: {
  userMessage: string;
  planner: PlannerResult;
  verification: VerificationResult;
}) {
  const unsupported = Array.isArray(verification.unsupported_claims)
    ? verification.unsupported_claims
    : [];

  return uniqueQueries([
    ...unsupported,
    userMessage,
    planner.retrieval_goal,
    ...planner.rewritten_queries,
  ], userMessage);
}

export function buildVerifierMessages(reply: string, answerSources: NormalizedSource[]): ChatMessage[] {
  return [
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
        reply,
        "",
        "# Retrieved sources",
        answerSources
          .map((source) => `${source.citation}\n${source.excerpt}`)
          .join("\n\n"),
      ].join("\n"),
    },
  ];
}
