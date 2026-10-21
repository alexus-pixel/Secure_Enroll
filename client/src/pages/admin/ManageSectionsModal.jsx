import { useEffect, useState } from 'react';
import {
  updateSectionCapacity, updateSectionName, createSection, deleteSection,
  getAdviserOptions, setSectionAdviser,
} from '../../api/admin';
import ConfirmDialog from '../../components/ConfirmDialog';
import SectionStudentsModal from './SectionStudentsModal';

// A class bigger than this is not one a teacher can hold, and the server
// refuses it too (validators/settingsValidators.js).
const SECTION_MAX = 60;

export default function ManageSectionsModal({ gradeLevel, sections, allSections = [], onClose, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: '', capacity: '', adviserId: '' });
  const [newSection, setNewSection] = useState({ name: '', capacity: '' });
  const [error, setError] = useState('');
  const [teachers, setTeachers] = useState([]);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [saving, setSaving] = useState(null); // the section whose Save is waiting for a yes
  const [saveBusy, setSaveBusy] = useState(false);
  const [viewing, setViewing] = useState(null); // the section whose learners are being listed

  useEffect(() => { getAdviserOptions().then(setTeachers).catch(() => setTeachers([])); }, []);

  // A section name belongs to its grade level: Kinder and Grade 6 may both
  // have a section "1", but one grade level cannot hold the name twice, or
  // "Grade 6 - 1" names two classes. Only this grade's sections are compared.
  // A section being renamed is not a clash with itself.
  const nameTaken = (name, exceptId = null) => sections.find(
    (s) => s.id !== exceptId && s.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  const clash = newSection.name.trim() ? nameTaken(newSection.name) : null;
  const editClash = editingId && draft.name.trim() ? nameTaken(draft.name, editingId) : null;

  const clashSentence = (hit) => `${gradeLevel.name} already has a section called “${hit.name}”. `
    + 'Two sections of the same grade level cannot share a name.';

  // A teacher advises at most one section in the school year, so every teacher
  // who already advises one is looked up here by id. The server enforces the
  // same rule; this only lets the drop-down say which section is holding them
  // instead of letting an administrator pick a name that will be refused.
  const advisedBy = {};
  allSections.forEach((s) => {
    if (s.adviser_teacher_id) advisedBy[String(s.adviser_teacher_id)] = s;
  });
  // Why one section cannot be removed, as a sentence, or '' when it can.
  const removeBlockedBecause = (s) => (s.enrolled_count > 0
    ? `${s.name} has ${s.enrolled_count} learner${s.enrolled_count === 1 ? '' : 's'} placed in it, so it cannot `
      + 'be removed. Move them to another section of this grade level first.'
    : '');

  // The adviser is shown by name while the row is being read. The list of
  // teachers is what the drop-down offers, so the same name is used here; a
  // section whose adviser has since left the list still shows the name the
  // server sent with it.
  const adviserNameOf = (section) => {
    const picked = teachers.find((t) => String(t.id) === String(section.adviser_teacher_id));
    return picked ? picked.name : (section.adviser_name || 'No adviser');
  };

  function startEdit(section) {
    setError('');
    setEditingId(section.id);
    setDraft({
      name: section.name,
      capacity: String(section.capacity),
      adviserId: section.adviser_teacher_id ? String(section.adviser_teacher_id) : '',
    });
  }

  // What this Save would actually change — nothing to confirm if the
  // admin reopened the row and typed nothing.
  function changesFor(section) {
    const changes = [];
    const name = draft.name.trim();
    if (name && name !== section.name) changes.push({ field: 'name', value: name });
    const capacity = Number(draft.capacity);
    if (draft.capacity !== '' && capacity !== section.capacity) changes.push({ field: 'capacity', value: capacity });
    const adviserId = draft.adviserId ? Number(draft.adviserId) : null;
    const wasAdviserId = section.adviser_teacher_id ? Number(section.adviser_teacher_id) : null;
    if (adviserId !== wasAdviserId) {
      changes.push({
        field: 'adviser',
        value: adviserId,
        // The name is kept alongside the id so the confirmation can name the
        // teacher the administrator just picked rather than a bare number.
        label: adviserId ? (teachers.find((t) => t.id === adviserId)?.name || 'that teacher') : 'No adviser',
      });
    }
    return changes;
  }

  function askToSave(section) {
    setError('');
    const name = draft.name.trim();
    if (!name) return setError('Enter a section name.');
    if (name.length > 40) return setError('A section name can be at most 40 characters.');
    if (editClash) return setError(clashSentence(editClash));
    const capacity = Number(draft.capacity);
    if (!draft.capacity || !Number.isInteger(capacity) || capacity < 1) {
      return setError('Enter a valid number of slots (1 or more).');
    }
    // The server holds the same ceiling; this is so the form says it first.
    if (capacity > SECTION_MAX) {
      return setError(`A section can hold at most ${SECTION_MAX} learners.`);
    }
    if (capacity < section.enrolled_count) {
      return setError(`${section.name} already has ${section.enrolled_count} enrolled. Capacity can’t go below that.`);
    }
    const changes = changesFor(section);
    if (changes.length === 0) {
      setEditingId(null);
      return undefined;
    }
    setSaving({ section, changes });
    return undefined;
  }

  async function handleSave() {
    const { section, changes } = saving;
    setSaveBusy(true);
    setError('');
    try {
      // The name goes first: a refused name leaves the capacity alone too,
      // so one Save never half-applies in a way the admin cannot see.
      const rename = changes.find((c) => c.field === 'name');
      if (rename) await updateSectionName(section.id, rename.value);
      const recap = changes.find((c) => c.field === 'capacity');
      if (recap) await updateSectionCapacity(section.id, recap.value);
      const adviser = changes.find((c) => c.field === 'adviser');
      if (adviser) await setSectionAdviser(section.id, adviser.value);
      setSaving(null);
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this section.');
      setSaving(null);
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleRemove() {
    setError('');
    setRemoveBusy(true);
    try {
      await deleteSection(removing.id);
      setRemoving(null);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove section.');
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  }

  async function handleAddSection(e) {
    e.preventDefault();
    setError('');
    if (clash) {
      setError(clashSentence(clash));
      return;
    }
    try {
      await createSection({
        name: newSection.name, gradeLevelId: gradeLevel.id, capacity: Number(newSection.capacity),
      });
      setNewSection({ name: '', capacity: '' });
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add section.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{gradeLevel.name} Sections</h2>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="table-wrap">
          <table className="data" style={{ marginBottom: 16 }}>
            <thead><tr><th>Section</th><th>Adviser</th><th>Slots</th><th>Enrolled</th><th>Left</th><th></th></tr></thead>
            <tbody>
              {sections.map((s) => (
                <tr key={s.id}>
                  <td>
                    {editingId === s.id ? (
                      <>
                        <input
                          className={`input${editClash ? ' input-error' : ''}`} style={{ minWidth: 140 }}
                          aria-label={`Name of ${s.name}`} maxLength={40} value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                        {editClash && (
                          <p className="field-error" style={{ margin: '4px 0 0', maxWidth: 240 }}>
                            {clashSentence(editClash)}
                          </p>
                        )}
                      </>
                    ) : s.name}
                  </td>
                  <td>
                    {editingId === s.id ? (
                      <select
                        className="input" style={{ minWidth: 190, padding: '4px 6px' }}
                        aria-label={`Adviser for ${s.name}`}
                        value={draft.adviserId}
                        onChange={(e) => setDraft({ ...draft, adviserId: e.target.value })}
                      >
                        <option value="">No adviser</option>
                        {teachers.map((t) => {
                          // A teacher already advising another section is still
                          // listed, named with the section that holds them, so
                          // the administrator can see where to go and release
                          // them rather than wondering why a name is missing.
                          const held = advisedBy[String(t.id)];
                          const elsewhere = held && held.id !== s.id;
                          return (
                            <option key={t.id} value={t.id} disabled={Boolean(elsewhere)}>
                              {elsewhere ? `${t.name} — advises ${held.grade_level_name} ${held.name}` : t.name}
                            </option>
                          );
                        })}
                      </select>
                    ) : adviserNameOf(s)}
                  </td>
                  <td>
                    {editingId === s.id ? (
                      <input
                        className="input" style={{ width: 80 }} type="number" min="1" max={SECTION_MAX}
                        aria-label={`Slots for ${s.name}`}
                        value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                      />
                    ) : s.capacity}
                  </td>
                  <td>
                    <button className="link-action" onClick={() => setViewing(s)} type="button">
                      {s.enrolled_count}
                    </button>
                  </td>
                  <td>{s.slots_left}</td>
                  {/* The three row actions read as one line; at the larger type
                      size they would otherwise break across two and make every
                      row a different height. */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {editingId === s.id ? (
                      <>
                        <button
                          className="link-action" type="button" onClick={() => askToSave(s)}
                          disabled={Boolean(editClash)} style={{ marginRight: 10 }}
                        >
                          Save
                        </button>
                        <button className="link-action" type="button" onClick={() => { setEditingId(null); setError(''); }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="link-action" type="button" onClick={() => startEdit(s)} style={{ marginRight: 10 }}>Edit</button>
                        <button className="link-action" type="button" onClick={() => setViewing(s)} style={{ marginRight: 10 }}>
                          View learners
                        </button>
                        <button
                          className="link-action" type="button" onClick={() => setRemoving(s)}
                          style={{ color: 'var(--danger)' }} disabled={Boolean(removeBlockedBecause(s))}
                          title={removeBlockedBecause(s)}
                          aria-describedby={removeBlockedBecause(s) ? `why-${s.id}` : undefined}
                        >
                          Remove
                        </button>
                        {removeBlockedBecause(s) && (
                          <p id={`why-${s.id}`} className="hint" style={{ margin: '4px 0 0', maxWidth: 260, whiteSpace: 'normal' }}>
                            {removeBlockedBecause(s)}
                          </p>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleAddSection} className="admin-form" style={{ padding: 0, border: 'none', flexWrap: 'wrap' }}>
          <input
            className={`input${clash ? ' input-error' : ''}`} placeholder="Section name" value={newSection.name}
            aria-label="Section name" maxLength={40}
            onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} required
          />
          <input className="input" placeholder="Slots" type="number" min="1" max={SECTION_MAX} style={{ maxWidth: 100 }} aria-label="Slots"
            value={newSection.capacity} onChange={(e) => setNewSection({ ...newSection, capacity: e.target.value })} required />
          <button className="btn btn-primary" type="submit" disabled={Boolean(clash)}>Save</button>
          {clash ? (
            <p className="field-error" style={{ width: '100%', margin: 0 }}>
              {clash.grade_level_name} already has a section called &ldquo;{clash.name}&rdquo;. Section names are
              unique across the whole school year.
            </p>
          ) : (
            <p className="hint" style={{ width: '100%', margin: 0 }}>
              A section name has to be unique across the whole school year, not just within this grade level.
              A section is shown as it stands until you press Edit; its name, slots and adviser can then all
              be changed together. A teacher can advise only one section, and a section with learners in it
              cannot be removed.
            </p>
          )}
        </form>
      </div>

      {saving && (
        <ConfirmDialog
          title={`Save changes to ${saving.section.name}?`}
          confirmLabel="Save changes"
          busy={saveBusy}
          onConfirm={handleSave}
          onClose={() => setSaving(null)}
        >
          <ul style={{ margin: '0 0 8px 18px', padding: 0 }}>
            {saving.changes.map((c) => (
              <li key={c.field}>
                {c.field === 'name' && <>Name: <b>{saving.section.name}</b> &rarr; <b>{c.value}</b></>}
                {c.field === 'capacity' && <>Slots: <b>{saving.section.capacity}</b> &rarr; <b>{c.value}</b></>}
                {c.field === 'adviser' && (
                  <>Adviser: <b>{adviserNameOf(saving.section)}</b> &rarr; <b>{c.label}</b></>
                )}
              </li>
            ))}
          </ul>
          {saving.changes.some((c) => c.field === 'name') && (
            <p className="hint" style={{ margin: 0 }}>
              The name is used on master lists and class schedules, so it changes everywhere this section appears.
            </p>
          )}
        </ConfirmDialog>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove section"
          tone="danger"
          busy={removeBusy}
          onConfirm={handleRemove}
          onClose={() => setRemoving(null)}
        >
          <p>Any class schedule assigned to this section is removed with it.</p>
          <p>
            A section with learners placed in it cannot be removed. Move them to another section of this
            grade level first.
          </p>
        </ConfirmDialog>
      )}

      {viewing && (
        <SectionStudentsModal section={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
