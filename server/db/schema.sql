-- ============================================================
-- SecureEnroll — PostgreSQL schema
-- A Secure Online Enrollment System with Encrypted Student Data
-- and Role-Based Access Control
--
-- Caloocan City Elementary School
-- University of Caloocan City - North Campus
-- Information Assurance and Security 1
--
-- Run this file against an empty database:
--   psql -U postgres -d secureenroll -f schema.sql
-- ============================================================

-- pgcrypto gives us pgp_sym_encrypt / pgp_sym_decrypt for
-- column-level encryption, and digest() for blind-index hashes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. ACCESS CONTROL  (the RBAC core)
-- ============================================================

-- Roles are data, not hardcoded strings. Adding a role later
-- (say, "principal") does not require changing application code.
CREATE TABLE roles (
    id          SMALLSERIAL PRIMARY KEY,
    name        VARCHAR(30)  NOT NULL UNIQUE,
    description TEXT
);

-- One row per thing a user can DO. Verbs, not screens.
CREATE TABLE permissions (
    id          SMALLSERIAL PRIMARY KEY,
    code        VARCHAR(60)  NOT NULL UNIQUE,   -- e.g. application.approve
    description TEXT
);

-- The many-to-many join: which role may do which action.
CREATE TABLE role_permissions (
    role_id       SMALLINT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);


-- ============================================================
-- 2. ACCOUNTS
-- ============================================================

