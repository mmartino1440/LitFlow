-- litflow MCP companion — SQLite schema
--
-- Current paper state lives in `papers`; every prior state is preserved in `paper_versions`
-- (written BEFORE an update overwrites `papers`, so no edit ever loses a prior state).
--
-- Field names/shape are deliberately close to the real LitFlow app's own paper object
-- (see ../litflow.html `addPaper()`), so bridge.py can convert cleanly in both directions:
--   dateCompleted (camelCase, in-app)  <-> date_completed (this table)
--   tags: []      (in-app array)      <-> tags (this table, JSON array as TEXT)
--   array position (in-app ordering)  <-> curr_order (this table, an explicit column so an
--                                        MCP tool call can query/set order without re-sending
--                                        the whole library)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS libraries (
    id   TEXT PRIMARY KEY,          -- e.g. 'example', or a project name from litflow-<name>.html
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
    id         TEXT NOT NULL,
    library_id TEXT NOT NULL REFERENCES libraries(id),
    name       TEXT NOT NULL,
    color      TEXT,
    PRIMARY KEY (id, library_id)
);

CREATE TABLE IF NOT EXISTS papers (
    id               TEXT NOT NULL,        -- carries over the app's own 'p<timestamp>' ids on import
    library_id       TEXT NOT NULL REFERENCES libraries(id),
    title            TEXT NOT NULL,
    link             TEXT,
    citation         TEXT,
    track            TEXT,
    type             TEXT,
    status           TEXT,
    curr_order       INTEGER,              -- manual sequencing; maps to array position in the app
    design           TEXT,
    methods          TEXT,
    findings         TEXT,
    relevance        TEXT,
    questions        TEXT,
    notes            TEXT,
    tags             TEXT,                 -- JSON array, e.g. '["neuro","methods"]'
    date_completed   TEXT,
    current_version  INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (library_id, id)
);

CREATE TABLE IF NOT EXISTS paper_versions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id     TEXT NOT NULL,
    paper_id       TEXT NOT NULL,
    version        INTEGER NOT NULL,
    snapshot       TEXT NOT NULL,           -- full row state at this version, as JSON
    changed_fields TEXT,                    -- JSON array of fields that differ from the prior version
    source_file    TEXT,                    -- provenance when imported/backfilled; NULL for live captures
    captured_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (library_id, paper_id) REFERENCES papers(library_id, id),
    UNIQUE (library_id, paper_id, version)
);

CREATE INDEX IF NOT EXISTS idx_papers_library ON papers(library_id);
CREATE INDEX IF NOT EXISTS idx_papers_status  ON papers(library_id, status);
CREATE INDEX IF NOT EXISTS idx_versions_paper ON paper_versions(library_id, paper_id, version);
