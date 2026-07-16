import type { MatchRow, NormalizedSource } from "./types.ts";

export function sourceLabel(row: MatchRow, index: number) {
  const pageStart = Number(row.metadata?.page_start ?? 0);
  const pageEnd = Number(row.metadata?.page_end ?? 0);
  if (pageStart > 0 && pageEnd > 0) {
    return pageStart === pageEnd
      ? `[${index}] ${row.title}, p. ${pageStart}`
      : `[${index}] ${row.title}, pp. ${pageStart}-${pageEnd}`;
  }
  return `[${index}] ${row.title}`;
}

export function buildContext(matches: MatchRow[]) {
  return matches
    .map((row, index) => {
      const label = sourceLabel(row, index + 1);
      return `${label}\n${row.content}`;
    })
    .join("\n\n");
}

export function normalizeSource(row: MatchRow, index: number): NormalizedSource {
  const pageStart = Number(row.metadata?.page_start ?? 0);
  const pageEnd = Number(row.metadata?.page_end ?? 0);
  const pageLabel = pageStart > 0 && pageEnd > 0
    ? pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}-${pageEnd}`
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
