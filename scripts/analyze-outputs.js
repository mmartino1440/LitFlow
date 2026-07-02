#!/usr/bin/env node
// Citation-fidelity + structural analysis pass over completed benchmark runs.
// Not a full quality grade (see the report's manual read-through section for
// that) — this is an automatable proxy for two things the prompts explicitly
// forbid: citing a paper number outside the provided list, and pulling in
// author-year citations from training data rather than the provided notes.
//
// Usage: node scripts/analyze-outputs.js
// Output: benchmarks/analysis-summary.json

const fs = require('fs');
const path = require('path');

const BENCH_DIR = path.join(__dirname, '..', 'benchmarks');

// Each completed run, tagged with the dataset it used and the paper list
// needed to check citations against (path relative to repo root).
const RUNS = [
  { file: '2026-07-01T16-50-07-007Z-synthesis.json', dataset: 'ollama-11paper', papersFile: path.join(__dirname, '..', 'test-data', 'dissertation-test-batch.json') },
  { file: '2026-07-01T20-44-15-650Z-claude.json', dataset: 'claude-78paper-gold', papersFile: path.join(__dirname, '..', '..', '..', '01_RESEARCH', 'dissertation', '02_literature', 'disertation_library_backup.json') },
  { file: '2026-07-01T21-19-35-207Z-claude.json', dataset: 'claude-78paper-gold', papersFile: path.join(__dirname, '..', '..', '..', '01_RESEARCH', 'dissertation', '02_literature', 'disertation_library_backup.json') },
  { file: '2026-07-01T21-26-41-317Z-claude.json', dataset: 'claude-78paper-gold', papersFile: path.join(__dirname, '..', '..', '..', '01_RESEARCH', 'dissertation', '02_literature', 'disertation_library_backup.json') },
  { file: '2026-07-01T21-32-31-450Z-claude.json', dataset: 'claude-11paper-matched', papersFile: path.join(__dirname, '..', 'test-data', 'dissertation-test-batch.json') },
];

const WORD_TARGET = { lit_review: [400, 600] };

function knownCitations(papers) {
  // (surname-lowercase, year) pairs pulled from each paper's own citation field,
  // e.g. "Rau et al., 2005" -> { surname: "rau", year: "2005" }.
  const known = new Set();
  for (const p of papers) {
    const m = (p.citation || '').match(/^([A-Z][a-zA-Z'-]+)/);
    const y = (p.citation || '').match(/\b(19|20)\d{2}\b/);
    if (m && y) known.add(`${m[1].toLowerCase()}|${y[0]}`);
  }
  return known;
}

function analyzeOutput(text, paperCount, known) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  const bracketMatches = [...text.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1], 10));
  const outOfRange = bracketMatches.filter(n => n < 1 || n > paperCount);
  const uniqueValidCited = new Set(bracketMatches.filter(n => n >= 1 && n <= paperCount));
  const coverage = paperCount > 0 ? +(uniqueValidCited.size / paperCount).toFixed(2) : null;

  // Author-year style citations, e.g. "Rau et al., 2005" or "(Fanselow & Bolles, 1979)".
  const authorYearMatches = [...text.matchAll(/([A-Z][a-zA-Z'-]+)(?:\s+(?:&|and|et al\.?)\s*[A-Za-z.'-]*)?,?\s+\(?((?:19|20)\d{2})[a-z]?\)?/g)];
  const unverified = [];
  for (const m of authorYearMatches) {
    const key = `${m[1].toLowerCase()}|${m[2]}`;
    if (!known.has(key)) unverified.push(`${m[1]} ${m[2]}`);
  }

  return {
    words,
    bracketCitationCount: bracketMatches.length,
    outOfRangeCitations: [...new Set(outOfRange)],
    paperCoverage: coverage,
    authorYearCitationCount: authorYearMatches.length,
    unverifiedAuthorYearCitations: [...new Set(unverified)],
  };
}

function main() {
  const records = [];
  for (const run of RUNS) {
    const runPath = path.join(BENCH_DIR, run.file);
    if (!fs.existsSync(runPath)) { console.error(`Missing: ${runPath}`); continue; }
    const data = JSON.parse(fs.readFileSync(runPath, 'utf8'));
    const papersData = JSON.parse(fs.readFileSync(run.papersFile, 'utf8'));
    const known = knownCitations(papersData.papers);
    const paperCount = data.paperCount;
    const wordTarget = WORD_TARGET[data.mode];

    for (const r of data.results) {
      for (const [method, res] of Object.entries(r.methods)) {
        if (!res.ok || !res.finalOutput) {
          const reason = res.ok
            ? 'empty finalOutput despite ok:true — likely max_tokens exhausted by extended thinking before any text was emitted'
            : `failed at step "${res.failedAt}"`;
          records.push({ dataset: run.dataset, sourceFile: run.file, model: r.model, method, ok: false, failedAt: res.failedAt || null, failureReason: reason });
          continue;
        }
        const analysis = analyzeOutput(res.finalOutput, paperCount, known);
        const withinWordTarget = wordTarget ? (analysis.words >= wordTarget[0] && analysis.words <= wordTarget[1]) : null;
        records.push({
          dataset: run.dataset, sourceFile: run.file, model: r.model, method, ok: true,
          paperCount, totalSec: res.totalSec, callCount: res.steps.length,
          costUSD: res.totalCostUSD ?? null,
          inputTok: res.totalInputTok ?? null, outputTok: res.totalOutputTok ?? null,
          estTokens: res.totalTokens ?? null, avgTokensPerSec: res.avgTokensPerSec ?? null,
          ...analysis,
          withinWordTarget,
        });
      }
    }
  }

  const outPath = path.join(BENCH_DIR, 'analysis-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
  console.log(`Analyzed ${records.length} model/method/dataset combos -> ${outPath}`);
  for (const r of records) {
    if (!r.ok) { console.log(`  ${r.dataset} | ${r.model} | ${r.method}: FAILED — ${r.failureReason}`); continue; }
    console.log(`  ${r.dataset} | ${r.model} | ${r.method}: ${r.words}w, coverage=${r.paperCoverage}, outOfRange=${r.outOfRangeCitations.length}, unverifiedAuthorYear=${r.unverifiedAuthorYearCitations.length}${r.unverifiedAuthorYearCitations.length ? ' (' + r.unverifiedAuthorYearCitations.join('; ') + ')' : ''}`);
  }
}

main();
