import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uniqueQueries } from "./planner.ts";
import type { MatchRow, XenophonDatabase } from "./types.ts";

const embeddingSession = new Supabase.ai.Session("gte-small");

export async function retrieveMatchesForQueries({
  supabase,
  queries,
  matchCount,
  matchThreshold,
}: {
  supabase: SupabaseClient<XenophonDatabase>;
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
