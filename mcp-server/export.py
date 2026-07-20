"""Export one library from the litflow database to a JSON file for library-viewer.html.

This is the *viewer* export (full internal shape, incl. version metadata) -- for a file you can
load back into the real app (../litflow.html) via Settings > Import JSON, use bridge.py instead.

Usage:
    python export.py <library_id> [out.json]        # defaults to export/<library>.library.json
    LITFLOW_DB=path/to/litflow.db python export.py example
"""
import os
import sys
import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).parent
DB_PATH = os.environ.get("LITFLOW_DB", str(HERE / "litflow.db"))

PAPER_COLS = ["id", "title", "link", "citation", "track", "type", "status", "curr_order",
              "design", "methods", "findings", "relevance", "questions", "notes", "tags",
              "date_completed", "current_version", "created_at", "updated_at"]


def export_library(library_id: str) -> dict:
    conn = sqlite3.connect(DB_PATH)
    lib = conn.execute("SELECT id, name FROM libraries WHERE id = ?", (library_id,)).fetchone()
    if lib is None:
        conn.close()
        raise SystemExit(f"No library '{library_id}' in {DB_PATH}. Run seed_example.py first?")
    tracks = conn.execute(
        "SELECT id, name, color FROM tracks WHERE library_id = ? ORDER BY id", (library_id,)
    ).fetchall()
    papers = conn.execute(
        f"SELECT {', '.join(PAPER_COLS)} FROM papers WHERE library_id = ? "
        f"ORDER BY curr_order IS NULL, curr_order, title", (library_id,)
    ).fetchall()
    conn.close()

    def _paper_dict(row):
        d = dict(zip(PAPER_COLS, row))
        try:
            d["tags"] = json.loads(d["tags"]) if d["tags"] else []
        except (json.JSONDecodeError, TypeError):
            d["tags"] = []
        return d

    return {
        "library": {"id": lib[0], "name": lib[1]},
        "tracks": [{"id": t[0], "name": t[1], "color": t[2]} for t in tracks],
        "papers": [_paper_dict(row) for row in papers],
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python export.py <library_id> [out.json]")
    library_id = sys.argv[1]
    data = export_library(library_id)

    if len(sys.argv) > 2:
        out = Path(sys.argv[2])
    else:
        out = HERE / "export" / f"{library_id}.library.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    print(f"Exported '{library_id}' ({len(data['papers'])} papers) -> {out}")


if __name__ == "__main__":
    main()
