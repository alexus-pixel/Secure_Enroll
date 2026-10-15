// What each document decision means, in the words shown to the registrar.
export const DOC_ACTIONS = {
  verified: { label: 'Verify', cls: 'reg-btn-green', hint: 'The document is correct and readable.' },
  flagged: { label: 'Flag', cls: 'reg-btn-amber', hint: 'Something needs the parent\u2019s attention, but the document is not refused outright.' },
  rejected: { label: 'Reject', cls: 'reg-btn-red', hint: 'The document is not acceptable and the parent must upload a new one.' },
};

export const DOC_STATUS_LABEL = {
  awaiting: 'Awaiting parent',
  pending: 'Pending review',
  verified: 'Verified',
  flagged: 'Flagged',
  rejected: 'Rejected',
};
