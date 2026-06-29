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

### v1.6
- Disk persistence via File System Access API (Chrome/Edge 86+) — data survives clearing browser storage
- Fixed quick-add to library bug (Enter key and Add → button were non-functional in Additional Readings)
- Settings → LLM Provider now explains that Claude Pro / ChatGPT Plus don't include API access, with Ollama as a free local alternative
- Data safety warning added to Settings and landing page

### v1.5
- Initial public release

## License

MIT
