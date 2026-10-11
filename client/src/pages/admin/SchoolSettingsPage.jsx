import { useEffect, useState } from 'react';
import { getSchoolSettings, createSchoolYear, activateSchoolYear, updateSchoolYearEndDate } from '../../api/admin';
import ManageSectionsModal from './ManageSectionsModal';

export default function SchoolSettingsPage() {
  const [data, setData] = useState(null);
  const [showYearForm, setShowYearForm] = useState(false);
  const [newYear, setNewYear] = useState({ label: '', opensAt: '', closesAt: '' });
  const [managingGrade, setManagingGrade] = useState(null);
  const [editingEndDateId, setEditingEndDateId] = useState(null);
  const [endDateDraft, setEndDateDraft] = useState('');
  const [error, setError] = useState('');

  function load() {
    getSchoolSettings().then(setData).catch((err) => setError(err.response?.data?.message || 'Could not load school settings.'));
  }
  useEffect(load, []);

  async function handleAddYear(e) {
    e.preventDefault();
    try {
      await createSchoolYear({ ...newYear, closesAt: newYear.closesAt || undefined });
      setShowYearForm(false);
      setNewYear({ label: '', opensAt: '', closesAt: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.errors?.map((x) => x.message).join(' ') || err.response?.data?.message || 'Could not add school year.');
    }
  }

  async function handleActivate(id) {
    await activateSchoolYear(id);
    load();
  }

  async function handleSaveEndDate(id) {
    setError('');
    if (!endDateDraft) {
      setError('Pick an end date before saving.');
      return;
    }
    try {
      await updateSchoolYearEndDate(id, endDateDraft);
      setEditingEndDateId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update the end date.');
    }
  }

  if (!data) return error ? <div className="alert alert-error">{error}</div> : <div className="empty-state">Loading...</div>;

  const sectionsByGrade = data.sections.reduce((acc, s) => {
    (acc[s.grade_level_id] = acc[s.grade_level_id] || []).push(s);
    return acc;
  }, {});

  return (
    <div>
      <h1>School Settings</h1>
      <p className="muted" style={{ marginTop: -10, marginBottom: 20 }}>School years, grade levels &amp; sections</p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="admin-section-header" style={{ marginBottom: 10 }}>
          <strong>School Years</strong>
          <button className="btn btn-ghost" onClick={() => setShowYearForm((s) => !s)}>+ Add School Year</button>
        </div>
        {data.schoolYears.map((y) => (
          <div key={y.id} className="settings-row">
            <div>
              <b>{y.label}</b>
              <div className="cell-sub">
                Starts {new Date(y.opens_at).toLocaleDateString()} &middot; Ends{' '}
                {editingEndDateId === y.id ? (
                  <>
                    <input
                      className="input" type="date" style={{ display: 'inline-block', width: 150, padding: '2px 6px' }}
                      value={endDateDraft} onChange={(e) => setEndDateDraft(e.target.value)}
                    />
                    {' '}
                    <button className="link-action" onClick={() => handleSaveEndDate(y.id)}>Save</button>
                    {' '}
                    <button className="link-action" onClick={() => setEditingEndDateId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    {new Date(y.closes_at).toLocaleDateString()}
                    {' '}
                    <button
                      className="link-action"
                      onClick={() => { setEditingEndDateId(y.id); setEndDateDraft(y.closes_at.slice(0, 10)); }}
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {y.is_ended ? (
                <span className="pill pill-draft">Ended</span>
              ) : y.is_active ? (
                <span className="pill pill-open">Active</span>
              ) : (
                <button className="link-action" onClick={() => handleActivate(y.id)}>Set as active</button>
              )}
            </div>
          </div>
        ))}
        {showYearForm && (
          <form onSubmit={handleAddYear} className="admin-form" style={{ flexWrap: 'wrap' }}>
            <input className="input" placeholder="2027-2028" value={newYear.label} onChange={(e) => setNewYear({ ...newYear, label: e.target.value })} required />
            <div>
              <label className="label" style={{ fontSize: 11 }}>Start date</label>
              <input className="input" type="date" value={newYear.opensAt} onChange={(e) => setNewYear({ ...newYear, opensAt: e.target.value })} required />
            </div>
            <div>
              <label className="label" style={{ fontSize: 11 }}>End date (optional)</label>
              <input className="input" type="date" value={newYear.closesAt} onChange={(e) => setNewYear({ ...newYear, closesAt: e.target.value })} />
            </div>
            <button className="btn btn-primary" type="submit">Save</button>
            <p className="hint" style={{ width: '100%', margin: 0 }}>
              Leave the end date blank to have it end automatically 10 months after the start date.
              School years for 2025 or earlier can&rsquo;t be added.
            </p>
          </form>
        )}
      </div>

      <div className="card">
        <strong>Sections per Grade Level</strong>
        <div style={{ marginTop: 10 }}>
          {data.gradeLevels.map((g) => {
            const gradeSections = sectionsByGrade[g.id] || [];
            return (
              <div key={g.id} className="settings-row">
                <div>
                  <b>{g.name}</b>
                  <div className="cell-sub">
                    {gradeSections.length > 0
                      ? gradeSections.map((s) => `${s.name} (${s.enrolled_count}/${s.capacity}${s.enrolled_count >= s.capacity ? ' \u2014 full' : ''})`).join(' \u00b7 ')
                      : 'No sections yet'}
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setManagingGrade({ id: g.id, name: g.name })}
                >
                  Manage
                </button>
              </div>
            );
          })}
          {data.gradeLevels.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No grade levels configured.</p>}
        </div>
      </div>

      {managingGrade && (
        <ManageSectionsModal
          gradeLevel={managingGrade}
          sections={sectionsByGrade[managingGrade.id] || []}
          onClose={() => setManagingGrade(null)}
          onChanged={() => { load(); }}
        />
      )}
    </div>
  );
}