CREATE TABLE users (
    id                    BIGSERIAL PRIMARY KEY,
    -- store emails already lowercased by the API so UNIQUE really is unique
    email                 VARCHAR(255) NOT NULL UNIQUE,
    password_hash         TEXT        NOT NULL,       -- bcrypt, never plaintext
    role_id               SMALLINT    NOT NULL REFERENCES roles(id),
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    email_verified_at     TIMESTAMPTZ,
    -- brute-force protection
    failed_login_attempts SMALLINT    NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every security-relevant action lands here. Append-only:
-- the application never issues UPDATE or DELETE on this table.
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(60) NOT NULL,   -- LOGIN_SUCCESS, APPLICATION_APPROVED, ...
    entity_type VARCHAR(40),            -- 'enrollment_application'
    entity_id   BIGINT,
    ip_address  INET,
    user_agent  TEXT,
    details     JSONB,                  -- before/after values, reason codes
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user    ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity  ON audit_logs (entity_type, entity_id);


-- ============================================================
-- 3. PEOPLE
--
-- Encryption rule of thumb used below:
--   plaintext  -> anything the registrar must search or sort by
--   encrypted  -> identifiers and contact details (BYTEA via pgcrypto)
--   hashed     -> an encrypted value we still need to look up by
--                 (a "blind index": deterministic hash, not reversible)
-- ============================================================

-- A guardian profile hangs off a user account, one to one.
CREATE TABLE guardians (
    user_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name       VARCHAR(60) NOT NULL,
    middle_name      VARCHAR(60),
    last_name        VARCHAR(60) NOT NULL,
    contact_number   BYTEA       NOT NULL,   -- encrypted
    address          BYTEA       NOT NULL,   -- encrypted
    valid_id_type    VARCHAR(40),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE students (
    id           BIGSERIAL PRIMARY KEY,
    lrn_encrypted BYTEA,                     -- Learner Reference Number, encrypted
    lrn_hash      CHAR(64) UNIQUE,           -- blind index: SHA-256 of the LRN
    first_name    VARCHAR(60) NOT NULL,
    middle_name   VARCHAR(60),
    last_name     VARCHAR(60) NOT NULL,
    birth_date    BYTEA       NOT NULL,      -- encrypted
    sex           CHAR(1)     NOT NULL CHECK (sex IN ('M','F')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_name ON students (last_name, first_name);

-- A student may have more than one guardian; a guardian may
-- enroll more than one child.
CREATE TABLE student_guardians (
    student_id   BIGINT      NOT NULL REFERENCES students(id)      ON DELETE CASCADE,
    guardian_id  BIGINT      NOT NULL REFERENCES guardians(user_id) ON DELETE CASCADE,
    relationship VARCHAR(30) NOT NULL,       -- Mother, Father, Aunt, ...
    is_primary   BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (student_id, guardian_id)
);


-- ============================================================
-- 4. SCHOOL STRUCTURE
-- ============================================================

CREATE TABLE school_years (
    id         SMALLSERIAL PRIMARY KEY,
    label      VARCHAR(9)  NOT NULL UNIQUE,   -- '2026-2027'
    opens_at   TIMESTAMPTZ NOT NULL,
    closes_at  TIMESTAMPTZ NOT NULL,
    is_active  BOOLEAN     NOT NULL DEFAULT FALSE,
    CHECK (closes_at > opens_at)
);

CREATE TABLE grade_levels (
    id         SMALLSERIAL PRIMARY KEY,
    name       VARCHAR(20) NOT NULL UNIQUE,   -- 'Kinder', 'Grade 1' ... 'Grade 6'
    sort_order SMALLINT    NOT NULL
);

CREATE TABLE sections (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(40) NOT NULL,      -- 'Sampaguita'
    grade_level_id SMALLINT    NOT NULL REFERENCES grade_levels(id),
    school_year_id SMALLINT    NOT NULL REFERENCES school_years(id),
    capacity       SMALLINT    NOT NULL CHECK (capacity > 0),
    UNIQUE (name, grade_level_id, school_year_id)
);


-- ============================================================
-- 5. ENROLLMENT
-- ============================================================

CREATE TABLE enrollment_applications (
    id             BIGSERIAL PRIMARY KEY,
    student_id     BIGINT      NOT NULL REFERENCES students(id),
    school_year_id SMALLINT    NOT NULL REFERENCES school_years(id),
    grade_level_id SMALLINT    NOT NULL REFERENCES grade_levels(id),
    section_id     INTEGER     REFERENCES sections(id),   -- assigned on approval
    status         VARCHAR(20) NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('draft','submitted','under_review',
                                     'needs_revision','approved','rejected')),
    submitted_by   BIGINT      NOT NULL REFERENCES users(id),
    submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by    BIGINT      REFERENCES users(id),
    reviewed_at    TIMESTAMPTZ,
    remarks        TEXT,

    -- This is the duplicate-record defence from the concept paper:
    -- one student cannot be enrolled twice in the same school year.
    UNIQUE (student_id, school_year_id)
);

CREATE INDEX idx_applications_status ON enrollment_applications (status, school_year_id);

CREATE TABLE documents (
    id             BIGSERIAL PRIMARY KEY,
    application_id BIGINT      NOT NULL REFERENCES enrollment_applications(id)
                               ON DELETE CASCADE,
    doc_type       VARCHAR(40) NOT NULL,   -- birth_certificate, form_138, good_moral
    file_path      TEXT        NOT NULL,   -- stored outside the web root
    mime_type      VARCHAR(80) NOT NULL,
    file_size      INTEGER     NOT NULL CHECK (file_size > 0),
    checksum       CHAR(64)    NOT NULL,   -- SHA-256, proves the file is unaltered
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','verified','rejected')),
    verified_by    BIGINT      REFERENCES users(id),
    verified_at    TIMESTAMPTZ,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_application ON documents (application_id);


-- ============================================================
-- 6. SEED DATA — the three roles from the concept paper
-- ============================================================

INSERT INTO roles (name, description) VALUES
    ('parent',    'Parent or guardian. Submits and tracks enrollment for their own children.'),
    ('registrar', 'Registrar staff. Verifies student information and processes applications.'),
    ('admin',     'Administrator. Manages user accounts, school records, and system settings.');

INSERT INTO permissions (code, description) VALUES
    ('application.create',   'Submit a new enrollment application'),
    ('application.view_own', 'View applications for one''s own children'),
    ('application.view_all', 'View every application'),
    ('application.review',   'Move an application into review'),
    ('application.approve',  'Approve or reject an application'),
    ('document.upload',      'Upload a supporting document'),
    ('document.verify',      'Mark a document verified or rejected'),
    ('student.view_all',     'View every student record'),
    ('user.manage',          'Create, disable, and assign roles to users'),
    ('audit.view',           'Read the audit log'),
    ('settings.manage',      'Change school years, grade levels, and sections');

-- parent
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'parent'
  AND p.code IN ('application.create','application.view_own','document.upload');

-- registrar
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'registrar'
  AND p.code IN ('application.view_all','application.review','application.approve',
                 'document.verify','student.view_all');

-- admin gets everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin';

INSERT INTO grade_levels (name, sort_order) VALUES
    ('Kinder', 0), ('Grade 1', 1), ('Grade 2', 2), ('Grade 3', 3),
    ('Grade 4', 4), ('Grade 5', 5), ('Grade 6', 6);
