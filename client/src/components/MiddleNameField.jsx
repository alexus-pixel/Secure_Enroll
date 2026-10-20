import { NAME_MAX } from '../utils/validators';

/**
 * A middle name box with a "No middle name" tick under it.
 *
 * A blank box and a learner who has no middle name are different facts, and
 * only one of them is a mistake. Ticking the box empties and disables the
 * field, so what is saved says "there is none" rather than "nobody filled
 * this in" — which matters here, because two learners are told apart by their
 * full name, middle name included.
 *
 * The tick is sent to the server as its own value; the server applies the same
 * rule, so an empty middle name is refused unless the tick says it is meant.
 */
export default function MiddleNameField({
  id,
  label = 'Middle name',
  value,
  none,
  error,
  onChange,
  onToggleNone,
  onBlur,
  autoComplete = 'off',
  placeholder = 'e.g. Bautista',
  className = 'input',
  errorClassName = 'field-error',
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`${className}${error ? ' input-error' : ''}`}
        value={none ? '' : value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={none ? '' : placeholder}
        disabled={none}
        maxLength={NAME_MAX}
        autoComplete={autoComplete}
        aria-invalid={error ? 'true' : undefined}
      />
      <label className="checkbox-inline" htmlFor={`${id}_none`}>
        <input
          id={`${id}_none`}
          type="checkbox"
          checked={Boolean(none)}
          onChange={(e) => onToggleNone(e.target.checked)}
        />
        <span>No middle name</span>
      </label>
      {error && <p className={errorClassName}>{error}</p>}
    </div>
  );
}
