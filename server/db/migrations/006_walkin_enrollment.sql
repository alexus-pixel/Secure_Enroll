-- ============================================================
-- SecureEnroll — migration 006: physical document records
--
-- Supports Admin-assisted walk-in enrollment: a parent hands over
-- physical paper documents at the front desk instead of uploading
-- files. documents.file_path/mime_type/file_size/checksum were all
-- NOT NULL (every existing row is a real upload), so a document
-- with no file at all needs is_physical to distinguish it, and
-- those four columns need to become optional — but only when
-- is_physical is true, enforced by the CHECK below rather than
-- just relaxing them for every row.
--
--   psql "$DATABASE_URL" -f server/db/migrations/006_walkin_enrollment.sql
-- ============================================================

BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_physical BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE documents
  ALTER COLUMN file_path DROP NOT NULL,
  ALTER COLUMN mime_type DROP NOT NULL,
  ALTER COLUMN file_size DROP NOT NULL,
  ALTER COLUMN checksum DROP NOT NULL;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_physical_or_file_check;
ALTER TABLE documents ADD CONSTRAINT documents_physical_or_file_check
  CHECK (is_physical = TRUE OR (file_path IS NOT NULL AND mime_type IS NOT NULL AND file_size IS NOT NULL AND checksum IS NOT NULL));

COMMIT;
