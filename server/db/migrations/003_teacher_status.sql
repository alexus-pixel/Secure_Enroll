-- ============================================================
-- SecureEnroll — migration 003: teacher status
--
-- Adds a real employment-status field to teachers (active / locked
-- / retired), shown as an editable dropdown on the Edit Teacher
-- form. Additive only, safe to run after 002_admin.sql.
--
--   psql "$DATABASE_URL" -f server/db/migrations/003_teacher_status.sql
-- ============================================================

BEGIN;

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'locked', 'retired'));

-- Backfill any teachers that already existed under the old
-- is_active-only model: an inactive teacher becomes "retired" by
-- default, since that's the closer real-world match — an admin can
-- still change it to "locked" by hand if that's actually what was
-- meant. (status just defaulted to 'active' for every existing row
-- in the ALTER above, so this is the only meaningful backfill.)
UPDATE teachers SET status = 'retired' WHERE is_active = FALSE;

COMMIT;
