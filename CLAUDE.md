# CLAUDE.md — LitFlow

Repo-specific guidance for working on LitFlow. See root README.md for what the app is.

## Repo shape

LitFlow is a single-file HTML/JS/CSS web app with **no build step**. `litflow.html` is the **only**
app file — there is no multi-file branded-copy pattern anymore. (Through v1.9, separate near-
identical copies like `litflow-ann.html`/`litflow-dissertation.html` existed purely so each got its
own isolated localStorage bucket via filename-based namespacing; that mechanism is gone as of v1.10.)

**Multiple libraries live inside the one file.** Data is namespaced by an explicit library id, not a
filename: `lf_libraries` (localStorage key) holds the index of `{id, name, createdAt}` entries,
`lf_currentLibrary` holds the active id, and each library's own data lives under `lf_<id>_papers`,
`lf_<id>_tracks`, `lf_<id>_settings`, etc. (`litflow.html`, `LIBRARIES` region, ~line 1042 onward). A
header dropdown (`#libSelect`) switches the active library; a management modal handles create/rename/
delete. The very first library (the pre-existing single-library data from before this feature shipped)
keeps a fixed id of `'litflow'` for continuity with existing users' IndexedDB file handles.

If you're tempted to fork `litflow.html` into a new branded copy again for a new project/dataset,
don't — extend the in-app library switcher instead. That's specifically what it was built to replace.

On first load after upgrading, the app scans for the old filename-derived legacy keys
(`lf_litflow-ann_*`, `lf_litflow-dissertation_*`, `lf_litflow-sefl_*`) and offers a one-time import of
each as a named library (`bootstrapLibraries()`/`showMigrationModal()`). Legacy keys are never deleted
automatically, whether imported or skipped.

## Versioning & changelogs

Two changelogs must stay in sync: `README.md` (`## Changelog`) and `index.html` (`#changelog`
section, `.cl-entry` blocks). `litflow-landing.html` also has a small mini-changelog snippet but it's
already stale (stuck at v1.6) and not treated as authoritative — don't feel obligated to keep it
current unless asked.

No version string is displayed anywhere inside the app itself (`DEFAULT_SETTINGS` has no `version`
field, no in-app footer/badge shows one) — versioning is purely changelog documentation, not
something other code depends on.

**Use standard `MAJOR.MINOR.PATCH` semantics:**
- **PATCH** (`v1.8.1`, `v1.8.2`, …) — bug fixes, hardening, safety nets. No new user-facing capability.
- **MINOR** (`v1.9`, `v1.10`, …) — new user-facing features, even if bundled with fixes.
- **MAJOR** (`v2.0`) — reserved for a breaking or fundamental architectural change. Hasn't happened yet.

**Internal-only changes don't get a public changelog entry at all** — dev tooling, benchmark scripts,
refactors with no user-visible effect, etc. stay out of both README.md and index.html. (`package.json`
/ `scripts/` / `benchmarks/` are exactly this category — dev tooling, not shipped app code.)

When adding an entry: write it in both files in the same pass, newest-first, matching content between
the two (index.html's prose can be a little more marketing-toned; README's should be terser). Check
what the *last documented* version actually is in both files before picking the next number — they
can drift (this happened once: a real v1.8 shipped in the code and was documented in README.md but
never made it into index.html, so the next fix incorrectly jumped straight to "v1.9" before being
caught and corrected to v1.8.1).

## Roadmap / backlog

Ideas that are agreed-on-in-concept but not yet built. Not versioned, not in either changelog until
actually shipped.

