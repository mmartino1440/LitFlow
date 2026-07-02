#!/usr/bin/env node
// "Gold standard" benchmark: runs LitFlow's real 3 synthesis methods against
// Claude models, using the FULL dissertation library (all papers, any status,
// notes included) rather than the curated 11-paper test set used for the
// local Ollama benchmarks. Structurally parallel to benchmark-synthesis.js,
// but calls the Anthropic API (scripts/lib/anthropic.js) instead of Ollama.
//
// Usage:
//   node scripts/benchmark-claude.js
//   node scripts/benchmark-claude.js --models=claude-sonnet-5 --methods=standard
//   node scripts/benchmark-claude.js --models=claude-opus-4-8,claude-sonnet-5 --methods=standard,batch_condense,consensus
//   node scripts/benchmark-claude.js --data=test-data/dissertation-test-batch.json --include-notes=false
//     (matched-dataset mode: mirrors benchmark-synthesis.js's Ollama run exactly,
//     for apples-to-apples provider comparison instead of the full-library gold standard)
//
// Output: benchmarks/<timestamp>-claude.md (full intermediate + final output,
//         with exact per-call cost) and the matching .json.

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { loadApiKey, callClaude, getCumulativeCostUSD, PRICING, SAFETY_LIMIT_USD } = require('./lib/anthropic');
const { buildSynthPrompt, buildChunkSummaryPrompt, buildCondensePrompt, buildMergePrompt } = require('./lib/prompts');

function parseArgs(argv) {
  const args = {
    apiKeyPath: 'C:\\Users\\mmart\\OneDrive\\Desktop\\.claude\\api.txt',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    methods: ['standard', 'batch_condense', 'consensus'],
    chunkSize: 5,
    mode: 'lit_review',
    agents: 2,
    mergeMode: 'merge',
    maxTokens: 10000,
    includeNotes: true,
    data: path.join(__dirname, '..', '..', '..', '01_RESEARCH', 'dissertation', '02_literature', 'disertation_library_backup.json'),
    outDir: path.join(__dirname, '..', 'benchmarks'),
  };
  for (const raw of argv.slice(2)) {
    const [key, val] = raw.replace(/^--/, '').split(/=(.*)/s);
    if (key === 'models') args.models = val.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'methods') args.methods = val.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'chunk-size') args.chunkSize = parseInt(val, 10);
    else if (key === 'mode') args.mode = val;
    else if (key === 'agents') args.agents = parseInt(val, 10);
    else if (key === 'merge-mode') args.mergeMode = val;
    else if (key === 'max-tokens') args.maxTokens = parseInt(val, 10);
    else if (key === 'include-notes') args.includeNotes = val !== 'false';
    else if (key === 'api-key-path') args.apiKeyPath = val;
    else if (key === 'data') args.data = val;
    else if (key === 'out-dir') args.outDir = val;
  }
  return args;
}

function fmtRow(cols) { return '| ' + cols.join(' | ') + ' |'; }
function fmtUSD(n) { return '$' + n.toFixed(4); }
function sumSec(steps) { return +steps.reduce((a, s) => a + (s.totalSec || 0), 0).toFixed(1); }
function sumCost(steps) { return steps.reduce((a, s) => a + (s.costUSD || 0), 0); }
function sumTok(steps, field) { return steps.reduce((a, s) => a + (s[field] || 0), 0); }

async function runStandard(client, model, papers, mode, proj, maxTokens, includeNotes) {
  process.stdout.write(`      single call (${papers.length} papers)... `);
  const prompt = buildSynthPrompt(papers, mode, proj, includeNotes);
  const res = await callClaude(client, model, prompt, maxTokens);
  const steps = [{ step: 'standard', ...res }];
  console.log(res.ok ? `${res.totalSec}s, ${res.inputTokens}in/${res.outputTokens}out tok, ${fmtUSD(res.costUSD)}` : `FAILED — ${res.error}`);
  if (!res.ok) return { ok: false, failedAt: 'standard', steps, totalSec: sumSec(steps), totalCostUSD: sumCost(steps) };
  return { ok: true, steps, finalOutput: res.output, totalSec: sumSec(steps), totalCostUSD: sumCost(steps), totalInputTok: sumTok(steps, 'inputTokens'), totalOutputTok: sumTok(steps, 'outputTokens') };
}

