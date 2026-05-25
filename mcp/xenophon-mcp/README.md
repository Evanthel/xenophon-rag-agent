# Xenophon MCP Server

This package exposes the Xenophon knowledge base and agent flow as a local `stdio` MCP server.

## Tools

- `ask_xenophon` - send a prompt to the existing Supabase `rag-chat` function in `rag` or `agent` mode.
- `search_knowledge` - run semantic search against the indexed Supabase chunks.
- `list_documents` - inspect documents currently loaded into the knowledge base.

## Required environment variables

- `SUPABASE_URL`
- `OPENROUTER_API_KEY`

Optional:

- `SUPABASE_ANON_KEY` - sent to Supabase Edge Functions if your deployment expects it.
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
        "/absolute/path/to/lmt-chatbot/mcp/xenophon-mcp/dist/index.js"
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

A copyable example also lives in [mcp-server.example.json](/Users/piotrobiegly/Documents/GitHub/lmt-chatbot/mcp/xenophon-mcp/mcp-server.example.json:1).

## Supabase functions used

- `rag-chat`
- `search-knowledge`
- `list-documents`
