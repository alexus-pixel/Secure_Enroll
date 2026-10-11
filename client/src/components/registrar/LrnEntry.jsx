import { useState } from 'react';
import api from '../../api/client';

export default function LrnEntry({ studentId, onSaved }) {
  const [lrn, setLrn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    if (!/^\d{12}$/.test(lrn)) {
      setError('LRN must be exactly 12 digits.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/registrar/students/${studentId}/lrn`, { lrn });
      setLrn('');
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the LRN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={lrn}
          onChange={(e) => setLrn(e.target.value.replace(/\D/g, '').slice(0, 12))}
          inputMode="numeric"
          maxLength={12}
          placeholder="12-digit LRN"
          aria-label="LRN"
        />
        <button type="button" onClick={save} disabled={busy || lrn.length !== 12}>
          {busy ? 'Saving...' : 'Save LRN'}
        </button>
      </div>
      {error && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 4 }}>{error}</div>}
    </div>
  );
}