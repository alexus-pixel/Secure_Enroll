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

module.exports = { upsertGuardian };