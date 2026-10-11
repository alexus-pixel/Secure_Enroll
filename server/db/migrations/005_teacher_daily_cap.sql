-- ============================================================
-- SecureEnroll — migration 005: per-teacher daily period cap
--
-- Adds an editable daily limit (default 5 periods/day) separate
-- from the existing school-wide weekly cap (WEEKLY_LOAD_CAP = 24
-- periods/week in code). The weekly cap stops a teacher from being
-- overloaded across the whole week; this one stops any single day
-- from being packed too tight, even if the week overall has room.
--
--   psql "$DATABASE_URL" -f server/db/migrations/005_teacher_daily_cap.sql
-- ============================================================

BEGIN;

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS max_periods_per_day SMALLINT NOT NULL DEFAULT 5
    CHECK (max_periods_per_day > 0 AND max_periods_per_day <= 20);

COMMIT;
