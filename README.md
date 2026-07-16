# Xenophon

Xenophon is a portfolio project: a reflective AI assistant with retrieval-augmented generation, an inspectable agent pipeline, and a small MCP integration layer. It is intentionally built as a static frontend plus Supabase Edge Functions to show how far a lightweight architecture can go before it needs a full application server.

The project focuses on a practical product question: how can an AI assistant answer with context, expose its reasoning workflow as product telemetry, and stay deployable as a simple static app?

Live demo: https://evanthel.github.io/xenophon-rag-agent/

## Lineage

GitHub still marks this repository as a fork from the original classroom chatbot lineage (`klodzikowski/lmt-ai-19-chatbot` / `lmt-chatbot`). The inherited base was a small browser chatbot used for course work.

The portfolio work in this repository is the Xenophon layer on top of that base:

- Retrieval-augmented generation backed by Supabase and pgvector.
- Supabase Edge Functions for RAG, search, document listing, ingestion, and cleanup.
- Agent pipeline with planning, query rewriting, retrieval, answering, verification, and retry.
- Compare mode for side-by-side direct LLM vs RAG evaluation.
- MCP stdio server exposing the knowledge base to agent clients.
- Repeatable benchmark pack with fixed questions, cost/latency/citation metrics, and a real Compare-mode screenshot.
- CI, TypeScript tests, Python smoke checks, security guards, and frontend/backend modularization.

## Portfolio Highlights

- Static frontend with no build step, split into focused JavaScript modules and CSS.
- RAG backend using Supabase, pgvector, embeddings, and source citations.
- Agent mode with planning, query rewriting, retrieval, answering, grounding verification, and retry.
- Side-by-side `Standard` vs `RAG` comparison mode for evaluating retrieval impact.
- Token, cost, cached-token, latency, model snapshot, and transcript metadata in the UI.
- Portfolio evidence pack with a flow diagram, Compare-mode visual, and repeatable benchmark questions.
- Security hardening for public Edge Functions: JWT verification, rate limiting, model allowlisting, request-size limits, and explicit endpoint visibility.
- Local MCP server that exposes the same backend as tools for agent clients.
- Node test suite covering the pure planning, verification, citation, source, usage, and authorization logic.

## Product Surface

The browser app supports four modes:

- `Standard`: direct browser-to-OpenRouter chat completion with no retrieval.
- `RAG`: retrieves matching chunks from Supabase/pgvector and answers with source citations.
- `Agent`: plans the request, rewrites retrieval queries, retrieves evidence, answers, verifies grounding, and retries retrieval when evidence is weak.
- `Compare`: runs direct and RAG paths side by side so the retrieval delta is visible.

The `Agent` mode renders a pipeline trace under each reply: planner intent, retrieval goal, generated queries, retry queries, retrieved count, cited sources, and grounding status.

## Architecture

```text
Browser UI
  |-- Standard mode --> OpenRouter chat completions
  |-- RAG/Agent mode -> Supabase Edge Function: rag-chat

rag-chat
  |-- planner.ts       -> parse/prepare retrieval intent
  |-- retrieval.ts     -> embed query and search pgvector chunks
  |-- answering.ts     -> call OpenRouter with retrieved evidence
  |-- verification.ts  -> evaluate grounding and build retry queries
  |-- sources.ts       -> normalize citations and source metadata
  |-- usage.ts         -> aggregate token usage
  |-- security.ts      -> rate limits, model allowlist, input guards

MCP server
  |-- ask_xenophon     -> rag-chat
  |-- search_knowledge -> semantic search endpoint
  |-- list_documents   -> document listing endpoint
```

## Repository Structure

- `index.html` - static HTML shell.
- `styles/main.css` - browser app styles.
- `src/config.js` - frontend constants, prompt, pricing, storage keys, and sampling presets.
- `src/api.js` - OpenRouter and Supabase function calls.
- `src/state.js` - browser conversation state helpers.
- `src/render.js` - markdown rendering and sanitization.
- `src/ui.js` - browser UI controller and DOM rendering.
- `supabase/functions/rag-chat/` - RAG and agent pipeline modules.
- `supabase/functions/search-knowledge/` - semantic search endpoint.
- `supabase/functions/list-documents/` - document listing endpoint.
- `supabase/functions/ingest-chunks/` - protected ingestion endpoint.
- `supabase/functions/cleanup-documents/` - protected cleanup endpoint.
- `scripts/` - local ingestion and cleanup helpers.
- `mcp/xenophon-mcp/` - local stdio MCP server exposing Xenophon tools.

## Security Model

Endpoint visibility is explicit in `supabase/config.toml`:

- Public browser/MCP endpoints: `rag-chat`, `search-knowledge`, `list-documents`.
- Protected admin endpoints: `ingest-chunks`, `cleanup-documents`.

All configured functions validate a Supabase JWT. The public endpoints are intended for calls using the publishable Supabase key. The protected endpoints also require the server-side `INGEST_TOKEN` via `x-ingest-token`.

`rag-chat` is bring-your-own-key for OpenRouter. The frontend and MCP server send the OpenRouter key in `x-openrouter-api-key`; the function still accepts the legacy JSON body field for compatibility. The public endpoint does not read a server OpenRouter key from environment variables.

Additional `rag-chat` guards:

- per-worker rate limit
- maximum latest-query length
- maximum retained chat messages and message length
- model allowlist, defaulting to `google/gemini-2.5-flash` and `google/gemini-2.5-pro`
- optional `OPENROUTER_MODEL_ALLOWLIST` env var for comma-separated deployment-specific models

## Run Locally

Open `index.html` directly or serve the repo root with any static file server:

```bash
python3 -m http.server 4173
```

Run unit tests:

```bash
npm test
```

The tests cover planner parsing and fallbacks, verifier parsing and fallbacks, source normalization, citation extraction, usage aggregation, endpoint visibility, model allowlisting, query limits, and rate limiting.

## CI

The GitHub Actions workflow runs secret scanning, repository hygiene checks, MCP `npm ci` plus build, Deno formatting and type checks for Supabase Functions, Node test coverage for the TypeScript logic, and lightweight Python script smoke checks.

## Supabase Functions

Deploy functions from the `supabase/functions/` tree. Required runtime secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INGEST_TOKEN` for ingestion and cleanup

Optional:

- `OPENROUTER_MODEL_ALLOWLIST`

## MCP Server

The MCP package exposes:

- `ask_xenophon` - query the `rag-chat` flow in `rag` or `agent` mode.
- `search_knowledge` - run semantic search over indexed chunks.
- `list_documents` - inspect indexed documents.

Quick start:

```bash
cd mcp/xenophon-mcp
npm install
npm run build
```

Related files:

- [docs/portfolio/README.md](docs/portfolio/README.md)
- [mcp/xenophon-mcp/README.md](mcp/xenophon-mcp/README.md)
- [mcp/xenophon-mcp/mcp-server.example.json](mcp/xenophon-mcp/mcp-server.example.json)
- [CHANGELOG.md](CHANGELOG.md)
