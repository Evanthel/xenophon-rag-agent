# Xenophon

Xenophon is a single-file reflective chatbot for distilling dilemmas, concluding conundrums, and relieving reflection. It runs as a static GitHub Pages app and uses OpenRouter-compatible chat completions so the same interface can reach multiple hosted models.

# Specs

Xenophon is implemented in `index.html` with embedded HTML, CSS, and JavaScript. The app stores the API key and settings in browser `sessionStorage`, sends chat requests directly from the browser to OpenRouter, streams model responses into the chat UI, and can export simple or detailed JSON transcripts.

Repository structure:

- `index.html` - complete static app, including UI, settings drawer, OpenRouter request logic, markdown rendering, token/cost metadata, and transcript export.
- `README.md` - project overview, technical specification, and change log.
- `LICENSE` - repository license.

Runtime dependencies are loaded from CDNs in the browser:

- `marked` for markdown parsing.
- `DOMPurify` for sanitizing rendered assistant markdown.

# Change Log

- Rebranded the app as Xenophon with new tagline, "Inquire" submit button, and "Philosophy Frames" settings section.
- Switched from OpenAI to OpenRouter and added Gemini 2.5 Flash plus stable Gemini 2.5 Pro model options.
- Removed the editable system prompt controls and hardcoded the Xenophon prompt into the first user message only.
- Rethemed the UI with a pale parchment, white, and golden-accent Greek philosophy palette.
