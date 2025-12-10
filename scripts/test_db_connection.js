require('dotenv').config();
const db = require('../services/db');

(async () => {
  try {
    const res = await db.query('SELECT version(), current_database()');
    console.log('Connected to Postgres:', res.rows[0].version, 'DB:', res.rows[0].current_database);
    process.exit(0);
  } catch (err) {
    console.error('DB connection error:', err);
    process.exit(1);
  }
})();

