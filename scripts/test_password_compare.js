require('dotenv').config();
const bcrypt = require('bcryptjs');
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
  const plain = process.argv[3] || '123456';
  if (!email) {
    console.error('Usage: node backend/scripts/test_password_compare.js <email> [password]');
    process.exit(1);
  }
  try {
    const col = await resolvePasswordColumn();
    const res = await db.query(`SELECT ${col} AS hash FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    if (res.rowCount === 0) {
      console.log(JSON.stringify({ found: false }, null, 2));
      process.exit(0);
    }
    const hash = res.rows[0].hash;
    const ok = await bcrypt.compare(plain, hash);
    console.log(JSON.stringify({ found: true, match: ok, passwordLength: hash?.length || 0 }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(2);
  }
}

main();

