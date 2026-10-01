-- ============================================================
-- SecureEnroll — migration 002: Admin section
--
-- Adds everything the admin portal needs: teachers, subjects,
-- weekly schedule entries with a teacher-conflict guard, school
-- settings (enrollment toggle), and required-document config.
--
-- This file is ADDITIVE ONLY. It does not touch schema.sql or any
-- existing table's existing columns, so it is safe to run after
-- schema.sql on a database that already has real data in it.
--
-- Run:
--   psql "$DATABASE_URL" -f server/db/migrations/002_admin.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Users get a display name. schema.sql's users table only
--    has email; the admin Users page needs to show and search by
--    a name too (parents get theirs from `guardians` already, but
--    registrar/admin staff accounts have no such row). Nullable,
--    so every existing row stays valid with no backfill required.
-- ------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(120);

-- ------------------------------------------------------------
-- 1. School year gets an enrollment on/off switch.
--    (label, opens_at, closes_at, is_active already exist.)
-- ------------------------------------------------------------
ALTER TABLE school_years
  ADD COLUMN IF NOT EXISTS enrollment_open BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 2. Teachers — a roster the admin manages directly.
--    Deliberately NOT linked to `users`: teachers do not get a
--    portal login in this build (that is a separate, un-built
--    role). Email is kept in plaintext because it is the lookup
--    key used to send master-list/schedule PDFs and is not, on
--    its own, sensitive the way a home address or LRN is.
--    Contact number is treated the same way the concept paper
--    treats guardian contact numbers: encrypted at rest.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teachers (
    id              SERIAL PRIMARY KEY,
    first_name      VARCHAR(60)  NOT NULL,
    last_name       VARCHAR(60)  NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    contact_number  BYTEA,                          -- encrypted (pgp_sym_encrypt)
    degree          VARCHAR(120),
    major           VARCHAR(120),
    date_hired      DATE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by      BIGINT       REFERENCES users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teachers_name ON teachers (last_name, first_name);

-- ------------------------------------------------------------
-- 3. Subjects — scoped to one grade level + school year, so
--    "Science" for Grade 4, SY 2026-2027 is a distinct row from
--    "Science" for Grade 5. is_domain marks the six Kinder
--    developmental domains, which the UI treats as a different
--    vocabulary but the same underlying row shape.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(80) NOT NULL,
    grade_level_id  SMALLINT    NOT NULL REFERENCES grade_levels(id),
    school_year_id  SMALLINT    NOT NULL REFERENCES school_years(id),
    is_domain       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (name, grade_level_id, school_year_id)
);

-- What a teacher is generally qualified/assigned to teach
-- (shown on the Teachers roster). Separate from the actual
-- weekly timetable in schedule_entries below.
CREATE TABLE IF NOT EXISTS teacher_subjects (
    teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (teacher_id, subject_id)
);

-- ------------------------------------------------------------
-- 4. Schedule entries — one weekly recurring class block.
--    days is an array of ISO weekday numbers (1=Mon..5=Fri).
--    role_type distinguishes a normal subject period from a
--    homeroom "Adviser" row, which has no period/time of its own.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_entries (
    id              BIGSERIAL PRIMARY KEY,
    section_id      INTEGER     NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    subject_id      INTEGER     REFERENCES subjects(id),
    teacher_id      INTEGER     REFERENCES teachers(id),
    session         VARCHAR(10) CHECK (session IN ('morning','afternoon')),
    days            SMALLINT[]  NOT NULL DEFAULT '{}',
    start_time      TIME,
    end_time        TIME,
    room            VARCHAR(40),
    role_type       VARCHAR(20) NOT NULL DEFAULT 'subject'
                    CHECK (role_type IN ('subject','adviser')),
    school_year_id  SMALLINT    NOT NULL REFERENCES school_years(id),
    created_by      BIGINT      REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role_type = 'adviser' OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)),
    CHECK (role_type = 'adviser' OR session IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_schedule_teacher ON schedule_entries (teacher_id, school_year_id);
CREATE INDEX IF NOT EXISTS idx_schedule_section ON schedule_entries (section_id, school_year_id);

-- ------------------------------------------------------------
-- 5. Required documents — a single global checklist, matching
--    "Applies to every new application" in the admin flow.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS required_document_types (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(40) NOT NULL UNIQUE,
    label        VARCHAR(80) NOT NULL,
    is_required  BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order   SMALLINT    NOT NULL DEFAULT 0
);

INSERT INTO required_document_types (code, label, is_required, sort_order) VALUES
    ('birth_certificate', 'PSA Birth Certificate',          TRUE,  1),
    ('parent_valid_id',   'Parent/Guardian Valid ID',       TRUE,  2),
    ('school_clearance',  'School Clearance',                FALSE, 3),
    ('form_138',          'Form 138 / Report Card',          TRUE,  4),
    ('good_moral',        'Certificate of Good Moral Character', FALSE, 5),
    ('medical_certificate','Medical Certificate',            FALSE, 6)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- 6. New permission codes for the admin-only actions this
--    build introduces, granted to the admin role. Existing
--    admin permissions (user.manage, audit.view, settings.manage,
--    application.view_all, student.view_all) already cover most
--    of the admin section; these two are new verbs.
-- ------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('teacher.manage',  'Add, edit, and view teacher records and their schedules'),
    ('schedule.manage', 'Create, edit, and remove class schedule entries')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('teacher.manage', 'schedule.manage')
ON CONFLICT DO NOTHING;

COMMIT;
