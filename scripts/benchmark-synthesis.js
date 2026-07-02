#!/usr/bin/env node
// Benchmarks local Ollama models against ALL THREE of LitFlow's synthesis
// methods — Standard (single-shot), Batch condense, and Consensus/multi-agent —
// against one real LitFlow data file. Mirrors litflow.html's exact prompt
// builders (scripts/lib/prompts.js) and callLLM() request shape
// (scripts/lib/ollama.js), so results reflect real LitFlow usage, not a
// synthetic test harness.
//
// Usage:
//   node scripts/benchmark-synthesis.js
//   node scripts/benchmark-synthesis.js --models=llama3:latest,phi4:latest
//   node scripts/benchmark-synthesis.js --methods=standard,consensus --agents=3 --merge-mode=merge
//   node scripts/benchmark-synthesis.js --data=test-data/dissertation-test-batch.json --chunk-size=5 --mode=lit_review
//
// Output: benchmarks/<timestamp>-synthesis.md (full intermediate + final output
//         per model per method, with per-call timing) and the matching .json.

const fs = require('fs');
const path = require('path');
const { callOllama, unloadAll, discoverModels, getOllamaVersion, getHardwareInfo } = require('./lib/ollama');
const { buildSynthPrompt, buildChunkSummaryPrompt, buildCondensePrompt, buildMergePrompt } = require('./lib/prompts');

function parseArgs(argv) {
  const args = {
    timeout: 120,
    baseUrl: 'http://localhost:11434/v1',
    models: null,
    methods: ['standard', 'batch_condense', 'consensus'],
    chunkSize: 5,
    mode: 'lit_review',
    agents: 2,
    mergeMode: 'merge',
    data: path.join(__dirname, '..', 'test-data', 'dissertation-test-batch.json'),
    outDir: path.join(__dirname, '..', 'benchmarks'),
  };
  for (const raw of argv.slice(2)) {
    const [key, val] = raw.replace(/^--/, '').split(/=(.*)/s);
    if (key === 'timeout') args.timeout = parseInt(val, 10);
    else if (key === 'base-url') args.baseUrl = val;
    else if (key === 'models') args.models = val.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'methods') args.methods = val.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'chunk-size') args.chunkSize = parseInt(val, 10);
    else if (key === 'mode') args.mode = val;
    else if (key === 'agents') args.agents = parseInt(val, 10);
    else if (key === 'merge-mode') args.mergeMode = val;
    else if (key === 'data') args.data = val;
    else if (key === 'out-dir') args.outDir = val;
  }
  return args;
}

function fmtRow(cols) { return '| ' + cols.join(' | ') + ' |'; }
function sumSec(steps) { return +steps.reduce((a, s) => a + (s.totalSec || 0), 0).toFixed(1); }
function sumTok(steps) { return steps.reduce((a, s) => a + (s.estTokens || 0), 0); }

// ── Method 1: Standard (single-shot) — one call with every "done" paper in one prompt.
async function runStandard(baseUrl, modelName, papers, mode, proj, timeoutSec) {
  process.stdout.write(`      single call (${papers.length} papers)... `);
  const prompt = buildSynthPrompt(papers, mode, proj, false);
  const res = await callOllama(baseUrl, modelName, prompt, timeoutSec);
  const steps = [{ step: 'standard', ...res }];
  console.log(res.ok ? `${res.totalSec}s, ~${res.estTokens} tok, ${res.tokensPerSec} tok/s` : `FAILED — ${res.error}`);
  if (!res.ok) return { ok: false, failedAt: 'standard', steps, totalSec: sumSec(steps), totalTokens: sumTok(steps) };
  return {
    ok: true, steps, finalOutput: res.output,
    totalSec: sumSec(steps), totalTokens: sumTok(steps),
    avgTokensPerSec: res.totalSec > 0 ? +(res.estTokens / res.totalSec).toFixed(1) : 0,
  };
}

// ── Method 2: Batch condense — N chunk-summary calls, then 1 condense call.
async function runBatchCondense(baseUrl, modelName, papers, chunkSize, mode, proj, timeoutSec) {
  const chunks = [];
  for (let i = 0; i < papers.length; i += chunkSize) chunks.push(papers.slice(i, i + chunkSize));
  const steps = [];
  const summaries = [];

  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`      batch ${i + 1}/${chunks.length} (${chunks[i].length} papers)... `);
    const res = await callOllama(baseUrl, modelName, buildChunkSummaryPrompt(chunks[i], proj, false), timeoutSec);
    steps.push({ step: `batch_summary_${i + 1}`, papers: chunks[i].map(p => p.title), ...res });
    console.log(res.ok ? `${res.totalSec}s, ~${res.estTokens} tok, ${res.tokensPerSec} tok/s` : `FAILED — ${res.error}`);
    if (!res.ok) return { ok: false, failedAt: `batch_summary_${i + 1}`, steps, totalSec: sumSec(steps), totalTokens: sumTok(steps) };
    summaries.push(res.output);
  }

  process.stdout.write(`      condense (${summaries.length} summaries -> final)... `);
  const condenseRes = await callOllama(baseUrl, modelName, buildCondensePrompt(summaries, mode, proj), timeoutSec);
  steps.push({ step: 'condense', ...condenseRes });
  console.log(condenseRes.ok ? `${condenseRes.totalSec}s, ~${condenseRes.estTokens} tok, ${condenseRes.tokensPerSec} tok/s` : `FAILED — ${condenseRes.error}`);
  if (!condenseRes.ok) return { ok: false, failedAt: 'condense', steps, totalSec: sumSec(steps), totalTokens: sumTok(steps) };

  const totalSec = sumSec(steps);
  return {
    ok: true, steps, finalOutput: condenseRes.output,
    totalSec, totalTokens: sumTok(steps),
    avgTokensPerSec: totalSec > 0 ? +(sumTok(steps) / totalSec).toFixed(1) : 0,
  };
}

