require('dotenv').config();
const db = require('../services/db');

const REQUIRED_COLUMNS = [
  { name: 'role', ddl: "ALTER TABLE public.users ADD COLUMN role TEXT DEFAULT 'content_creator'" },
  { name: 'is_active', ddl: "ALTER TABLE public.users ADD COLUMN is_active BOOLEAN DEFAULT TRUE" },
  { name: 'password', ddl: "ALTER TABLE public.users ADD COLUMN password TEXT" },
  { name: 'email_verified', ddl: "ALTER TABLE public.users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE" },
  { name: 'last_login_at', ddl: "ALTER TABLE public.users ADD COLUMN last_login_at TIMESTAMP NULL" }
];

(async () => {
  try {
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'");
    const cols = new Set(res.rows.map(r => r.column_name));
    const missing = REQUIRED_COLUMNS.filter(c => !cols.has(c.name));
    if (missing.length === 0) {
      console.log('All required columns already exist.');
      process.exit(0);
    }
    for (const m of missing) {
      console.log('Adding column:', m.name);
      await db.query(m.ddl);
    }
    console.log('Users table updated.');
    process.exit(0);
  } catch (err) {
    console.error('Ensure columns error:', err);
    process.exit(1);
  }
})();

