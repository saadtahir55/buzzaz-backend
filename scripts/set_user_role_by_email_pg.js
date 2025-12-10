require('dotenv').config();
const pg = require('../services/db');

async function main() {
  const email = process.argv[2];
  const role = process.argv[3];
  if (!email || !role) {
    console.error('Usage: node backend/scripts/set_user_role_by_email_pg.js <email> <role>');
    process.exit(1);
  }

  const allowed = new Set(['brand','content_creator','influencer','ugc_creator','admin','support']);
  if (!allowed.has(role)) {
    console.error('Invalid role. Allowed:', Array.from(allowed).join(', '));
    process.exit(1);
  }

  try {
    const find = await pg.query('SELECT uid, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    if (find.rowCount === 0) {
      console.log(JSON.stringify({ updated: false, reason: 'USER_NOT_FOUND' }, null, 2));
      process.exit(0);
    }
    const uid = find.rows[0].uid;
    await pg.query('UPDATE users SET role = $1 WHERE uid = $2', [role, uid]);
    const check = await pg.query('SELECT uid, email, role FROM users WHERE uid = $1', [uid]);
    console.log(JSON.stringify({ updated: true, user: check.rows[0] }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error updating role:', err.message || err);
    process.exit(2);
  }
}

main();

