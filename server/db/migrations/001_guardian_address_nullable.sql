-- ============================================================
-- Migration 001: allow guardians.address to be NULL
--
-- Why: the parent account creation flow now captures name +
-- contact number at registration time, but address is still
-- collected later, on the first enrollment application. Run
-- this once against any database created from an older copy
-- of schema.sql (a fresh install already has it applied).
--
--   psql -U postgres -d secureenroll -f migrations/001_guardian_address_nullable.sql
-- ============================================================

ALTER TABLE guardians ALTER COLUMN address DROP NOT NULL;
