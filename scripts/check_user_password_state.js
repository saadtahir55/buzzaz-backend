require('dotenv').config();
const db = require('../services/db');

async function resolvePasswordColumn() {
  const res = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name IN ('password','password_hash')"
  );
  const cols = res.rows.map(r => r.column_name);
  if (cols.includes('password')) return 'password';
  if (cols.includes('password_hash')) return 'password_hash';
  throw new Error('Users table missing password column');
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node backend/scripts/check_user_password_state.js <email>');
    process.exit(1);
  }

  try {
    const passwordCol = await resolvePasswordColumn();
    const { rows } = await db.query(`SELECT uid, email, role, is_active, (${passwordCol} IS NOT NULL) AS has_password, LENGTH(${passwordCol}) AS password_length FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    if (!rows.length) {
      console.log(JSON.stringify({ found: false }, null, 2));
    } else {
      console.log(JSON.stringify({ found: true, passwordCol, user: rows[0] }, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(2);
  }
}

main();