// ── Method 3: Consensus/multi-agent — same single-shot prompt run `agents` times
// independently, then (if mergeMode === 'merge') one merge call over all responses.
async function runConsensus(baseUrl, modelName, papers, mode, proj, agentCount, mergeMode, timeoutSec) {
  const prompt = buildSynthPrompt(papers, mode, proj, false);
  const steps = [];
  const responses = [];

  for (let i = 0; i < agentCount; i++) {
    process.stdout.write(`      agent ${i + 1}/${agentCount}... `);
    const res = await callOllama(baseUrl, modelName, prompt, timeoutSec);
    steps.push({ step: `agent_${i + 1}`, ...res });
    console.log(res.ok ? `${res.totalSec}s, ~${res.estTokens} tok, ${res.tokensPerSec} tok/s` : `FAILED — ${res.error}`);
    if (!res.ok) return { ok: false, failedAt: `agent_${i + 1}`, steps, totalSec: sumSec(steps), totalTokens: sumTok(steps) };
    responses.push(res.output);
  }

  if (mergeMode !== 'merge') {
    const totalSec = sumSec(steps);
    return {
      ok: true, steps, finalOutput: `[sidebyside mode — ${agentCount} independent agent responses, no merge call]`,
      totalSec, totalTokens: sumTok(steps),
      avgTokensPerSec: totalSec > 0 ? +(sumTok(steps) / totalSec).toFixed(1) : 0,
    };
  }

  process.stdout.write(`      merge (${agentCount} agent responses -> consensus)... `);
  const mergeRes = await callOllama(baseUrl, modelName, buildMergePrompt(responses, mode, proj), timeoutSec);
  steps.push({ step: 'merge', ...mergeRes });
  console.log(mergeRes.ok ? `${mergeRes.totalSec}s, ~${mergeRes.estTokens} tok, ${mergeRes.tokensPerSec} tok/s` : `FAILED — ${mergeRes.error}`);
  if (!mergeRes.ok) return { ok: false, failedAt: 'merge', steps, totalSec: sumSec(steps), totalTokens: sumTok(steps) };

  const totalSec = sumSec(steps);
  return {
    ok: true, steps, finalOutput: mergeRes.output,
    totalSec, totalTokens: sumTok(steps),
    avgTokensPerSec: totalSec > 0 ? +(sumTok(steps) / totalSec).toFixed(1) : 0,
  };
}

