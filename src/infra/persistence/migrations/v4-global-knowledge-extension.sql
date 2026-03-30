-- Migration v4: Global Knowledge Schema Extension
-- Widens knowledge_type CHECK constraint, adds scope, embedding, and decay columns.
-- Uses CREATE + INSERT + DROP + RENAME pattern because SQLite does not support ALTER CHECK.

CREATE TABLE IF NOT EXISTS global_knowledge_v4 (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    source_goal_id TEXT,
    source_context_pack_id TEXT,
    knowledge_type TEXT NOT NULL CHECK(knowledge_type IN (
        'pitfall', 'pattern', 'approach', 'decision',
        'constraint', 'failure_mode', 'time_estimate', 'tool_preference'
    )),
    domain_tags TEXT,
    scope TEXT,                          -- e.g. 'github-api', 'nodejs-fs'
    content TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    occurrence_count INTEGER DEFAULT 1,
    last_reinforced_at INTEGER NOT NULL,
    embedding BLOB,                      -- nullable; generated async on record
    embedding_dim INTEGER,
    embedding_model TEXT,
    decayed_at INTEGER,                  -- null = active; non-null = soft-deleted
    FOREIGN KEY(source_goal_id) REFERENCES goals(id)
);

INSERT OR IGNORE INTO global_knowledge_v4
    (id, created_at, source_goal_id, source_context_pack_id,
     knowledge_type, domain_tags, scope, content, confidence,
     occurrence_count, last_reinforced_at, embedding, embedding_dim,
     embedding_model, decayed_at)
SELECT id, created_at, source_goal_id, source_context_pack_id,
       knowledge_type, domain_tags, NULL, content, confidence,
       occurrence_count, last_reinforced_at, NULL, NULL, NULL, NULL
FROM global_knowledge;

DROP TABLE IF EXISTS global_knowledge_old;
ALTER TABLE global_knowledge RENAME TO global_knowledge_old;
ALTER TABLE global_knowledge_v4 RENAME TO global_knowledge;
DROP TABLE IF EXISTS global_knowledge_old;

-- Re-create indexes on the new table
CREATE INDEX IF NOT EXISTS idx_gk_type ON global_knowledge(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_gk_type_conf ON global_knowledge(knowledge_type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_gk_source ON global_knowledge(source_goal_id);
CREATE INDEX IF NOT EXISTS idx_gk_scope ON global_knowledge(scope);
CREATE INDEX IF NOT EXISTS idx_gk_active ON global_knowledge(decayed_at) WHERE decayed_at IS NULL;
