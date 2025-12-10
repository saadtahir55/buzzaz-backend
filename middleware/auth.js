const jwt = require('jsonwebtoken');
const db = require('../services/db');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // JWT verification only (Postgres-based auth)
    const secret = process.env.JWT_SECRET;
    if (!secret || !secret.trim()) {
      return res.status(500).json({ message: 'Server configuration error' });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (e) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Ensure a Postgres user row exists. Create on first login.
    const uid = decoded.uid || decoded.sub;
    const email = decoded.email || null;
    const result = await db.query('SELECT uid, email, role, display_name FROM users WHERE uid = $1 LIMIT 1', [uid]);
    let pgUser = result.rows[0];

    if (!pgUser) {
      const defaultRole = 'content_creator';
      const displayName = decoded.name || null;
      await db.query(
        'INSERT INTO users (uid, email, role, display_name, created_at, is_active) VALUES ($1, $2, $3, $4, NOW(), TRUE)',
        [uid, email, defaultRole, displayName]
      );
      const created = await db.query('SELECT uid, email, role, display_name FROM users WHERE uid = $1 LIMIT 1', [uid]);
      pgUser = created.rows[0];
    }

    req.user = {
      uid: pgUser.uid,
      email: pgUser.email,
      role: pgUser.role,
      displayName: pgUser.display_name,
    };
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    // Special handling for content_creator -> influencer/ugc_creator transition
    // Allow content_creator to access influencer endpoints during role transition
    if (req.user.role === 'content_creator' && allowedRoles.includes('influencer')) {
      next();
      return;
    }
    
    // Allow content_creator to access ugc_creator endpoints during role transition
    if (req.user.role === 'content_creator' && allowedRoles.includes('ugc_creator')) {
      next();
      return;
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: `Access denied. One of these roles required: ${allowedRoles.join(', ')}.` });
    }
    
    next();
  };
};

module.exports = { authMiddleware, requireRole };
