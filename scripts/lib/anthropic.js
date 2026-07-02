// Claude-calling helper for the LitFlow benchmark scripts — the Anthropic-API
// counterpart to scripts/lib/ollama.js's callOllama(). Uses the official
// @anthropic-ai/sdk (not raw fetch — that's only what litflow.html's
// browser-side callLLM() is forced into) and reports exact cost from the
// API's own token usage, since this hits a real paid account.

const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

// $ per million tokens, input/output. Keep in sync with current published pricing.
const PRICING = {
  'claude-opus-4-8':  { in: 5, out: 25 },
  'claude-sonnet-5':  { in: 2, out: 10 }, // intro pricing through 2026-08-31
};

const SAFETY_LIMIT_USD = 4; // hard stop with $1 of headroom under the real $5 credit cap

let cumulativeCostUSD = 0;

// The key file isn't guaranteed to be a bare key — it may be `NAME=sk-ant-...`
// or similar. Extract the sk-ant-* token directly rather than assuming format;
// never log/print any candidate value while doing so.
function loadApiKey(keyPath) {
  const raw = fs.readFileSync(keyPath, 'utf8');
  const match = raw.match(/sk-ant-[A-Za-z0-9_-]+/);
  if (match) return match[0];
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`API key file at ${keyPath} is empty`);
  const eq = trimmed.indexOf('=');
  return eq === -1 ? trimmed : trimmed.slice(eq + 1).trim();
}

function costFor(model, inputTokens, outputTokens) {
  const rates = PRICING[model];
  if (!rates) throw new Error(`No pricing entry for model "${model}" — add one to PRICING before using it`);
  return (inputTokens / 1e6) * rates.in + (outputTokens / 1e6) * rates.out;
}

function getCumulativeCostUSD() { return cumulativeCostUSD; }

// Mirrors callOllama()'s return shape (ok/totalSec/output/error) plus real
// token counts and cost pulled from the API response instead of estimated.
async function callClaude(client, model, prompt, maxTokens = 4096) {
  if (cumulativeCostUSD >= SAFETY_LIMIT_USD) {
    return { ok: false, totalSec: 0, error: `Aborted: cumulative spend $${cumulativeCostUSD.toFixed(4)} already at/above the $${SAFETY_LIMIT_USD} safety limit`, output: '' };
  }

  const started = Date.now();
  try {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();
    const totalSec = +((Date.now() - started) / 1000).toFixed(1);

    const textBlock = message.content.find(b => b.type === 'text');
    const output = textBlock ? textBlock.text : '';
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    const costUSD = costFor(model, inputTokens, outputTokens);
    cumulativeCostUSD += costUSD;

    return {
      ok: true, totalSec, output,
      inputTokens, outputTokens, costUSD,
      tokensPerSec: totalSec > 0 ? +(outputTokens / totalSec).toFixed(1) : 0,
    };
  } catch (e) {
    const totalSec = +((Date.now() - started) / 1000).toFixed(1);
    return { ok: false, totalSec, error: e.message, output: '' };
  }
}

module.exports = { loadApiKey, callClaude, costFor, getCumulativeCostUSD, PRICING, SAFETY_LIMIT_USD };
