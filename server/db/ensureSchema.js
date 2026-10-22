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

  // --- An LRN the registrar could not find in the DepEd LIS -----------------
  // Flagging clears the stored LRN (it was wrong), remembers who flagged it
  // and why, and puts the learner back on the Missing LRN worklist. The
  // parent sees the note and can send a corrected number.
  await step('lrn correction flag', `
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS lrn_flagged_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS lrn_flag_note   TEXT,
      ADD COLUMN IF NOT EXISTS lrn_flagged_by  BIGINT REFERENCES users(id)`);

  // --- Login lockout that gets longer each time -----------------------------
  await step('escalating lockout', `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS lockout_count        SMALLINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ`);

  // --- A staff account created by an admin must choose its own password -----
  await step('force password change', `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`);

  // --- How many subjects a grade level may have -----------------------------
  await step('subject count per grade', `
    ALTER TABLE grade_levels
      ADD COLUMN IF NOT EXISTS max_subjects SMALLINT NOT NULL DEFAULT 10
        CHECK (max_subjects > 0 AND max_subjects <= 20)`);

  // --- A teacher may exist without an email address -------------------------
  // (mock and offline staff records; they are skipped by every email the
  // system sends, see lib/masterListMail.js).
  await step('optional teacher email', `
    DO $$
    BEGIN
      IF to_regclass('public.teachers') IS NOT NULL THEN
        ALTER TABLE teachers ALTER COLUMN email DROP NOT NULL;
      END IF;
    END $$`);

  // --- One adviser per section ----------------------------------------------
  await step('section adviser', `
    DO $$
    BEGIN
      IF to_regclass('public.teachers') IS NOT NULL THEN
        ALTER TABLE sections
          ADD COLUMN IF NOT EXISTS adviser_teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL;
      END IF;
    END $$`);

  // --- The registrar runs the class schedules too ---------------------------
  // Same screens, same rules as the administrator: the registrar is the one
  // who knows which learner sits in which section, so splitting the schedule
  // away from them only created a hand-off.
  await step('registrar may manage schedules', `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r, permissions p
    WHERE r.name = 'registrar' AND p.code = 'schedule.manage'
    ON CONFLICT DO NOTHING`);

  // --- The administrator does not do the registrar's job --------------------
  // Least privilege (concept paper, FR-RBAC): the administrator runs accounts,
  // school records, settings and the audit log. Reviewing documents, deciding
  // an application and enrolling a walk-in belong to the registrar alone, so
  // one person cannot both create a staff account and act as the registrar.
  // The original seed gave the admin every permission; this takes those three
  // back on a database that already has them, every time the API starts.
  await step('admin loses registrar powers', `
    DELETE FROM role_permissions rp
     USING roles r, permissions p
     WHERE rp.role_id = r.id AND rp.permission_id = p.id
       AND r.name = 'admin'
       AND p.code IN ('application.review', 'application.approve', 'document.verify')`);

  // --- A section's timetable is shown to parents only once it is published ---
  // NULL = not published (parents see "not published yet"). The registrar or
  // administrator publishes it from the class-schedule page when it is ready,
  // and can take it back down again.
  await step('sections.schedule_published_at', `
    ALTER TABLE sections
      ADD COLUMN IF NOT EXISTS schedule_published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS schedule_published_by BIGINT REFERENCES users(id) ON DELETE SET NULL`);

  // --- A school year created automatically needs its dates confirmed --------
  await step('school year dates confirmed', `
    ALTER TABLE school_years
      ADD COLUMN IF NOT EXISTS dates_confirmed BOOLEAN NOT NULL DEFAULT TRUE`);

  // --- A section name is unique within its grade level ----------------------
  // Schools number sections per grade, so Kinder and Grade 6 may both have a
  // section "1". What cannot happen is one grade level holding the name
  // twice, because "Grade 6 - 1" would then name two classes. An earlier
  // version of this system made the name unique across the whole year; that
  // index is dropped here so the looser, correct rule can apply.
  await step('drop year-wide section name index', `
    DROP INDEX IF EXISTS idx_sections_name_per_year`);
  await step('section names unique per grade level', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM sections
        GROUP BY school_year_id, grade_level_id, lower(btrim(name)) HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_name_per_grade
          ON sections (school_year_id, grade_level_id, lower(btrim(name)));
      ELSE
        RAISE NOTICE 'sections: duplicate names in one grade level already exist, unique index skipped';
      END IF;
    END $$`);

  // --- A teacher advises at most one section per school year -----------------
  // An adviser carries one class for the whole year, so the same teacher
  // cannot hold two advisories at once. The application refuses it on every
  // save and names the section that already holds them; this index is the
  // backstop for anything that writes the column directly. Data copied from
  // an earlier year may already break the rule, so the index is only created
  // when it can be.
  await step('one adviser per teacher per school year', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM sections
        WHERE adviser_teacher_id IS NOT NULL
        GROUP BY school_year_id, adviser_teacher_id HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_one_adviser_per_year
          ON sections (school_year_id, adviser_teacher_id)
          WHERE adviser_teacher_id IS NOT NULL;
      ELSE
        RAISE NOTICE 'sections: a teacher already advises more than one section in a school year, unique index skipped';
      END IF;
    END $$`);

  // --- Nothing that has to be unique may be typed twice ----------------------
  // Each of these is already refused in the application, by name, before
  // anything is written. These indexes are the backstop for two requests at
  // once and for anything that writes the tables directly. Each is only
  // created when the data allows it, so a database that already breaks the
  // rule still starts and says so.
  await step('unique teacher licence numbers', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM teachers WHERE prc_license_number IS NOT NULL AND btrim(prc_license_number) <> ''
        GROUP BY btrim(prc_license_number) HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_prc_unique
          ON teachers (btrim(prc_license_number))
          WHERE prc_license_number IS NOT NULL AND btrim(prc_license_number) <> '';
      ELSE
        RAISE NOTICE 'teachers: a PRC licence number appears twice, unique index skipped';
      END IF;
    END $$`);

  await step('unique document names', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM required_document_types GROUP BY lower(btrim(label)) HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_document_types_label_unique
          ON required_document_types (lower(btrim(label)));
      ELSE
        RAISE NOTICE 'required_document_types: a label appears twice, unique index skipped';
      END IF;
    END $$`);

  // A learner's full name identifies them across the whole school: two records
  // reading the same cannot be told apart on a master list or a class record.
  await step('unique learner names', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM students
        GROUP BY lower(btrim(first_name)), lower(btrim(COALESCE(middle_name, ''))), lower(btrim(last_name))
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_students_full_name_unique
          ON students (
            lower(btrim(first_name)),
            lower(btrim(COALESCE(middle_name, ''))),
            lower(btrim(last_name))
          );
      ELSE
        RAISE NOTICE 'students: two learners share a full name, unique index skipped';
      END IF;
    END $$`);

  // One account per email address, whatever case it was typed in.
  await step('unique emails whatever the case', `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM users GROUP BY lower(btrim(email)) HAVING COUNT(*) > 1) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users (lower(btrim(email)));
      ELSE
        RAISE NOTICE 'users: an email address appears twice in different cases, unique index skipped';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM teachers WHERE email IS NOT NULL GROUP BY lower(btrim(email)) HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email_lower_unique
          ON teachers (lower(btrim(email))) WHERE email IS NOT NULL;
      ELSE
        RAISE NOTICE 'teachers: an email address appears twice in different cases, unique index skipped';
      END IF;
    END $$`);

  // One teacher may be linked to a subject once.
  await step('one teacher-subject link', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM teacher_subjects GROUP BY teacher_id, subject_id HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_subjects_unique
          ON teacher_subjects (teacher_id, subject_id);
      ELSE
        RAISE NOTICE 'teacher_subjects: a link appears twice, unique index skipped';
      END IF;
    END $$`);

  // --- When classes actually start ------------------------------------------
  // The school year's opens_at/closes_at are the enrollment window: when the
  // office accepts applications. The first day of classes is a different date
  // — enrollment usually closes before the children walk in — and the landing
  // page has to tell a parent both. Existing years start out with the two the
  // same, which is what the system assumed until now, and the administrator
  // can move the class start date afterwards.
  await step('class start date', `
    ALTER TABLE school_years
      ADD COLUMN IF NOT EXISTS classes_start_on DATE`);
  await step('class start date backfill', `
    UPDATE school_years
       SET classes_start_on = (opens_at AT TIME ZONE 'Asia/Manila')::date
     WHERE classes_start_on IS NULL`);
  // The enrollment window is now a short span (a few days by default) that
  // closes BEFORE classes begin, and the school-year form only edits the
  // window's start and end — the first day of classes is a separate stored
  // value. Older rows were backfilled with classes_start_on equal to the day
  // enrollment opened, which would now read as "classes already started" the
  // moment enrollment opens and would break the rule that enrollment ends on
  // or before classes start. Move any such day up to the enrollment END, so
  // every row satisfies closes_at <= classes_start_on. Idempotent: a row that
  // already starts classes on or after its close date is left alone.
  await step('class start on or after enrollment end', `
    UPDATE school_years
       SET classes_start_on = (closes_at AT TIME ZONE 'Asia/Manila')::date
     WHERE classes_start_on IS NULL
        OR classes_start_on < (closes_at AT TIME ZONE 'Asia/Manila')::date`);

  // --- School-wide settings the administrator controls -----------------------
  // One row per setting, because these are a handful of single values with no
  // relationships to anything — a table with a column per setting would need a
  // migration every time one is added, and a one-row table needs guarding
  // against ever becoming two rows.
  await step('app settings table', `
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await step('default school hours', `
    INSERT INTO app_settings (key, value) VALUES ('day_opens_at', '06:00'), ('day_closes_at', '18:00')
    ON CONFLICT (key) DO NOTHING`);

  // --- Which documents each kind of enrollment needs -------------------------
  // A first-time Kinder learner and a transferee are asked for different
  // papers: nobody has a Form 138 before they have been to school, and a
  // returning learner's birth certificate is already on file. One checklist
  // for both meant the desk ticking boxes that did not apply.
  await step('document types audience', `
    ALTER TABLE required_document_types
      ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'all'`);
  await step('document types audience check', `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'required_document_types_applies_to_check'
      ) THEN
        ALTER TABLE required_document_types
          ADD CONSTRAINT required_document_types_applies_to_check
          CHECK (applies_to IN ('all', 'new', 'returning'));
      END IF;
    END $$`);
  // Form 138 is the report card from the grade just finished, so it belongs to
  // a learner who has been enrolled before and to nobody else.
  await step('form 138 is for returning learners', `
    UPDATE required_document_types SET applies_to = 'returning'
     WHERE code = 'form_138' AND applies_to = 'all'`);

  // --- Who is reviewing an application right now -----------------------------
  // Two staff opening the same application and deciding it at the same moment
  // is how one learner gets approved and rejected within a second of each
  // other. Opening an application claims it; the claim is refreshed while the
  // page is open and goes stale on its own, so a registrar who closes their
  // laptop does not hold an application forever.
  await step('application review claim', `
    ALTER TABLE enrollment_applications
      ADD COLUMN IF NOT EXISTS review_claimed_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS review_claimed_at TIMESTAMPTZ`);

  // --- When enrollment actually closed --------------------------------------
  // The closing date typed in School Settings is a plan. This is the record of
  // the day enrollment really stopped taking applications, whether it ran to
  // the end of its window, filled every slot, or was switched off early. It is
  // set the first time the system sees enrollment closed and cleared again if
  // it reopens, so "Closed on ..." is never a stale date from a year ago.
  await step('enrollment closed timestamp', `
    ALTER TABLE school_years
      ADD COLUMN IF NOT EXISTS enrollment_closed_at TIMESTAMPTZ`);

  // --- A teacher's daily teaching load -------------------------------------
  // A teacher handles three to eight periods a day: fewer is not a working
  // day, more than eight does not fit a teacher's load. Caps set under the
  // older rules (1-20, then 10-12) are moved into range before the CHECK goes
  // on, so an existing database is not left failing it.
  await step('teacher daily cap range', `
    ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_max_periods_per_day_check`);
  await step('teacher daily cap backfill', `
    UPDATE teachers
       SET max_periods_per_day = LEAST(GREATEST(COALESCE(max_periods_per_day, 8), 3), 8)
     WHERE max_periods_per_day IS NULL OR max_periods_per_day < 3 OR max_periods_per_day > 8`);
  await step('teacher daily cap default', `
    ALTER TABLE teachers ALTER COLUMN max_periods_per_day SET DEFAULT 8`);
  await step('teacher daily cap check', `
    ALTER TABLE teachers
      ADD CONSTRAINT teachers_max_periods_per_day_check
      CHECK (max_periods_per_day >= 3 AND max_periods_per_day <= 8)`);

  // --- Undoing a schedule hand-over -----------------------------------------
  // Deactivating a teacher means handing every class they still hold to
  // somebody else. Activating them again offers to hand those same classes
  // back, so one row is written per transfer: who gave, who received, and a
  // snapshot of each period exactly as it was when it moved (section, days,
  // times). The snapshot is what makes "only move back what nobody has
  // touched since" answerable at restore time. restored_at is set once the
  // hand-over has been undone and stops it being offered again.
  await step('teacher schedule transfers', `
    DO $$
    BEGIN
      IF to_regclass('public.teachers') IS NOT NULL THEN
        CREATE TABLE IF NOT EXISTS teacher_schedule_transfers (
          id              BIGSERIAL   PRIMARY KEY,
          from_teacher_id INTEGER     NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
          to_teacher_id   INTEGER     NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
          school_year_id  SMALLINT    NOT NULL REFERENCES school_years(id),
          entry_ids       BIGINT[]    NOT NULL DEFAULT '{}',
          subject_ids     INTEGER[]   NOT NULL DEFAULT '{}',
          entries         JSONB       NOT NULL DEFAULT '[]',
          created_by      BIGINT      REFERENCES users(id),
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          restored_at     TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_teacher_transfers_pending
          ON teacher_schedule_transfers (from_teacher_id, school_year_id)
          WHERE restored_at IS NULL;
      END IF;
    END $$`);
}

module.exports = { ensureSchema };
