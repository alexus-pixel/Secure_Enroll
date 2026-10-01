import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getTeachers, getTeacher, createTeacher, updateTeacher } from '../../api/admin';
import TeacherFormModal from './TeacherFormModal';

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const [editingTeacher, setEditingTeacher] = useState(null); // null | 'new' | teacher
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    getTeachers(search).then(setTeachers).catch((err) => setError(err.response?.data?.message || 'Could not load teachers.'));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(form) {
    await createTeacher({ ...form, subjectIds: form.subjectIds });
    setEditingTeacher(null);
    load();
  }

  async function handleEdit(form) {
    const updated = await updateTeacher(editingTeacher.id, form);
    setEditingTeacher(null);
    if (updated.clearedSchedules > 0) {
      setNotice(`${updated.clearedSchedules} class assignment${updated.clearedSchedules === 1 ? '' : 's'} removed since this teacher is now marked retired.`);
    } else {
      setNotice('');
    }
    load();
  }

  async function openEdit(t) {
    setError('');
    // The list row only carries subject/grade *names* for display —
    // editing needs the real record (degree, major, sex, address,
    // contact number, and actual subject ids), or the form would
    // silently reopen blank and overwrite all of that on save.
    try {
      const full = await getTeacher(t.id);
      setEditingTeacher(full);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this teacher.');
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Teachers</h1>
          <p>See each teacher's subjects, grade levels, and weekly load before assigning a new class.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditingTeacher('new')}>+ Add Teacher</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>{notice}</div>}

      <div className="search-box">
        <Search size={15} className="search-box-icon" />
        <input
          className="admin-search-input" placeholder="Search teachers..."
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card card-flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Teacher</th><th>Grade Levels</th><th>Weekly Load</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const pct = Math.min(100, (t.weekly_load / t.weekly_load_cap) * 100);
                const full = t.weekly_load >= t.weekly_load_cap;
                return (
                  <tr key={t.id}>
                    <td>
                      <b>{t.last_name}, {t.first_name}</b>
                      <div className="cell-sub">{(t.subjects || []).join(', ') || '\u2014'}</div>
                    </td>
                    <td>{(t.grade_levels || []).join(', ') || '\u2014'}</td>
                    <td style={{ minWidth: 160 }}>
                      <div style={{ fontSize: 11.5, marginBottom: 3 }}>{t.weekly_load}/{t.weekly_load_cap} periods</div>
                      <div className="grade-card-fill-bar" style={{ margin: 0 }}>
                        <div style={{ width: `${pct}%`, background: full ? 'var(--danger)' : 'var(--accent)' }} />
                      </div>
                    </td>
                    <td>
                      {t.status === 'retired' ? <span className="pill pill-draft">Retired</span>
                        : t.status === 'locked' ? <span className="pill pill-open" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>Locked</span>
                          : full ? <span className="pill pill-needs_revision">Fully booked</span>
                            : <span className="pill pill-approved">Available</span>}
                    </td>
                    <td>
                      <button className="link-action" onClick={() => openEdit(t)} style={{ marginRight: 10 }}>Edit</button>
                      <Link to={`/admin/teachers/${t.id}`}>View schedule</Link>
                    </td>
                  </tr>
                );
              })}
              {teachers.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No teachers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingTeacher && (
        <TeacherFormModal
          mode={editingTeacher === 'new' ? 'create' : 'edit'}
          teacher={editingTeacher === 'new' ? null : editingTeacher}
          onClose={() => setEditingTeacher(null)}
          onSubmit={editingTeacher === 'new' ? handleCreate : handleEdit}
        />
      )}
    </div>
  );
}
