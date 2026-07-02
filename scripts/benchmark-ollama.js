#!/usr/bin/env node
// Benchmarks local Ollama models against LitFlow's real "lit_review" synthesis
// prompt, so response time/quality numbers reflect actual LitFlow usage rather
// than a toy prompt. Requires Node 18+ (uses built-in fetch/AbortController).
//
// Usage:
//   node scripts/benchmark-ollama.js
//   node scripts/benchmark-ollama.js --models=llama3:latest,phi4:latest
//   node scripts/benchmark-ollama.js --timeout=60 --base-url=http://localhost:11434/v1
//
// Output: benchmarks/<timestamp>.md (human-readable report) and
//         benchmarks/<timestamp>.json (raw data, full output text included).

const fs = require('fs');
const path = require('path');
const { callOllama, unloadAll, discoverModels, getOllamaVersion, getHardwareInfo } = require('./lib/ollama');

function parseArgs(argv) {
  const args = { timeout: 180, baseUrl: 'http://localhost:11434/v1', models: null, outDir: path.join(__dirname, '..', 'benchmarks') };
  for (const raw of argv.slice(2)) {
    const [key, val] = raw.replace(/^--/, '').split(/=(.*)/s);
    if (key === 'timeout') args.timeout = parseInt(val, 10);
    else if (key === 'base-url') args.baseUrl = val;
    else if (key === 'models') args.models = val.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'out-dir') args.outDir = val;
  }
  return args;
}

// ── Example paper notes — same shape as LitFlow's paper objects, used to build
// the identical prompt buildSynthPrompt() in litflow.html would produce for mode "lit_review".
const EXAMPLE_PAPERS = [
  {
    title: 'Sustained attention deficits following prefrontal lesions in a naturalistic task',
    citation: 'Alvarez & Chen, 2023, J. Cogn. Neurosci.',
    design: 'Lesion-comparison study, N=34 (18 PFC lesion, 16 matched controls)',
    methods: 'Continuous performance task during 45-min naturalistic video viewing; eye tracking + EEG',
    findings: 'PFC lesion group showed 40% more attentional lapses, concentrated in the second half of sessions; no group difference in first 15 minutes.',
    relevance: 'Motivates using naturalistic, extended-duration paradigms rather than short lab tasks to detect subtle attentional deficits.',
    questions: 'Unclear whether the effect is specific to sustained attention or reflects general fatigue/vigilance decline.',
  },
  {
    title: 'Head pose dynamics as a behavioral marker of engagement in clinical interviews',
    citation: 'Okafor et al., 2024, Behav. Res. Methods',
    design: 'Observational, N=52 clinical interviews, cross-sectional',
    methods: 'Automated head pose extraction (video) correlated with clinician-rated engagement scores',
    findings: 'Reduced head pose variability predicted clinician-rated disengagement (r=0.52); effect stronger in the latter third of interviews.',
    relevance: 'Supports using automated head/face kinematics as a scalable, objective proxy for engagement in interview-based protocols.',
    questions: 'Sample was outpatient adults only; unclear if the marker generalizes to other populations or interview formats.',
  },
  {
    title: 'Diarization-based turn-taking metrics predict rapport in unstructured dyadic conversation',
    citation: 'Petrov & Lindqvist, 2025, Comput. Speech Lang.',
    design: 'Corpus study, N=120 dyadic conversations, naturalistic setting',
    methods: 'WhisperX-based diarization; turn-taking latency and overlap rate computed automatically and compared to human rapport ratings',
    findings: 'Shorter turn-taking latency and moderate overlap rate were associated with higher rated rapport; very high or very low overlap both predicted lower rapport.',
    relevance: 'Suggests audio-derived turn-taking features can supplement video-derived engagement markers in a multimodal pipeline.',
    questions: 'Diarization error rate in noisy/naturalistic audio was not fully characterized; could bias turn-taking estimates.',
  },
];

