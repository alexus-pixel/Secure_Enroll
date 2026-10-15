const PDFDocument = require('pdfkit');

/**
 * Both functions below return a Buffer (fully built in memory)
 * rather than streaming straight to a response, because the same
 * buffer needs to go to two different places: attached to an
 * email (Teachers page "Send PDF") and, if the caller wants,
 * served as a download. Building small documents like these
 * in-memory keeps the code simple and is not a real memory
 * concern at school-roster scale (tens of rows, not millions).
 */
function buildPdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

function masterListPdf({ sectionName, gradeLevelName, schoolYearLabel, students }) {
  return buildPdfBuffer((doc) => {
    doc.fontSize(16).text('SecureEnroll — Master List', { align: 'left' });
    doc.fontSize(11).fillColor('#55677A')
      .text(`${gradeLevelName} — ${sectionName} · School Year ${schoolYearLabel}`);
    doc.moveDown(1);
    doc.fillColor('#16212E').fontSize(10);

    const colX = [40, 220, 340, 460];
    doc.font('Helvetica-Bold');
    doc.text('Student', colX[0], doc.y, { continued: false });
    doc.text('LRN', colX[1], doc.y - doc.currentLineHeight());
    doc.text('Guardian', colX[2], doc.y - doc.currentLineHeight());
    doc.text('Contact', colX[3], doc.y - doc.currentLineHeight());
    doc.moveDown(0.5);
    doc.font('Helvetica');

    for (const s of students) {
      const y = doc.y;
      doc.text(`${s.last_name}, ${s.first_name}`, colX[0], y, { width: 170 });
      doc.text(s.lrn || '\u2014', colX[1], y, { width: 110 });
      doc.text(s.guardian_name || '\u2014', colX[2], y, { width: 110 });
      doc.text(s.guardian_contact || '\u2014', colX[3], y, { width: 100 });
      doc.moveDown(0.6);
    }
  });
}

const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

function teacherSchedulePdf({ teacherName, schoolYearLabel, entries }) {
  return buildPdfBuffer((doc) => {
    doc.fontSize(16).text('SecureEnroll — Weekly Schedule');
    doc.fontSize(11).fillColor('#55677A').text(`${teacherName} \u00b7 School Year ${schoolYearLabel}`);
    doc.moveDown(1);

    const cols = [
      { label: 'Day(s)', x: 40, width: 70 },
      { label: 'Time', x: 110, width: 95 },
      { label: 'Grade & Section', x: 205, width: 175 },
      { label: 'Subject', x: 380, width: 160 },
    ];
    const tableRight = cols[cols.length - 1].x + cols[cols.length - 1].width;

    function drawHeader() {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#16212E');
      for (const c of cols) doc.text(c.label, c.x, y, { width: c.width });
      doc.moveDown(0.6);
      doc.moveTo(40, doc.y).lineTo(tableRight, doc.y).strokeColor('#D8DEE6').lineWidth(1).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor('#16212E');
    }

    drawHeader();

    for (const e of entries) {
      if (doc.y > 740) { doc.addPage(); drawHeader(); }

      const y = doc.y;
      const days = (e.days || []).map((d) => DAY_LABELS[d]).join('/') || '\u2014';
      const time = e.role_type === 'adviser'
        ? 'All day (Adviser)'
        : `${e.start_time?.slice(0, 5)}\u2013${e.end_time?.slice(0, 5)}`;
      const gradeSection = `${e.grade_level_name}${e.section_name ? ` \u2013 ${e.section_name}` : ''}`;
      const subject = e.subject_name || (e.role_type === 'adviser' ? 'Adviser (all subjects)' : '\u2014');

      // Day(s) is the narrowest column and the one most likely to
      // wrap onto a second line (a Mon-through-Fri entry, say) — the
      // row has to be at least as tall as whichever column actually
      // needs the most vertical space, or the next row's divider
      // line (and the next row itself) would land right on top of
      // wrapped text instead of below it.
      const textHeight = Math.max(
        doc.heightOfString(days, { width: cols[0].width }),
        doc.heightOfString(gradeSection, { width: cols[2].width }),
        doc.heightOfString(subject, { width: cols[3].width })
      );
      const rowHeight = Math.max(22, textHeight + 8);

      doc.text(days, cols[0].x, y, { width: cols[0].width });
      doc.text(time, cols[1].x, y, { width: cols[1].width });
      doc.text(gradeSection, cols[2].x, y, { width: cols[2].width });
      doc.text(subject, cols[3].x, y, { width: cols[3].width });

      const rowBottom = y + rowHeight;
      doc.moveTo(40, rowBottom - 4).lineTo(tableRight, rowBottom - 4).strokeColor('#EEF2F6').lineWidth(0.5).stroke();
      doc.y = rowBottom;
    }

    if (entries.length === 0) {
      doc.fillColor('#8A97A6').text('No periods scheduled yet for this school year.');
    }
  });
}

/**
 * The Reports page's "Master Enrollment List" PDF — every enrolled
 * learner school-wide, grouped by grade level (masterListPdf above
 * is the Teachers page's version of this, scoped to one section).
 */
function masterEnrollmentListPdf({ schoolYearLabel, students }) {
  return buildPdfBuffer((doc) => {
    doc.fontSize(16).text('SecureEnroll — Master Enrollment List');
    doc.fontSize(11).fillColor('#55677A').text(`School Year ${schoolYearLabel} \u00b7 ${students.length} enrolled`);
    doc.moveDown(1);

    const byGrade = new Map();
    for (const s of students) {
      if (!byGrade.has(s.grade_level)) byGrade.set(s.grade_level, []);
      byGrade.get(s.grade_level).push(s);
    }

    for (const [gradeLevel, rows] of byGrade) {
      doc.fillColor('#16212E').fontSize(12).font('Helvetica-Bold').text(gradeLevel);
      doc.moveDown(0.3);
      const colX = [40, 190, 280, 400];
      doc.fontSize(9).font('Helvetica-Bold');
      const headY = doc.y;
      doc.text('Student', colX[0], headY);
      doc.text('LRN', colX[1], headY);
      doc.text('Section', colX[2], headY);
      doc.text('Guardian', colX[3], headY);
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(9);

      for (const s of rows) {
        const y = doc.y;
        const fullName = [s.last_name, s.first_name].filter(Boolean).join(', ') + (s.middle_name ? ` ${s.middle_name[0]}.` : '');
        doc.text(fullName, colX[0], y, { width: 145 });
        doc.text(s.lrn || '\u2014', colX[1], y, { width: 85 });
        doc.text(s.section || '\u2014', colX[2], y, { width: 115 });
        doc.text(s.guardian_name || '\u2014', colX[3], y, { width: 140 });
        doc.moveDown(0.5);
        if (doc.y > 760) doc.addPage();
      }
      doc.moveDown(0.8);
    }
  });
}

module.exports = { masterListPdf, masterEnrollmentListPdf, teacherSchedulePdf };