const METHOD_LABEL = {
  standard: 'Standard (single-shot)',
  batch_condense: 'Batch condense',
  consensus: 'Consensus / multi-agent',
};

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });

  const data = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  const project = data.settings?.project || 'my research project';
  const donePapers = data.papers.filter(p => p.status === 'done');
  if (!donePapers.length) {
    console.error(`No "done" papers found in ${args.data}`);
    process.exit(1);
  }

  console.log(`Loaded ${donePapers.length} done papers from ${args.data}`);
  console.log(`Methods under test: ${args.methods.join(', ')}`);
  console.log(`Mode: ${args.mode} | Project: "${project}" | chunk-size: ${args.chunkSize} | agents: ${args.agents} | merge-mode: ${args.mergeMode}`);

  console.log(`\nDiscovering models at ${args.baseUrl} ...`);
  const catalog = await discoverModels(args.baseUrl);
  const targets = args.models
    ? args.models.map(name => catalog.find(m => m.name === name)).filter(Boolean)
    : catalog;
  if (!targets.length) {
    console.error('No matching models found. Available:', catalog.map(m => m.name).join(', '));
    process.exit(1);
  }

  console.log('Unloading any already-resident models for a clean baseline...');
  await unloadAll(args.baseUrl);

  const hw = getHardwareInfo();
  const ollamaVersion = await getOllamaVersion(args.baseUrl);
  console.log('Hardware:', hw);
  console.log('Ollama version:', ollamaVersion);
  console.log(`\nTesting ${targets.length} model(s) x ${args.methods.length} method(s), ${args.timeout}s timeout per call:\n`);

  const results = []; // { model, paramSize, quant, sizeGB, methods: { standard: {...}, batch_condense: {...}, consensus: {...} } }
  for (const m of targets) {
    console.log(`${m.name} (${m.paramSize}, ${m.quant}, ${m.sizeGB}GB)`);
    const methodResults = {};
    for (const method of args.methods) {
      console.log(`  [${METHOD_LABEL[method] || method}]`);
      let res;
      if (method === 'standard') res = await runStandard(args.baseUrl, m.name, donePapers, args.mode, project, args.timeout);
      else if (method === 'batch_condense') res = await runBatchCondense(args.baseUrl, m.name, donePapers, args.chunkSize, args.mode, project, args.timeout);
      else if (method === 'consensus') res = await runConsensus(args.baseUrl, m.name, donePapers, args.mode, project, args.agents, args.mergeMode, args.timeout);
      else { console.log(`  unknown method "${method}", skipping`); continue; }
      methodResults[method] = res;
      // Unload between methods too: a timed-out call can otherwise leave the
      // server mid-generation, contaminating the next method's timing for the same model.
      await unloadAll(args.baseUrl);
    }
    results.push({ model: m.name, paramSize: m.paramSize, quant: m.quant, sizeGB: m.sizeGB, methods: methodResults });
    console.log('');
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(args.outDir, `${ts}-synthesis.json`);
  const mdPath = path.join(args.outDir, `${ts}-synthesis.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({
    hw, ollamaVersion, timeoutSec: args.timeout, mode: args.mode, chunkSize: args.chunkSize,
    agents: args.agents, mergeMode: args.mergeMode, project, paperCount: donePapers.length,
    methods: args.methods, results,
  }, null, 2));

  const lines = [];
  lines.push(`# LitFlow synthesis benchmark — ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Hardware');
  lines.push(`- GPU: ${hw.gpu}`);
  lines.push(`- CPU: ${hw.cpu} (${hw.cpuCores} logical cores)`);
  lines.push(`- RAM: ${hw.ramGB} GB`);
  lines.push(`- OS: ${hw.platform}`);
  lines.push(`- Ollama version: ${ollamaVersion}`);
  lines.push(`- Timeout per LLM call: ${args.timeout}s`);
  lines.push('');
  lines.push('## Test setup');
  lines.push(`- Data: \`${path.relative(path.join(__dirname, '..'), args.data)}\` — ${donePapers.length} papers with status=done`);
  lines.push(`- Synthesis mode: ${args.mode}`);
  lines.push(`- Batch condense chunk size: ${args.chunkSize} (-> ${Math.ceil(donePapers.length / args.chunkSize)} batches)`);
  lines.push(`- Consensus agents: ${args.agents}, merge mode: ${args.mergeMode}`);
  lines.push('');
  lines.push('## Results summary (all methods x all models)');
  lines.push('');
  lines.push(fmtRow(['Model', 'Method', 'Calls', 'Total time', 'Est. tokens', 'Avg tok/s', 'Result']));
  lines.push(fmtRow(['---', '---', '---', '---', '---', '---', '---']));
  for (const r of results) {
    for (const method of args.methods) {
      const res = r.methods[method];
      if (!res) continue;
      lines.push(fmtRow([
        r.model, METHOD_LABEL[method] || method, res.steps.length,
        res.ok ? res.totalSec + 's' : res.totalSec + 's (partial)',
        res.totalTokens,
        res.ok ? res.avgTokensPerSec : '—',
        res.ok ? '✅ OK' : `❌ failed at ${res.failedAt}`,
      ]));
    }
  }
  lines.push('');
  lines.push('## Per-model, per-method detail (intermediate calls + final output)');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.model} (${r.paramSize}, ${r.quant}, ${r.sizeGB}GB)`);
    lines.push('');
    for (const method of args.methods) {
      const res = r.methods[method];
      if (!res) continue;
      lines.push(`#### ${METHOD_LABEL[method] || method}`);
      lines.push('');
      for (const step of res.steps) {
        const label = step.step.startsWith('batch_summary') ? `Batch summary ${step.step.split('_').pop()}`
          : step.step.startsWith('agent_') ? `Agent ${step.step.split('_').pop()}`
          : step.step === 'merge' ? 'Merge (consensus)'
          : step.step === 'condense' ? 'Final condense'
          : 'Single-shot call';
        lines.push(`**${label}** — ${step.ok ? `${step.totalSec}s, TTFT ${step.timeToFirstTokenSec}s, ~${step.estTokens} tok, ${step.tokensPerSec} tok/s` : `FAILED: ${step.error}`}`);
        lines.push('');
        if (step.papers) lines.push(`_Papers: ${step.papers.join('; ')}_\n`);
        lines.push(step.ok ? '```\n' + step.output.trim() + '\n```' : '_(no output)_');
        lines.push('');
      }
      lines.push(res.ok
        ? `**TOTAL (${method}):** ${res.totalSec}s across ${res.steps.length} call(s), ~${res.totalTokens} est. tokens, ${res.avgTokensPerSec} tok/s average.`
        : `**FAILED (${method})** at step "${res.failedAt}" after ${res.totalSec}s of prior successful calls.`);
      lines.push('');
    }
  }
  fs.writeFileSync(mdPath, lines.join('\n'));

  console.log(`Report written to:\n  ${mdPath}\n  ${jsonPath}`);
}

main().catch(e => { console.error('Benchmark failed:', e); process.exit(1); });