function buildLitReviewPrompt(papers, project) {
  const notes = papers.map((p, i) => {
    const parts = [
      `Study design: ${p.design}`,
      `Methods: ${p.methods}`,
      `Findings: ${p.findings}`,
      `Relevance to ${project}: ${p.relevance}`,
      `Open questions: ${p.questions}`,
    ];
    return `[${i + 1}] ${p.title} (${p.citation})\n${parts.join('\n')}`;
  }).join('\n\n---\n\n');

  return `You are a scientific writing assistant. Based ONLY on the researcher's notes below — do not add information from your training data — write a structured literature review section of approximately 400–600 words. Use in-text citations by paper number [1], [2], etc. Synthesize themes and do not merely summarize each paper sequentially. Write in formal academic prose appropriate for a manuscript or dissertation.\n\nResearcher's notes:\n${notes}`;
}

function fmtRow(cols) { return '| ' + cols.join(' | ') + ' |'; }

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });

  console.log(`Discovering models at ${args.baseUrl} ...`);
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
  const prompt = buildLitReviewPrompt(EXAMPLE_PAPERS, 'my research project');

  console.log('Hardware:', hw);
  console.log('Ollama version:', ollamaVersion);
  console.log(`Testing ${targets.length} model(s), timeout ${args.timeout}s each:\n`);

  const results = [];
  for (const m of targets) {
    process.stdout.write(`  ${m.name} (${m.paramSize}, ${m.quant}, ${m.sizeGB}GB) ... `);
    const res = await callOllama(args.baseUrl, m.name, prompt, args.timeout);
    Object.assign(res, { model: m.name, paramSize: m.paramSize, quant: m.quant, sizeGB: m.sizeGB });
    results.push(res);
    console.log(res.ok
      ? `${res.totalSec}s total, TTFT ${res.timeToFirstTokenSec}s, ~${res.estTokens} tok, ${res.tokensPerSec} tok/s`
      : `FAILED — ${res.error}`);
    // Unload before the next model so each test starts from a clean, single-model
    // VRAM state instead of stacking on whatever the previous test left resident.
    await unloadAll(args.baseUrl);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(args.outDir, `${ts}.json`);
  const mdPath = path.join(args.outDir, `${ts}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ hw, ollamaVersion, timeoutSec: args.timeout, prompt, results }, null, 2));

  const lines = [];
  lines.push(`# LitFlow Ollama benchmark — ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Hardware');
  lines.push(`- GPU: ${hw.gpu}`);
  lines.push(`- CPU: ${hw.cpu} (${hw.cpuCores} logical cores)`);
  lines.push(`- RAM: ${hw.ramGB} GB`);
  lines.push(`- OS: ${hw.platform}`);
  lines.push(`- Ollama version: ${ollamaVersion}`);
  lines.push(`- Timeout per model: ${args.timeout}s`);
  lines.push('');
  lines.push('## Prompt');
  lines.push('LitFlow\'s real "lit_review" synthesis prompt against 3 example papers (~400-600 word structured literature review, in-text citations, formal academic prose).');
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push(fmtRow(['Model', 'Params', 'Quant', 'Disk size', 'Total time', 'Time to first token', 'Est. tokens', 'Tokens/sec', 'Result']));
  lines.push(fmtRow(['---', '---', '---', '---', '---', '---', '---', '---', '---']));
  for (const r of results) {
    lines.push(fmtRow([
      r.model, r.paramSize || '?', r.quant || '?', r.sizeGB ? r.sizeGB + 'GB' : '?',
      r.ok ? r.totalSec + 's' : r.totalSec + 's (aborted)',
      r.ok ? r.timeToFirstTokenSec + 's' : '—',
      r.ok ? r.estTokens : '—',
      r.ok ? r.tokensPerSec : '—',
      r.ok ? '✅ OK' : `❌ ${r.error}`,
    ]));
  }
  lines.push('');
  lines.push('## Full output per model');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.model}`);
    lines.push('');
    lines.push(r.ok ? '```\n' + r.output.trim() + '\n```' : `_${r.error}_`);
    lines.push('');
  }
  fs.writeFileSync(mdPath, lines.join('\n'));

  console.log(`\nReport written to:\n  ${mdPath}\n  ${jsonPath}`);
}

main().catch(e => { console.error('Benchmark failed:', e); process.exit(1); });
