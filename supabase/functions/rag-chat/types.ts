export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type MatchRow = {
  chunk_id: string;
  document_id: string;
  title: string;
  source_path: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

export type XenophonDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      match_document_chunks: {
        Args: {
          query_embedding: number[];
          match_count: number;
          match_threshold: number;
        };
        Returns: MatchRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type UsageShape = {
  prompt_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

export type PlannerResult = {
  action: "answer_now" | "ask_clarifying_question";
  intent: string;
  retrieval_goal: string;
  rewritten_queries: string[];
  clarifying_question: string | null;
  used_fallback: boolean;
};

export type VerificationResult = {
  status: "grounded" | "weak_evidence";
  supported_claims: string[];
  unsupported_claims: string[];
  note: string;
  parse_failed?: boolean;
};

export type TraceStep = {
  id: string;
  label: string;
  status: "done" | "skipped" | "low_confidence";
  summary: string;
};

export type NormalizedSource = {
  index: number;
  title: string;
  source_path: string;
  chunk_index: number;
  similarity: number;
  page_start: number | null;
  page_end: number | null;
  page_label: string | null;
  citation: string;
  excerpt: string;
  matched_queries: unknown[];
  metadata: Record<string, unknown>;
};
