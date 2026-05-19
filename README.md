# Xenophon

Xenophon is a reflective chatbot for distilling dilemmas, concluding conundrums, and relieving reflection. The frontend remains a static GitHub Pages app, but `v1.3` adds a visible lightweight agentic pipeline on top of the earlier Supabase-backed retrieval-augmented generation (RAG) flow.

# Specs

`index.html` contains the full browser app, including the UI, settings drawer, OpenRouter request logic, Supabase RAG controls, agent pipeline renderer, side-by-side comparison view, markdown rendering, token and cost metadata, and transcript export.

The app now supports four response modes:

- `Standard`: direct browser-to-OpenRouter call with no retrieval.
- `RAG`: browser invokes a Supabase Edge Function, which retrieves matching chunks from pgvector and then calls OpenRouter with that context as high-priority evidence.
- `Agent`: browser invokes the same Edge Function in agent mode. The backend plans the request, decides whether to answer now or ask one clarifying question, rewrites retrieval queries, retrieves evidence, answers with citations, verifies grounding, and retries retrieval when the first evidence pass is weak.
- `Compare`: runs both paths side by side and shows the retrieved chunks with citations below the RAG answer.

The `Agent` mode exposes a visible `Pipeline trace` beneath the reply, including:

- step status labels such as `done`, `skipped`, and `low_confidence`
- planner decision, intent, and retrieval goal
- generated retrieval queries and retry queries
- number of retrieved chunks
- sources actually cited in the final answer
- a grounding badge such as `Grounded`, `Weak evidence`, or `Needs clarification`

Repository structure:

- `index.html` - complete static app.
- `scripts/ingest_supabase_rag.py` - extracts local PDFs and uploads chunk batches to Supabase for embedding and storage, with automatic OCR fallback for pages whose embedded PDF text is corrupted.
- `scripts/cleanup_supabase_documents.py` - removes test or temporary documents from the Supabase RAG store.
- `supabase/migrations/20260508_add_rag.sql` - schema, pgvector index, and retrieval RPC.
- `supabase/functions/rag-chat/index.ts` - retrieval + OpenRouter orchestration, including the agentic pipeline.
- `supabase/functions/ingest-chunks/index.ts` - protected ingestion endpoint that embeds and stores uploaded chunks.
- `supabase/functions/cleanup-documents/index.ts` - protected cleanup endpoint for deleting test or temporary documents.
- `supabase/functions/_shared/cors.ts` - shared CORS headers for browser-safe invocation.

Runtime dependencies in the browser are still loaded from CDNs:

- `marked` for markdown parsing.
- `DOMPurify` for sanitizing rendered assistant markdown.

# Change Log

## v1

- Rebranded the app as Xenophon with new tagline, `Inquire` submit button, and `Philosophy Frames` settings section.
- Switched from OpenAI to OpenRouter and added Gemini 2.5 Flash plus stable Gemini 2.5 Pro model options.
- Removed the editable system prompt controls and hardcoded the Xenophon prompt into the first user message only.
- Rethemed the UI with a pale parchment, white, and golden-accent Greek philosophy palette.

## v1.1

- Added Supabase-backed RAG with pgvector storage and a retrieval RPC.
- Added `RAG` and `Compare` response modes to the static frontend.
- Added a side-by-side `No RAG` vs `RAG` answer comparison view.
- Added a retrieved-context panel with source citations and excerpts.
- Added protected ingestion and cleanup functions plus local helper scripts for managing Supabase knowledge documents.

## v1.2

- Added `Agent` mode as a lightweight agentic pipeline layered on top of the existing RAG backend.
- Added a `clarify-or-answer` gate so the planner can ask one clarifying follow-up when the request is too vague.
- Added multi-query retrieval planning with visible query rewrite output.
- Added a grounding verification step and a visible `Pipeline trace` panel under agent replies.
- Added automatic retrieval retry with broader fallback queries when the first evidence pass is weak.
- Added planner rationale preview in the UI, including decision, intent, and retrieval goal.
