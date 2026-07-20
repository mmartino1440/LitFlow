"""Bridge between LitFlow's browser-app JSON export and this MCP server's SQLite database.

The two halves of LitFlow speak slightly different dialects of the same paper record
(camelCase `dateCompleted` vs. this DB's `date_completed`; an in-app `tags` array vs. a JSON-text
column; array position vs. an explicit `curr_order` column) -- this script is the translator, so a
library can move between "open it in the browser and read/write notes" and "point an MCP-capable
model at it" without hand-editing anything.

Usage:
    # Browser app -> this database (import a Settings > Export JSON backup)
    python bridge.py import litflow-backup-2026-07-20.json <library_id> ["Library display name"]

    # This database -> browser app (produces a file you can load via Settings > Import JSON)
    python bridge.py export <library_id> [out.json]

LITFLOW_DB selects the database file (defaults to ./litflow.db next to this script), same as server.py.
"""
import os
import sys
import json
import sqlite3
from pathlib import Path

from server import _apply_versioned_update, _tags_out  # noqa: reuse the exact same write path as the MCP tools

HERE = Path(__file__).parent
DB_PATH = os.environ.get("LITFLOW_DB", str(HERE / "litflow.db"))


def _ensure_schema(conn):
    conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))


def import_json(json_path: str, library_id: str, library_name: str = ""):
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    papers = data.get("papers", data if isinstance(data, list) else [])
    tracks = data.get("tracks") or []
    if not papers:
        raise SystemExit(f"No papers found in {json_path} -- expected {{papers: [...]}} or a bare array.")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    _ensure_schema(conn)

    conn.execute(
        "INSERT INTO libraries (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        (library_id, library_name or library_id),
    )
    for t in tracks:
        conn.execute(
            "INSERT INTO tracks (id, library_id, name, color) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(id, library_id) DO UPDATE SET name = excluded.name, color = excluded.color",
            (t.get("id"), library_id, t.get("name", t.get("id")), t.get("color")),
        )

    added, updated, unchanged = 0, 0, 0
    for i, p in enumerate(papers):
        paper_id = p.get("id")
        if not paper_id:
            continue
        is_new = conn.execute(
            "SELECT 1 FROM papers WHERE library_id=? AND id=?", (library_id, paper_id)
        ).fetchone() is None
        fields = {
            "title": p.get("title"), "link": p.get("link"), "citation": p.get("citation"),
            "track": p.get("track"), "type": p.get("type"), "status": p.get("status"),
            "design": p.get("design"), "methods": p.get("methods"), "findings": p.get("findings"),
            "relevance": p.get("relevance"), "questions": p.get("questions"), "notes": p.get("notes"),
            "date_completed": p.get("dateCompleted") or None,
            "tags": json.dumps(p["tags"]) if p.get("tags") else None,
            "curr_order": i,
        }
        result = _apply_versioned_update(conn, library_id, paper_id, fields, source=f"import:{Path(json_path).name}")
        if result is None:
            unchanged += 1
        elif is_new:
            added += 1
        else:
            updated += 1
    conn.commit()
    conn.close()
    print(f"Imported into '{library_id}': {added} added, {updated} updated, {unchanged} unchanged "
          f"(of {len(papers)} papers in {json_path}).")


def export_json(library_id: str, out_path: str = ""):
    conn = sqlite3.connect(DB_PATH)
    lib = conn.execute("SELECT id, name FROM libraries WHERE id = ?", (library_id,)).fetchone()
    if lib is None:
        conn.close()
        raise SystemExit(f"No library '{library_id}' in {DB_PATH}.")
    tracks = conn.execute(
        "SELECT id, name, color FROM tracks WHERE library_id = ? ORDER BY id", (library_id,)
    ).fetchall()
    rows = conn.execute(
        """SELECT id, title, link, citation, track, type, status, design, methods, findings,
                  relevance, questions, notes, tags, date_completed
           FROM papers WHERE library_id = ? ORDER BY curr_order IS NULL, curr_order, title""",
        (library_id,),
    ).fetchall()
    conn.close()

    papers_out = []
    for row in rows:
        (pid, title, link, citation, track, type_, status, design, methods, findings,
         relevance, questions, notes, tags, date_completed) = row
        papers_out.append({
            "id": pid, "title": title, "link": link or "", "citation": citation or "",
            "track": track or "unassigned", "type": type_ or "paper", "status": status or "todo",
            "design": design or "", "methods": methods or "", "findings": findings or "",
            "relevance": relevance or "", "questions": questions or "", "notes": notes or "",
            "dateCompleted": date_completed or "",
            "tags": _tags_out(tags),
        })
    data = {
        "papers": papers_out,
        "tracks": [{"id": t[0], "name": t[1], "color": t[2]} for t in tracks],
    }

    out = Path(out_path) if out_path else HERE / "export" / f"{library_id}.litflow-import.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Exported '{library_id}' ({len(papers_out)} papers) -> {out}")
    print("Load this file via Settings > Import JSON in ../litflow.html to bring it back into the app.")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("import", "export"):
        raise SystemExit(__doc__)
    if sys.argv[1] == "import":
        if len(sys.argv) < 4:
            raise SystemExit("Usage: python bridge.py import <path.json> <library_id> [\"Library name\"]")
        import_json(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "")
    else:
        if len(sys.argv) < 3:
            raise SystemExit("Usage: python bridge.py export <library_id> [out.json]")
        export_json(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")


if __name__ == "__main__":
    main()
