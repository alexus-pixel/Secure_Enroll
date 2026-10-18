// Brings an older database up to the shape the code expects, every time the
// API starts. Every step is idempotent (safe to run again and again) and
// failures are logged rather than fatal, so the API still starts.
//
// Why this exists: the registrar's document review (Verify / Flag / Reject,
// reasons, paper copies) and staff names need columns and a wider status rule
// that only migration 007 adds. A database that never had 007 applied made
// every review action fail with a server error. This makes that impossible.
// It is the same change as db/migrations/007_registrar_review.sql, plus a few
// small things the newer features need.
const pool = require('./pool');

async function step(name, sql) {
  try {
    await pool.query(sql);
  } catch (err) {
    console.error(`[schema] ${name} failed: ${err.message}`);
  }
}

async function ensureSchema() {
  // Staff / account names (greeting, Edit Profile).
  await step('users name columns', `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name     VARCHAR(60),
      ADD COLUMN IF NOT EXISTS last_name      VARCHAR(60),
      ADD COLUMN IF NOT EXISTS middle_initial VARCHAR(2)`);

  await step('grade qualification', `
    ALTER TABLE enrollment_applications
      ADD COLUMN IF NOT EXISTS grade_qualification VARCHAR(10)`);

  // Document review.
  await step('document review columns', `
    ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS received_in_person BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS review_note        TEXT`);

  await step('physical flag sync', `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'is_physical') THEN
        UPDATE documents SET is_physical = TRUE WHERE received_in_person AND NOT is_physical;
        UPDATE documents SET received_in_person = TRUE WHERE is_physical AND NOT received_in_person;
      END IF;
    END $$`);

  // Status may be pending, verified, flagged or rejected. Only touch the rule
  // when it does not already allow 'flagged'.
  await step('document status rule', `
    DO $$
    DECLARE c RECORD; ok BOOLEAN := FALSE;
    BEGIN
      FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'documents'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%' AND pg_get_constraintdef(oid) ILIKE '%pending%'
      LOOP
        IF c.def ILIKE '%flagged%' THEN
          ok := TRUE;
        ELSE
          EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', c.conname);
        END IF;
      END LOOP;
      IF NOT ok THEN
        ALTER TABLE documents ADD CONSTRAINT documents_status_check
          CHECK (status IN ('pending', 'verified', 'flagged', 'rejected'));
      END IF;
    END $$`);

  // A replacement for a flagged / rejected document marks the application 'resubmitted'.
  await step('resubmitted status', `
    DO $$
    DECLARE c RECORD;
    BEGIN
      FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'enrollment_applications'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%under_review%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%resubmitted%'
      LOOP
        EXECUTE format('ALTER TABLE enrollment_applications DROP CONSTRAINT %I', c.conname);
        ALTER TABLE enrollment_applications ADD CONSTRAINT enrollment_applications_status_check
          CHECK (status IN ('draft','submitted','under_review','resubmitted','needs_revision','approved','rejected'));
      END LOOP;
    END $$`);

  // Office documents and other file types have long MIME types.
  await step('wider mime_type', `
    DO $$
    BEGIN
      IF (SELECT character_maximum_length FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'mime_type') < 150 THEN
        ALTER TABLE documents ALTER COLUMN mime_type TYPE VARCHAR(150);
      END IF;
    END $$`);

  // The name shown in the greeting belongs to the account, not to whatever
  // guardian name is typed on an application, so keep a copy on users.
  await step('account names backfill', `
    UPDATE users u SET first_name = g.first_name, last_name = g.last_name,
                       middle_initial = LEFT(g.middle_name, 2)
    FROM guardians g
    WHERE g.user_id = u.id AND u.first_name IS NULL`);

  // A section is chosen only after approval. Clear any section that an earlier
  // version assigned to an application that has not been approved.
  await step('sections only after approval', `
    UPDATE enrollment_applications SET section_id = NULL
    WHERE section_id IS NOT NULL AND status <> 'approved'`);

  // Each section's master list is emailed to its adviser when enrollment closes.
  await step('master list emails', `
    ALTER TABLE school_years ADD COLUMN IF NOT EXISTS auto_email_lists BOOLEAN NOT NULL DEFAULT TRUE`);
  await step('master list email log', `
    DO $$
    BEGIN
      IF to_regclass('public.teachers') IS NOT NULL THEN
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
        CREATE INDEX IF NOT EXISTS idx_masterlist_emails_section
          ON masterlist_emails (section_id, school_year_id, created_at DESC);
      END IF;
    END $$`);
}

module.exports = { ensureSchema };
