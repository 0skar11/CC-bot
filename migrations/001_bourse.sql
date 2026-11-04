CREATE TABLE IF NOT EXISTS bourse_records (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bourse_records_prefix ON bourse_records (key text_pattern_ops);