- **Claude Code CLI as a synthesis backend (not yet started, to be tested later).** Goal: let users
  who have Claude Code CLI access but no Anthropic API key run synthesis without API credits, and
  sidestep the "stops mid-run when API credits run out" failure mode.
  - A browser tab can't spawn local processes directly (sandboxed) — no way around that from
    `litflow.html`'s JS alone.
  - The clean path: LitFlow's existing `provider === 'local'` path (`callLLM()`, ~line 2172) already
    just POSTs OpenAI-compatible `/chat/completions` requests to a user-set `baseUrl` — this is how
    Ollama/LM Studio support works today, with zero provider-specific code beyond that branch. A small
    local companion script (e.g. `litflow-cli-bridge.js`, run via `node litflow-cli-bridge.js`) could
    expose that same endpoint and shell out to `claude -p "<prompt>"` (Claude Code's non-interactive
    print mode) internally, returning its stdout as the response. Users would set Provider → Local,
    Base URL → the bridge's localhost port. **No changes needed to litflow.html itself** for basic
    functionality — this is purely a new standalone script + a couple lines of setup docs.
  - Tradeoff to weigh before building: this requires the user to run a small local server, which is a
    step away from LitFlow's "no server" pitch (README) — though Ollama already implies the same
    thing in practice.
  - Security note for whoever builds it: bind the bridge to `127.0.0.1` only, and pass the prompt to
    the CLI via `spawn()` with an argument array (never string-interpolate into a shell command) —
    the prompt is arbitrary user-supplied text and could contain shell metacharacters.
  - Scope for v1: skip automatic detect-and-resume when Claude Code's usage cap is hit — just surface
    its error message clearly and let the user manually retry once the limit resets. Only build
    polling/auto-resume if manual retry turns out to be annoying in practice.

- **Citation verification & relevance-backfill from a manuscript draft (not yet started).** Goal:
  let users paste a manuscript/abstract draft and (a) have an LLM backfill each library paper's
  Relevance field explaining why it matters to *that specific draft*, and (b) step through each claim
  in the draft with a one-click jump to its cited paper, to manually verify the claim (Ctrl+F in the
  source, or just checking figures — no automated full-text verification, since the app has no access
  to the source PDF/webpage's actual text, only a `link` URL).
  - **Relevance backfill**: extend `runPaperAI(id, type)` (~line 2112) with a new `type` that takes
    the pasted draft text plus one paper's existing notes and asks the LLM why that paper is relevant
    to the draft, then loop over all papers sequentially (same no-concurrency pattern as
    `runBatchCondense`/`runConsensus`, ~2344/2394) reusing the token-estimate UI
    (`updateMultiStepUI`, ~2267) to warn about cost before running. Writes go through the existing
    `updateF(id, 'relevance', val)` setter (~1898).
  - **Data-safety flag for whoever builds this**: backfilling `relevance` in a loop risks silently
    overwriting a user's own hand-written relevance notes — the same class of bug fixed in v1.8.1 for
    disk-reconnect overwrites. Don't auto-overwrite non-empty fields without a per-paper or
    whole-batch confirmation, and consider reusing the recovery-snapshot mechanism added in v1.8.1
    before a batch write.
  - **Citation verification stepper**: no existing "claims" data model — this needs a new LLM call
    that reads the pasted draft and returns a list of `{claim text, cited-source text}` pairs. Because
    every existing prompt in the codebase (`buildSynthPrompt`, `buildChunkSummaryPrompt`, etc.) returns
    free text and none parse structured output, this is new territory: the prompt needs to ask for
    strict JSON and the response needs a parse-with-fallback path, since `callLLM`'s return value
    (`d.content[0].text` / `d.choices[0].message.content`) is untyped prose everywhere else today.
  - Match each extracted citation reference against the library by comparing to each paper's
    `citation` field (already parsed by `parseCitation` for RIS/BibTeX export) — fuzzy match, not
    exact, since manuscript in-text citations rarely match the stored citation string verbatim.
  - Stepper UI (prev/next through claims) can reuse `openPaperCard(id)` (~line 1715) to jump to and
    scroll-highlight the matched paper's card — no new "jump to source" mechanic needed, only a new
    thin wrapper around it plus prev/next state.
  - **Scope for v1**: single manuscript-paste box (no live sync with an external doc), one LLM call to
    extract claims + citation matches (not incremental), no automated verification against source text
    — verification stays a manual human step; the app's job is just fast navigation to the right paper
    plus (optionally) a suggested search phrase to Ctrl+F for.
