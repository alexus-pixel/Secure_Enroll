-- =====================================================================
-- Mock teachers for every grade level (Kinder to Grade 6)
-- ---------------------------------------------------------------------
-- What it does, for the ACTIVE school year:
--   1. Creates the subjects each grade level studies (Kinder uses the
--      learning domains; Grades 1-6 use the elementary subjects).
--      Subjects that already exist are left alone.
--   2. Creates 3-4 mock teachers per grade level (27 in total).
--      All names are made up. No email address is set.
--   3. Links each teacher to the subjects they handle (teacher_subjects),
--      so they show up in the admin "Assign teachers" and schedule screens.
--   4. Prints a summary of teachers per grade level with their subjects.
--
-- Safe to run more than once: nothing is duplicated.
--
-- About the email:
--   teachers.email was created as NOT NULL, so a teacher cannot be saved
--   without one. The first statement below makes the column optional
--   (a no-op if it already is). UNIQUE still applies to real addresses;
--   Postgres allows any number of NULLs. Teachers with no email are
--   skipped by the automatic master-list emails and show
--   "No email address on file" in the admin screens. Add one from
--   Admin > Teachers > Edit when you want them to receive emails.
--
-- Run:  psql "$DATABASE_URL" -f server/db/seed_teachers_by_grade.sql
--       (or paste the whole file into the Neon SQL editor)
-- =====================================================================

ALTER TABLE teachers ALTER COLUMN email DROP NOT NULL;

DO $$
DECLARE
  yr   smallint;
  rec  record;
  tid  integer;
