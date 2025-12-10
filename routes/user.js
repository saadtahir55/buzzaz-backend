const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const pg = require('../services/db');
const { getInstagramDashboardData } = require('../services/postgresInstagram');

const router = express.Router();

// Get all brands for chat (influencers and UGC creators only)
router.get('/brands', authMiddleware, async (req, res) => {
  try {
    // Check if user is influencer or UGC creator
    const userRole = req.user.role;
    if (!['influencer', 'ugc_creator'].includes(userRole)) {
      return res.status(403).json({ message: 'Access denied. Only influencers and UGC creators can access this endpoint.' });
    }

    const result = await pg.query(
      'SELECT uid, email, display_name FROM users WHERE role = $1',
      ['brand']
    );
    const users = result.rows.map(r => ({
      id: r.uid,
      name: r.display_name || r.email || 'Unknown Brand',
      role: 'brand',
      avatar: null,
      email: r.email || null,
      companyName: null,
    }));

    res.json({ users });

  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ message: 'Server error while fetching brands' });
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    // Get user data from Postgres
    const userRes = await pg.query('SELECT uid, email, role, display_name, social_connections FROM users WHERE uid = $1 LIMIT 1', [userId]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userRow = userRes.rows[0];

    // If influencer, also get instagram profile from Postgres
    let influencerProfile = null;
    if (userRow.role === 'influencer') {
      const profRes = await pg.query('SELECT * FROM instagram_profiles WHERE uid = $1 LIMIT 1', [userId]);
      if (profRes.rowCount > 0) {
        influencerProfile = profRes.rows[0];
      }
    }

    res.json({
      user: {
        uid: userRow.uid,
        email: userRow.email,
        role: userRow.role,
        displayName: userRow.display_name,
        socialConnections: userRow.social_connections || null,
      },
      influencerProfile,
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile (Postgres)
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const allowedUpdates = ['email', 'isActive'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid updates provided' });
    }
    const email = updates.email;
    const isActive = updates.isActive;
    if (typeof isActive !== 'undefined' && typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be boolean' });
    }
    if (typeof email !== 'undefined' && typeof email !== 'string') {
      return res.status(400).json({ message: 'email must be string' });
    }
    if (typeof email !== 'undefined' && typeof isActive !== 'undefined') {
      await pg.query('UPDATE users SET email = $1, is_active = $2 WHERE uid = $3', [email, isActive, userId]);
    } else if (typeof email !== 'undefined') {
      await pg.query('UPDATE users SET email = $1 WHERE uid = $2', [email, userId]);
    } else if (typeof isActive !== 'undefined') {
      await pg.query('UPDATE users SET is_active = $1 WHERE uid = $2', [isActive, userId]);
    }
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check if user has completed profile setup
router.get('/profile-status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userRole = req.user.role;
    const userEmail = req.user.email;

    let hasCompletedProfile = false;

    if (userRole === 'influencer') {
      const profRes = await pg.query('SELECT uid FROM instagram_profiles WHERE uid = $1 LIMIT 1', [userId]);
      if (profRes.rowCount > 0) {
        hasCompletedProfile = true;
      } else {
        // Fallback: check detailed cache
        const detRes = await pg.query('SELECT uid FROM instagram_detailed_data WHERE uid = $1 LIMIT 1', [userId]);
        if (detRes.rowCount > 0) {
          hasCompletedProfile = true;
        }
      }
    } else if (userRole === 'ugc_creator') {
      // Until UGC is migrated to Postgres, allow dashboard access
      hasCompletedProfile = true;
    } else {
      // Brands don't need additional profile setup
      hasCompletedProfile = true;
    }

    // Do not override onboarding in development. Influencers must complete wizard.

    res.json({
      hasCompletedProfile,
      role: userRole,
      requiresOnboarding: (userRole === 'influencer' || userRole === 'ugc_creator') && !hasCompletedProfile
    });

  } catch (error) {
    console.error('Profile status check error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Choose final role for content creators (one-time post-login selection)
router.put('/role', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const currentRole = req.user.role;
    const { role: newRole } = req.body;

    // Only allow switching from 'content_creator' to an allowed creator subtype
    const allowedNewRoles = ['influencer', 'ugc_creator', 'ugc'];
    if (currentRole !== 'content_creator') {
      return res.status(400).json({ message: 'Role selection not allowed. Current role is not content_creator.' });
    }
    if (!allowedNewRoles.includes(newRole)) {
      return res.status(400).json({ message: 'Invalid role selection. Choose influencer or ugc_creator.' });
    }

    // Map alias 'ugc' to actual role 'ugc_creator'
    const mappedRole = newRole === 'ugc' ? 'ugc_creator' : newRole;
    const userType = mappedRole === 'ugc_creator' ? 'ugc' : 'influencer';

    await pg.query(
      'UPDATE users SET role = $1 WHERE uid = $2',
      [mappedRole, userId]
    );

    res.json({
      message: 'Role updated successfully',
      uid: userId,
      role: mappedRole,
      userType
    });
  } catch (error) {
    console.error('Choose role error:', error);
    res.status(500).json({ message: 'Server error while selecting role' });
  }
});

module.exports = router;
