const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pg = require('../services/db');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node backend/scripts/get_user_by_email_pg.js <email>');
    process.exit(1);
  }

  try {
    const { rows } = await pg.query(
      'SELECT uid, email, role, display_name, is_active, created_at, last_login_at FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    if (rows.length === 0) {
      console.log(JSON.stringify({ found: false }, null, 2));
    } else {
      console.log(JSON.stringify({ found: true, user: rows[0] }, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error('Error querying user by email:', err.message);
    process.exit(2);
  }
}

main();