async function runBatchCondense(client, model, papers, chunkSize, mode, proj, maxTokens, includeNotes) {
  const chunks = [];
  for (let i = 0; i < papers.length; i += chunkSize) chunks.push(papers.slice(i, i + chunkSize));
  const steps = [];
  const summaries = [];

  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`      batch ${i + 1}/${chunks.length} (${chunks[i].length} papers)... `);
    const res = await callClaude(client, model, buildChunkSummaryPrompt(chunks[i], proj, includeNotes), maxTokens);
    steps.push({ step: `batch_summary_${i + 1}`, papers: chunks[i].map(p => p.title), ...res });
    console.log(res.ok ? `${res.totalSec}s, ${res.inputTokens}in/${res.outputTokens}out tok, ${fmtUSD(res.costUSD)}` : `FAILED — ${res.error}`);
    if (!res.ok) return { ok: false, failedAt: `batch_summary_${i + 1}`, steps, totalSec: sumSec(steps), totalCostUSD: sumCost(steps) };
    summaries.push(res.output);
  }

  process.stdout.write(`      condense (${summaries.length} summaries -> final)... `);
  const condenseRes = await callClaude(client, model, buildCondensePrompt(summaries, mode, proj), maxTokens);
  steps.push({ step: 'condense', ...condenseRes });
  console.log(condenseRes.ok ? `${condenseRes.totalSec}s, ${condenseRes.inputTokens}in/${condenseRes.outputTokens}out tok, ${fmtUSD(condenseRes.costUSD)}` : `FAILED — ${condenseRes.error}`);
  if (!condenseRes.ok) return { ok: false, failedAt: 'condense', steps, totalSec: sumSec(steps), totalCostUSD: sumCost(steps) };

  return { ok: true, steps, finalOutput: condenseRes.output, totalSec: sumSec(steps), totalCostUSD: sumCost(steps), totalInputTok: sumTok(steps, 'inputTokens'), totalOutputTok: sumTok(steps, 'outputTokens') };
}

async function runConsensus(client, model, papers, mode, proj, agentCount, mergeMode, maxTokens, includeNotes) {
  const prompt = buildSynthPrompt(papers, mode, proj, includeNotes);
  const steps = [];
  const responses = [];

  for (let i = 0; i < agentCount; i++) {
    process.stdout.write(`      agent ${i + 1}/${agentCount}... `);
    const res = await callClaude(client, model, prompt, maxTokens);
    steps.push({ step: `agent_${i + 1}`, ...res });
    console.log(res.ok ? `${res.totalSec}s, ${res.inputTokens}in/${res.outputTokens}out tok, ${fmtUSD(res.costUSD)}` : `FAILED — ${res.error}`);
    if (!res.ok) return { ok: false, failedAt: `agent_${i + 1}`, steps, totalSec: sumSec(steps), totalCostUSD: sumCost(steps) };
    responses.push(res.output);
  }

  if (mergeMode !== 'merge') {
    return { ok: true, steps, finalOutput: `[sidebyside mode — ${agentCount} independent agent responses, no merge call]`, totalSec: sumSec(steps), totalCostUSD: sumCost(steps), totalInputTok: sumTok(steps, 'inputTokens'), totalOutputTok: sumTok(steps, 'outputTokens') };
  }

  process.stdout.write(`      merge (${agentCount} agent responses -> consensus)... `);
  const mergeRes = await callClaude(client, model, buildMergePrompt(responses, mode, proj), maxTokens);
  steps.push({ step: 'merge', ...mergeRes });
  console.log(mergeRes.ok ? `${mergeRes.totalSec}s, ${mergeRes.inputTokens}in/${mergeRes.outputTokens}out tok, ${fmtUSD(mergeRes.costUSD)}` : `FAILED — ${mergeRes.error}`);
  if (!mergeRes.ok) return { ok: false, failedAt: 'merge', steps, totalSec: sumSec(steps), totalCostUSD: sumCost(steps) };

  return { ok: true, steps, finalOutput: mergeRes.output, totalSec: sumSec(steps), totalCostUSD: sumCost(steps), totalInputTok: sumTok(steps, 'inputTokens'), totalOutputTok: sumTok(steps, 'outputTokens') };
}

