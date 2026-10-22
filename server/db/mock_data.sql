-- ============================================================================
-- SecureEnroll -- CLEAR THE DATABASE AND LOAD PRESENTATION (MOCK) DATA
-- Caloocan City Elementary School
--
-- WARNING: this DELETES every user, learner, guardian, application, document,
-- teacher, section, subject, schedule and audit-log row, then loads demo data.
-- It keeps the structure and the settings that are not data: roles and
-- permissions, grade levels, the required-documents list and school hours.
-- Run it ONLY on the database you are happy to wipe.
--
-- HOW TO RUN (Neon: SQL Editor, paste the WHOLE file, press Run once)
--   1. Change the one line below, the ENCRYPTION_KEY, to EXACTLY the same value
--      as ENCRYPTION_KEY on Render. Learner names are not secret, but birth
--      dates, LRNs, phone numbers and addresses are encrypted with that key; if
--      the key here differs from the one the API uses, the app cannot read them.
--   2. Run the file. It is one statement, so it either finishes completely or
--      changes nothing.
--   3. Run the "WHAT WAS LOADED" query at the very bottom to see the summary.
--
-- MAIN ACCOUNTS (sign in at the site)
--   Admin@test.com       Admin123_        administrator
--   Registrar@test.com   Registrar123_    registrar
--   Parent@test.com      Parent123_       parent, with 3 children already enrolled
--   (every other parent in the data uses the password Parent123_)
--
-- LIVE DEMO OF "PUBLISH SCHEDULE"
--   1. Sign in as Parent@test.com > Schedule > Mateo (Grade 3) or Liana (Kinder):
--      "schedule has not been published yet".
--   2. Sign in as Registrar@test.com > Class Schedules > Grade 3 > Rosal > Publish schedule.
--   3. Refresh the parent's Schedule page: the weekly timetable appears.
-- ============================================================================

DO $mock$
DECLARE
  -- >>> CHANGE THIS to the ENCRYPTION_KEY you set on Render <<<
  enc_key text := 'PASTE_YOUR_ENCRYPTION_KEY_HERE';

  -- Passwords for the three main accounts.
  pw_admin     text := 'Admin123_';
  pw_registrar text := 'Registrar123_';
  pw_parent    text := 'Parent123_';

  r_parent smallint;  r_registrar smallint;  r_admin smallint;
  admin_id bigint;    registrar_id bigint;   demo_parent_id bigint;
  sy_prev smallint;   sy_now smallint;
  h_admin text;       h_registrar text;      h_parent text;

  -- Name pools (Filipino names), combined and shuffled deterministically.
  fem  text[] := ARRAY['Maria','Angelica','Sofia','Isabella','Gabriela','Kimberly','Princess','Jasmine','Nicole','Bianca',
                       'Camille','Daniela','Elaine','Francine','Hazel','Irish','Joanna','Kathleen','Lyka','Mariel',
                       'Nina','Patricia','Queenie','Rhea','Samantha','Trisha','Vanessa','Yvonne','Zoey','Alyssa',
                       'Bea','Clarisse','Danica','Erika','Faith','Giselle','Hannah','Ivy','Jenny','Kristine'];
  mal  text[] := ARRAY['Juan','Miguel','Gabriel','Rafael','Joshua','Mark','John','Christian','Daniel','Carlo',
                       'Adrian','Bryan','Cedric','Dominic','Emmanuel','Francis','Gerald','Harvey','Ian','Jerome',
                       'Kenneth','Lorenzo','Marco','Nathan','Oscar','Paolo','Quentin','Ryan','Sean','Tristan',
                       'Vincent','Xavier','Zachary','Andre','Benjamin','Carl','Dennis','Elijah','Felix','Gino'];
  lasts text[] := ARRAY['Santos','Reyes','Cruz','Bautista','Ocampo','Garcia','Mendoza','Torres','Tomas','Andrada',
                        'Castillo','Flores','Villanueva','Ramos','Aquino','Dela Cruz','Navarro','Salazar','Gonzales','Lopez',
                        'Fernandez','Rivera','Domingo','Aguilar','Manalo','Pascual','Soriano','Valdez','Del Rosario','Hernandez',
                        'Castro','Rosales','Padilla','Magsaysay','Alvarez','De Guzman','Mercado','Pangilinan','Evangelista','Dizon',
                        'Cabrera','Lim','Tan','Sy','Uy','Robles','Macaraeg','Panganiban','Sarmiento','Velasco',
                        'Enriquez','Zamora','Bernardo','Tolentino','Guevarra','Abad','Camacho','Estrada','Francisco','Soliman'];
  g_fem text[] := ARRAY['Rosario','Corazon','Teresita','Lourdes','Remedios','Josefina','Marilou','Cecilia','Evelyn','Gloria',
                        'Rowena','Imelda','Liza','Norma','Divina','Arlene','Sheila','Jocelyn','Rhodora','Fe'];
  g_mal text[] := ARRAY['Ricardo','Eduardo','Alfredo','Rolando','Danilo','Reynaldo','Romeo','Arnel','Benito','Cesar',
                        'Dante','Edgardo','Felipe','Generoso','Hernani','Isidro','Jaime','Leandro','Manuel','Nestor'];
  streets text[] := ARRAY['Rizal Avenue Extension','Samson Road','Zapote Street','Bagong Silang Road','Libis Street',
                          'Congress Road','Dagat-Dagatan Avenue','Gen. Luis Street','Maligaya Drive','Camarin Road'];
  id_types text[] := ARRAY['UMID','PhilID','Drivers License','Passport','Voters ID','SSS ID'];
  nl int := 60;

  -- The class day: periods start at these times (the first 4 are the morning
  -- session, the last 4 the afternoon session).
  slot_start time[] := ARRAY['07:00','08:00','09:20','10:20','13:00','14:00','15:20','16:20']::time[];
  slot_end   time[] := ARRAY['08:00','09:00','10:20','11:20','14:00','15:00','16:20','17:20']::time[];

  v_g int; v_p int; v_fam int; sec_id int; subj_id int; teach_id int; n_periods int;
  kid1 bigint; kid2 bigint; kid3 bigint;
  app_id bigint;
