-- Automatic delivery of each section's master list to its adviser.
-- The API applies this on start (db/ensureSchema.js); this file is the same
-- change for anyone who prefers to run it by hand. Safe to run twice.
ALTER TABLE school_years ADD COLUMN IF NOT EXISTS auto_email_lists BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS masterlist_emails (
    id             BIGSERIAL PRIMARY KEY,
    section_id     INTEGER     NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    school_year_id SMALLINT    NOT NULL REFERENCES school_years(id),
    teacher_id     INTEGER     REFERENCES teachers(id) ON DELETE SET NULL,
    to_email       VARCHAR(255),
    student_count  INTEGER     NOT NULL DEFAULT 0,
    status         VARCHAR(10) NOT NULL CHECK (status IN ('sent','failed','skipped')),
    trigger        VARCHAR(10) NOT NULL CHECK (trigger IN ('auto','manual')),
    error          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_masterlist_emails_section ON masterlist_emails (section_id, school_year_id, created_at DESC);
