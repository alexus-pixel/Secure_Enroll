const PDFDocument = require('pdfkit');

/**
 * Every PDF the system produces (class master list, teacher schedule, the
 * school-wide master enrollment list) shares one look: a blue school header,
 * tables with blue header rows and light striped rows, and a footer with page
 * numbers. Each builder returns a Buffer so the same bytes can be attached to
 * an email or served as a download.
 */
const SCHOOL = 'Caloocan City Elementary School';
const SYSTEM = 'Online Enrollment System';

const C = {
  blue: '#1E4FA3',        // header band and table headers
  blueDark: '#163B7C',
  blueSoft: '#E4ECF9',    // info box
  stripe: '#F3F7FD',      // alternate table rows
  line: '#D5DEEB',
  ink: '#16212E',
  muted: '#5B6B7C',
  white: '#FFFFFF',
};

const MARGIN = 40;
const FOOTER_SPACE = 34;

function buildPdfBuffer(draw, { landscape = false, margin = MARGIN } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: landscape ? 'landscape' : 'portrait', bufferPages: true,
      margins: { top: margin, left: margin, right: margin, bottom: margin + FOOTER_SPACE - 10 },
      info: { Title: SCHOOL, Author: SCHOOL, Creator: SYSTEM },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      addFooters(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;

// Blue school banner at the top of the first page.
function drawBanner(doc, title, subtitle) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const h = 64;
  doc.save();
  doc.rect(x, doc.page.margins.top - 8, w, h).fill(C.blue);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(17)
    .text(SCHOOL, x + 18, doc.page.margins.top + 6, { width: w - 36, lineBreak: false });
  doc.font('Helvetica').fontSize(9.5).fillColor('#C9D8F2')
    .text(SYSTEM, x + 18, doc.page.margins.top + 28, { width: w - 36, lineBreak: false });
  doc.restore();
  const y = doc.page.margins.top - 8 + h + 16;
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(18).text(title, x, y, { width: w });
  if (subtitle) doc.font('Helvetica').fontSize(10.5).fillColor(C.muted).text(subtitle, x, doc.y + 2, { width: w });
  doc.moveDown(0.8);
}

// A light blue box with label/value pairs laid out in columns.
function drawInfoBox(doc, pairs, columns = 2) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const rows = Math.ceil(pairs.length / columns);
  const rowH = 30;
  const h = rows * rowH + 14;
  const y = doc.y;
  doc.save().roundedRect(x, y, w, h, 6).fill(C.blueSoft).restore();
  const colW = (w - 28) / columns;
  pairs.forEach(([label, value], i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const px = x + 14 + col * colW;
    const py = y + 9 + row * rowH;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(label, px, py, { width: colW - 10, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink)
      .text(String(value ?? '—'), px, py + 11, { width: colW - 10, lineBreak: false, ellipsis: true });
  });
  doc.y = y + h + 14;
  doc.x = x;
}

/**
 * Table with a blue header row, striped body rows and automatic page breaks
 * (the header repeats on every page). columns: [{ label, width, align, bold }];
 * rows: arrays of strings (or { text, bold, color } objects) in column order.
 */
function drawTable(doc, columns, rows, { fontSize = 9, padY = 6, headerSize = 9, minRowHeight = 0 } = {}) {
  const x0 = doc.page.margins.left;
  const total = columns.reduce((n, c) => n + c.width, 0);
  const padX = 6;

  const header = () => {
    const y = doc.y;
    const h = 24;
    doc.save().rect(x0, y, total, h).fill(C.blue).restore();
    let x = x0;
    doc.font('Helvetica-Bold').fontSize(headerSize).fillColor(C.white);
    for (const c of columns) {
      doc.text(c.label, x + padX, y + (h - headerSize) / 2 - 1, { width: c.width - padX * 2, align: c.align || 'left', lineBreak: false });
      x += c.width;
    }
    doc.y = y + h;
  };

  header();
  rows.forEach((row, idx) => {
    doc.font('Helvetica').fontSize(fontSize);
    const cells = row.map((cell) => (typeof cell === 'object' && cell !== null ? cell : { text: cell }));
    const heights = cells.map((cell, i) => {
      doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      return doc.heightOfString(String(cell.text ?? '—'), { width: columns[i].width - padX * 2 });
    });
    const h = Math.max(minRowHeight, Math.max(...heights) + padY * 2);
    if (doc.y + h > bottomLimit(doc)) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      header();
    }
    const y = doc.y;
    if (idx % 2 === 0) doc.save().rect(x0, y, total, h).fill(C.stripe).restore();
    doc.save().moveTo(x0, y + h).lineTo(x0 + total, y + h).lineWidth(0.5).strokeColor(C.line).stroke().restore();
    let x = x0;
    cells.forEach((cell, i) => {
      doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(cell.color || C.ink)
        .text(String(cell.text ?? '—'), x + padX, y + padY, { width: columns[i].width - padX * 2, align: columns[i].align || 'left' });
      x += columns[i].width;
    });
    doc.y = y + h;
  });
  // outer border
  return total;
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const m = doc.page.margins;
    const y = doc.page.height - 30;
    const w = doc.page.width - m.left - m.right;
    const savedBottom = m.bottom;
    m.bottom = 0; // writing inside the bottom margin must not start a new page
    doc.save().moveTo(m.left, y - 6).lineTo(m.left + w, y - 6).lineWidth(0.5).strokeColor(C.line).stroke().restore();
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(`${SCHOOL}  ·  Confidential: contains learner information`, m.left, y, { width: w * 0.75, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, m.left, y, { width: w, align: 'right', lineBreak: false });
    m.bottom = savedBottom;
  }
}

