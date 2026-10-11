import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGradeScheduleSummary, getSchoolSettings } from '../../api/admin';

const EXPECTED_WEEKLY_PERIODS = 40; // rough denominator for the "week filled" bar; adjust per your bell schedule

export default function SchedulesPage() {
  const [schoolYears, setSchoolYears] = useState([]);
  const [selectedYearId, setSelectedYearId] = useState(null);
  const [grades, setGrades] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getSchoolSettings().then((data) => {
      setSchoolYears(data.schoolYears);
      // Default to whichever year is active; if somehow none is,
      // fall back to the most recent one in the list rather than
      // showing an empty selector.
      const active = data.schoolYears.find((y) => y.is_active);
      setSelectedYearId((active || data.schoolYears[0])?.id ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedYearId) return;
    getGradeScheduleSummary(selectedYearId).then(setGrades).catch((err) => setError(err.response?.data?.message || 'Could not load schedules.'));
  }, [selectedYearId]);

  const selectedYear = schoolYears.find((y) => y.id === selectedYearId);
  const isReadOnly = selectedYear ? (selectedYear.is_ended || !selectedYear.is_active) : false;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Class Schedules by Grade Level</h1>
          <p>Kinder through Grade 6. Manage subjects, sessions, and teacher assignments per section.</p>
        </div>
        <div>
          <label className="label" style={{ display: 'block', marginBottom: 4 }}>School year</label>
          <select
            className="input" value={selectedYearId || ''}
            onChange={(e) => setSelectedYearId(Number(e.target.value))}
          >
            {schoolYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}{y.is_active ? ' (current)' : y.is_ended ? ' (ended)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isReadOnly && (
        <div className="alert" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
          Viewing {selectedYear?.label} \u2014 this school year has ended, so its schedule is view-only.
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grade-card-grid">
        {grades.map((g) => {
          const pct = Math.min(100, Math.round((g.filled_periods / EXPECTED_WEEKLY_PERIODS) * 100));
          return (
            <div key={g.id} className="grade-card">
              <h3>{g.name}</h3>
              <div className="cell-sub">{g.section_count} section{g.section_count === 1 ? '' : 's'}</div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
                <span><b>{g.subject_count}</b> <span className="muted">subjects</span></span>
                <span><b>{g.teacher_count}</b> <span className="muted">teachers</span></span>
              </div>
              <div className={`grade-card-fill-bar${pct >= 100 ? ' is-full' : ''}`}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="cell-sub" style={{ marginBottom: 12 }}>
                {pct >= 100 ? 'All sections complete' : 'Incomplete \u2014 open periods remain'}
              </div>
              <Link to={`/admin/schedules/${g.id}?schoolYearId=${selectedYearId}`}>
                {isReadOnly ? 'View schedule' : 'Manage schedule'} &rarr;
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
