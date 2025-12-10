const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_EXPIRY = '7d';

function ensureJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

async function findUserByEmail(email) {
  const passwordCol = await resolvePasswordColumn();
  const res = await db.query(
    `SELECT uid, email, role, display_name, ${passwordCol} AS password_hash, is_active FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  return res.rows[0] || null;
}

async function findUserByUid(uid) {
  const res = await db.query('SELECT uid, email, role, display_name, is_active FROM users WHERE uid = $1 LIMIT 1', [uid]);
  return res.rows[0] || null;
}

let passwordColumnCache = null;

async function resolvePasswordColumn() {
  if (passwordColumnCache) return passwordColumnCache;
  const res = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name IN ('password_hash','password')"
  );
  const cols = res.rows.map(r => r.column_name);
  if (cols.includes('password')) {
    passwordColumnCache = 'password';
  } else if (cols.includes('password_hash')) {
    passwordColumnCache = 'password_hash';
  } else {
    throw new Error('No password column found on users table');
  }
  return passwordColumnCache;
}

async function register({ email, password, role = 'content_creator', displayName }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('User already exists');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const uid = `u_${Date.now().toString(36)}`;
  const passwordCol = await resolvePasswordColumn();
  await db.query(
    `INSERT INTO users (uid, email, role, display_name, ${passwordCol}, created_at, is_active) VALUES ($1, $2, $3, $4, $5, NOW(), TRUE)`,
    [uid, email, role, displayName || null, passwordHash]
  );
  const secret = ensureJwtSecret();
  const token = jwt.sign({ uid, email, role }, secret, { expiresIn: JWT_EXPIRY });
  return { token, user: { uid, email, role, displayName: displayName || null } };
}

async function login({ email, password }) {
  const user = await findUserByEmail(email);
  if (!user || !user.is_active) {
    throw new Error('Invalid credentials');
  }
  if (!user.password_hash) {
    // Migrated users from Firebase may not have a password set yet
    const err = new Error('PASSWORD_NOT_SET');
    err.code = 'PASSWORD_NOT_SET';
    throw err;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new Error('Invalid credentials');
  }
  await db.query('UPDATE users SET last_login_at = NOW() WHERE uid = $1', [user.uid]);
  const secret = ensureJwtSecret();
  const token = jwt.sign({ uid: user.uid, email: user.email, role: user.role }, secret, { expiresIn: JWT_EXPIRY });
  return { token, user: { uid: user.uid, email: user.email, role: user.role, displayName: user.display_name } };
}

function verifyToken(token) {
  const secret = ensureJwtSecret();
  return jwt.verify(token, secret);
}

module.exports = { register, login, verifyToken, findUserByEmail, findUserByUid };
