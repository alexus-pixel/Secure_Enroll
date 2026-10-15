-- ============================================================
-- SecureEnroll — migration 007: registrar document review
--
-- The registrar screens were written against columns that no
-- earlier migration created, so a database built only from
-- schema.sql + migrations 001-006 is missing them. Every statement
-- below is idempotent (IF NOT EXISTS / guarded), so it is safe to
-- run on a database that already has some or all of these columns,
-- including one where they were added by hand.
--
--   psql "$DATABASE_URL" -f server/db/migrations/007_registrar_review.sql
-- ============================================================

BEGIN;

-- Staff name fields used by the registrar "Account Settings" page.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name     VARCHAR(60),
  ADD COLUMN IF NOT EXISTS last_name      VARCHAR(60),
  ADD COLUMN IF NOT EXISTS middle_initial VARCHAR(2);

-- "Grade qualification: Met / Not Met" decision on the review page.
ALTER TABLE enrollment_applications
  ADD COLUMN IF NOT EXISTS grade_qualification VARCHAR(10);

-- A paper document the parent handed over in person, plus the
-- optional reason a registrar gives when flagging or rejecting one.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS received_in_person BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_note        TEXT;

-- Migration 006 added is_physical for admin walk-ins; the registrar
-- code used received_in_person for the same idea. Keep them in step so
-- the "file or physical" CHECK from 006 accepts either.
UPDATE documents SET is_physical = TRUE WHERE received_in_person AND NOT is_physical;
UPDATE documents SET received_in_person = TRUE WHERE is_physical AND NOT received_in_person;

-- A document can now be Verified, Flagged (needs attention) or
-- Rejected (must be replaced), in addition to Pending. Drop whatever
-- the old status CHECK was called, then add the wider one.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) ILIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('pending', 'verified', 'flagged', 'rejected'));

COMMIT;
