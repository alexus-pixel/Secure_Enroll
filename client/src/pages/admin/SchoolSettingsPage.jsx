import { useEffect, useState } from 'react';
import {
  getSchoolSettings, createSchoolYear, activateSchoolYear, updateSchoolYearDates,
  rolloverSchoolYear, confirmSchoolYearDates,
} from '../../api/admin';
import ManageSectionsModal from './ManageSectionsModal';
import ConfirmDialog from '../../components/ConfirmDialog';

// A school year is named after the two calendar years it runs through, so the
// name is worked out from the start date rather than typed.
const labelFor = (startDate) => {
  const y = Number(String(startDate).slice(0, 4));
  return Number.isFinite(y) && y > 0 ? `${y}-${y + 1}` : '';
};
// The end date is the end of the ENROLLMENT window, which is a short period
// that opens and closes within the same span rather than a year later. The
// picker is held to the day after the start through one year on; the server
// has the final say (it defaults a blank end to three days after the start).
const endDateBounds = (startDate) => {
  if (!startDate) return {};
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return {};
  const fmt = (d) => d.toISOString().slice(0, 10);
  const min = new Date(start.getTime() + 86400000);
  const max = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  return { min: fmt(min), max: fmt(max) };
};

export default function SchoolSettingsPage() {
  const [data, setData] = useState(null);
  const [showYearForm, setShowYearForm] = useState(false);
  const [newYear, setNewYear] = useState({ opensAt: '', closesAt: '' });
  const [rollingOver, setRollingOver] = useState(null); // the year being rolled over
  const [rollBusy, setRollBusy] = useState(false);
  const [confirmDates, setConfirmDates] = useState(null); // { id, opensAt, closesAt }
  const [managingGrade, setManagingGrade] = useState(null);
  // The school year whose dates are open for editing, and the two drafts. The
  // start date is only in play while that year has not begun.
  const [editingDatesId, setEditingDatesId] = useState(null);
  const [startDateDraft, setStartDateDraft] = useState('');
  const [endDateDraft, setEndDateDraft] = useState('');
  const [error, setError] = useState('');

  function load() {
    getSchoolSettings().then(setData).catch((err) => setError(err.response?.data?.message || 'Could not load school settings.'));
  }
  useEffect(load, []);

  // Adding a school year and moving a year's end date both change what the
  // whole school sees, so each asks first.
  const [confirming, setConfirming] = useState(null); // { kind, ... }

  async function handleAddYear() {
    try {
      await createSchoolYear({ opensAt: newYear.opensAt, closesAt: newYear.closesAt || undefined });
      setShowYearForm(false);
      setNewYear({ opensAt: '', closesAt: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.errors?.map((x) => x.message).join(' ') || err.response?.data?.message || 'Could not add school year.');
    }
  }

  async function handleActivate(id) {
    setError('');
    try {
      await activateSchoolYear(id);
      load();
    } catch (err) {
      // A new school year cannot be activated while another is still ongoing;
      // the server names the one that is still open.
      setError(err.response?.data?.message || 'Could not activate the school year.');
    }
  }

  // Starts the following school year: the sections, subjects and every
  // teacher's schedule are copied into it so nothing is rebuilt by hand.
  async function handleRollover() {
    setRollBusy(true);
    setError('');
    try {
      const result = await rolloverSchoolYear(rollingOver.id, {});
      setRollingOver(null);
      setConfirmDates({ id: result.id, label: result.label, opensAt: '', closesAt: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start the next school year.');
      setRollingOver(null);
    } finally {
      setRollBusy(false);
    }
  }

  async function handleConfirmDates(e) {
    e.preventDefault();
    setError('');
    try {
      await confirmSchoolYearDates(confirmDates.id, confirmDates.opensAt, confirmDates.closesAt);
      setConfirmDates(null);
      load();
    } catch (err) {
      setError(err.response?.data?.errors?.map((x) => x.message).join(' ') || err.response?.data?.message || 'Could not save those dates.');
    }
  }

  // Saves whichever dates the administrator is allowed to move. A year that
  // has already begun keeps its start date, so only the end date is sent; the
  // server applies the same rule either way.
  async function handleSaveDates(year) {
    setError('');
    if (!endDateDraft) {
      setError('Pick an end date before saving.');
      return;
    }
    const opensAt = year.has_started ? undefined : startDateDraft;
    if (!year.has_started && !startDateDraft) {
      setError('Pick a start date before saving.');
      return;
    }
    if (opensAt && endDateDraft <= opensAt) {
      setError('The end date has to be after the start date. Pick a later end date.');
      return;
    }
    try {
      await updateSchoolYearDates(year.id, {
        opensAt, closesAt: endDateDraft,
      });
      setEditingDatesId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update the school year dates.');
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

      {/* The system starts the next school year by itself once the current one
          ends. Its dates are provisional until an administrator enters them,
          and enrollment stays closed in the meantime. */}
      {(() => {
        const provisional = data.schoolYears.find((y) => y.is_active && y.dates_confirmed === false);
        if (!provisional) return null;
        return (
          <div className="alert alert-warn" role="status">
            <b>School year {provisional.label} was started automatically.</b>
            <div style={{ marginTop: 4 }}>
              Last year&rsquo;s sections, subjects and teacher schedules were copied into it. Enter its real
              start and end dates to finish setting it up &mdash; enrollment cannot be opened until you do.
            </div>
            <button
              className="btn btn-primary btn-sm" style={{ marginTop: 8 }}
              onClick={() => setConfirmDates({
                id: provisional.id, label: provisional.label,
                opensAt: provisional.opens_at.slice(0, 10), closesAt: provisional.closes_at.slice(0, 10),
              })}
            >
              Enter the dates
            </button>
          </div>
        );
      })()}

      <div className="card">
        <div className="admin-section-header" style={{ marginBottom: 10 }}>
          <strong>School Years</strong>
          <button className="btn btn-ghost" onClick={() => setShowYearForm((s) => !s)}>+ Add School Year</button>
        </div>
        {data.schoolYears.map((y) => (
          <div key={y.id} className="settings-row">
            <div>
              <b>{y.label}</b>
              {/* While a school year has not begun, both of its dates can
                  still be adjusted. Once classes have started, the day they
                  started on is a matter of record and only the end date is
                  left open. */}
              <div className="cell-sub">
                {editingDatesId === y.id ? (
                  <>
                    Enrollment starts{' '}
                    {/* The two pickers are the enrollment window: when it opens
                        and when it closes. A year that has already begun keeps
                        its start date (shown but disabled); its end date can
                        still be moved. The first day of classes is a separate
                        stored date — it follows the enrollment end — and so is
                        no longer typed here. */}
                    <input
                      className="input" type="date" style={{ display: 'inline-block', width: 150, padding: '2px 6px' }}
                      aria-label={`Enrollment start date of ${y.label}`} min="2026-01-01"
                      disabled={Boolean(y.has_started)}
                      value={y.has_started ? y.opens_at.slice(0, 10) : startDateDraft}
                      onChange={(e) => { setStartDateDraft(e.target.value); setEndDateDraft(''); }}
                    />
                    {' '}&middot; Enrollment ends{' '}
                    <input
                      className="input" type="date" style={{ display: 'inline-block', width: 150, padding: '2px 6px' }}
                      aria-label={`Enrollment end date of ${y.label}`}
                      {...endDateBounds(y.has_started ? y.opens_at.slice(0, 10) : startDateDraft)}
                      disabled={!y.has_started && !startDateDraft}
                      value={endDateDraft} onChange={(e) => setEndDateDraft(e.target.value)}
                    />
                    {' '}
                    <button className="link-action" onClick={() => setConfirming({ kind: 'dates', year: y })}>Save</button>
                    {' '}
                    <button className="link-action" onClick={() => setEditingDatesId(null)}>Cancel</button>
                    <p className="hint" style={{ margin: '4px 0 0' }}>
                      {y.has_started
                        ? 'This school year has already begun, so its start date can no longer be changed. You can still move its enrollment end date.'
                        : 'The enrollment period opens and closes within the same span; leave it blank when adding a year to default to three days.'}
                      {' '}Classes begin on or after the day enrollment closes.
                    </p>
                  </>
                ) : (
                  <>
                    Enrollment {new Date(y.opens_at).toLocaleDateString()} &ndash;{' '}
                    {new Date(y.closes_at).toLocaleDateString()}
                    {y.classes_start_on && (
                      <> &middot; Classes start {new Date(`${y.classes_start_on}T00:00:00`).toLocaleDateString()}</>
                    )}
                    {' '}
                    <button
                      className="link-action"
                      onClick={() => {
                        setEditingDatesId(y.id);
                        setStartDateDraft(y.opens_at.slice(0, 10));
                        setEndDateDraft(y.closes_at.slice(0, 10));
                      }}
                    >
                      Edit dates
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {y.dates_confirmed === false && <span className="pill pill-needs_revision">Dates not confirmed</span>}
              {y.is_ended ? (
                <>
                  <span className="pill pill-draft">Ended</span>
                  <button className="link-action" onClick={() => setRollingOver(y)}>Start next year</button>
                </>
              ) : y.is_active ? (
                <span className="pill pill-open">Active</span>
              ) : (
                <button className="link-action" onClick={() => handleActivate(y.id)}>Set as active</button>
              )}
            </div>
          </div>
        ))}
        {showYearForm && (
          <form onSubmit={(e) => { e.preventDefault(); setConfirming({ kind: 'year' }); }} className="admin-form" style={{ flexWrap: 'wrap' }}>
            <div>
              <label className="label" style={{ fontSize: 12.5 }}>Enrollment start</label>
              <input
                className="input" type="date" value={newYear.opensAt} min="2026-01-01"
                onChange={(e) => setNewYear({ ...newYear, opensAt: e.target.value, closesAt: '' })} required
              />
            </div>
            <div>
              <label className="label" style={{ fontSize: 12.5 }}>Enrollment end (optional)</label>
              <input
                className="input" type="date" value={newYear.closesAt}
                {...endDateBounds(newYear.opensAt)}
                disabled={!newYear.opensAt}
                onChange={(e) => setNewYear({ ...newYear, closesAt: e.target.value })}
              />
            </div>
            <div>
              <label className="label" style={{ fontSize: 12.5 }}>School year</label>
              <input className="input" value={labelFor(newYear.opensAt)} readOnly tabIndex={-1}
                placeholder="from the start date" aria-label="School year name" style={{ background: 'var(--surface-2, #f1f3f7)' }} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={!newYear.opensAt}>Save</button>
            <p className="hint" style={{ width: '100%', margin: 0 }}>
              The start and end dates are the enrollment period. The name comes from the start date.
              Leave the end date blank to default the enrollment period to three days after the start;
              set a later date to run enrollment longer. Classes begin on or after the day enrollment
              closes. School years for 2025 or earlier can&rsquo;t be added.
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
          {data.gradeLevels.length === 0 && <p className="muted" style={{ fontSize: 14.5 }}>No grade levels configured.</p>}
        </div>
      </div>

      {confirming?.kind === 'year' && (
        <ConfirmDialog
          title={`Add school year ${labelFor(newYear.opensAt)}?`}
          confirmLabel="Add school year"
          onConfirm={async () => { await handleAddYear(); setConfirming(null); }}
          onClose={() => setConfirming(null)}
        >
          <p>
            It starts on <b>{newYear.opensAt}</b> and ends on{' '}
            <b>{newYear.closesAt || 'three days after it starts, automatically'}</b>.
          </p>
          <p>It is added as an inactive year; nothing changes for parents until you set it as active.</p>
        </ConfirmDialog>
      )}

      {confirming?.kind === 'dates' && (
        <ConfirmDialog
          title={`Change the dates of ${confirming.year.label}?`}
          confirmLabel="Save dates"
          onConfirm={async () => { await handleSaveDates(confirming.year); setConfirming(null); }}
          onClose={() => setConfirming(null)}
        >
          {confirming.year.has_started ? (
            <p>The school year will end on <b>{endDateDraft}</b>. Its start date stays as it is.</p>
          ) : (
            <p>The school year will run from <b>{startDateDraft}</b> to <b>{endDateDraft}</b>.</p>
          )}
          <p>
            When a school year ends, the system starts the next one by itself and copies the sections,
            subjects and teacher schedules into it.
          </p>
        </ConfirmDialog>
      )}

      {rollingOver && (
        <ConfirmDialog
          title={`Start the school year after ${rollingOver.label}?`}
          confirmLabel="Start the next school year"
          busy={rollBusy}
          onConfirm={handleRollover}
          onClose={() => setRollingOver(null)}
        >
          <p>This creates the next school year and copies into it:</p>
          <ul>
            <li>every section, with its capacity and its adviser;</li>
            <li>every subject of every grade level;</li>
            <li>every teacher&rsquo;s schedule, period for period.</li>
          </ul>
          <p>
            Nothing from {rollingOver.label} is deleted &mdash; its schedule and class lists stay as the record of
            that year. You can change any copied period afterwards, including moving a teacher to another grade level.
          </p>
          <p>You will be asked for the new year&rsquo;s start and end dates next. Enrollment stays closed until you enter them.</p>
        </ConfirmDialog>
      )}

      {confirmDates && (
        <div className="modal-backdrop" onClick={() => setConfirmDates(null)}>
          <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm school year dates">
            <div className="modal-head"><h2 style={{ marginBottom: 2 }}>Dates for {confirmDates.label}</h2></div>
            <form onSubmit={handleConfirmDates}>
              <p className="hint">
                The new school year was created with provisional dates. Enter the real ones.
                Enrollment stays closed until you do.
              </p>
              <div className="field">
                <label className="label" htmlFor="sy_opens">Enrollment start</label>
                <input id="sy_opens" className="input" type="date" required value={confirmDates.opensAt}
                  onChange={(e) => setConfirmDates({ ...confirmDates, opensAt: e.target.value, closesAt: '' })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="sy_closes">Enrollment end</label>
                <input id="sy_closes" className="input" type="date" required value={confirmDates.closesAt}
                  {...endDateBounds(confirmDates.opensAt)} disabled={!confirmDates.opensAt}
                  onChange={(e) => setConfirmDates({ ...confirmDates, closesAt: e.target.value })} />
                <p className="hint">These are the enrollment window&rsquo;s start and end. Classes begin on or after the day enrollment closes.</p>
              </div>
              <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmDates(null)}>Later</button>
                <button type="submit" className="btn btn-primary">Save dates</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {managingGrade && (
        <ManageSectionsModal
          gradeLevel={managingGrade}
          sections={sectionsByGrade[managingGrade.id] || []}
          allSections={data.sections}
          onClose={() => setManagingGrade(null)}
          onChanged={() => { load(); }}
        />
      )}
    </div>
  );
}