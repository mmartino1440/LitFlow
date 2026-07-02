// Shared helpers for the LitFlow Ollama benchmark scripts. Mirrors litflow.html's
// callLLM()/readStreamedChat() request shape exactly, so timing reflects real
// LitFlow usage rather than a hand-rolled test harness.

const os = require('os');
const { execSync } = require('child_process');

async function readStreamedChat(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; if (onChunk) onChunk(full); }
      } catch (e) { /* ignore partial chunk */ }
    }
  }
  return full;
}

// One streamed chat completion call against baseUrl (…/v1). Returns timing +
// output on success, or { ok:false, error } on failure/timeout — never throws,
// so a caller can keep going through a multi-step flow after one step fails.
async function callOllama(baseUrl, model, prompt, timeoutSec, onChunk) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  const started = Date.now();
  let firstChunkMs = null;

  try {
    const r = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 10000, stream: true, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error?.message || `HTTP ${r.status}`);
    }
    const full = await readStreamedChat(r, chunk => {
      if (firstChunkMs === null) firstChunkMs = Date.now() - started;
      if (onChunk) onChunk(chunk);
    });
    const totalMs = Date.now() - started;
    const words = full.trim() ? full.trim().split(/\s+/).length : 0;
    const estTokens = Math.round(words * 1.35);
    return {
      ok: true, totalSec: +(totalMs / 1000).toFixed(1),
      timeToFirstTokenSec: firstChunkMs === null ? null : +(firstChunkMs / 1000).toFixed(1),
      words, estTokens,
      tokensPerSec: totalMs > 0 ? +(estTokens / (totalMs / 1000)).toFixed(1) : 0,
      output: full,
    };
  } catch (e) {
    const totalMs = Date.now() - started;
    const timedOut = e.name === 'AbortError';
    return {
      ok: false,
      totalSec: +(totalMs / 1000).toFixed(1),
      error: timedOut ? `Timed out after ${timeoutSec}s (no response)` : e.message,
      output: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadedModels(baseUrl) {
  const root = baseUrl.replace(/\/v1\/?$/, '');
  const r = await fetch(root + '/api/ps');
  const d = await r.json();
  return d.models.map(m => m.name);
}

// Ollama keeps a model resident in VRAM for `keep_alive` (default 5min) after
// last use. Left alone, back-to-back tests stack multiple models in VRAM at
// once (observed firsthand: 4 models simultaneously "loaded" against a 12GB
// card, which made every model past the first time out). Force-unload before
// each test so timings reflect one model running alone.
async function unloadAll(baseUrl) {
  const root = baseUrl.replace(/\/v1\/?$/, '');
  const names = await loadedModels(baseUrl);
  for (const name of names) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    await fetch(root + '/api/generate', { method: 'POST', body: JSON.stringify({ model: name, keep_alive: 0 }), signal: controller.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if ((await loadedModels(baseUrl)).length === 0) return;
    await new Promise(res => setTimeout(res, 1000));
  }
}

async function discoverModels(baseUrl) {
  const root = baseUrl.replace(/\/v1\/?$/, '');
  const r = await fetch(root + '/api/tags');
  const d = await r.json();
  return d.models.map(m => ({ name: m.name, paramSize: m.details?.parameter_size, quant: m.details?.quantization_level, sizeGB: +(m.size / 1e9).toFixed(1) }));
}

async function getOllamaVersion(baseUrl) {
  try {
    const root = baseUrl.replace(/\/v1\/?$/, '');
    const r = await fetch(root + '/api/version');
    const d = await r.json();
    return d.version || 'unknown';
  } catch (e) {
    return 'unreachable';
  }
}

function getHardwareInfo() {
  const info = {
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()?.[0]?.model || 'unknown',
    cpuCores: os.cpus()?.length || 0,
    ramGB: +(os.totalmem() / 1e9).toFixed(1),
    gpu: 'unknown',
  };
  try {
    const out = execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader', { encoding: 'utf8' }).trim();
    const [name, vram, driver] = out.split(',').map(s => s.trim());
    info.gpu = `${name} (${vram}, driver ${driver})`;
  } catch (e) {
    info.gpu = 'nvidia-smi unavailable';
  }
  return info;
}

module.exports = { callOllama, unloadAll, loadedModels, discoverModels, getOllamaVersion, getHardwareInfo };
