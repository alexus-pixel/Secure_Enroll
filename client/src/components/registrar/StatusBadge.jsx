const LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  resubmitted: 'Resubmitted',
  needs_revision: 'Needs Revision',
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function StatusBadge({ status }) {
  return <span className={`reg-badge reg-badge-${status}`}>{LABELS[status] || status}</span>;
}