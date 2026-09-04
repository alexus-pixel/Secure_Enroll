import { useState, useEffect } from 'react';
import {
  getSchoolYears, createSchoolYear, setActiveSchoolYear,
  getGradeLevels, createGradeLevel,
  getSections, createSection,
} from '../../api/admin';
import {
  GRADE_LEVEL_OPTIONS,
  SECTION_NAME_OPTIONS,
  SECTION_CAPACITY_OPTIONS,
  SCHOOL_YEAR_OPTIONS,
} from '../../constants/adminOptions';

export default function SchoolSettings() {
  const [schoolYears, setSchoolYears] = useState([]);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [sections, setSections] = useState([]);
  const [showYearForm, setShowYearForm] = useState(false);
  const [showGradeForm, setShowGradeForm] = useState(false);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [newSection, setNewSection] = useState({ name: '', gradeLevelId: '', capacity: '' });
  const [dbError, setDbError] = useState('');

  async function loadAll() {
    try {
      const [years, grades, secs] = await Promise.all([getSchoolYears(), getGradeLevels(), getSections()]);
      setSchoolYears(years);
      setGradeLevels(grades);
      setSections(secs);
    } catch (err) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error || err?.response?.data?.message;
      setDbError(`Failed to load school settings${status ? ` (HTTP ${status})` : ''}${serverMsg ? `: ${serverMsg}` : '.'}`);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleAddYear(e) {
    e.preventDefault();
    const option = SCHOOL_YEAR_OPTIONS.find((o) => o.yearLabel === selectedYear);
    if (!option) return;
    await createSchoolYear(option);
    setSelectedYear('');
    setShowYearForm(false);
    loadAll();
  }

  async function handleActivateYear(id) {
    await setActiveSchoolYear(id);
    loadAll();
  }

  async function handleAddGrade(e) {
    e.preventDefault();
    const option = GRADE_LEVEL_OPTIONS.find((o) => o.name === selectedGrade);
    if (!option) return;
    await createGradeLevel(option);
    setSelectedGrade('');
    setShowGradeForm(false);
    loadAll();
  }

  async function handleAddSection(e) {
    e.preventDefault();
    await createSection({ ...newSection, capacity: Number(newSection.capacity) });
    setNewSection({ name: '', gradeLevelId: '', capacity: '' });
    setShowSectionForm(false);
    loadAll();
  }

  const usedSectionNames = sections
    .filter((s) => String(s.grade_level_id) === String(newSection.gradeLevelId))
    .map((s) => s.name);

  const gradeById = Object.fromEntries(gradeLevels.map((g) => [g.id, g.name]));

  return (
    <div>
      <h1 className="admin-section-title">School Settings</h1>

      {dbError && (
        <p className="admin-error" style={{
          background: '#3f1d1d', border: '1px solid #7f1d1d', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16,
        }}>
          {dbError}
        </p>
      )}

      <div className="settings-grid">
        <div className="admin-card">
          <div className="settings-card-inner">
            <div className="admin-section-header" style={{ marginBottom: 8 }}>
              <strong>School Years</strong>
              <button className="admin-btn admin-btn-ghost" onClick={() => setShowYearForm((s) => !s)}>+ Add Year</button>
            </div>
            {schoolYears.map((y) => (
              <div key={y.id} className="settings-row">
                <span>{y.year_label}</span>
                {y.is_active
                  ? <span className="pill pill-open">Open</span>
                  : <button className="link-action" onClick={() => handleActivateYear(y.id)}>
                      <span className="pill pill-closed">Closed</span>
                    </button>}
              </div>
            ))}
            {schoolYears.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No school years yet.</p>}
          </div>
          {showYearForm && (
            <form onSubmit={handleAddYear} className="admin-form">
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} required>
                <option value="">Select school year</option>
                {SCHOOL_YEAR_OPTIONS
                  .filter((o) => !schoolYears.some((y) => y.year_label === o.yearLabel))
                  .map((o) => <option key={o.yearLabel} value={o.yearLabel}>{o.yearLabel}</option>)}
              </select>
              <button type="submit" className="admin-btn">Save</button>
            </form>
          )}
        </div>

        <div className="admin-card">
          <div className="settings-card-inner">
            <div className="admin-section-header" style={{ marginBottom: 8 }}>
              <strong>Grade Levels</strong>
              <button className="admin-btn admin-btn-ghost" onClick={() => setShowGradeForm((s) => !s)}>+ Add Level</button>
            </div>
            {gradeLevels.map((g) => (
              <div key={g.id} className="settings-row">
                <span>{g.name}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Order {g.level_order}</span>
              </div>
            ))}
            {gradeLevels.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No grade levels yet.</p>}
          </div>
          {showGradeForm && (
            <form onSubmit={handleAddGrade} className="admin-form">
              <select value={selectedGrade} onChange={(e) => setSelectedGrade(e.target.value)} required>
                <option value="">Select grade level</option>
                {GRADE_LEVEL_OPTIONS
                  .filter((o) => !gradeLevels.some((g) => g.name === o.name))
                  .map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
              <button type="submit" className="admin-btn">Save</button>
            </form>
          )}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-section-header" style={{ padding: '18px 20px 0' }}>
          <strong>Sections</strong>
          <button className="admin-btn admin-btn-ghost" onClick={() => setShowSectionForm((s) => !s)}>+ Add Section</button>
        </div>
        <table className="admin-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Section</th>
              <th>Grade Level</th>
              <th>Capacity</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td>{gradeById[s.grade_level_id] || '—'}</td>
                <td>{s.capacity}</td>
              </tr>
            ))}
            {sections.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No sections yet.</td></tr>
            )}
          </tbody>
        </table>
        {showSectionForm && (
          <form onSubmit={handleAddSection} className="admin-form">
            <select
              value={newSection.gradeLevelId}
              onChange={(e) => setNewSection({ ...newSection, gradeLevelId: e.target.value, name: '' })}
              required
            >
              <option value="">Grade level</option>
              {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select
              value={newSection.name}
              onChange={(e) => setNewSection({ ...newSection, name: e.target.value })}
              required
              disabled={!newSection.gradeLevelId}
            >
              <option value="">Section name</option>
              {SECTION_NAME_OPTIONS
                .filter((n) => !usedSectionNames.includes(n))
                .map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select
              value={newSection.capacity}
              onChange={(e) => setNewSection({ ...newSection, capacity: e.target.value })}
              required
            >
              <option value="">Capacity</option>
              {SECTION_CAPACITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="submit" className="admin-btn">Save</button>
          </form>
        )}
      </div>
    </div>
  );
}