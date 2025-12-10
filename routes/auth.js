const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const authService = require('../services/authService');
const pg = require('../services/db');

const router = express.Router();

// Register endpoint
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['brand', 'content_creator', 'influencer', 'ugc_creator', 'admin', 'support']).withMessage('Invalid role selected')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password, role, displayName } = req.body;
    const result = await authService.register({ email, password, role, displayName });
    return res.status(201).json({ message: 'User created successfully', ...result });
  } catch (error) {
    console.error('Registration error:', error);
    const raw = String(error?.message || error);
    if (raw === 'JWT_SECRET is not configured') {
      const status = 500;
      const msg = 'Server configuration error';
      if (process.env.NODE_ENV !== 'production') {
        return res.status(status).json({ message: msg, error: raw });
      }
      return res.status(status).json({ message: msg });
    }
    const msg = error?.message === 'User already exists' ? 'User already exists' : 'Server error during registration';
    const status = error?.message === 'User already exists' ? 400 : 500;
    if (process.env.NODE_ENV !== 'production') {
      return res.status(status).json({ message: msg, error: raw });
    }
    return res.status(status).json({ message: msg });
  }
});

// Login endpoint
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    return res.json({ message: 'Login successful', ...result });
  } catch (error) {
    const msg = String(error?.message || error);
    console.error('Login error:', msg);
    // More informative responses for common cases
    if (msg === 'PASSWORD_NOT_SET') {
      return res.status(422).json({ message: 'Password not set for this account. Please reset your password.' });
    }
    if (msg === 'JWT_SECRET is not configured') {
      return res.status(500).json({ message: 'Server configuration error' });
    }
    return res.status(401).json({ message: 'Invalid credentials, please try again' });
  }
});

// Verify token endpoint
router.post('/verify', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }
    const payload = authService.verifyToken(token);
    const user = await authService.findUserByUid(payload.uid);
    if (!user) return res.status(401).json({ message: 'User not found' });
    res.json({ valid: true, user: { uid: user.uid, email: user.email, role: user.role, displayName: user.display_name } });
  } catch (error) {
    res.status(401).json({ valid: false, message: 'Invalid token' });
  }
});

// Forgot password endpoint (Postgres)
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;
    const user = await authService.findUserByEmail(email);
    // Always respond success to avoid account enumeration
    if (!user) {
      return res.json({ message: 'If the email exists, a reset link has been sent.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pg.query(
      'INSERT INTO password_resets (token, user_id, email, created_at, expires_at, used) VALUES ($1, $2, $3, NOW(), $4, FALSE)',
      [token, user.uid, email, expiresAt]
    );
    const resetLink = `${process.env.FRONTEND_BASE_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    let emailSent = false;
    let emailError = null;
    if (emailUser && emailPass) {
      try {
        const transporter = nodemailer.createTransport({
          service: process.env.EMAIL_SERVICE || 'gmail',
          auth: { user: emailUser, pass: emailPass }
        });
        await transporter.sendMail({
          from: emailUser,
          to: email,
          subject: 'Buzzaz Password Reset',
          html: `
            <p>You requested a password reset.</p>
            <p>Click <a href="${resetLink}">here</a> to set a new password. This link expires in 1 hour.</p>
            <p>If you did not request this, please ignore this email.</p>
          `
        });
        emailSent = true;
      } catch (err) {
        console.error('Error sending reset email:', err);
        emailError = err.message;
      }
    }
    const responsePayload = { message: 'If the email exists, a reset link has been sent.' };
    if (!emailSent && process.env.NODE_ENV !== 'production') {
      responsePayload.devResetLink = resetLink;
      if (emailError) responsePayload.emailError = emailError;
    }
    res.json(responsePayload);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error during password reset request' });
  }
});

// Reset password endpoint (Postgres)
router.post('/reset-password', [
  body('token').isString().notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { token, newPassword } = req.body;
    const resetRes = await pg.query('SELECT token, user_id, expires_at, used FROM password_resets WHERE token = $1 LIMIT 1', [token]);
    if (resetRes.rowCount === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    const resetRow = resetRes.rows[0];
    if (resetRow.used) {
      return res.status(400).json({ message: 'Token has already been used' });
    }
    if (new Date(resetRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ message: 'Token has expired' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const colsRes = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name IN ('password','password_hash')");
    const cols = colsRes.rows.map(r => r.column_name);
    const passwordCol = cols.includes('password') ? 'password' : (cols.includes('password_hash') ? 'password_hash' : null);
    if (!passwordCol) {
      return res.status(500).json({ message: 'Users table missing password column' });
    }
    await pg.query(`UPDATE users SET ${passwordCol} = $1, last_login_at = NULL WHERE uid = $2`, [hashedPassword, resetRow.user_id]);
    await pg.query('UPDATE password_resets SET used = TRUE, used_at = NOW() WHERE token = $1', [token]);
    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error during password reset' });
  }
});

// Development-only: seed or update a user for testing
router.post('/dev/seed-user', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Not available in production' });
    }
    const { email, password, role = 'influencer' } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    // Determine password column for compatibility
    const colsRes = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('password','password_hash')");
    const cols = colsRes.rows.map(r => r.column_name);
    const passwordCol = cols.includes('password') ? 'password' : (cols.includes('password_hash') ? 'password_hash' : null);
    if (!passwordCol) {
      return res.status(500).json({ message: 'Users table missing password column' });
    }
    const existing = await pg.query('SELECT uid FROM users WHERE email = $1 LIMIT 1', [email]);
    if (existing.rowCount === 0) {
      const uid = `dev_${Date.now().toString(36)}`;
      await pg.query(`INSERT INTO users (uid, email, role, ${passwordCol}, is_active, created_at) VALUES ($1, $2, $3, $4, TRUE, NOW())`, [uid, email, role, hashedPassword]);
      return res.status(201).json({ message: 'User seeded', uid });
    } else {
      const uid = existing.rows[0].uid;
      await pg.query(`UPDATE users SET ${passwordCol} = $1, role = $2, is_active = TRUE WHERE uid = $3`, [hashedPassword, role, uid]);
      return res.json({ message: 'User updated', uid });
    }
  } catch (error) {
    console.error('Seed user error:', error?.message || error);
    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ message: 'Server error during user seeding', error: String(error?.message || error) });
    }
    res.status(500).json({ message: 'Server error during user seeding' });
  }
});

module.exports = router;
