-- A parent who replaces a flagged or rejected document (or answers a revision
-- request) puts the application back in the registrar's queue as 'resubmitted'.
-- The API applies this automatically on start (db/ensureSchema.js); this file is
-- the same change for anyone who prefers to run it by hand. Safe to run twice.
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
END $$;
