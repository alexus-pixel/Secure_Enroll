import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getGradeScheduleSummary, getScheduleSchoolYears } from '../../api/admin';
import useAutoRefresh, { useAlive, keepIfSame } from '../../hooks/useAutoRefresh';

const EXPECTED_WEEKLY_PERIODS = 40; // rough denominator for the "week filled" bar; adjust per your bell schedule

export default function SchedulesPage() {
  // The same page serves the admin and the registrar portals, so links stay
  // inside whichever one it is being shown in.
  const base = useLocation().pathname.startsWith('/registrar') ? '/registrar' : '/admin';
  const [schoolYears, setSchoolYears] = useState([]);
  const [selectedYearId, setSelectedYearId] = useState(null);
  const [grades, setGrades] = useState([]);
  const [error, setError] = useState('');
  const alive = useAlive();

  useEffect(() => {
    getScheduleSchoolYears().then((schoolYears) => {
      setSchoolYears(schoolYears);
      // Default to whichever year is active; if somehow none is,
      // fall back to the most recent one in the list rather than
      // showing an empty selector.
      const active = schoolYears.find((y) => y.is_active);
      setSelectedYearId((active || schoolYears[0])?.id ?? null);
    }).catch(() => {});
  }, []);

  // Stable so the auto-refresh interval survives a render.
  const load = useCallback(() => {
    if (!selectedYearId) return;
    getGradeScheduleSummary(selectedYearId)
      .then((rows) => { if (alive.current) setGrades((prev) => keepIfSame(prev, rows)); })
      .catch((err) => { if (alive.current) setError(err.response?.data?.message || 'Could not load schedules.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYearId]);

  useEffect(() => { load(); }, [load]);
  // Period counts here move whenever anyone edits a grade's schedule on the
  // next screen over, so the cards re-read themselves. Nothing on this page is
  // typed into, so a refresh cannot interrupt anything.
  useAutoRefresh(load);

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
              <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
                <span><b>{g.subject_count}</b> <span className="muted">subjects</span></span>
                <span><b>{g.teacher_count}</b> <span className="muted">teachers</span></span>
              </div>
              <div className={`grade-card-fill-bar${pct >= 100 ? ' is-full' : ''}`}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="cell-sub" style={{ marginBottom: 12 }}>
                {pct >= 100 ? 'All sections complete' : 'Incomplete \u2014 open periods remain'}
              </div>
              <Link to={`${base}/schedules/${g.id}?schoolYearId=${selectedYearId}`}>
                {isReadOnly ? 'View schedule' : 'Manage schedule'} &rarr;
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
