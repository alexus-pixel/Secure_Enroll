import { useState } from 'react';
import { updateSectionCapacity, createSection, deleteSection } from '../../api/admin';

export default function ManageSectionsModal({ gradeLevel, sections, onClose, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [capacityDraft, setCapacityDraft] = useState('');
  const [newSection, setNewSection] = useState({ name: '', capacity: '' });
  const [error, setError] = useState('');

  async function saveCapacity(id) {
    setError('');
    const capacity = Number(capacityDraft);
    if (!capacityDraft || !Number.isInteger(capacity) || capacity < 1) {
      setError('Enter a valid number of slots (1 or more).');
      return;
    }
    try {
      await updateSectionCapacity(id, capacity);
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update capacity.');
    }
  }

  async function handleRemove(section) {
    setError('');
    if (!window.confirm(`Remove ${section.name}? Any class schedule already assigned to it will be removed too.`)) return;
    try {
      await deleteSection(section.id);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove section.');
    }
  }

  async function handleAddSection(e) {
    e.preventDefault();
    setError('');
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
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{gradeLevel.name} Sections</h2>
          <button className="btn-ghost" onClick={onClose} type="button">Close</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}

        <table className="data" style={{ marginBottom: 16 }}>
          <thead><tr><th>Section</th><th>Slots</th><th>Enrolled</th><th></th></tr></thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  {editingId === s.id ? (
                    <input
                      className="input" style={{ width: 80 }} type="number" min="1"
                      value={capacityDraft} onChange={(e) => setCapacityDraft(e.target.value)}
                    />
                  ) : s.capacity}
                </td>
                <td>{s.enrolled_count}</td>
                <td>
                  {editingId === s.id ? (
                    <button className="link-action" onClick={() => saveCapacity(s.id)}>Save</button>
                  ) : (
                    <>
                      <button className="link-action" onClick={() => { setEditingId(s.id); setCapacityDraft(String(s.capacity)); }} style={{ marginRight: 10 }}>Edit</button>
                      <button
                        className="link-action" onClick={() => handleRemove(s)}
                        style={{ color: 'var(--danger)' }} disabled={s.enrolled_count > 0}
                        title={s.enrolled_count > 0 ? 'Has enrolled students — cannot be removed' : ''}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={handleAddSection} className="admin-form" style={{ padding: 0, border: 'none' }}>
          <input className="input" placeholder="Section name" value={newSection.name} onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} required />
          <input className="input" placeholder="Slots" type="number" min="1" style={{ maxWidth: 100 }} value={newSection.capacity} onChange={(e) => setNewSection({ ...newSection, capacity: e.target.value })} required />
          <button className="btn btn-primary" type="submit">Save</button>
        </form>
      </div>
    </div>
  );
}