# Changelog

## Unreleased

- Added a portfolio evidence pack with a flow diagram, Compare-mode preview, fixed benchmark questions, and a live benchmark runner.
- Repositioned README and UI copy around a portfolio-ready product narrative.
- Split the static frontend into `index.html`, `styles/main.css`, and focused modules under `src/`.
- Split `rag-chat` into planner, retrieval, answering, verification, usage, source, security, and shared type modules.
- Added `rag-chat` rate limiting, request-size guards, model allowlisting, and explicit endpoint visibility.
- Moved OpenRouter key forwarding for RAG/MCP calls to `x-openrouter-api-key`, with legacy JSON body fallback.
- Added unit tests for planner/verifier parsing and fallbacks, source normalization, citation extraction, usage aggregation, and endpoint input guards.

## v1.2.1

- Improved PDF ingestion quality by detecting corrupted embedded text and falling back to OCR for affected pages before chunking and embedding.

## v1.2

- Added `Agent` mode as a lightweight agentic pipeline layered on top of the existing RAG backend.
- Added a clarify-or-answer gate so the planner can ask one clarifying follow-up when the request is too vague.
- Added multi-query retrieval planning with visible query rewrite output.
- Added a grounding verification step and a visible pipeline trace panel under agent replies.
- Added automatic retrieval retry with broader fallback queries when the first evidence pass is weak.
- Added planner rationale preview in the UI, including decision, intent, and retrieval goal.

## v1.1

- Added Supabase-backed RAG with pgvector storage and a retrieval RPC.
- Added `RAG` and `Compare` response modes to the static frontend.
- Added a side-by-side `No RAG` vs `RAG` answer comparison view.
- Added a retrieved-context panel with source citations and excerpts.
- Added protected ingestion and cleanup functions plus local helper scripts for managing Supabase knowledge documents.

## v1

- Rebranded the app as Xenophon with new tagline, `Inquire` submit button, and `Philosophy Frames` settings section.
- Switched from OpenAI to OpenRouter and added Gemini 2.5 Flash plus stable Gemini 2.5 Pro model options.
- Removed the editable system prompt controls and hardcoded the Xenophon prompt into the first user message only.
- Rethemed the UI with a pale parchment, white, and golden-accent Greek philosophy palette.
