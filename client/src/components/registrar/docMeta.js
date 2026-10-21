/**
 * What each document decision means, in the words shown to the registrar.
 *
 * There are two, because there are only two things a registrar can conclude
 * about a file: it is acceptable, or it is not and the parent has to send
 * another. Flagging used to sit between them and said neither — a flagged
 * document blocked approval exactly as a rejected one did, so it was a reject
 * that did not tell the parent to replace anything. The status is still
 * understood everywhere (old rows carry it) but it is no longer offered.
 */
export const DOC_ACTIONS = {
  verified: { label: 'Verify', cls: 'reg-btn-green', hint: 'The document is correct and readable.' },
  rejected: { label: 'Reject', cls: 'reg-btn-red', hint: 'The document is not acceptable and the parent must upload a new one.' },
};

export const DOC_STATUS_LABEL = {
  awaiting: 'Awaiting parent',
  pending: 'Pending review',
  verified: 'Verified',
  flagged: 'Flagged',
  rejected: 'Rejected',
};