const nameOf = (s) => [s.last_name, [s.first_name, s.middle_name ? `${s.middle_name[0]}.` : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const todayLabel = () => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

// ---------------------------------------------------------------------------
// Class master list (one section)
// ---------------------------------------------------------------------------
function masterListPdf({ sectionName, gradeLevelName, schoolYearLabel, students, adviserName }) {
  return buildPdfBuffer((doc) => {
    drawBanner(doc, 'Class Master List', `${gradeLevelName}${sectionName ? ` – ${sectionName}` : ''}  ·  School Year ${schoolYearLabel}`);
    const male = students.filter((s) => s.sex === 'M').length;
    const female = students.filter((s) => s.sex === 'F').length;
    drawInfoBox(doc, [
      ['Grade and section', `${gradeLevelName}${sectionName ? ` – ${sectionName}` : ''}`],
      ['Class adviser', adviserName || '—'],
      ['School year', schoolYearLabel],
      ['Enrolled learners', `${students.length}  (${male} male, ${female} female)`],
    ], 2);

    const cols = [
      { label: 'No.', width: 30, align: 'center' },
      { label: 'Learner', width: 150 },
      { label: 'LRN', width: 88 },
      { label: 'Sex', width: 32, align: 'center' },
      { label: 'Parent / Guardian', width: 120 },
      { label: 'Contact number', width: 95 },
    ];
    if (!students.length) {
      doc.font('Helvetica').fontSize(11).fillColor(C.muted).text('No learners are enrolled in this section yet.');
      return;
    }
    drawTable(doc, cols, students.map((s, i) => [
      String(i + 1), { text: nameOf(s), bold: true }, s.lrn || '—', s.sex || '—', s.guardian_name || '—', s.guardian_contact || '—',
    ]));
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(`Prepared ${todayLabel()} from the enrollment records.`, doc.page.margins.left);
  });
}

// ---------------------------------------------------------------------------
// Teacher weekly schedule: time rows x Monday-Friday columns
// ---------------------------------------------------------------------------
const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

function time12(t) {
  if (!t) return '';
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function teacherSchedulePdf({ teacherName, schoolYearLabel, entries }) {
  return buildPdfBuffer((doc) => {
    const periods = entries.filter((e) => e.role_type !== 'adviser' && e.start_time);
    const advisory = [...new Set(entries.filter((e) => e.role_type === 'adviser')
      .map((e) => `${e.grade_level_name}${e.section_name ? ` – ${e.section_name}` : ''}`))];

    drawBanner(doc, 'Weekly Teaching Schedule', `${teacherName}  ·  School Year ${schoolYearLabel}`);
    drawInfoBox(doc, [
      ['Teacher', teacherName],
      ['Class adviser of', advisory.length ? advisory.join(', ') : '—'],
      ['School year', schoolYearLabel],
      ['Periods per week', String(periods.reduce((n, e) => n + (e.days || []).length, 0))],
    ], 4);

    if (!periods.length) {
      doc.font('Helvetica').fontSize(11).fillColor(C.muted).text('No periods are scheduled yet for this school year.');
      return;
    }

    // one row per distinct time slot, one column per weekday
    const slots = [...new Map(periods.map((e) => [`${e.start_time}|${e.end_time}`, e])).values()]
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)) || String(a.end_time).localeCompare(String(b.end_time)));
    const timeW = 92;
    const dayW = (contentWidth(doc) - timeW) / 5;
    const cols = [{ label: 'Time', width: timeW }, ...[1, 2, 3, 4, 5].map((d) => ({ label: DAY_NAMES[d], width: dayW, align: 'left' }))];
    const rows = slots.map((slot) => {
      const row = [{ text: `${time12(slot.start_time)}\n${time12(slot.end_time)}`, bold: true }];
      for (const d of [1, 2, 3, 4, 5]) {
        const here = periods.filter((e) => e.start_time === slot.start_time && e.end_time === slot.end_time && (e.days || []).includes(d));
        row.push(here.length
          ? here.map((e) => `${e.subject_name || 'Class'}\n${e.grade_level_name}${e.section_name ? ` – ${e.section_name}` : ''}${e.room ? `\nRoom ${e.room}` : ''}`).join('\n\n')
          : { text: '—', color: '#9AA7B5' });
      }
      return row;
    });
    drawTable(doc, cols, rows, { fontSize: 8.5, padY: 7 });
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(`Prepared ${todayLabel()}. Times are shown in 12-hour format.`, doc.page.margins.left);
  }, { landscape: true, margin: 36 });
}

