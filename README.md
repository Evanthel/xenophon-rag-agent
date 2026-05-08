# Xenophon

Xenophon is a reflective chatbot for distilling dilemmas, concluding conundrums, and relieving reflection. The frontend remains a static GitHub Pages app, but `v1.1` adds Supabase-backed retrieval-augmented generation (RAG) and a built-in comparison mode so you can inspect the difference between a direct answer and a retrieved-context answer.

# Specs

`index.html` contains the full browser app, including the UI, settings drawer, OpenRouter request logic, Supabase RAG controls, side-by-side comparison renderer, markdown rendering, token and cost metadata, and transcript export.

The app now supports three response modes:

- `Standard`: direct browser-to-OpenRouter call with no retrieval.
- `RAG`: browser invokes a Supabase Edge Function, which retrieves matching chunks from pgvector and then calls OpenRouter with that context as high-priority evidence.
- `Compare`: runs both paths side by side and shows the retrieved chunks with citations below the RAG answer.

Repository structure:

- `index.html` - complete static app.
- `scripts/ingest_supabase_rag.py` - extracts local PDFs and uploads chunk batches to Supabase for embedding and storage.
- `scripts/cleanup_supabase_documents.py` - removes test or temporary documents from the Supabase RAG store.
- `supabase/migrations/20260508_add_rag.sql` - schema, pgvector index, and retrieval RPC.
- `supabase/functions/rag-chat/index.ts` - retrieval + OpenRouter orchestration.
- `supabase/functions/ingest-chunks/index.ts` - protected ingestion endpoint that embeds and stores uploaded chunks.
- `supabase/functions/cleanup-documents/index.ts` - protected cleanup endpoint for deleting test or temporary documents.
- `supabase/functions/_shared/cors.ts` - shared CORS headers for browser-safe invocation.
- `README.md` - overview, setup, and change log.
- `LICENSE` - repository license.

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
