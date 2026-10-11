-- ============================================================
-- SecureEnroll — migration 004: additional teacher details
--
-- Adds fields worth having on a real teacher HR record beyond the
-- original set: a middle name/initial (optional, matches how most
-- Philippine legal names are actually structured), sex, a PRC
-- (Professional Regulation Commission) license number — the real
-- credential a licensed Philippine teacher holds — and a home
-- address. Address is encrypted at rest, the same pattern already
-- used for guardian and teacher contact numbers.
--
--   psql "$DATABASE_URL" -f server/db/migrations/004_teacher_details.sql
-- ============================================================

BEGIN;

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR(60),
  ADD COLUMN IF NOT EXISTS sex VARCHAR(10) CHECK (sex IN ('male', 'female') OR sex IS NULL),
  ADD COLUMN IF NOT EXISTS prc_license_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS address BYTEA;

COMMIT;
