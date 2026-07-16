# Xenophon MCP Server

This package exposes the Xenophon knowledge base and agent flow as a local `stdio` MCP server.

## Tools

- `ask_xenophon` - send a prompt to the existing Supabase `rag-chat` function in `rag` or `agent` mode.
- `search_knowledge` - run semantic search against the indexed Supabase chunks.
- `list_documents` - inspect documents currently loaded into the knowledge base.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` - sent to Supabase Edge Functions for JWT verification.
- `OPENROUTER_API_KEY`

Optional:

- `XENOPHON_DEFAULT_MODEL` - defaults to `google/gemini-2.5-flash`.

## Install and run

```bash
cd mcp/xenophon-mcp
npm install
npm run build
```

Then run the server:

```bash
SUPABASE_URL=... \
SUPABASE_ANON_KEY=... \
OPENROUTER_API_KEY=... \
node dist/index.js
```

## Example MCP host config

```json
{
  "mcpServers": {
    "xenophon": {
      "command": "node",
      "args": [
        "/absolute/path/to/xenophon-rag-agent/mcp/xenophon-mcp/dist/index.js"
      ],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_ANON_KEY": "your-publishable-key",
        "OPENROUTER_API_KEY": "your-openrouter-key",
        "XENOPHON_DEFAULT_MODEL": "google/gemini-2.5-flash"
      }
    }
  }
}
```

A copyable example also lives in [mcp-server.example.json](mcp-server.example.json).

## Supabase functions used

- `rag-chat`
- `search-knowledge`
- `list-documents`
