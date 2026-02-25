CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL,
    state TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL DEFAULT 'active',
    active_goal_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    archived_at INTEGER,
    archive_summary TEXT,
    archive_metadata TEXT,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle ON sessions(lifecycle_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona_id);
CREATE INDEX IF NOT EXISTS idx_sessions_goal ON sessions(active_goal_id);

CREATE TABLE IF NOT EXISTS session_turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    attachments TEXT,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_turns_session ON session_turns(session_id, timestamp);

CREATE TABLE IF NOT EXISTS memory_entries (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    turn_id TEXT UNIQUE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    embedding_dim INTEGER NOT NULL,
    embedding_model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_session_created
ON memory_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_model_dim
ON memory_entries(embedding_model, embedding_dim);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
    content,
    entry_id UNINDEXED,
    session_id UNINDEXED,
    role UNINDEXED,
    content='memory_entries',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_entries_fts(rowid, content, entry_id, session_id, role)
    VALUES (new.rowid, new.content, new.entry_id, new.session_id, new.role);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
    INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content, entry_id, session_id, role)
    VALUES ('delete', old.rowid, old.content, old.entry_id, old.session_id, old.role);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_au AFTER UPDATE ON memory_entries BEGIN
    INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content, entry_id, session_id, role)
    VALUES ('delete', old.rowid, old.content, old.entry_id, old.session_id, old.role);
    INSERT INTO memory_entries_fts(rowid, content, entry_id, session_id, role)
    VALUES (new.rowid, new.content, new.entry_id, new.session_id, new.role);
END;

CREATE TABLE IF NOT EXISTS embedding_cache (
    cache_key TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding_dim INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (cache_key, embedding_model)
);

CREATE INDEX IF NOT EXISTS idx_embedding_cache_lru
ON embedding_cache(last_accessed_at ASC);

CREATE TABLE IF NOT EXISTS core_memories (
    memory_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    owner_type TEXT NOT NULL DEFAULT 'agent',
    owner_id TEXT NOT NULL DEFAULT 'legacy-default-agent',
    turn_id TEXT UNIQUE,
    role TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    summary TEXT NOT NULL,
    importance REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (memory_id)
);

CREATE INDEX IF NOT EXISTS idx_core_memories_session_created
ON core_memories(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_memories_owner
ON core_memories(session_id, owner_type, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_memories_importance
ON core_memories(session_id, importance DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS core_memories_fts USING fts5(
    summary,
    raw_content,
    memory_id UNINDEXED,
    session_id UNINDEXED,
    content='core_memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS core_memories_ai AFTER INSERT ON core_memories BEGIN
    INSERT INTO core_memories_fts(rowid, summary, raw_content, memory_id, session_id)
    VALUES (new.rowid, new.summary, new.raw_content, new.memory_id, new.session_id);
END;

CREATE TRIGGER IF NOT EXISTS core_memories_ad AFTER DELETE ON core_memories BEGIN
    INSERT INTO core_memories_fts(core_memories_fts, rowid, summary, raw_content, memory_id, session_id)
    VALUES ('delete', old.rowid, old.summary, old.raw_content, old.memory_id, old.session_id);
END;

CREATE TRIGGER IF NOT EXISTS core_memories_au AFTER UPDATE ON core_memories BEGIN
    INSERT INTO core_memories_fts(core_memories_fts, rowid, summary, raw_content, memory_id, session_id)
    VALUES ('delete', old.rowid, old.summary, old.raw_content, old.memory_id, old.session_id);
    INSERT INTO core_memories_fts(rowid, summary, raw_content, memory_id, session_id)
    VALUES (new.rowid, new.summary, new.raw_content, new.memory_id, new.session_id);
END;
