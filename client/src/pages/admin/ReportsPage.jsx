import { useState } from 'react';
import {
  downloadMasterEnrollmentList, downloadApplicationStatusReport, downloadPendingApplications,
  downloadRegistrarActivityReport, downloadDuplicateFlagsReport, downloadGradeLevelCapacityReport,
} from '../../api/admin';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

// Converts a "last N days" choice into the {from, to} dates the
// backend's date filter expects; "all" sends neither, which the
// backend treats as no filter at all rather than some arbitrary
// default window quietly hiding older records.
function rangeToDates(rangeValue) {
  if (rangeValue === 'all') return {};
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - Number(rangeValue));
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function ReportCard({ title, description, formats, onExport }) {
  const [range, setRange] = useState('30');
  const [busyFormat, setBusyFormat] = useState(null);
  const [error, setError] = useState('');

  async function handleExport(format) {
    setError('');
    setBusyFormat(format);
    try {
      await onExport(rangeToDates(range), format);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not generate this report.');
    } finally {
      setBusyFormat(null);
    }
  }

  return (
    <div className="card">
      <strong>{title}</strong>
      <p className="cell-sub" style={{ marginTop: 4, marginBottom: 12 }}>{description}</p>

      <label className="label" style={{ fontSize: 11 }}>Date range</label>
      <select className="input" value={range} onChange={(e) => setRange(e.target.value)} style={{ marginBottom: 12 }}>
        {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {formats.map((f) => (
          <button
            key={f.value} className="btn btn-secondary btn-sm"
            onClick={() => handleExport(f.value)} disabled={busyFormat !== null}
          >
            {busyFormat === f.value ? '\u2026' : '\u2193'} {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reports &amp; Export</h1>
          <p>Generate and download enrollment data reports.</p>
        </div>
      </div>

      <div className="settings-grid">
        <ReportCard
          title="Master Enrollment List"
          description="All enrolled learners with LRN, grade, section, and guardian info."
          formats={[{ value: 'csv', label: 'CSV' }, { value: 'pdf', label: 'PDF' }, { value: 'excel', label: 'Excel' }]}
          onExport={(dates, format) => downloadMasterEnrollmentList(dates, format === 'pdf' ? 'pdf' : 'csv')}
        />
        <ReportCard
          title="Application Status Report"
          description="Summary of applications by status, grade level, and date range."
          formats={[{ value: 'csv', label: 'CSV' }]}
          onExport={(dates) => downloadApplicationStatusReport(dates)}
        />
        <ReportCard
          title="Pending Applications"
          description="All applications awaiting review or with missing documents."
          formats={[{ value: 'csv', label: 'CSV' }]}
          onExport={(dates) => downloadPendingApplications(dates)}
        />
        <ReportCard
          title="Registrar Activity Report"
          description="Actions performed by each registrar within a date range."
          formats={[{ value: 'csv', label: 'CSV' }]}
          onExport={(dates) => downloadRegistrarActivityReport(dates)}
        />
        <ReportCard
          title="Duplicate Flags Report"
          description="All applications flagged for possible duplicate enrollment."
          formats={[{ value: 'csv', label: 'CSV' }]}
          onExport={(dates) => downloadDuplicateFlagsReport(dates)}
        />
        <ReportCard
          title="Grade Level Capacity"
          description="Current enrollment vs. maximum slots, Kinder to Grade 6."
          formats={[{ value: 'csv', label: 'CSV' }]}
          onExport={(dates) => downloadGradeLevelCapacityReport(dates)}
        />
      </div>
    </div>
  );
}
