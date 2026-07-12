# LitFlow

A structured literature tracker for researchers. One HTML file. No account. No server.

**[→ Download LitFlow](https://neurohumanist-website.vercel.app/litflow.html)**  
**[→ Learn more](https://neurohumanist-website.vercel.app/litflow-page.html)**

## What it is

LitFlow is a single-file web app that runs entirely in your browser. It helps researchers build a consistent daily reading habit with structured note-taking, custom reading tracks, streak tracking, and AI-powered synthesis — using only your own notes, never its training data.

## Features

- Six structured note fields per paper (Study Design, Key Methods, Main Findings, Relevance, Open Questions, Notes)
- Custom reading tracks with colors
- LLM synthesis from your notes only (Claude, OpenAI, Ollama, LM Studio)
- Quick-add papers by title, DOI, or URL from inside any paper card
- Day streak counter and progress bars
- Export to JSON (backup) and Markdown (writing)
- Disk persistence — connect a data file in Chrome/Edge that survives clearing browser storage
- Clear API key guidance — Settings explains that Claude Pro/ChatGPT Plus don't include API access; Ollama highlighted as a free local alternative
- Works offline — data in localStorage (all browsers) or a connected disk file (Chrome/Edge 86+)

## Getting started

1. Download `litflow.html`
2. Open it in Chrome, Edge, Safari, or Firefox
3. Go to ⚙ Settings → set up your reading tracks
4. Add a paper and start reading

## About

Built by [Mike Martino](https://neurohumanist-website.vercel.app), MD/PhD candidate in Systems Neuroscience at MUSC.

A paper describing this tool is planned for submission to the Journal of Open Source Software (JOSS).

## Changelog

### v1.9
- All Papers list now sorts alphabetically by title (case-insensitive) by default, on top of the existing track/status/type filters and search
- Paper titles are now editable after creation — new Title field in each paper's expand panel, no more deleting and re-adding a paper to fix a typo

### v1.8.1
- Fixed a data-loss bug: reconnecting a data file (or reopening LitFlow with one already connected) could silently overwrite newer unsaved local changes with an older version from disk, with no warning and no way back
- Reconnect now detects the conflict (compares save timestamps) and prompts you to choose which version to keep instead of overwriting automatically
- Added an automatic recovery snapshot before any wholesale overwrite (conflict resolution, JSON import, reset) — a "Restore previous session" option appears in Settings → Data whenever there's something to recover
- JSON import now asks for confirmation before replacing an existing library

### v1.8
- Synthesis max output tokens are now configurable in Settings, with a per-model reference table (context window, max output ceiling) and Consensus-merge-specific guidance — fixes a bug where output was silently capped at 1,500 tokens for every model and method, which could truncate longer syntheses mid-sentence
- Citation export — one-click RIS and BibTeX export for your whole library, plus a per-paper "Cite" button
- Fixed: the Model field in Settings now correctly remembers a separate value per provider, so switching to a local Ollama model no longer risks sending it a Claude model string (or vice versa)

### v1.7
- Multi-Agent Consensus — run the same synthesis prompt 2–3 times independently, then either merge into a consensus or display responses side by side for comparison
- Batch + Condense — splits your library into configurable chunks (3–10 papers), summarizes each batch independently, then condenses all summaries into a final synthesis — handles large libraries without hitting token limits in a single call
- Dynamic token cost estimate shown before running any multi-step job, with Ollama recommended for large libraries to avoid API charges
- Card expand bug fixed — papers in the All Papers view now expand and collapse correctly (duplicate DOM ID issue when the same paper appeared in both Up Next and the main list)

### v1.6
- Disk persistence via File System Access API (Chrome/Edge 86+) — data survives clearing browser storage
- Fixed quick-add to library bug (Enter key and Add → button were non-functional in Additional Readings)
- Settings → LLM Provider now explains that Claude Pro / ChatGPT Plus don't include API access, with Ollama as a free local alternative
- Data safety warning added to Settings and landing page

### v1.5
- Initial public release

## License

MIT