// ---------------------------------------------------------------------------
// School-wide master enrollment list (Reports page), grouped by grade level
// ---------------------------------------------------------------------------
function masterEnrollmentListPdf({ schoolYearLabel, students }) {
  return buildPdfBuffer((doc) => {
    drawBanner(doc, 'Master Enrollment List', `School Year ${schoolYearLabel}  ·  ${students.length} enrolled`);
    const byGrade = new Map();
    for (const s of students) {
      if (!byGrade.has(s.grade_level)) byGrade.set(s.grade_level, []);
      byGrade.get(s.grade_level).push(s);
    }
    if (!students.length) {
      doc.font('Helvetica').fontSize(11).fillColor(C.muted).text('No learners are enrolled yet.');
      return;
    }
    const cols = [
      { label: 'No.', width: 30, align: 'center' },
      { label: 'Learner', width: 160 },
      { label: 'LRN', width: 92 },
      { label: 'Section', width: 100 },
      { label: 'Parent / Guardian', width: 133 },
    ];
    for (const [gradeLevel, rows] of byGrade) {
      if (doc.y + 70 > bottomLimit(doc)) { doc.addPage(); doc.y = doc.page.margins.top; }
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.blueDark).text(`${gradeLevel}  (${rows.length})`, doc.page.margins.left, doc.y);
      doc.moveDown(0.4);
      drawTable(doc, cols, rows.map((s, i) => [
        String(i + 1), { text: nameOf(s), bold: true }, s.lrn || '—', s.section || '—', s.guardian_name || '—',
      ]));
      doc.moveDown(1);
    }
  });
}

module.exports = { masterListPdf, masterEnrollmentListPdf, teacherSchedulePdf, SCHOOL };
