"""litflow MCP companion — a standalone, SQLite-backed MCP server for the LitFlow library format.

Lets any MCP-capable model (Claude Code, Claude Desktop, or an MCP Inspector client) read and
write a literature library as tools, instead of only through the browser app's own UI. Pair it
with `bridge.py` to move a library between this database and LitFlow's own JSON export/import
format (Settings -> Export/Import JSON in ../litflow.html), or use it standalone with the example
library from `seed_example.py`.

Zero setup beyond the MCP SDK: no database server, no external accounts. The whole library is one
SQLite file.

Run:  python server.py            (stdio transport)
DB:   set LITFLOW_DB to point at a database file; defaults to ./litflow.db next to this script.
      Create one first with:  python seed_example.py
"""
import os
import json
import sqlite3
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

DB_PATH = os.environ.get("LITFLOW_DB", str(Path(__file__).parent / "litflow.db"))

# Fields whose changes are versioned.
TRACKED_FIELDS = ["title", "link", "citation", "track", "type", "status", "curr_order",
                  "design", "methods", "findings", "relevance", "questions", "notes",
                  "tags", "date_completed"]

mcp = FastMCP("litflow")


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _tags_in(tags_csv: str) -> Optional[str]:
    """Convert a comma-separated tags string (MCP tool args are flat strings) to JSON for storage."""
    if not tags_csv:
        return None
    return json.dumps([t.strip() for t in tags_csv.split(",") if t.strip()])


def _tags_out(tags_json) -> list:
    if not tags_json:
        return []
    try:
        return json.loads(tags_json)
    except (json.JSONDecodeError, TypeError):
        return []


# --------------------------------------------------------------------------
# Tools
# --------------------------------------------------------------------------

@mcp.tool()
def list_papers(library: str, track: str = "", status: str = "") -> str:
    """List papers in a library, optionally filtered by track id and/or status.

    Args:
        library: library id, e.g. 'example'
        track: optional track id to filter by (e.g. 't1') -- leave empty for all tracks
        status: optional status to filter by (e.g. 'todo', 'reading', 'done') -- leave empty for all
    """
    conn = _conn()
    query = "SELECT id, title, track, status, curr_order FROM papers WHERE library_id = ?"
    params = [library]
    if track:
        query += " AND track = ?"
        params.append(track)
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY curr_order IS NULL, curr_order, title"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    if not rows:
        return f"No papers found in library '{library}' matching the given filters."
    lines = [f"{r[0]} | {r[1]} | track={r[2]} | status={r[3]} | order={r[4]}" for r in rows]
    return f"{len(rows)} paper(s):\n" + "\n".join(lines)


@mcp.tool()
def get_paper(library: str, paper_id: str) -> str:
    """Get full detail for one paper, including all notes fields and tags.

    Args:
        library: library id, e.g. 'example'
        paper_id: the paper's id
    """
    cols = ["id", "title", "link", "citation", "track", "type", "status", "curr_order",
            "design", "methods", "findings", "relevance", "questions", "notes", "tags",
            "date_completed", "current_version", "created_at", "updated_at"]
    conn = _conn()
    row = conn.execute(
        f"SELECT {', '.join(cols)} FROM papers WHERE library_id = ? AND id = ?", (library, paper_id)
    ).fetchone()
    conn.close()
    if not row:
        return f"No paper '{paper_id}' found in library '{library}'."
    d = dict(zip(cols, row))
    d["tags"] = _tags_out(d["tags"])
    return json.dumps(d, indent=2, default=str)


@mcp.tool()
def search_papers(library: str, query: str) -> str:
    """Search a library's papers by substring match across title, findings, relevance, and notes.

    Args:
        library: library id, e.g. 'example'
        query: text to search for (case-insensitive substring match)
    """
    conn = _conn()
    like = f"%{query}%"
    rows = conn.execute(
        """SELECT id, title, status FROM papers
           WHERE library_id = ? AND (
             title LIKE ? OR findings LIKE ? OR relevance LIKE ? OR notes LIKE ?
           ) ORDER BY title""",
        (library, like, like, like, like),
    ).fetchall()
    conn.close()
    if not rows:
        return f"No matches for '{query}' in library '{library}'."
    return f"{len(rows)} match(es):\n" + "\n".join(f"{r[0]} | {r[1]} | status={r[2]}" for r in rows)