BEGIN
  IF enc_key IS NULL OR btrim(enc_key) = '' OR enc_key LIKE 'PASTE_%' THEN
    RAISE EXCEPTION 'Edit the first line of this script: set enc_key to the ENCRYPTION_KEY from Render, then run it again.';
  END IF;

  -- The "publish schedule" columns. The API adds them on startup, but this makes
  -- the script work even if it is run before the new API version has started.
  ALTER TABLE sections
    ADD COLUMN IF NOT EXISTS schedule_published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS schedule_published_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

  -- ==========================================================================
  -- 1. CLEAR ALL DATA (structure, roles, permissions, grade levels, required
  --    documents and school hours stay).
  -- ==========================================================================
  TRUNCATE TABLE
    audit_logs, auth_tokens, masterlist_emails, teacher_schedule_transfers,
    documents, enrollment_applications, student_guardians, students, guardians,
    schedule_entries, teacher_subjects, subjects, sections, teachers,
    school_years, users
  RESTART IDENTITY CASCADE;

  SELECT id INTO r_parent    FROM roles WHERE name = 'parent';
  SELECT id INTO r_registrar FROM roles WHERE name = 'registrar';
  SELECT id INTO r_admin     FROM roles WHERE name = 'admin';
  IF r_parent IS NULL OR r_registrar IS NULL OR r_admin IS NULL THEN
    RAISE EXCEPTION 'The roles table is empty. Run db/schema.sql first.';
  END IF;

  -- Elementary grade levels hold up to 10 subjects here; the demo uses 8 (Kinder 6).
  UPDATE grade_levels SET max_subjects = 10;

  -- bcrypt hashes, cost 12 (the same cost the API uses). One hash is reused for
  -- every generated parent so loading ~250 parents stays fast.
  h_admin     := crypt(pw_admin,     gen_salt('bf', 12));
  h_registrar := crypt(pw_registrar, gen_salt('bf', 12));
  h_parent    := crypt(pw_parent,    gen_salt('bf', 12));

  -- ==========================================================================
  -- 2. THE THREE MAIN ACCOUNTS (emails are stored lowercase; sign-in is not
  --    case sensitive, so "Admin@test.com" works)
  -- ==========================================================================
  INSERT INTO users (email, password_hash, role_id, is_active, email_verified_at, full_name, first_name, last_name, must_change_password)
  VALUES ('admin@test.com', h_admin, r_admin, TRUE, now(), 'System Administrator', 'System', 'Administrator', FALSE)
  RETURNING id INTO admin_id;

  INSERT INTO users (email, password_hash, role_id, is_active, email_verified_at, full_name, first_name, last_name, middle_initial, must_change_password)
  VALUES ('registrar@test.com', h_registrar, r_registrar, TRUE, now(), 'Elena M. Marquez', 'Elena', 'Marquez', 'M', FALSE)
  RETURNING id INTO registrar_id;

  INSERT INTO users (email, password_hash, role_id, is_active, email_verified_at, full_name, first_name, last_name, must_change_password)
  VALUES ('parent@test.com', h_parent, r_parent, TRUE, now(), 'Maria Dela Cruz', 'Maria', 'Dela Cruz', FALSE)
  RETURNING id INTO demo_parent_id;

  INSERT INTO guardians (user_id, first_name, middle_name, last_name, contact_number, address, valid_id_type)
  VALUES (demo_parent_id, 'Maria', 'Santos', 'Dela Cruz', pgp_sym_encrypt('09171234567', enc_key),
          pgp_sym_encrypt('Blk 12 Lot 5 Samson Road, Brgy. 176, Caloocan City', enc_key), 'PhilID');

  -- ==========================================================================
  -- 3. SCHOOL YEARS: last year (finished) and this year (enrollment open)
  --    The window below is wide on purpose so enrollment is open on the day
  --    of the presentation. Adjust it in Admin > School Settings if needed.
  -- ==========================================================================
  INSERT INTO school_years (label, opens_at, closes_at, is_active, auto_email_lists, enrollment_open, dates_confirmed, classes_start_on, enrollment_closed_at)
  VALUES ('2025-2026', timestamptz '2025-04-01 00:00+08', timestamptz '2026-03-31 23:59+08', FALSE, FALSE, FALSE, TRUE,
          date '2025-06-16', timestamptz '2025-06-13 17:00+08')
  RETURNING id INTO sy_prev;

  -- auto_email_lists is OFF so the demo never tries to email a master list.
  INSERT INTO school_years (label, opens_at, closes_at, is_active, auto_email_lists, enrollment_open, dates_confirmed, classes_start_on)
  VALUES ('2026-2027', timestamptz '2026-04-01 00:00+08', timestamptz '2027-03-31 23:59+08', TRUE, FALSE, TRUE, TRUE, NULL)
  RETURNING id INTO sy_now;

  -- ==========================================================================
  -- 4. SECTIONS: two per grade level, 20 slots each.
  --    Sampaguita = fully occupied (20/20), Rosal = still has slots.
  -- ==========================================================================
  INSERT INTO sections (name, grade_level_id, school_year_id, capacity)
  SELECT s.name, gl.id, sy_now, 20
  FROM grade_levels gl CROSS JOIN (VALUES ('Sampaguita'), ('Rosal')) AS s(name)
  ORDER BY gl.sort_order, s.name DESC;

  -- ==========================================================================
  -- 5. SUBJECTS (this school year). Kinder uses six learning domains. Grades
  --    1-6 each have 8 subjects; the 8 "families" below line up with the 8
  --    teachers who teach them (see section 6).
  -- ==========================================================================
  CREATE TEMP TABLE mock_fam (grade_sort int, fam int, name text) ON COMMIT DROP;
  INSERT INTO mock_fam (grade_sort, fam, name)
  SELECT gs.g, f.fam,
         CASE f.fam
           WHEN 1 THEN 'Filipino'
           WHEN 2 THEN 'English'
           WHEN 3 THEN 'Mathematics'
           WHEN 4 THEN CASE WHEN gs.g <= 2 THEN 'Reading Enrichment' ELSE 'Science' END
           WHEN 5 THEN 'Araling Panlipunan'
           WHEN 6 THEN 'MAPEH'
           WHEN 7 THEN 'Edukasyon sa Pagpapakatao'
           WHEN 8 THEN CASE WHEN gs.g <= 3 THEN 'Mother Tongue' ELSE 'EPP' END
         END
  FROM generate_series(1, 6) AS gs(g) CROSS JOIN generate_series(1, 8) AS f(fam);

  INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
  SELECT d.name, gl.id, sy_now, TRUE
  FROM grade_levels gl,
       (VALUES (1, 'Language, Literacy and Communication'), (2, 'Mathematics'),
               (3, 'Understanding the Physical and Natural Environment'), (4, 'Socio-Emotional Development'),
               (5, 'Physical Health and Motor Development'), (6, 'Creative Arts')) AS d(n, name)
  WHERE gl.sort_order = 0
  ORDER BY d.n;

  INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
  SELECT f.name, gl.id, sy_now, FALSE
  FROM mock_fam f JOIN grade_levels gl ON gl.sort_order = f.grade_sort
  ORDER BY f.grade_sort, f.fam;

  -- ==========================================================================
  -- 6. TEACHERS: 10 profiles covering every grade level.
  --      T1, T2  Kinder (all six learning domains)
  --      T3..T10 Grades 1-6, one subject each (Filipino, English, Mathematics,
  --              Science / Reading, Araling Panlipunan, MAPEH, EsP, Mother
  --              Tongue / EPP) -- so each subject has exactly one teacher and
  --              a teacher is never in two classrooms at once.
  -- ==========================================================================
  INSERT INTO teachers (first_name, middle_name, last_name, email, contact_number, degree, major, date_hired,
                        is_active, status, sex, prc_license_number, address, max_periods_per_day, created_by)
  SELECT t.first_name, t.middle_name, t.last_name, t.email, pgp_sym_encrypt(t.phone, enc_key), t.degree, t.major, t.hired,
         TRUE, 'active', t.sex, t.prc, pgp_sym_encrypt(t.addr, enc_key), 10, admin_id
  FROM (VALUES
    (1,  'Maria Cristina', 'Lopez',   'Reyes',      'maria.reyes@caloocan-es.example',      '09181110001', 'BEEd', 'Generalist',        date '2012-06-04', 'female', '1000001', 'Blk 4 Lot 2 Libis Street, Brgy. 28, Caloocan City'),
    (2,  'Jocelyn',        'Ramos',   'Santos',     'jocelyn.santos@caloocan-es.example',   '09181110002', 'BEEd', 'Generalist',        date '2014-06-02', 'female', '1000002', 'Blk 9 Lot 7 Congress Road, Brgy. 171, Caloocan City'),
    (3,  'Angelica',       'Cruz',    'Dela Cruz',  'angelica.delacruz@caloocan-es.example','09181110003', 'BSEd', 'Filipino',          date '2015-06-01', 'female', '1000003', 'Blk 2 Lot 11 Zapote Street, Brgy. 12, Caloocan City'),
    (4,  'Roberto',        'Aquino',  'Garcia',     'roberto.garcia@caloocan-es.example',   '09181110004', 'BSEd', 'English',           date '2013-06-03', 'male',   '1000004', 'Blk 6 Lot 3 Samson Road, Brgy. 176, Caloocan City'),
    (5,  'Ernesto',        'Valdez',  'Mendoza',    'ernesto.mendoza@caloocan-es.example',  '09181110005', 'BSEd', 'Mathematics',       date '2011-06-06', 'male',   '1000005', 'Blk 1 Lot 9 Rizal Avenue Extension, Brgy. 28, Caloocan City'),
    (6,  'Lourdes',        'Pascual', 'Bautista',   'lourdes.bautista@caloocan-es.example', '09181110006', 'BSEd', 'Science',           date '2016-06-06', 'female', '1000006', 'Blk 8 Lot 4 Maligaya Drive, Brgy. 171, Caloocan City'),
    (7,  'Ramon',          'Torres',  'Villanueva', 'ramon.villanueva@caloocan-es.example', '09181110007', 'BSEd', 'Social Studies',    date '2010-06-07', 'male',   '1000007', 'Blk 3 Lot 6 Camarin Road, Brgy. 176, Caloocan City'),
    (8,  'Grace',          'Flores',  'Aquino',     'grace.aquino@caloocan-es.example',     '09181110008', 'BSEd', 'MAPEH',             date '2017-06-05', 'female', '1000008', 'Blk 5 Lot 8 Gen. Luis Street, Brgy. 12, Caloocan City'),
    (9,  'Teresita',       'Castro',  'Ramos',      'teresita.ramos@caloocan-es.example',   '09181110009', 'BSEd', 'Values Education',  date '2009-06-01', 'female', '1000009', 'Blk 7 Lot 1 Bagong Silang Road, Brgy. 171, Caloocan City'),
    (10, 'Antonio',        'Salazar', 'Cruz',       'antonio.cruz@caloocan-es.example',     '09181110010', 'BTLEd','Home Economics',    date '2018-06-04', 'male',   '1000010', 'Blk 10 Lot 12 Dagat-Dagatan Avenue, Brgy. 28, Caloocan City')
  ) AS t(no, first_name, middle_name, last_name, email, phone, degree, major, hired, sex, prc, addr)
  ORDER BY t.no;
  -- (identity was restarted above, so the teachers are now ids 1..10 in this order)

  -- Kinder teachers: all six learning domains.
  INSERT INTO teacher_subjects (teacher_id, subject_id)
  SELECT t.id, s.id FROM teachers t, subjects s, grade_levels gl
  WHERE t.id IN (1, 2) AND s.grade_level_id = gl.id AND gl.sort_order = 0 AND s.school_year_id = sy_now;

  -- Grades 1-6: teacher 2 + family number, for each subject of that family.
  INSERT INTO teacher_subjects (teacher_id, subject_id)
  SELECT 2 + f.fam, s.id
  FROM mock_fam f
  JOIN grade_levels gl ON gl.sort_order = f.grade_sort
  JOIN subjects s ON s.grade_level_id = gl.id AND s.school_year_id = sy_now AND s.name = f.name;

  -- Advisers (one section each): Kinder Sampaguita -> T1, Kinder Rosal -> T2,
  -- Grades 1-6 Sampaguita -> T3..T8, Grade 1 Rosal -> T9, Grade 2 Rosal -> T10.
  UPDATE sections s SET adviser_teacher_id = a.teacher_id
  FROM (
    SELECT gl.id AS grade_id, x.name AS section_name, x.teacher_id
    FROM (VALUES (0,'Sampaguita',1),(0,'Rosal',2),(1,'Sampaguita',3),(2,'Sampaguita',4),(3,'Sampaguita',5),
                 (4,'Sampaguita',6),(5,'Sampaguita',7),(6,'Sampaguita',8),(1,'Rosal',9),(2,'Rosal',10)) AS x(sort, name, teacher_id)
    JOIN grade_levels gl ON gl.sort_order = x.sort
  ) a
  WHERE s.grade_level_id = a.grade_id AND s.name = a.section_name AND s.school_year_id = sy_now;

  -- ==========================================================================
  -- 7. LEARNERS AND PARENTS
  --    Per grade level: 20 enrolled in Sampaguita (full), 10 enrolled in Rosal,
  --    then 4 applications waiting (1 submitted, 1 under review, 1 needs
  --    revision, 1 rejected). Plus 12 returning learners who finished last
  --    year and are not enrolled for this year yet (use them for walk-in).
  -- ==========================================================================
  CREATE TEMP TABLE mock_spec ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY q.g, q.kind, q.seq)::int AS rn, q.g AS grade_sort, q.kind, q.seq
  FROM (
    SELECT g, 'S' AS kind, s AS seq FROM generate_series(0, 6) g, generate_series(1, 20) s
    UNION ALL SELECT g, 'R', s FROM generate_series(0, 6) g, generate_series(1, 10) s
    UNION ALL SELECT g, 'P', 1 FROM generate_series(0, 6) g
    UNION ALL SELECT g, 'U', 1 FROM generate_series(0, 6) g
    UNION ALL SELECT g, 'N', 1 FROM generate_series(0, 6) g
    UNION ALL SELECT g, 'X', 1 FROM generate_series(0, 6) g
    UNION ALL SELECT g, 'H', s FROM generate_series(0, 5) g, generate_series(1, 2) s
  ) q;

  CREATE TEMP TABLE mock_pool ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY md5(f.name || '|' || l.name))::int AS rn, f.name AS first_name, f.sex, l.name AS last_name
  FROM (SELECT unnest(fem) AS name, 'F'::text AS sex UNION ALL SELECT unnest(mal), 'M') f
  CROSS JOIN (SELECT unnest(lasts) AS name) l;

  CREATE TEMP TABLE mock_students ON COMMIT DROP AS
  SELECT s.rn, s.grade_sort, s.kind, s.seq,
         p.first_name, p.sex, p.last_name,
         CASE WHEN p.rn % 5 = 0 OR lasts[((p.rn * 7) % nl) + 1] = p.last_name THEN NULL
              ELSE lasts[((p.rn * 7) % nl) + 1] END AS middle_name,
         -- Kinder learners still waiting for a decision have no LRN yet (they show up under "Missing LRN").
         CASE WHEN s.grade_sort = 0 AND s.kind IN ('P', 'U') THEN NULL
              ELSE '1070' || lpad((100000 + s.rn)::text, 8, '0') END AS lrn,
         make_date(2026 - 5 - s.grade_sort - (s.rn % 2), 1 + (s.rn * 7) % 12, 1 + (s.rn * 11) % 28) AS birth_date,
         (p.rn % 3 <> 0) AS guardian_female,
         CASE WHEN s.kind = 'H' THEN 'secureenroll.demo.parent' || lpad(s.rn::text, 3, '0') || '@gmail.com'
              ELSE 'parent' || lpad(s.rn::text, 4, '0') || '@example.com' END AS guardian_email
  FROM mock_spec s JOIN mock_pool p ON p.rn = s.rn;

  -- Parent accounts (one per learner, password Parent123_).
  INSERT INTO users (email, password_hash, role_id, is_active, email_verified_at, full_name, first_name, last_name, must_change_password)
  SELECT m.guardian_email, h_parent, r_parent, TRUE, now(),
         CASE WHEN m.guardian_female THEN g_fem[(m.rn % 20) + 1] ELSE g_mal[(m.rn % 20) + 1] END || ' ' || m.last_name,
         CASE WHEN m.guardian_female THEN g_fem[(m.rn % 20) + 1] ELSE g_mal[(m.rn % 20) + 1] END,
         m.last_name, FALSE
  FROM mock_students m ORDER BY m.rn;

  INSERT INTO guardians (user_id, first_name, middle_name, last_name, contact_number, address, valid_id_type)
  SELECT u.id,
         CASE WHEN m.guardian_female THEN g_fem[(m.rn % 20) + 1] ELSE g_mal[(m.rn % 20) + 1] END,
         NULL, m.last_name,
         pgp_sym_encrypt('09' || lpad(((m.rn * 7919) % 1000000000)::text, 9, '0'), enc_key),
         pgp_sym_encrypt('Blk ' || ((m.rn % 40) + 1) || ' Lot ' || ((m.rn % 25) + 1) || ' ' || streets[(m.rn % 10) + 1]
                         || ', Brgy. ' || (ARRAY['12','28','171','176'])[(m.rn % 4) + 1] || ', Caloocan City', enc_key),
         id_types[(m.rn % 6) + 1]
  FROM mock_students m JOIN users u ON u.email = m.guardian_email;

  -- Learners. Their ids are set to rn so the rows can be joined back easily.
  INSERT INTO students (id, lrn_encrypted, lrn_hash, first_name, middle_name, last_name, birth_date, sex)
  SELECT m.rn,
         CASE WHEN m.lrn IS NULL THEN NULL ELSE pgp_sym_encrypt(m.lrn, enc_key) END,
         CASE WHEN m.lrn IS NULL THEN NULL ELSE encode(digest(m.lrn, 'sha256'), 'hex') END,
         m.first_name, m.middle_name, m.last_name,
         pgp_sym_encrypt(m.birth_date::text, enc_key), m.sex
  FROM mock_students m ORDER BY m.rn;
  PERFORM setval(pg_get_serial_sequence('students', 'id'), (SELECT max(id) FROM students));

  INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary)
  SELECT m.rn, u.id,
         CASE WHEN m.guardian_female THEN (CASE WHEN m.rn % 11 = 0 THEN 'Grandmother' ELSE 'Mother' END)
              ELSE (CASE WHEN m.rn % 13 = 0 THEN 'Uncle' ELSE 'Father' END) END,
         TRUE
  FROM mock_students m JOIN users u ON u.email = m.guardian_email;

  -- ==========================================================================
  -- 8. THE PARENT@TEST.COM DEMO FAMILY (3 children on the main parent account)
  -- ==========================================================================
  INSERT INTO students (lrn_encrypted, lrn_hash, first_name, middle_name, last_name, birth_date, sex)
  VALUES (pgp_sym_encrypt('107099900001', enc_key), encode(digest('107099900001', 'sha256'), 'hex'),
          'Liana', 'Santos', 'Dela Cruz', pgp_sym_encrypt('2021-03-14', enc_key), 'F')
  RETURNING id INTO kid1;
  INSERT INTO students (lrn_encrypted, lrn_hash, first_name, middle_name, last_name, birth_date, sex)
  VALUES (pgp_sym_encrypt('107099900003', enc_key), encode(digest('107099900003', 'sha256'), 'hex'),
          'Mateo', 'Santos', 'Dela Cruz', pgp_sym_encrypt('2018-08-02', enc_key), 'M')
  RETURNING id INTO kid2;
  INSERT INTO students (lrn_encrypted, lrn_hash, first_name, middle_name, last_name, birth_date, sex)
  VALUES (pgp_sym_encrypt('107099900005', enc_key), encode(digest('107099900005', 'sha256'), 'hex'),
          'Cassandra', 'Santos', 'Dela Cruz', pgp_sym_encrypt('2016-11-20', enc_key), 'F')
  RETURNING id INTO kid3;
  INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary)
  VALUES (kid1, demo_parent_id, 'Mother', TRUE), (kid2, demo_parent_id, 'Mother', TRUE), (kid3, demo_parent_id, 'Mother', TRUE);

  -- ==========================================================================
  -- 9. APPLICATIONS FOR THIS SCHOOL YEAR
  -- ==========================================================================
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at,
     reviewed_by, reviewed_at, remarks, grade_qualification)
  SELECT m.rn, sy_now, gl.id,
         CASE WHEN m.kind IN ('S', 'R') THEN sec.id END,
         CASE m.kind WHEN 'S' THEN 'approved' WHEN 'R' THEN 'approved' WHEN 'P' THEN 'submitted'
                     WHEN 'U' THEN 'under_review' WHEN 'N' THEN 'needs_revision' WHEN 'X' THEN 'rejected' END,
         u.id,
         now() - (((m.rn * 13) % 70) || ' days')::interval - (((m.rn * 37) % 600) || ' minutes')::interval,
         CASE WHEN m.kind IN ('S', 'R', 'N', 'X') THEN registrar_id END,
         CASE WHEN m.kind IN ('S', 'R', 'N', 'X')
              THEN now() - (((m.rn * 13) % 70) || ' days')::interval + interval '2 days' END,
         CASE m.kind
           WHEN 'N' THEN 'The photo of the birth certificate is blurry. Please upload a clearer, full-page copy.'
           WHEN 'X' THEN 'The parent or guardian ID submitted is expired and a valid one was not provided in time.'
         END,
         CASE WHEN m.grade_sort > 0 THEN 'met' END
  FROM mock_students m
  JOIN users u ON u.email = m.guardian_email
  JOIN grade_levels gl ON gl.sort_order = m.grade_sort
  LEFT JOIN sections sec ON sec.school_year_id = sy_now AND sec.grade_level_id = gl.id
       AND sec.name = CASE m.kind WHEN 'S' THEN 'Sampaguita' WHEN 'R' THEN 'Rosal' END
  WHERE m.kind IN ('S', 'R', 'P', 'U', 'N', 'X');

  -- Parent@test.com's children: Kinder and Grade 3 approved (Rosal), Grade 5 sent back for correction.
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, remarks, grade_qualification)
  SELECT kid1, sy_now, gl.id, sec.id, 'approved', demo_parent_id, now() - interval '20 days', registrar_id, now() - interval '18 days', NULL, NULL
  FROM grade_levels gl JOIN sections sec ON sec.grade_level_id = gl.id AND sec.school_year_id = sy_now AND sec.name = 'Rosal'
  WHERE gl.sort_order = 0;
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, remarks, grade_qualification)
  SELECT kid2, sy_now, gl.id, sec.id, 'approved', demo_parent_id, now() - interval '19 days', registrar_id, now() - interval '17 days', NULL, 'met'
  FROM grade_levels gl JOIN sections sec ON sec.grade_level_id = gl.id AND sec.school_year_id = sy_now AND sec.name = 'Rosal'
  WHERE gl.sort_order = 3;
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, remarks, grade_qualification)
  SELECT kid3, sy_now, gl.id, NULL, 'needs_revision', demo_parent_id, now() - interval '5 days', registrar_id, now() - interval '3 days',
         'The report card (Form 138) is cut off at the bottom. Please upload the complete page.', 'met'
  FROM grade_levels gl WHERE gl.sort_order = 5;

  -- Last year's enrollment (approved) for returning learners: everyone above
  -- Kinder was in the grade below last year, and the 12 "H" learners finished
  -- last year but are NOT enrolled this year yet.
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, grade_qualification)
  SELECT m.rn, sy_prev, gl.id, NULL, 'approved', u.id,
         timestamptz '2025-04-10 09:00+08' + ((m.rn % 40) || ' days')::interval,
         registrar_id, timestamptz '2025-04-12 09:00+08' + ((m.rn % 40) || ' days')::interval,
         CASE WHEN gl.sort_order > 0 THEN 'met' END
  FROM mock_students m
  JOIN users u ON u.email = m.guardian_email
  JOIN grade_levels gl ON gl.sort_order = CASE WHEN m.kind = 'H' THEN m.grade_sort ELSE m.grade_sort - 1 END
  WHERE (m.kind IN ('S', 'R') AND m.grade_sort >= 1) OR m.kind = 'H';
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, grade_qualification)
  SELECT kid2, sy_prev, gl.id, NULL, 'approved', demo_parent_id, timestamptz '2025-04-20 09:00+08', registrar_id, timestamptz '2025-04-22 09:00+08', 'met'
  FROM grade_levels gl WHERE gl.sort_order = 2;
  INSERT INTO enrollment_applications
    (student_id, school_year_id, grade_level_id, section_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, grade_qualification)
  SELECT kid3, sy_prev, gl.id, NULL, 'approved', demo_parent_id, timestamptz '2025-04-21 09:00+08', registrar_id, timestamptz '2025-04-23 09:00+08', 'met'
  FROM grade_levels gl WHERE gl.sort_order = 4;

  -- ==========================================================================
  -- 10. DOCUMENTS for this year's applications, from the school's required-
  --     documents list (everyone: birth certificate + parent ID; learners
  --     above Kinder are "returning" and also bring the report card). They are
  --     recorded as received at the school office (paper copies).
  -- ==========================================================================
  INSERT INTO documents (application_id, doc_type, status, is_physical, received_in_person, verified_by, verified_at, review_note)
  SELECT a.id, d.code,
         CASE
           WHEN a.status = 'approved' THEN 'verified'
           WHEN a.status = 'under_review' AND d.code = 'birth_certificate' THEN 'verified'
           WHEN a.status = 'needs_revision' AND d.code IN ('birth_certificate', 'form_138') THEN 'flagged'
           WHEN a.status = 'rejected' AND d.code = 'parent_valid_id' THEN 'rejected'
           ELSE 'pending' END,
         TRUE, TRUE,
         CASE WHEN a.status IN ('approved', 'under_review', 'needs_revision', 'rejected') THEN registrar_id END,
         CASE WHEN a.status IN ('approved', 'under_review', 'needs_revision', 'rejected') THEN COALESCE(a.reviewed_at, now()) END,
         CASE
           WHEN a.status = 'needs_revision' AND d.code IN ('birth_certificate', 'form_138')
             THEN 'The copy is blurry or cut off. Please upload a clear, complete page.'
           WHEN a.status = 'rejected' AND d.code = 'parent_valid_id'
             THEN 'The ID is expired. A valid, unexpired ID is required.'
         END
  FROM enrollment_applications a
  JOIN grade_levels gl ON gl.id = a.grade_level_id
  JOIN required_document_types d
    ON d.is_required AND (d.applies_to = 'all' OR (d.applies_to = 'returning' AND gl.sort_order >= 1))
  WHERE a.school_year_id = sy_now
    -- a Kinder "needs revision" is flagged on the birth certificate only
    AND NOT (a.status = 'needs_revision' AND gl.sort_order > 0 AND d.code = 'birth_certificate');

  -- ==========================================================================
  -- 11. CLASS SCHEDULES for the seven Sampaguita sections (Monday to Friday).
  --     Rosal sections have no timetable (except Kinder and Grade 3, see below) so one can be built
  --     live. Each grade has its own room (Kinder = Room 101 ... Grade 6 = 107).
  -- ==========================================================================
  FOR v_g IN 0..6 LOOP
    SELECT s.id INTO sec_id
    FROM sections s JOIN grade_levels gl ON gl.id = s.grade_level_id
    WHERE gl.sort_order = v_g AND s.school_year_id = sy_now AND s.name = 'Sampaguita';

    n_periods := CASE WHEN v_g = 0 THEN 6 ELSE 8 END;
    FOR v_p IN 1..n_periods LOOP
      IF v_g = 0 THEN
        teach_id := 1;
        SELECT s.id INTO subj_id FROM subjects s JOIN grade_levels gl ON gl.id = s.grade_level_id
        WHERE gl.sort_order = 0 AND s.school_year_id = sy_now ORDER BY s.id OFFSET (v_p - 1) LIMIT 1;
      ELSE
        -- Grades are staggered so that at any hour each of the six grades is
        -- on a different subject, hence a different teacher.
        v_fam := ((v_p - 1 + v_g) % 8) + 1;
        teach_id := 2 + v_fam;
        SELECT s.id INTO subj_id
        FROM mock_fam f JOIN grade_levels gl ON gl.sort_order = f.grade_sort
        JOIN subjects s ON s.grade_level_id = gl.id AND s.school_year_id = sy_now AND s.name = f.name
        WHERE f.grade_sort = v_g AND f.fam = v_fam;
      END IF;

      INSERT INTO schedule_entries
        (section_id, subject_id, teacher_id, session, days, start_time, end_time, room, role_type, school_year_id, created_by)
      VALUES
        (sec_id, subj_id, teach_id,
         CASE WHEN slot_start[v_p] < time '12:00' THEN 'morning' ELSE 'afternoon' END,
         ARRAY[1,2,3,4,5]::smallint[], slot_start[v_p], slot_end[v_p], 'Room 10' || (v_g + 1), 'subject', sy_now, admin_id);
    END LOOP;
  END LOOP;

  -- Two Rosal sections get a finished timetable but are NOT published: Kinder
  -- and Grade 3, where Parent@test.com's children are placed. For the demo,
  -- sign in as that parent (the schedule says "not published yet"), then publish
  -- it as the registrar and refresh the parent's page.
  FOR v_g IN SELECT unnest(ARRAY[0, 3]) LOOP
    SELECT s.id INTO sec_id
    FROM sections s JOIN grade_levels gl ON gl.id = s.grade_level_id
    WHERE gl.sort_order = v_g AND s.school_year_id = sy_now AND s.name = 'Rosal';

    n_periods := CASE WHEN v_g = 0 THEN 6 ELSE 8 END;
    FOR v_p IN 1..n_periods LOOP
      IF v_g = 0 THEN
        teach_id := 2;
        SELECT s.id INTO subj_id FROM subjects s JOIN grade_levels gl ON gl.id = s.grade_level_id
        WHERE gl.sort_order = 0 AND s.school_year_id = sy_now ORDER BY s.id OFFSET (v_p - 1) LIMIT 1;
      ELSE
        -- Offset 7 is the one that no Sampaguita grade (1-6) uses, so no teacher
        -- is ever in two classrooms at once.
        v_fam := ((v_p - 1 + 7) % 8) + 1;
        teach_id := 2 + v_fam;
        SELECT s.id INTO subj_id
        FROM mock_fam f JOIN grade_levels gl ON gl.sort_order = f.grade_sort
        JOIN subjects s ON s.grade_level_id = gl.id AND s.school_year_id = sy_now AND s.name = f.name
        WHERE f.grade_sort = v_g AND f.fam = v_fam;
      END IF;

      INSERT INTO schedule_entries
        (section_id, subject_id, teacher_id, session, days, start_time, end_time, room, role_type, school_year_id, created_by)
      VALUES
        (sec_id, subj_id, teach_id,
         CASE WHEN slot_start[v_p] < time '12:00' THEN 'morning' ELSE 'afternoon' END,
         ARRAY[1,2,3,4,5]::smallint[], slot_start[v_p], slot_end[v_p], 'Room 20' || (v_g + 1), 'subject', sy_now, admin_id);
    END LOOP;
  END LOOP;

  -- Publish the Sampaguita timetables so parents can see them. The Rosal
  -- sections stay UNPUBLISHED.
  UPDATE sections SET schedule_published_at = now(), schedule_published_by = registrar_id
  WHERE school_year_id = sy_now AND name = 'Sampaguita';

  -- ==========================================================================
  -- 12. A SAMPLE AUDIT TRAIL (so the Audit Log page is not empty at the start)
  -- ==========================================================================
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, details, created_at)
  SELECT registrar_id, 'APPLICATION_APPROVED', 'enrollment_application', a.id,
         ('203.0.113.' || (10 + a.id % 40))::inet, 'Mozilla/5.0 (demo data)', jsonb_build_object('demo', TRUE), a.reviewed_at
  FROM enrollment_applications a
  WHERE a.school_year_id = sy_now AND a.status = 'approved';
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, details, created_at)
  SELECT u.id, 'LOGIN_SUCCESS', NULL, NULL, '203.0.113.5'::inet, 'Mozilla/5.0 (demo data)', jsonb_build_object('demo', TRUE), now() - (k || ' hours')::interval
  FROM users u, generate_series(1, 3) k WHERE u.id IN (admin_id, registrar_id);

  RAISE NOTICE 'Demo data loaded. Sign in with Admin@test.com / Admin123_, Registrar@test.com / Registrar123_, Parent@test.com / Parent123_.';
END
$mock$;


-- ============================================================================
-- WHAT WAS LOADED  (run this separately, after the script above)
-- ============================================================================
-- 1) Sections: Sampaguita should read 20/20 and Rosal less than 20.
SELECT gl.name AS grade, sec.name AS section, sec.capacity,
       COUNT(ea.id) FILTER (WHERE ea.status = 'approved') AS enrolled,
       sec.capacity - COUNT(ea.id) FILTER (WHERE ea.status = 'approved') AS slots_left,
       t.first_name || ' ' || t.last_name AS adviser
FROM sections sec
JOIN grade_levels gl ON gl.id = sec.grade_level_id
LEFT JOIN enrollment_applications ea ON ea.section_id = sec.id
LEFT JOIN teachers t ON t.id = sec.adviser_teacher_id
GROUP BY gl.sort_order, gl.name, sec.id, sec.name, sec.capacity, t.first_name, t.last_name
ORDER BY gl.sort_order, sec.name DESC;
