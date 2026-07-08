# CLAUDE.md — LitFlow

Repo-specific guidance for working on LitFlow. See root README.md for what the app is.

## Repo shape

LitFlow is a single-file HTML/JS/CSS web app with **no build step**. `litflow.html` is canonical;
`litflow-ann.html`, `litflow-dissertation.html`, and `litflow-sefl.html` are independently-maintained,
near-byte-identical branded copies (different `<title>`/project name, otherwise the same code). There
is no template or generator — each copy is a real file that must be edited separately.

**When a change touches shared subsystems** (persistence, provider/LLM calls, core data model, modals,
etc.), it must be applied to all four files identically. The fast, low-risk way to do this:

1. Make the change in `litflow.html` first, verify it (see `verify` skill / manual browser check).
2. `git diff litflow.html > /tmp/patch.diff`, then `sed` the filename in the patch header and
   `git apply` it to each other file. `git apply` tolerates line-number drift from unrelated local
   edits in the target file (it matches on context), so this works even when the other files aren't
   byte-identical to `litflow.html` at that moment — confirm with `git apply --check` first.
3. If `git apply --check` fails for a file, fall back to `Edit` with anchor text (function names,
   `id="..."` strings) rather than hardcoded line numbers, and re-verify that file specifically.

Don't assume the four files are in sync before you start — diff the relevant region first
(`diff <(sed -n 'X,Yp' fileA) <(sed -n 'X,Yp' fileB)`), since ann/dissertation/sefl often carry
their own unrelated in-flight edits.

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
