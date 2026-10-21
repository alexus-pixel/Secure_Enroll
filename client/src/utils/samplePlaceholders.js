/**
 * The example shown in grey inside an empty box.
 *
 * A rule stated in a hint is read once; the example is there while the box is
 * being filled in, which is when the format actually matters. Every box on the
 * enrollment forms gets one, so a parent at the desk can see the shape of what
 * is wanted — twelve digits, one leading 09, a name without a title — instead
 * of finding out from a red sentence after pressing Save.
 *
 * None of these are real people, real addresses or real numbers: an example
 * that happens to be somebody's actual address is the kind of thing that ends
 * up submitted verbatim.
 *
 * Keyed by the field names the forms already use, so a box picks its example
 * up from here by passing nothing.
 */
const SAMPLE_PLACEHOLDERS = {
  // The learner
  firstName: 'e.g. Maria Lourdes',
  middleName: 'e.g. Bautista',
  lastName: 'e.g. Dela Cruz',
  lrn: 'e.g. 136482910573',

  // The parent or guardian
  guardianFirstName: 'e.g. Juan',
  guardianMiddleName: 'e.g. Reyes',
  guardianLastName: 'e.g. Dela Cruz',
  guardianEmail: 'e.g. juandelacruz@gmail.com',
  confirmEmail: 'Re-type it, e.g. juandelacruz@gmail.com',
  guardianConfirmEmail: 'Re-type it, e.g. juandelacruz@gmail.com',
  email: 'e.g. juandelacruz@gmail.com',
  contactNumber: 'e.g. 09171234567',
  guardianContactNumber: 'e.g. 09171234567',
  relationshipOther: 'e.g. Aunt, foster parent',
  guardianRelationshipOther: 'e.g. Aunt, foster parent',
  // House and street made up on purpose; the barangay and city are the
  // school's own, which is where every learner here lives.
  address: 'e.g. Blk 7 Lot 12, Sampaguita St., Brgy. 176, Caloocan City',
  guardianAddress: 'e.g. Blk 7 Lot 12, Sampaguita St., Brgy. 176, Caloocan City',
  validIdNumber: 'e.g. 1234-5678-9012',
};

/** The example for one field, or '' when that field has none. */
export function sampleFor(field) {
  return SAMPLE_PLACEHOLDERS[field] || '';
}

export default SAMPLE_PLACEHOLDERS;
