import { useEffect, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  getSubjectSettings, addSubject, updateSubject, removeSubject, setMaxSubjects, subjectError,
} from '../../api/subjects';

/**
 * The subject panel on one grade level's schedule page: the grade's
 * subjects for the active school year (add, rename, remove) and the
 * per-grade limit on how many it may have at all, with a live
 * "7 of 10 subjects" counter between the two.
 *
 * It owns its own copy of the list, and hands every change up through
 * onSubjectsChange so the schedule grid and the Add Period drawer on
 * the same page keep offering exactly the subjects that now exist.
 */
export default function SubjectsPanel({ gradeLevelId, schoolYearId, isReadOnly = false, onSubjectsChange }) {
  const [subjects, setSubjects] = useState([]);
  const [maxSubjects, setMax] = useState(null);
  const [gradeName, setGradeName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  // The learning-domain flag is no longer editable here: the seed data sets it
  // on Kinder's domains and nothing else, so the panel only shows it.
  const [editing, setEditing] = useState(null); // { id, name }
  const [savingEdit, setSavingEdit] = useState(false);

  const [removing, setRemoving] = useState(null); // the subject awaiting confirmation
  const [removeBusy, setRemoveBusy] = useState(false);

  const [limitDraft, setLimitDraft] = useState('');
  const [limitOpen, setLimitOpen] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);

  function applyList(list, max) {
    setSubjects(list);
    if (max !== undefined) setMax(max);
    onSubjectsChange?.(list);
  }

  function load() {
    setLoading(true);
    getSubjectSettings(gradeLevelId, schoolYearId)
      .then((data) => {
        setGradeName(data.gradeLevelName);
        setMax(data.maxSubjects);
        setLimitDraft(String(data.maxSubjects));
        setSubjects(data.subjects);
        onSubjectsChange?.(data.subjects);
      })
      .catch((err) => setError(subjectError(err, 'Could not load the subjects for this grade level.')))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [gradeLevelId, schoolYearId]);

  const count = subjects.length;
  const atLimit = maxSubjects != null && count >= maxSubjects;

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(''); setNotice('');
    try {
      const subject = await addSubject({ name, gradeLevelId: Number(gradeLevelId) });
      applyList(
        [...subjects, { id: subject.id, name: subject.name, is_domain: subject.is_domain, scheduled_count: 0, teacher_count: 0 }]
          .sort(byDomainThenName),
        subject.maxSubjects,
      );
      setNewName('');
      setNotice(`${subject.name} added.`);
    } catch (err) {
      setError(subjectError(err, 'Could not add that subject.'));
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveEdit(e) {
    e?.preventDefault();
    const name = editing.name.trim();
    if (!name) return;
    setSavingEdit(true);
    setError(''); setNotice('');
    try {
      const saved = await updateSubject(editing.id, { name });
      applyList(
        subjects.map((s) => (s.id === saved.id ? { ...s, name: saved.name, is_domain: saved.is_domain } : s))
          .sort(byDomainThenName),
      );
      setEditing(null);
      setNotice(`Saved as ${saved.name}.`);
    } catch (err) {
      setError(subjectError(err, 'Could not save that subject.'));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRemove() {
    setRemoveBusy(true);
    setError(''); setNotice('');
    try {
      const result = await removeSubject(removing.id);
      applyList(subjects.filter((s) => s.id !== removing.id));
      setNotice(
        result?.teacherLinksRemoved
          ? `${removing.name} removed, and ${result.teacherLinksRemoved} teacher ${result.teacherLinksRemoved === 1 ? 'link' : 'links'} with it.`
          : `${removing.name} removed.`,
      );
      setRemoving(null);
    } catch (err) {
      setError(subjectError(err, 'Could not remove that subject.'));
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  }

  // The limit can never sit below the subjects the grade already has: it would
  // leave the grade permanently over its own ceiling. Said as the number is
  // typed, so the form never offers a value the server is going to refuse.
  let limitProblem = '';
  if (limitDraft !== '') {
    const n = Number(limitDraft);
    if (!Number.isInteger(n)) limitProblem = 'Enter a whole number.';
    else if (n > 20) limitProblem = 'A grade level can allow at most 20 subjects.';
    else if (n < count) {
      limitProblem = `${gradeName || 'This grade level'} already has ${count} subject${count === 1 ? '' : 's'}, so the limit cannot be lower than ${count}.`;
    } else if (n < 1) limitProblem = 'A grade level must allow at least 1 subject.';
  }

  async function handleSaveLimit(e) {
    e?.preventDefault();
    if (limitProblem || limitDraft === '') return;
    setSavingLimit(true);
    setError(''); setNotice('');
    try {
      const result = await setMaxSubjects(gradeLevelId, Number(limitDraft));
      setMax(result.maxSubjects);
      setLimitDraft(String(result.maxSubjects));
      setLimitOpen(false);
      setNotice(`${gradeName || 'This grade level'} may now have up to ${result.maxSubjects} subjects.`);
    } catch (err) {
      setError(subjectError(err, 'Could not change the subject limit.'));
    } finally {
      setSavingLimit(false);
    }
  }

  return (
    <div className="card">
      <div className="admin-section-header" style={{ marginBottom: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>Subjects</strong>
          {maxSubjects != null && (
            <span className={`pill ${atLimit ? 'pill-needs_revision' : 'pill-approved'}`}>
              {count} of {maxSubjects} subjects
            </span>
          )}
        </div>
        {!isReadOnly && maxSubjects != null && !limitOpen && (
          <button className="link-action" onClick={() => { setLimitOpen(true); setLimitDraft(String(maxSubjects)); }}>
            Adjust limit
          </button>
        )}
      </div>

      {!isReadOnly && limitOpen && (
        <form onSubmit={handleSaveLimit} style={{ marginBottom: 14 }}>
          <label className="label" htmlFor="max-subjects">
            Subjects allowed for {gradeName || 'this grade level'}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              id="max-subjects" className={`input${limitProblem ? ' input-error' : ''}`} type="number"
              min={Math.max(1, count)} max="20" step="1"
              aria-invalid={limitProblem ? 'true' : undefined}
              style={{ width: 90, margin: 0 }}
              value={limitDraft}
              onChange={(e) => setLimitDraft(e.target.value)}
            />
            <button className="btn btn-sm" type="submit" disabled={savingLimit || limitDraft === '' || Boolean(limitProblem)}>
              {savingLimit ? 'Saving...' : 'Save limit'}
            </button>
            <button
              className="btn btn-sm btn-secondary" type="button"
              onClick={() => { setLimitOpen(false); setLimitDraft(String(maxSubjects)); setError(''); }}
            >
              Cancel
            </button>
          </div>
          {limitProblem
            ? <div className="field-error" role="alert" style={{ margin: '6px 0 0' }}>{limitProblem}</div>
            : (
              <div className="hint hint-spaced" style={{ margin: '6px 0 0' }}>
                {Math.max(1, count)} to 20. It cannot go below the {count} subject{count === 1 ? '' : 's'} this grade already has.
              </div>
            )}
        </form>
      )}

      {error && <div className="field-error" style={{ marginBottom: 10 }}>{error}</div>}
      {notice && !error && <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>{notice}</p>}

      {loading ? (
        <p className="muted" style={{ fontSize: 14.5 }}>Loading subjects...</p>
      ) : count === 0 ? (
        <p className="muted" style={{ fontSize: 14.5 }}>
          No subjects yet for this grade level{!isReadOnly && ' — add the first one below'}.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Subject</th>
                <th>In the schedule</th>
                <th>Teachers</th>
                {!isReadOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const isEditing = editing?.id === s.id;
                return (
                  <tr key={s.id}>
                    <td>
                      {isEditing ? (
                        <input
                          className="input" style={{ maxWidth: 220 }} autoFocus
                          value={editing.name}
                          onChange={(e) => setEditing((v) => ({ ...v, name: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(e); }}
                        />
                      ) : (
                        <>
                          <b>{s.name}</b>
                          {s.is_domain && <span className="pill pill-open" style={{ marginLeft: 8 }}>Domain</span>}
                        </>
                      )}
                    </td>
                    <td>
                      {s.scheduled_count > 0
                        ? `${s.scheduled_count} period${s.scheduled_count === 1 ? '' : 's'}`
                        : <span className="muted">Not scheduled</span>}
                    </td>
                    <td>
                      {s.teacher_count > 0
                        ? `${s.teacher_count} teacher${s.teacher_count === 1 ? '' : 's'}`
                        : <span className="muted">—</span>}
                    </td>
                    {!isReadOnly && (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {isEditing ? (
                          <>
                            <button className="btn btn-sm" onClick={handleSaveEdit} disabled={savingEdit || !editing.name.trim()}>
                              {savingEdit ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              className="link-action" style={{ marginLeft: 10 }}
                              onClick={() => { setEditing(null); setError(''); }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="link-action" style={{ marginRight: 10 }}
                              onClick={() => { setNotice(''); setError(''); setEditing({ id: s.id, name: s.name }); }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => { setNotice(''); setError(''); setRemoving(s); }}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isReadOnly && (
        <form onSubmit={handleAdd} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <input
            className="input" style={{ maxWidth: 240 }} placeholder="New subject name"
            value={newName} onChange={(e) => setNewName(e.target.value)} disabled={atLimit}
          />
          <button className="btn btn-sm btn-secondary" type="submit" disabled={adding || atLimit || !newName.trim()}>
            {adding ? 'Adding...' : '+ Add subject'}
          </button>
          {atLimit && (
            <span className="hint" style={{ margin: 0 }}>
              {gradeName || 'This grade level'} is at its limit of {maxSubjects} subjects — raise the limit or remove one first.
            </span>
          )}
        </form>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove subject"
          tone="danger"
          busy={removeBusy}
          // A scheduled subject cannot be removed at all, so the
          // dialog explains why instead of offering a button that
          // would only come back refused.
          disabled={removing.scheduled_count > 0}
          onConfirm={handleRemove}
          onClose={() => setRemoving(null)}
        >
          {removing.scheduled_count > 0 ? (
            <p>
              {removing.name} is still used in {removing.scheduled_count} scheduled
              period{removing.scheduled_count === 1 ? '' : 's'}. Remove those periods from the weekly
              schedule first — otherwise the timetable would lose the record of what was being taught.
            </p>
          ) : (
            <>
              <p>This takes {removing.name} off {gradeName || 'this grade level'} for the current school year.</p>
              {removing.teacher_count > 0 && (
                <p>
                  {removing.teacher_count} teacher{removing.teacher_count === 1 ? '' : 's'} {removing.teacher_count === 1 ? 'is' : 'are'} linked
                  to {removing.name} and {removing.teacher_count === 1 ? 'loses' : 'lose'} that link. Their other subjects and
                  their timetable are untouched.
                </p>
              )}
            </>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

// Learning domains first, then alphabetically — the same order the
// server's own listing uses, so a freshly added row lands where a
// reload would have put it.
function byDomainThenName(a, b) {
  if (a.is_domain !== b.is_domain) return a.is_domain ? -1 : 1;
  return a.name.localeCompare(b.name);
}
