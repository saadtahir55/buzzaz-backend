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
  try {
    const targetPassword = '123456';
    const hash = await bcrypt.hash(targetPassword, 12);
    const passwordCol = await resolvePasswordColumn();

    // Update all users' password to the new hash
    const updateSql = `UPDATE users SET ${passwordCol} = $1`;
    const result = await db.query(updateSql, [hash]);

    console.log(JSON.stringify({
      success: true,
      passwordCol,
      affectedRows: result.rowCount || null
    }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Reset all passwords error:', err.message || err);
    process.exit(1);
  }
}

main();

