import { SAMPLING_LOCKED } from "./config.js";

export async function callOpenRouter({ apiKey, model, messages, temperature, top_p, max_tokens, wantLogprobs, onDelta, stream = true }) {
  // OpenRouter exposes an OpenAI-compatible chat completions endpoint.
  // We always stream so users see generation token by token.
  const payload = {
    model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream,
    max_tokens,
  };
  if (stream) payload.stream_options = { include_usage: true };
  if (!SAMPLING_LOCKED(model)) {
    payload.temperature = temperature;
    payload.top_p = top_p;
    if (stream && wantLogprobs) {
      payload.logprobs = true;
      payload.top_logprobs = 5;
    }
    // When the user picks the 'Reproducible' preset (temperature 0),
    // pin the sampler to a fixed seed so repeated benchmark prompts are
    // comparable. Best-effort per the API reference; temperature 0 alone
    // can still be subject to backend variance.
    if (temperature === 0) payload.seed = 42;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.href,
      "X-Title": "Xenophon",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // Streaming errors are still returned as a single JSON error body.
    const body = await response.json().catch(() => ({}));
    const msg = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(msg);
  }

  if (!stream) {
    const body = await response.json();
    const choice = body?.choices?.[0];
    const content = choice?.message?.content;
    const reply = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => part?.text ?? "").join("")
        : "";
    return {
      reply,
      usage: body?.usage ?? null,
      finish_reason: choice?.finish_reason ?? null,
      model_snapshot: body?.model ?? model,
      id: body?.id ?? null,
      logprobs: null,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let replyText = "";
  let usage = null;
  let finishReason = null;
  let modelSnapshot = null;
  let id = null;
  const logprobsContent = [];

  // Consume SSE events. One self-contained parser that handles both the
  // per-chunk deltas and any trailing data line the server may have
  // sent without a final newline.
  const processSseLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk.error) throw new Error(chunk.error.message || "Streaming error");
    if (chunk.model) modelSnapshot = chunk.model;
    if (chunk.id) id = chunk.id;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta?.content;
    if (delta) {
      replyText += delta;
      if (onDelta) onDelta(delta);
    }
    const lpDelta = choice.logprobs?.content;
    if (Array.isArray(lpDelta)) logprobsContent.push(...lpDelta);
  };

  streamLoop: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      if (rawLine.trim() === "data: [DONE]") break streamLoop;
      processSseLine(rawLine);
    }
  }
  // Flush the decoder and any trailing line the server didn't
  // terminate with a newline — otherwise we'd silently drop the last
  // data event when the stream ends without a final \n.
  buffer += decoder.decode();
  if (buffer.trim()) processSseLine(buffer);

  return {
    reply: replyText,
    usage,
    finish_reason: finishReason,
    model_snapshot: modelSnapshot,
    id,
    logprobs: logprobsContent.length ? logprobsContent : null,
  };
}

export async function callRagChat({
  supabaseUrl,
  supabaseAnonKey,
  openrouterApiKey,
  model,
  messages,
  temperature,
  top_p,
  max_tokens,
  match_count,
  match_threshold,
  pipeline_mode = "rag",
}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/rag-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "x-openrouter-api-key": openrouterApiKey,
    },
    body: JSON.stringify({
      openrouterApiKey,
      model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      temperature,
      top_p,
      max_tokens,
      match_count,
      match_threshold,
      pipeline_mode,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? `Supabase function HTTP ${response.status}`);
  }
  return body;
}
