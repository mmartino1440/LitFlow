"""Create a litflow database seeded with a small, fictional example library.

Usage:  python seed_example.py [path/to/litflow.db]

Safe to re-run: it applies the schema with IF NOT EXISTS and only inserts the example rows
that aren't already there. The example data is entirely made up -- a demo of the shape, not
anyone's real reading list.
"""
import sys
import json
import sqlite3
from pathlib import Path

from server import _apply_versioned_update

HERE = Path(__file__).parent
DB_PATH = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "litflow.db")

LIBRARY = ("example", "Example Library — Sleep & Memory")
TRACKS = [
    ("t1", "example", "Mechanisms", "#0C7C79"),
    ("t2", "example", "Behavioral studies", "#9A6A12"),
]
PAPERS = [
    {
        "id": "hippocampal-replay-2019", "track": "t1", "type": "paper", "status": "done",
        "curr_order": 1, "title": "Hippocampal replay during slow-wave sleep",
        "link": "https://example.org/replay-2019", "citation": "Rivera et al., 2019",
        "design": "Rodent electrophysiology, n=12.",
        "methods": "Tetrode recordings across learning and subsequent sleep.",
        "findings": "Sequences active during learning reactivated in compressed form during SWS.",
        "relevance": "Core mechanistic evidence for sleep-dependent consolidation.",
        "questions": "Does replay fidelity predict next-day recall?",
        "notes": "Cited by nearly everything downstream; good anchor paper.",
        "tags": json.dumps(["mechanism", "anchor-paper"]),
    },
    {
        "id": "spindles-declarative-2021", "track": "t1", "type": "paper", "status": "done",
        "curr_order": 2, "title": "Sleep spindles and declarative memory gains",
        "link": "https://example.org/spindles-2021", "citation": "Okafor & Lindqvist, 2021",
        "design": "Human polysomnography + word-pair recall, n=40.",
        "methods": "Overnight PSG; spindle density correlated with morning recall improvement.",
        "findings": "Spindle density predicted overnight recall gains (r=0.46).",
        "relevance": "Bridges the rodent replay work to human declarative memory.",
        "questions": "Is the effect causal or a correlate of sleep depth?",
        "notes": "",
        "tags": json.dumps(["human", "EEG"]),
    },
    {
        "id": "nap-vs-wake-2022", "track": "t2", "type": "paper", "status": "reading",
        "curr_order": 1, "title": "Daytime naps versus quiet wakefulness for retention",
        "link": "https://example.org/nap-2022", "citation": "Delgado et al., 2022",
        "design": "Behavioral, within-subjects crossover, n=28.",
        "methods": "90-min nap vs. quiet wake; retention tested at 24h.",
        "findings": "", "relevance": "Directly tests a practical intervention.",
        "questions": "How does nap timing relative to learning matter?",
        "notes": "Halfway through — findings section still to summarize.",
        "tags": json.dumps(["behavioral"]),
    },
    {
        "id": "targeted-reactivation-2023", "track": "t2", "type": "review", "status": "todo",
        "curr_order": 2, "title": "Targeted memory reactivation: a review",
        "link": "https://example.org/tmr-2023", "citation": "Brandt, 2023",
        "design": "", "methods": "", "findings": "", "relevance": "", "questions": "",
        "notes": "Queued — good candidate for the synthesis once read.",
        "tags": json.dumps(["review"]),
    },
]


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    conn.execute("INSERT OR IGNORE INTO libraries (id, name) VALUES (?, ?)", LIBRARY)
    conn.executemany(
        "INSERT OR IGNORE INTO tracks (id, library_id, name, color) VALUES (?, ?, ?, ?)", TRACKS
    )

    added = 0
    for paper in PAPERS:
        fields = {k: v for k, v in paper.items() if k != "id"}
        result = _apply_versioned_update(conn, "example", paper["id"], fields, source="seed")
        if result is not None:
            added += 1
    conn.commit()
    conn.close()

    print(f"Seeded '{DB_PATH}': library 'example', {len(TRACKS)} tracks, "
          f"{added} paper(s) added ({len(PAPERS) - added} already present).")
    print("Next:  set LITFLOW_DB to this path and run the MCP server, or")
    print("       python export.py example  ->  open library-viewer.html and load the JSON, or")
    print("       python bridge.py export example  ->  load into ../litflow.html via Settings > Import.")


if __name__ == "__main__":
    main()
