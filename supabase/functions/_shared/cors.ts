export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    "x-openrouter-api-key",
    "x-ingest-token",
  ].join(", "),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