@mcp.tool()
def get_paper_history(library: str, paper_id: str) -> str:
    """Show the full version history of one paper -- what changed, and when.

    Args:
        library: library id, e.g. 'example'
        paper_id: the paper's id
    """
    conn = _conn()
    rows = conn.execute(
        """SELECT version, changed_fields, source_file, captured_at FROM paper_versions
           WHERE library_id = ? AND paper_id = ? ORDER BY version""",
        (library, paper_id),
    ).fetchall()
    conn.close()
    if not rows:
        return f"No version history for '{paper_id}' in library '{library}'."
    lines = []
    for version, changed_json, source, captured in rows:
        changed = ", ".join(json.loads(changed_json)) if changed_json else "(initial)"
        lines.append(f"v{version}: changed {changed} (source: {source or 'live edit'}, {captured})")
    return f"{len(rows)} version(s) for {paper_id}:\n" + "\n".join(lines)


def _apply_versioned_update(conn, library: str, paper_id: str, new_fields: dict,
                            source: str = "live:mcp-tool") -> Optional[str]:
    """Diff against current state, bump version, write both `papers` and `paper_versions` in the
    same transaction. Returns a summary string, or None if nothing changed."""
    row = conn.execute(
        f"SELECT {', '.join(TRACKED_FIELDS)}, current_version FROM papers WHERE library_id=? AND id=?",
        (library, paper_id),
    ).fetchone()
    if row is None:
        current = {f: None for f in TRACKED_FIELDS}
        current_version = 0
    else:
        current = dict(zip(TRACKED_FIELDS, row[:-1]))
        current_version = row[-1]

    merged = dict(current)
    merged.update({k: v for k, v in new_fields.items() if v is not None})
    changed = [f for f in TRACKED_FIELDS if (current.get(f) or "") != (merged.get(f) or "")]
    if not changed and row is not None:
        return None

    new_version = current_version + 1
    placeholders = ", ".join(["?"] * len(TRACKED_FIELDS))
    conn.execute(
        f"""INSERT INTO papers (id, library_id, {", ".join(TRACKED_FIELDS)}, current_version)
            VALUES (?, ?, {placeholders}, ?)
            ON CONFLICT(library_id, id) DO UPDATE SET
              {", ".join(f"{f} = excluded.{f}" for f in TRACKED_FIELDS)},
              current_version = excluded.current_version,
              updated_at = CURRENT_TIMESTAMP""",
        [paper_id, library] + [merged[f] for f in TRACKED_FIELDS] + [new_version],
    )
    conn.execute(
        """INSERT INTO paper_versions (library_id, paper_id, version, snapshot, changed_fields, source_file)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (library, paper_id, new_version, json.dumps(merged, default=str), json.dumps(changed), source),
    )
    return f"v{new_version} ({', '.join(changed)})"


@mcp.tool()
def update_paper(library: str, paper_id: str, title: str = "", link: str = "", citation: str = "",
                 track: str = "", type: str = "", status: str = "", design: str = "",
                 methods: str = "", findings: str = "", relevance: str = "", questions: str = "",
                 notes: str = "", tags: str = "") -> str:
    """Update one or more fields on an existing paper. Leave a field empty to leave it unchanged.
    Automatically records a new version -- callers never manage history directly.

    Args:
        library: library id, e.g. 'example'
        paper_id: the paper's id
        title, link, citation, track, type, status, design, methods, findings, relevance,
        questions, notes: only the fields you pass are updated; leave others empty/omitted
        tags: comma-separated tags, e.g. "neuro, methods" -- replaces the existing tag list
    """
    fields = {k: v for k, v in dict(title=title, link=link, citation=citation, track=track, type=type,
              status=status, design=design, methods=methods, findings=findings, relevance=relevance,
              questions=questions, notes=notes).items() if v}
    if tags:
        fields["tags"] = _tags_in(tags)
    conn = _conn()
    result = _apply_versioned_update(conn, library, paper_id, fields)
    conn.commit()
    conn.close()
    if result is None:
        return f"No change -- '{paper_id}' already matches the given fields."
    return f"Updated {paper_id} in {library}: {result}"


@mcp.tool()
def add_paper(library: str, paper_id: str, title: str, link: str = "", citation: str = "",
              track: str = "", type: str = "paper", status: str = "todo", tags: str = "") -> str:
    """Add a new paper to a library. Records it as version 1.

    Args:
        library: library id, e.g. 'example'
        paper_id: a new, unique id for this paper (any string; the app itself uses 'p<timestamp>')
        title: paper title
        link: URL or DOI, if known
        citation: citation string, if known
        track: track id to file it under
        type: 'paper', 'review', etc. (default 'paper')
        status: 'todo', 'reading', 'done', 'skip' (default 'todo')
        tags: comma-separated tags, e.g. "neuro, methods"
    """
    conn = _conn()
    exists = conn.execute("SELECT 1 FROM papers WHERE library_id=? AND id=?", (library, paper_id)).fetchone()
    if exists:
        conn.close()
        return f"'{paper_id}' already exists in '{library}' -- use update_paper instead."
    fields = dict(title=title, link=link, citation=citation, track=track, type=type, status=status)
    if tags:
        fields["tags"] = _tags_in(tags)
    _apply_versioned_update(conn, library, paper_id, fields, source="live:mcp-tool-add")
    conn.commit()
    conn.close()
    return f"Added {paper_id} to {library} as version 1."


# --------------------------------------------------------------------------
# Resources — read-only, GET-like
# --------------------------------------------------------------------------

@mcp.resource("litflow://libraries")
def get_libraries() -> str:
    """List all libraries in the database."""
    conn = _conn()
    rows = conn.execute("SELECT id, name FROM libraries ORDER BY id").fetchall()
    conn.close()
    content = "# LitFlow Libraries\n\n"
    for lib_id, name in rows:
        content += f"- **{lib_id}**: {name}\n"
    return content


@mcp.resource("litflow://{library}/tracks")
def get_tracks(library: str) -> str:
    """List the tracks defined for one library."""
    conn = _conn()
    rows = conn.execute("SELECT id, name, color FROM tracks WHERE library_id = ? ORDER BY id", (library,)).fetchall()
    conn.close()
    content = f"# Tracks — {library}\n\n"
    for tid, name, color in rows:
        content += f"- **{tid}**: {name} ({color})\n"
    return content


@mcp.resource("litflow://{library}/papers")
def get_papers_resource(library: str) -> str:
    """Full current-state paper list for one library, as a markdown table."""
    conn = _conn()
    rows = conn.execute(
        "SELECT id, title, track, status FROM papers WHERE library_id = ? ORDER BY curr_order IS NULL, curr_order, title",
        (library,),
    ).fetchall()
    conn.close()
    content = f"# Papers — {library} ({len(rows)} total)\n\n| id | title | track | status |\n|---|---|---|---|\n"
    for r in rows:
        content += f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |\n"
    return content


@mcp.resource("litflow://{library}/todo")
def get_todo_resource(library: str) -> str:
    """Just the not-yet-read papers for one library -- the actual reading queue."""
    conn = _conn()
    rows = conn.execute(
        "SELECT id, title FROM papers WHERE library_id = ? AND status = 'todo' ORDER BY curr_order IS NULL, curr_order",
        (library,),
    ).fetchall()
    conn.close()
    content = f"# To-read queue — {library} ({len(rows)})\n\n"
    for r in rows:
        content += f"- {r[0]}: {r[1]}\n"
    return content


# --------------------------------------------------------------------------
# Prompts — reusable literature-review templates
# --------------------------------------------------------------------------

@mcp.prompt()
def summarize_paper(library: str, paper_id: str) -> str:
    """Generate a prompt to summarize one paper, based only on its stored notes."""
    return f"""Use the get_paper tool to fetch paper '{paper_id}' from library '{library}'.
Based ONLY on its design/methods/findings/relevance/questions/notes fields -- do not add
information from your training data -- write a single concise paragraph (3-5 sentences)
summarizing what this paper did, what it found, and why it matters.
If those fields are empty or very thin, say so explicitly rather than guessing, and suggest
fetching the paper's actual link/DOI instead."""


@mcp.prompt()
def what_to_read_next(library: str, paper_id: str) -> str:
    """Generate a prompt to suggest what to read next, using the rest of the library as context."""
    return f"""Use get_paper to fetch '{paper_id}' from library '{library}', then use list_papers
(library='{library}', status='todo') to see what else is queued. Based on {paper_id}'s notes,
suggest 1-3 SPECIFIC already-tracked todo papers worth reading next (name them by title), plus
up to 3 more specific topics/methods worth looking for beyond what's already tracked."""


@mcp.prompt()
def synthesize(library: str, mode: str = "lit_review", track: str = "") -> str:
    """Generate a cross-paper synthesis prompt. mode: lit_review, gap_analysis, methods_summary,
    findings_table, or relevance."""
    scope = f"track '{track}'" if track else "all done papers"
    instructions = {
        "lit_review": "write a structured 400-600 word literature review section, in-text citations by paper id, synthesizing themes rather than summarizing sequentially.",
        "gap_analysis": "identify what's well established, what's contested, what's missing, and where this body of work could be extended.",
        "methods_summary": "group papers by methodological approach, noting common methods, variations, and limitations.",
        "findings_table": "produce a table: Paper | Study Design | Key Finding | Relevance.",
        "relevance": "write a 200-400 word synthesis of how this literature supports, challenges, or contextualizes the project.",
    }
    instr = instructions.get(mode, instructions["lit_review"])
    return f"""Use list_papers (library='{library}', status='done'{f", track='{track}'" if track else ""})
to find the papers in scope ({scope}), then get_paper for each one. Based ONLY on their design/
methods/findings/relevance/questions fields (NOT the scratch notes field, and do not add information
from your training data), {instr}"""


if __name__ == "__main__":
    mcp.run(transport="stdio")
