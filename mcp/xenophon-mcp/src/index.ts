#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type SourceResult = {
  index: number;
  title: string;
  source_path: string;
  chunk_index: number;
  similarity: number;
  page_start: number | null;
  page_end: number | null;
  page_label: string | null;
  excerpt: string;
  metadata: Record<string, unknown>;
};

type RagChatResponse = {
  reply: string;
  usage: Record<string, unknown> | null;
  finish_reason: string | null;
  model_snapshot: string | null;
  id: string | null;
  sources: SourceResult[];
  retrieved_count: number;
  trace: Record<string, unknown> | null;
};

type SearchKnowledgeResponse = {
  query: string;
  match_count: number;
  match_threshold: number;
  results: SourceResult[];
};

type ListDocumentsResponse = {
  documents: Array<{
    id: string;
    title: string;
    source_path: string;
    source_type: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }>;
  limit: number;
  offset: number;
  search: string;
  total: number;
};

const XENOPHON_MCP_SYSTEM_PROMPT = [
  "You are Xenophon, a reflective assistant.",
  "Help the user reason clearly, identify the real problem, and end with a practical next step.",
  "Prefer grounded, structured answers over vague brainstorming.",
].join(" ");

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getConfig() {
  return {
    supabaseUrl: getRequiredEnv("SUPABASE_URL").replace(/\/$/, ""),
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || "",
    defaultModel: process.env.XENOPHON_DEFAULT_MODEL?.trim() || "google/gemini-2.5-flash",
  };
}

function getOpenRouterApiKey() {
  return getRequiredEnv("OPENROUTER_API_KEY");
}

function makeSupabaseHeaders() {
  const { supabaseAnonKey } = getConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (supabaseAnonKey) {
    headers.apikey = supabaseAnonKey;
    headers.Authorization = `Bearer ${supabaseAnonKey}`;
  }

  return headers;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string"
      ? body.error
      : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function buildFunctionUrl(functionName: string) {
  return `${getConfig().supabaseUrl}/functions/v1/${functionName}`;
}

function buildConversationMessages(conversation: ChatMessage[], prompt: string) {
  return [
    { role: "system", content: XENOPHON_MCP_SYSTEM_PROMPT } satisfies ChatMessage,
    ...conversation,
    { role: "user", content: prompt } satisfies ChatMessage,
  ];
}

function toolText(title: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${title}\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  };
}

const server = new McpServer({
  name: "xenophon-mcp",
  version: "0.1.0",
});

server.registerTool(
  "ask_xenophon",
  {
    description: "Query the Xenophon Supabase backend in RAG or agent mode.",
    inputSchema: z.object({
      prompt: z.string().min(1),
      mode: z.enum(["rag", "agent"]).default("agent"),
      conversation: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })).default([]),
      model: z.string().min(1).optional(),
      temperature: z.number().min(0).max(2).default(0.8),
      top_p: z.number().min(0).max(1).default(1),
      max_tokens: z.number().int().min(1).max(4096).default(1024),
      match_count: z.number().int().min(1).max(12).default(4),
      match_threshold: z.number().min(0).max(1).default(0.55),
    }),
  },
  async ({
    prompt,
    mode,
    conversation,
    model,
    temperature,
    top_p,
    max_tokens,
    match_count,
    match_threshold,
  }) => {
    const response = await fetchJson<RagChatResponse>(buildFunctionUrl("rag-chat"), {
      method: "POST",
      headers: makeSupabaseHeaders(),
      body: JSON.stringify({
        openrouterApiKey: getOpenRouterApiKey(),
        model: model || getConfig().defaultModel,
        messages: buildConversationMessages(conversation, prompt),
        temperature,
        top_p,
        max_tokens,
        match_count,
        match_threshold,
        pipeline_mode: mode,
      }),
    });

    return toolText("Xenophon response", response);
  },
);

server.registerTool(
  "search_knowledge",
  {
    description: "Run semantic search over Xenophon's indexed knowledge chunks.",
    inputSchema: z.object({
      query: z.string().min(1),
      match_count: z.number().int().min(1).max(10).default(5),
      match_threshold: z.number().min(0).max(1).default(0.55),
    }),
  },
  async ({ query, match_count, match_threshold }) => {
    const response = await fetchJson<SearchKnowledgeResponse>(buildFunctionUrl("search-knowledge"), {
      method: "POST",
      headers: makeSupabaseHeaders(),
      body: JSON.stringify({
        query,
        match_count,
        match_threshold,
      }),
    });

    return toolText("Knowledge search results", response);
  },
);

server.registerTool(
  "list_documents",
  {
    description: "List documents currently available in Xenophon's knowledge base.",
    inputSchema: z.object({
      search: z.string().default(""),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }),
  },
  async ({ search, limit, offset }) => {
    const response = await fetchJson<ListDocumentsResponse>(buildFunctionUrl("list-documents"), {
      method: "POST",
      headers: makeSupabaseHeaders(),
      body: JSON.stringify({
        search,
        limit,
        offset,
      }),
    });

    return toolText("Knowledge base documents", response);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
