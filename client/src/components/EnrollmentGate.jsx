import { CalendarX2 } from 'lucide-react';

// Shows the "enrollment is closed" notice at the top and turns every input,
// select and button inside it off. While enrollment is open it renders its
// children unchanged.
export default function EnrollmentGate({ closed, title, message, children }) {
  return (
    <>
      {closed && (
        <div className="enroll-closed" role="alert">
          <CalendarX2 size={22} aria-hidden="true" />
          <div>
            <strong>{title}</strong>
            <p>{message}</p>
          </div>
        </div>
      )}
      <fieldset className={`enroll-gate${closed ? ' is-closed' : ''}`} disabled={closed}>
        {children}
      </fieldset>
    </>
  );
}
