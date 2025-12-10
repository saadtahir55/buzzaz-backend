const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { admin, db, auth } = require('../config/firebase');

const router = express.Router();

// Middleware to ensure only admins and support can access these routes
router.use(authMiddleware);
router.use(requireRole(['admin', 'support']));

// Get all users with filtering and pagination
router.get('/users', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role = '',
      status = '',
      search = ''
    } = req.query;

    let query = db.collection('users');

    // Apply filters
    if (role) {
      query = query.where('role', '==', role);
    }

    if (status) {
      const isActive = status === 'active';
      query = query.where('isActive', '==', isActive);
    }

    // Get all documents first (Firebase doesn't support text search natively)
    const snapshot = await query.get();
    let users = [];

    snapshot.forEach(doc => {
      const userData = doc.data();
      delete userData.password; // Remove sensitive data
      
      users.push({
        uid: doc.id,
        ...userData
      });
    });

    // Apply search filter in memory
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(user => 
        (user.email && user.email.toLowerCase().includes(searchLower)) ||
        (user.fullName && user.fullName.toLowerCase().includes(searchLower)) ||
        (user.uid && user.uid.toLowerCase().includes(searchLower))
      );
    }

    // Sort by creation date (newest first)
    users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedUsers = users.slice(startIndex, endIndex);

    // Calculate pagination info
    const totalUsers = users.length;
    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      users: paginatedUsers,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalUsers,
        limit: parseInt(limit),
        hasNext: endIndex < totalUsers,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
});

// Get user statistics
router.get('/stats', async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    
    let totalUsers = 0;
    let activeUsers = 0;
    let sponsoredUsers = 0;
    const usersByRole = {
      influencers: 0,
      ugcCreators: 0,
      brands: 0,
      admins: 0
    };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let recentSignups = 0;

    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      totalUsers++;

      if (userData.isActive) {
        activeUsers++;
      }

      if (userData.isSponsored) {
        sponsoredUsers++;
      }

      // Count by role
      switch (userData.role) {
        case 'influencer':
          usersByRole.influencers++;
          break;
        case 'ugc_creator':
          usersByRole.ugcCreators++;
          break;
        case 'brand':
          usersByRole.brands++;
          break;
        case 'admin':
          usersByRole.admins++;
          break;
      }

      // Count recent signups
      if (userData.createdAt && new Date(userData.createdAt) > thirtyDaysAgo) {
        recentSignups++;
      }
    });

    res.json({
      totalUsers,
      activeUsers,
      sponsoredUsers,
      recentSignups,
      usersByRole
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Server error while fetching statistics' });
  }
});

// Get detailed user information
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user data
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    delete userData.password; // Remove sensitive data

    // Get profile data based on role
    let profileData = {};
    if (userData.role === 'influencer') {
      const profileDoc = await db.collection('influencers').doc(userId).get();
      if (profileDoc.exists) {
        profileData = profileDoc.data();
      }
    } else if (userData.role === 'ugc_creator') {
      const profileDoc = await db.collection('ugc_creators').doc(userId).get();
      if (profileDoc.exists) {
        profileData = profileDoc.data();
      }
    }

    res.json({
      uid: userId,
      ...userData,
      profileData
    });

  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ message: 'Server error while fetching user details' });
  }
});

// Update user status (activate/suspend)
router.put('/users/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean value' });
    }

    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user status
    await db.collection('users').doc(userId).update({
      isActive,
      updatedAt: new Date().toISOString()
    });

    const action = isActive ? 'activated' : 'suspended';
    res.json({ 
      message: `User ${action} successfully`,
      userId,
      isActive
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ message: 'Server error while updating user status' });
  }
});

// Update user sponsor status
router.put('/users/:userId/sponsor', async (req, res) => {
  try {
    const { userId } = req.params;
    const { isSponsored } = req.body;

    if (typeof isSponsored !== 'boolean') {
      return res.status(400).json({ message: 'isSponsored must be a boolean value' });
    }

    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();

    // Only influencers and UGC creators can be sponsored
    if (!['influencer', 'ugc_creator'].includes(userData.role)) {
      return res.status(400).json({ 
        message: 'Only influencers and UGC creators can be sponsored' 
      });
    }

    // Update sponsor status
    await db.collection('users').doc(userId).update({
      isSponsored,
      updatedAt: new Date().toISOString()
    });

    const action = isSponsored ? 'added to' : 'removed from';
    res.json({ 
      message: `User ${action} sponsored list successfully`,
      userId,
      isSponsored
    });

  } catch (error) {
    console.error('Update sponsor status error:', error);
    res.status(500).json({ message: 'Server error while updating sponsor status' });
  }
});

// Edit user profile
router.put('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, role, isActive } = req.body;

    // Validate required fields
    if (!fullName || !email || !role) {
      return res.status(400).json({ message: 'Full name, email, and role are required' });
    }

    // Validate role
    const validRoles = ['influencer', 'ugc_creator', 'brand', 'admin', 'support'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }

    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if email is already taken by another user
    const emailQuery = await db.collection('users').where('email', '==', email).get();
    const emailExists = emailQuery.docs.some(doc => doc.id !== userId);
    
    if (emailExists) {
      return res.status(400).json({ message: 'Email is already in use by another user' });
    }

    // Update user profile
    const updateData = {
      fullName,
      email,
      role,
      updatedAt: new Date().toISOString()
    };

    if (typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }

    await db.collection('users').doc(userId).update(updateData);

    res.json({ 
      message: 'User profile updated successfully',
      userId,
      updatedData: updateData
    });

  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ message: 'Server error while updating user profile' });
  }
});

// Change user password
router.put('/users/:userId/password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    // Validate password
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Hash the new password
    const bcrypt = require('bcryptjs');
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password in Firestore (since users are stored in Firestore, not Firebase Auth)
    await db.collection('users').doc(userId).update({
      password: hashedPassword,
      updatedAt: new Date().toISOString()
    });

    res.json({ 
      message: 'Password updated successfully',
      userId
    });

  } catch (error) {
    const { userId } = req.params; // Ensure userId is available in catch block
    console.error('Change password error:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      userId: userId,
      errorInfo: error.errorInfo
    });
    
    res.status(500).json({ 
      message: 'Server error while changing password',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete user
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();

    // Prevent deletion of admin users (safety measure)
    if (userData.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete admin users' });
    }

    // Delete user from Firebase Auth
    try {
      await admin.auth().deleteUser(userId);
    } catch (authError) {
      console.warn('User not found in Auth, continuing with Firestore deletion:', authError.message);
    }

    // Delete user from Firestore
    await db.collection('users').doc(userId).delete();

    // Also delete related data (optional - you might want to keep some data for audit purposes)
    // Delete user's profile data if it exists
    const profileCollections = ['influencerProfiles', 'ugcCreatorProfiles', 'brandProfiles'];
    for (const collection of profileCollections) {
      try {
        await db.collection(collection).doc(userId).delete();
      } catch (error) {
        // Profile might not exist, continue
      }
    }

    res.json({ 
      message: 'User deleted successfully',
      userId,
      deletedUser: {
        fullName: userData.fullName,
        email: userData.email,
        role: userData.role
      }
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
});

module.exports = router;