require('dotenv').config();
const db = require('../services/db');

(async () => {
  try {
    const check = await db.query("SELECT to_regclass('public.password_resets') AS exists");
    if (check.rows[0].exists) {
      console.log('password_resets table exists');
      process.exit(0);
    }
    console.log('Creating password_resets table...');
    await db.query(`
      CREATE TABLE public.password_resets (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        used_at TIMESTAMP NULL
      );
    `);
    console.log('password_resets table created');
    process.exit(0);
  } catch (err) {
    console.error('Ensure password_resets error:', err);
    process.exit(1);
  }
})();

