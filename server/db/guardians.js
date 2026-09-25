async function upsertGuardian(db, { userId, firstName, middleName, lastName, contactNumber, address, validIdType }) {
  const key = process.env.ENCRYPTION_KEY;
  const result = await db.query(
    `INSERT INTO guardians (user_id, first_name, middle_name, last_name, contact_number, address, valid_id_type)
     VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5::text, $8), pgp_sym_encrypt($6::text, $8), $7)
     ON CONFLICT (user_id) DO UPDATE SET
       first_name = EXCLUDED.first_name, middle_name = EXCLUDED.middle_name,
       last_name = EXCLUDED.last_name, contact_number = EXCLUDED.contact_number,
       address = EXCLUDED.address, valid_id_type = EXCLUDED.valid_id_type, updated_at = NOW()
     RETURNING user_id`,
    [userId, firstName, middleName || null, lastName, contactNumber, address, validIdType || null, key]
  );
  return result.rows[0].user_id;
}

// Used right after account creation: no address yet, that's collected
// later at enrollment, so upsertGuardian is called with address: null.
async function createGuardianProfile(db, { userId, firstName, middleName, lastName, contactNumber }) {
  return upsertGuardian(db, {
    userId, firstName, middleName, lastName, contactNumber, address: null, validIdType: null,
  });
}

// Profile fields only — the /auth/me and Account Settings screens never
// need to decrypt contact_number or address, so we don't touch pgcrypto here.
async function getGuardianProfile(db, userId) {
  const result = await db.query(
    `SELECT first_name, middle_name, last_name FROM guardians WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function updateGuardianProfile(db, userId, { firstName, middleName, lastName }) {
  const result = await db.query(
    `UPDATE guardians
     SET first_name = $2, middle_name = $3, last_name = $4, updated_at = NOW()
     WHERE user_id = $1
     RETURNING first_name, middle_name, last_name`,
    [userId, firstName, middleName || null, lastName]
  );
  return result.rows[0] || null;
}

module.exports = { upsertGuardian, createGuardianProfile, getGuardianProfile, updateGuardianProfile };