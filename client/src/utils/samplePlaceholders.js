/**
 * The masked example shown in grey inside an empty box.
 *
 * A rule stated in a hint is read once; the example is there while the box is
 * being filled in, which is when the format actually matters. Every box on the
 * enrollment forms gets one, so a parent at the desk can see the shape of what
 * is wanted — twelve characters for an LRN, eleven for a number that starts 09
 * — instead of finding out from a red sentence after pressing Save.
 *
 * The shape only, never a sample that reads as a real value: everything past
 * the fixed part of a format is x's, and the rest names what belongs there. A
 * plausible name, address or number sitting in grey gets copied into the box
 * and submitted verbatim, and then there is a record nobody can tell from a
 * real one.
 *
 * Keyed by the field names the forms already use, so a box picks its example
 * up from here by passing nothing.
 */
const SAMPLE_PLACEHOLDERS = {
  // The learner
  firstName: 'Given name',
  middleName: 'Middle name (optional)',
  lastName: 'Family name',
  lrn: '1234xxxxxxxx',

  // The parent or guardian
  guardianFirstName: 'Given name',
  guardianMiddleName: 'Middle name (optional)',
  guardianLastName: 'Family name',
  guardianEmail: 'name@gmail.com',
  confirmEmail: 'Re-type name@gmail.com',
  guardianConfirmEmail: 'Re-type name@gmail.com',
  email: 'name@gmail.com',
  contactNumber: '09xxxxxxxxx',
  guardianContactNumber: '09xxxxxxxxx',
  relationshipOther: 'Relationship to the learner',
  guardianRelationshipOther: 'Relationship to the learner',
  address: 'House/Blk/Lot, Street, Barangay, City',
  guardianAddress: 'House/Blk/Lot, Street, Barangay, City',
  validIdNumber: '1234-xxxx-xxxx',
};

/** The example for one field, or '' when that field has none. */
export function sampleFor(field) {
  return SAMPLE_PLACEHOLDERS[field] || '';
}

export default SAMPLE_PLACEHOLDERS;