BEGIN
  SELECT id INTO yr FROM school_years WHERE is_active = TRUE ORDER BY id LIMIT 1;
  IF yr IS NULL THEN
    RAISE EXCEPTION 'No active school year found. Set one in Admin > System Settings first.';
  END IF;

  -- 1. Subjects per grade level -----------------------------------------
  INSERT INTO subjects (name, grade_level_id, school_year_id, is_domain)
  SELECT s.subject, g.id, yr, (g.name = 'Kinder')
  FROM grade_levels g
  JOIN (VALUES
    ('Kinder', ARRAY[
      'Language, Literacy and Communication', 'Mathematics',
      'Understanding the Physical and Natural Environment',
      'Socio-Emotional Development', 'Values Development',
      'Physical Health and Motor Development', 'Creative Arts']),
    ('Grade 1', ARRAY['Mother Tongue', 'Filipino', 'English', 'Mathematics',
      'Araling Panlipunan', 'MAPEH', 'Edukasyon sa Pagpapakatao']),
    ('Grade 2', ARRAY['Mother Tongue', 'Filipino', 'English', 'Mathematics',
      'Araling Panlipunan', 'MAPEH', 'Edukasyon sa Pagpapakatao']),
    ('Grade 3', ARRAY['Mother Tongue', 'Filipino', 'English', 'Mathematics', 'Science',
      'Araling Panlipunan', 'MAPEH', 'Edukasyon sa Pagpapakatao']),
    ('Grade 4', ARRAY['Filipino', 'English', 'Mathematics', 'Science',
      'Araling Panlipunan', 'MAPEH', 'Edukasyon sa Pagpapakatao',
      'Edukasyong Pantahanan at Pangkabuhayan']),
    ('Grade 5', ARRAY['Filipino', 'English', 'Mathematics', 'Science',
      'Araling Panlipunan', 'MAPEH', 'Edukasyon sa Pagpapakatao',
      'Edukasyong Pantahanan at Pangkabuhayan']),
    ('Grade 6', ARRAY['Filipino', 'English', 'Mathematics', 'Science',
      'Araling Panlipunan', 'MAPEH', 'Edukasyon sa Pagpapakatao',
      'Edukasyong Pantahanan at Pangkabuhayan'])
  ) AS cur(grade, subjects) ON cur.grade = g.name
  CROSS JOIN LATERAL unnest(cur.subjects) AS s(subject)
  ON CONFLICT (name, grade_level_id, school_year_id) DO NOTHING;

  -- 2 + 3. Teachers (no email) and the subjects they handle --------------
  FOR rec IN
    SELECT * FROM (VALUES
      -- grade,    first,      middle,  last,         sex,      degree, major,         hired,        subjects
      ('Kinder',  'Maricel',  'Anne',  'Bautista',   'female', 'BEEd', 'Generalist',  '2014-06-02', ARRAY['Language, Literacy and Communication', 'Mathematics']),
      ('Kinder',  'Rosalinda','Joy',   'Mercado',    'female', 'BEEd', 'Generalist',  '2016-06-06', ARRAY['Understanding the Physical and Natural Environment', 'Socio-Emotional Development']),
      ('Kinder',  'Jomar',    'Paul',  'Villanueva', 'male',   'BEEd', 'Generalist',  '2019-06-03', ARRAY['Values Development', 'Physical Health and Motor Development', 'Creative Arts']),

      ('Grade 1', 'Teresita', 'Mae',   'Navarro',    'female', 'BEEd', 'Generalist',  '2009-06-01', ARRAY['Mother Tongue', 'Filipino']),
      ('Grade 1', 'Carlo',    'Miguel','Dizon',      'male',   'BSEd', 'English',     '2015-06-01', ARRAY['English', 'Edukasyon sa Pagpapakatao']),
      ('Grade 1', 'Liza',     'Marie', 'Soriano',    'female', 'BSEd', 'Mathematics', '2012-06-04', ARRAY['Mathematics']),
      ('Grade 1', 'Ramon',    'Jose',  'Pascual',    'male',   'BPEd', 'Generalist',  '2018-06-04', ARRAY['Araling Panlipunan', 'MAPEH']),

      ('Grade 2', 'Josefina', 'Grace', 'Aquino',     'female', 'BEEd', 'Generalist',  '2008-06-02', ARRAY['Mother Tongue', 'Filipino']),
      ('Grade 2', 'Eduardo',  'Luis',  'Manalo',     'male',   'BSEd', 'English',     '2013-06-03', ARRAY['English', 'Edukasyon sa Pagpapakatao']),
      ('Grade 2', 'Cristina', 'Faye',  'Salazar',    'female', 'BSEd', 'Mathematics', '2017-06-05', ARRAY['Mathematics']),
      ('Grade 2', 'Benedict', 'John',  'Castillo',   'male',   'BPEd', 'Generalist',  '2020-08-24', ARRAY['Araling Panlipunan', 'MAPEH']),

      ('Grade 3', 'Norma',    'Lyn',   'Domingo',    'female', 'BEEd', 'Generalist',  '2007-06-04', ARRAY['Mother Tongue', 'Filipino']),
      ('Grade 3', 'Arnel',    'Vince', 'Ocampo',     'male',   'BSEd', 'English',     '2014-06-02', ARRAY['English', 'Edukasyon sa Pagpapakatao']),
      ('Grade 3', 'Gemma',    'Rose',  'Fernandez',  'female', 'BSEd', 'Mathematics', '2011-06-06', ARRAY['Mathematics', 'Science']),
      ('Grade 3', 'Rolando',  'Kyle',  'Santiago',   'male',   'BPEd', 'Generalist',  '2016-06-06', ARRAY['Araling Panlipunan', 'MAPEH']),

      ('Grade 4', 'Elena',    'Marie', 'Lazaro',     'female', 'BSEd', 'Filipino',    '2006-06-05', ARRAY['Filipino', 'Araling Panlipunan']),
      ('Grade 4', 'Dennis',   'Paul',  'Cabrera',    'male',   'BSEd', 'English',     '2012-06-04', ARRAY['English', 'Edukasyon sa Pagpapakatao']),
      ('Grade 4', 'Angelica', 'Joy',   'Valdez',     'female', 'BSEd', 'Science',     '2015-06-01', ARRAY['Mathematics', 'Science']),
      ('Grade 4', 'Mario',    'Jay',   'Estrada',    'male',   'BTLEd','Home Economics','2018-06-04', ARRAY['MAPEH', 'Edukasyong Pantahanan at Pangkabuhayan']),

      ('Grade 5', 'Lourdes',  'Ann',   'Magno',      'female', 'BSEd', 'Filipino',    '2005-06-06', ARRAY['Filipino', 'Araling Panlipunan']),
      ('Grade 5', 'Rodel',    'Mark',  'Pineda',     'male',   'BSEd', 'English',     '2010-06-07', ARRAY['English', 'Edukasyon sa Pagpapakatao']),
      ('Grade 5', 'Shiela',   'Mae',   'Roxas',      'female', 'BSEd', 'Science',     '2013-06-03', ARRAY['Mathematics', 'Science']),
      ('Grade 5', 'Oscar',    'Ian',   'Tolentino',  'male',   'BTLEd','Home Economics','2017-06-05', ARRAY['MAPEH', 'Edukasyong Pantahanan at Pangkabuhayan']),

      ('Grade 6', 'Evelyn',   'Rose',  'Alcantara',  'female', 'BSEd', 'Filipino',    '2004-06-07', ARRAY['Filipino', 'Araling Panlipunan']),
      ('Grade 6', 'Virgilio', 'Noel',  'Samonte',    'male',   'BSEd', 'English',     '2009-06-01', ARRAY['English', 'Edukasyon sa Pagpapakatao']),
      ('Grade 6', 'Daisy',    'Lyn',   'Hernandez',  'female', 'BSEd', 'Science',     '2011-06-06', ARRAY['Mathematics', 'Science']),
      ('Grade 6', 'Felix',    'Andre', 'Gonzales',   'male',   'BTLEd','Home Economics','2016-06-06', ARRAY['MAPEH', 'Edukasyong Pantahanan at Pangkabuhayan'])
    ) AS t(grade, first_name, middle_name, last_name, sex, degree, major, date_hired, subjects)
  LOOP
    -- Re-use the teacher if a previous run already created them.
    SELECT id INTO tid FROM teachers
     WHERE lower(first_name) = lower(rec.first_name)
       AND lower(last_name)  = lower(rec.last_name)
       AND email IS NULL
     ORDER BY id LIMIT 1;

    IF tid IS NULL THEN
      INSERT INTO teachers (first_name, middle_name, last_name, sex, degree, major, date_hired, is_active, status)
      VALUES (rec.first_name, rec.middle_name, rec.last_name, rec.sex, rec.degree, rec.major,
              rec.date_hired::date, TRUE, 'active')
      RETURNING id INTO tid;
    END IF;

    INSERT INTO teacher_subjects (teacher_id, subject_id)
    SELECT tid, s.id
      FROM subjects s
      JOIN grade_levels g ON g.id = s.grade_level_id
     WHERE g.name = rec.grade
       AND s.school_year_id = yr
       AND s.name = ANY (rec.subjects::text[])
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 4. Check: teachers of each grade level and the subjects they handle ----
SELECT g.name                                              AS grade_level,
       t.first_name || ' ' || COALESCE(t.middle_name || ' ', '') || t.last_name AS teacher,
       string_agg(s.name, ', ' ORDER BY s.name)            AS subjects,
       t.email
  FROM teachers t
  JOIN teacher_subjects ts ON ts.teacher_id = t.id
  JOIN subjects s          ON s.id = ts.subject_id
  JOIN grade_levels g      ON g.id = s.grade_level_id
 WHERE s.school_year_id = (SELECT id FROM school_years WHERE is_active = TRUE ORDER BY id LIMIT 1)
   AND t.email IS NULL
 GROUP BY g.sort_order, g.name, t.id
 ORDER BY g.sort_order, t.last_name;
