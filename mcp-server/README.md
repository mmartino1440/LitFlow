# litflow MCP companion

The browser app (`../litflow.html`, the main LitFlow project) is where you build a daily reading
habit. This is a second, optional way to work with the same kind of library: a **self-contained
MCP server** that lets any MCP-capable model — Claude Code, Claude Desktop, any MCP client — read
and write your papers as tools, plus a small **viewer** to browse the result and copy a digest
into any chat.

Zero setup beyond the MCP SDK: no database server, no external accounts, no API keys. The whole
library is one SQLite file.

```
mcp-server/
├─ server.py           # the MCP server (tools + resources + prompts)
├─ schema.sql           # SQLite schema
├─ bridge.py             # convert between ../litflow.html's JSON export/import and this database
├─ seed_example.py      # create a database with a small fictional example library
├─ export.py             # dump a library to viewer JSON
├─ library-viewer.html  # standalone viewer — open in any browser, no server needed
└─ requirements.txt     # just `mcp`
```

## Quickstart

```bash
cd mcp-server
pip install -r requirements.txt
python seed_example.py          # creates litflow.db with an example library
python export.py example        # writes export/example.library.json
```

Open `library-viewer.html` in a browser (it renders the example on open) and load the exported
JSON, or connect the MCP server to a model:

```bash
claude mcp add litflow -e LITFLOW_DB=/path/to/mcp-server/litflow.db -- python /path/to/mcp-server/server.py
```

Tools: `list_papers`, `get_paper`, `search_papers`, `add_paper`, `update_paper`, `get_paper_history`.
Resources: `litflow://libraries`, `litflow://{library}/tracks`, `litflow://{library}/papers`,
`litflow://{library}/todo`. Prompts: `summarize_paper`, `what_to_read_next`, `synthesize` — all
of which instruct the model to reason only from what's recorded, not from its training data.
Every write is versioned automatically; `get_paper_history` shows the trail.

## Moving a library between the app and the MCP database

`bridge.py` translates in both directions — it's the reason this lives inside the LitFlow repo
instead of as a separate project:

```bash
# Browser app -> this database (a Settings > Export JSON backup from ../litflow.html)
python bridge.py import litflow-backup-2026-07-20.json my-library "My Library"

# This database -> browser app (load the result via Settings > Import JSON)
python bridge.py export my-library
```

A typical flow: do your daily reading and note-taking in the app as usual, periodically export a
backup and bridge it into the MCP database, then point a model at it — "what should I read next,"
"synthesize what I've read on X," "check this draft's citations against what I've actually read."

## Your own library, without the app

You don't need the browser app at all if you'd rather build a library by just talking to a model:
point the server at a fresh database (`LITFLOW_DB=mylib.db`), apply `schema.sql` once, and start
asking your model to add papers, mark them read, and suggest what's next.

## License

MIT — same as the rest of this repo. See the root [README.md](../README.md) for the main app.