const METHOD_LABEL = { standard: 'Standard (single-shot)', batch_condense: 'Batch condense', consensus: 'Consensus / multi-agent' };

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });

  const apiKey = loadApiKey(args.apiKeyPath);
  const client = new Anthropic({ apiKey });

  const data = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  const project = data.settings?.project || 'my research project';
  // Full-set run: ALL papers regardless of status, notes included — unlike the
  // Ollama benchmark's `status === 'done'` filter.
  const papers = data.papers;

  console.log(`Loaded ${papers.length} papers (all statuses) from ${args.data}`);
  console.log(`Methods under test: ${args.methods.join(', ')}`);
  console.log(`Mode: ${args.mode} | Project: "${project}" | chunk-size: ${args.chunkSize} | agents: ${args.agents} | merge-mode: ${args.mergeMode} | include-notes: ${args.includeNotes}`);
  console.log(`Models: ${args.models.join(', ')}`);
  console.log(`Safety spend limit: $${SAFETY_LIMIT_USD}\n`);

  const results = [];
  for (const model of args.models) {
    if (!PRICING[model]) { console.error(`No pricing entry for "${model}" — skipping. Add it to scripts/lib/anthropic.js PRICING.`); continue; }
    console.log(`${model}`);
    const methodResults = {};
    for (const method of args.methods) {
      console.log(`  [${METHOD_LABEL[method] || method}]`);
      let res;
      if (method === 'standard') res = await runStandard(client, model, papers, args.mode, project, args.maxTokens, args.includeNotes);
      else if (method === 'batch_condense') res = await runBatchCondense(client, model, papers, args.chunkSize, args.mode, project, args.maxTokens, args.includeNotes);
      else if (method === 'consensus') res = await runConsensus(client, model, papers, args.mode, project, args.agents, args.mergeMode, args.maxTokens, args.includeNotes);
      else { console.log(`  unknown method "${method}", skipping`); continue; }
      methodResults[method] = res;
      console.log(`  running total spend: ${fmtUSD(getCumulativeCostUSD())}\n`);
    }
    results.push({ model, methods: methodResults });
  }

  const grandTotalUSD = getCumulativeCostUSD();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(args.outDir, `${ts}-claude.json`);
  const mdPath = path.join(args.outDir, `${ts}-claude.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({
    mode: args.mode, chunkSize: args.chunkSize, agents: args.agents, mergeMode: args.mergeMode,
    includeNotes: args.includeNotes, dataFile: args.data,
    project, paperCount: papers.length, methods: args.methods, grandTotalUSD, results,
  }, null, 2));

  const lines = [];
  lines.push(`# LitFlow Claude benchmark — ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Test setup');
  lines.push(`- Data: ${args.data} — ${papers.length} papers, notes ${args.includeNotes ? 'included' : 'excluded'}`);
  lines.push(`- Synthesis mode: ${args.mode}`);
  lines.push(`- Batch condense chunk size: ${args.chunkSize} (-> ${Math.ceil(papers.length / args.chunkSize)} batches)`);
  lines.push(`- Consensus agents: ${args.agents}, merge mode: ${args.mergeMode}`);
  lines.push(`- Models: ${args.models.join(', ')}`);
  lines.push(`- **Grand total spend: ${fmtUSD(grandTotalUSD)}**`);
  lines.push('');
  lines.push('## Results summary (all methods x all models)');
  lines.push('');
  lines.push(fmtRow(['Model', 'Method', 'Calls', 'Total time', 'Input tok', 'Output tok', 'Cost', 'Result']));
  lines.push(fmtRow(['---', '---', '---', '---', '---', '---', '---', '---']));
  for (const r of results) {
    for (const method of args.methods) {
      const res = r.methods[method];
      if (!res) continue;
      lines.push(fmtRow([
        r.model, METHOD_LABEL[method] || method, res.steps.length,
        res.totalSec + 's',
        res.ok ? res.totalInputTok : sumTok(res.steps, 'inputTokens'),
        res.ok ? res.totalOutputTok : sumTok(res.steps, 'outputTokens'),
        fmtUSD(res.totalCostUSD),
        res.ok ? '✅ OK' : `❌ failed at ${res.failedAt}`,
      ]));
    }
  }
  lines.push('');
  lines.push('## Per-model, per-method detail (intermediate calls + final output)');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.model}`);
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
        lines.push(`**${label}** — ${step.ok ? `${step.totalSec}s, ${step.inputTokens} input / ${step.outputTokens} output tokens, ${fmtUSD(step.costUSD)}` : `FAILED: ${step.error}`}`);
        lines.push('');
        if (step.papers) lines.push(`_Papers: ${step.papers.join('; ')}_\n`);
        lines.push(step.ok ? '```\n' + step.output.trim() + '\n```' : '_(no output)_');
        lines.push('');
      }
      lines.push(res.ok
        ? `**TOTAL (${method}):** ${res.totalSec}s across ${res.steps.length} call(s), ${res.totalInputTok} input / ${res.totalOutputTok} output tokens, ${fmtUSD(res.totalCostUSD)}.`
        : `**FAILED (${method})** at step "${res.failedAt}" after ${fmtUSD(res.totalCostUSD)} of prior successful calls.`);
      lines.push('');
    }
  }
  fs.writeFileSync(mdPath, lines.join('\n'));

  console.log(`Grand total spend: ${fmtUSD(grandTotalUSD)}`);
  console.log(`Report written to:\n  ${mdPath}\n  ${jsonPath}`);
}

main().catch(e => { console.error('Benchmark failed:', e); process.exit(1); });
