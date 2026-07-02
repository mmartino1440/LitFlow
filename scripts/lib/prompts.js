// Prompt builders copied verbatim from litflow.html (buildSynthPrompt,
// buildChunkSummaryPrompt, buildCondensePrompt, buildMergePrompt) so benchmark
// scripts send exactly what the real app sends for each of its 3 synthesis
// methods: standard (single-shot), batch condense, and consensus/multi-agent.

const MODE_INSTRUCTIONS_STANDALONE = {
  lit_review:      notes => `You are a scientific writing assistant. Based ONLY on the researcher's notes below — do not add information from your training data — write a structured literature review section of approximately 400–600 words. Use in-text citations by paper number [1], [2], etc. Synthesize themes and do not merely summarize each paper sequentially. Write in formal academic prose appropriate for a manuscript or dissertation.\n\nResearcher's notes:\n${notes}`,
  gap_analysis:    notes => `Based ONLY on the researcher's notes below, identify the key gaps, open questions, and unresolved debates in this literature. Structure your response as: (1) what is well established, (2) what is contested, (3) what is missing, and (4) where the researcher's own project could make a contribution. Do not add information beyond what the notes contain.\n\nNotes:\n${notes}`,
  methods_summary: notes => `Based ONLY on the researcher's notes, summarize the methods used across these papers. Group papers by methodological approach. Note the most common methods, variations across studies, and any methodological limitations the researcher flagged.\n\nNotes:\n${notes}`,
  findings_table:  (notes, proj) => `Based ONLY on the researcher's notes, create a structured comparison of key findings across these papers. Format your response as a clear text table with columns: Paper | Study Design | Key Finding | Relevance to ${proj}. Use only information present in the notes.\n\nNotes:\n${notes}`,
  relevance:       (notes, proj) => `Based ONLY on the researcher's notes about how each paper relates to "${proj}", write a 200–400 word synthesis of how this body of literature supports, challenges, or provides context for the researcher's own work. Do not add information beyond the notes.\n\nNotes:\n${notes}`,
};

function paperNotesBlock(paperList, proj, includeNotes) {
  return paperList.map((p, i) => {
    const parts = [];
    if (p.design)    parts.push(`Study design: ${p.design}`);
    if (p.methods)   parts.push(`Methods: ${p.methods}`);
    if (p.findings)  parts.push(`Findings: ${p.findings}`);
    if (p.relevance) parts.push(`Relevance to ${proj}: ${p.relevance}`);
    if (p.questions) parts.push(`Open questions: ${p.questions}`);
    if (includeNotes && p.notes) parts.push(`Scratch notes (unprocessed — interpret cautiously): ${p.notes}`);
    return `[${i + 1}] ${p.title} (${p.citation || 'citation unknown'})\n${parts.join('\n')}`;
  }).join('\n\n---\n\n');
}

// Standard (single-shot) — same prompt used for one-shot synthesis AND as the
// per-agent prompt in consensus mode (consensus just calls this N times).
function buildSynthPrompt(paperList, mode, proj, includeNotes) {
  const notes = paperNotesBlock(paperList, proj, includeNotes);
  const build = MODE_INSTRUCTIONS_STANDALONE[mode] || MODE_INSTRUCTIONS_STANDALONE.lit_review;
  return build(notes, proj);
}

function buildChunkSummaryPrompt(chunk, proj, includeNotes) {
  const notes = chunk.map((p, i) => {
    const parts = [];
    if (p.design)    parts.push(`Study design: ${p.design}`);
    if (p.methods)   parts.push(`Methods: ${p.methods}`);
    if (p.findings)  parts.push(`Findings: ${p.findings}`);
    if (p.relevance) parts.push(`Relevance to ${proj}: ${p.relevance}`);
    if (p.questions) parts.push(`Open questions: ${p.questions}`);
    if (includeNotes && p.notes) parts.push(`Scratch notes: ${p.notes}`);
    return `[${i + 1}] ${p.title} (${p.citation || 'citation unknown'})\n${parts.join('\n') || '(no notes)'}`;
  }).join('\n\n---\n\n');
  return `Based ONLY on the researcher's notes below — do not add information from your training data — write a concise structured summary of these ${chunk.length} papers. For each paper note the core finding, methodology, and relevance to "${proj}". Then identify 1–2 shared themes across this batch.\n\nNotes:\n${notes}`;
}

function buildCondensePrompt(summaries, mode, proj) {
  const combined = summaries.map((s, i) => `[Batch ${i + 1}]\n${s}`).join('\n\n---\n\n');
  const instructions = {
    lit_review:      `write a structured literature review section of 400–600 words. Use in-text citations where possible. Synthesize themes; do not list papers sequentially. Write in formal academic prose.`,
    gap_analysis:    `identify key gaps, open questions, and unresolved debates. Structure as: (1) what is well established, (2) what is contested, (3) what is missing, (4) where the researcher's project could contribute.`,
    methods_summary: `summarize and group methods across all papers. Note the most common approaches, variations, and methodological limitations flagged.`,
    findings_table:  `create a structured comparison table: Paper | Study Design | Key Finding | Relevance to ${proj}. Include all papers from the batch summaries.`,
    relevance:       `write a 300–500 word synthesis of how this body of literature supports, challenges, or provides context for "${proj}".`,
    custom:          `synthesize the key themes, findings, and implications across all batch summaries into a coherent final output.`,
  };
  return `You are a scientific writing assistant. You have received structured summaries from ${summaries.length} batches of a researcher's literature library (project: "${proj}"). Based ONLY on these batch summaries — do not add information from your training data — ${instructions[mode] || instructions.custom}\n\nBatch summaries:\n${combined}`;
}

function buildMergePrompt(responses, mode, proj) {
  const combined = responses.map((r, i) => `[Agent ${i + 1}]\n${r}`).join('\n\n---\n\n');
  return `You have received ${responses.length} independent syntheses of the same literature library (project: "${proj}"). Identify where the agents agree and where they diverge, then produce a single authoritative consensus ${mode.replace('_', ' ')} that resolves disagreements by weighing what is better supported. Do not simply concatenate — write a coherent final output.\n\n${combined}`;
}

module.exports = { buildSynthPrompt, buildChunkSummaryPrompt, buildCondensePrompt, buildMergePrompt };
