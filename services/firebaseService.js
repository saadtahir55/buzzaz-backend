const { db } = require('../config/firebase');

/**
 * Save Instagram reel data to Firebase
 * @param {string} userId - User ID
 * @param {string} username - Instagram username
 * @param {Array} reelData - Array of reel data from Instagram API
 * @returns {Promise<Object>} - Save result
 */
  const saveInstagramReelData = async (userId, username, reelData) => {
  try {
    const timestamp = new Date().toISOString();
    
    // Prepare the data structure for Firebase
    const instagramData = {
      userId: userId,
      username: username,
      reels: reelData.map(reel => ({
        // Support multiple possible field names from Apify outputs
        id: reel.id || reel.postId || reel.shortcode || reel.shortCode,
        shortCode: reel.shortCode || reel.shortcode || reel.code || '',
        displayUrl: reel.displayUrl || reel.thumbnailUrl || (Array.isArray(reel.images) ? reel.images[0] : '') || '',
        caption: reel.caption || '',
        ownerFullName: reel.ownerFullName || '',
        ownerUsername: reel.ownerUsername || username,
        url: reel.url || (reel.shortCode || reel.shortcode ? `https://www.instagram.com/p/${reel.shortCode || reel.shortcode}/` : ''),
        commentsCount: reel.commentsCount || 0,
        firstComment: reel.firstComment || (Array.isArray(reel.latestComments) ? reel.latestComments[0]?.text : '') || '',
        likesCount: reel.likesCount || 0,
        // Preserve views for reach calculations
        viewsCount: reel.viewsCount || reel.playCount || reel.videoPlayCount || 0,
        timestamp: reel.timestamp || reel.takenAt || timestamp,
        videoDuration: reel.videoDuration || 0,
        videoUrl: reel.videoUrl || '',
        hashtags: reel.hashtags || [],
        mentions: reel.mentions || [],
        isSponsored: reel.isSponsored || false
      })),
      totalReels: reelData.length,
      lastUpdated: timestamp,
      createdAt: timestamp
    };

    // Save to Firebase under users/{userId}/instagram/reels
    const docRef = db.collection('users').doc(userId).collection('instagram').doc('reels');
    await docRef.set(instagramData, { merge: true });

    console.log(`Instagram reel data saved for user ${userId}, username: ${username}`);
    
    return {
      success: true,
      message: 'Instagram reel data saved successfully',
      totalReels: reelData.length,
      savedAt: timestamp
    };
  } catch (error) {
    console.error('Error saving Instagram reel data to Firebase:', error);
    throw new Error(`Failed to save Instagram reel data: ${error.message}`);
  }
};

/**
 * Get Instagram reel data from Firebase
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Instagram reel data
 */
const getInstagramReelData = async (userId) => {
  try {
    // Primary location: users/{userId}/instagram/reels
    const docRef = db.collection('users').doc(userId).collection('instagram').doc('reels');
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data();
      const reels = Array.isArray(data?.reels) ? data.reels : [];
      if (reels.length > 0) {
        return {
          success: true,
          message: 'Instagram reel data retrieved successfully',
          data: reels
        };
      }
    }

    // Fallback location: instagramDetailedData/{userId}
    const detailedRef = db.collection('instagramDetailedData').doc(userId);
    const detailedDoc = await detailedRef.get();
    if (detailedDoc.exists) {
      const detailedData = detailedDoc.data();
      const reels = Array.isArray(detailedData?.reels) ? detailedData.reels : [];
      if (reels.length > 0) {
        return {
          success: true,
          message: 'Instagram reel data retrieved from fallback collection',
          data: reels
        };
      }
    }

    return {
      success: false,
      message: 'No Instagram reel data found in Firebase',
      data: null
    };
  } catch (error) {
    console.error('Error getting Instagram reel data from Firebase:', error);
    throw new Error(`Failed to get Instagram reel data: ${error.message}`);
  }
};

/**
 * Update Instagram connection status
 * @param {string} userId - User ID
 * @param {string} username - Instagram username
 * @param {boolean} isConnected - Connection status
 * @returns {Promise<Object>} - Update result
 */
const updateInstagramConnection = async (userId, username, isConnected = true) => {
  try {
    const timestamp = new Date().toISOString();
    
    const connectionData = {
      instagram: {
        username: username,
        connected: isConnected,
        lastUpdated: timestamp
      }
    };

    // Update user's social connections
    const userRef = db.collection('users').doc(userId);
    await userRef.set({ socialConnections: connectionData }, { merge: true });

    console.log(`Instagram connection updated for user ${userId}: ${username} - ${isConnected ? 'connected' : 'disconnected'}`);
    
    return {
      success: true,
      message: 'Instagram connection updated successfully',
      username: username,
      connected: isConnected,
      updatedAt: timestamp
    };
  } catch (error) {
    console.error('Error updating Instagram connection:', error);
    throw new Error(`Failed to update Instagram connection: ${error.message}`);
  }
};

/**
 * Get all Instagram data for dashboard
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Complete Instagram data for dashboard
 */
const getInstagramDashboardData = async (userId) => {
  try {
    // Get reel data
    const reelResult = await getInstagramReelData(userId);
    
    // Get connection status
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    let connectionStatus = null;
    if (userDoc.exists) {
      const userData = userDoc.data();
      connectionStatus = userData.socialConnections?.instagram || null;
    }

    return {
      success: true,
      message: 'Instagram dashboard data retrieved successfully',
      reelData: reelResult.data,
      connectionStatus: connectionStatus,
      hasData: reelResult.success && reelResult.data !== null
    };
  } catch (error) {
    console.error('Error getting Instagram dashboard data:', error);
    throw new Error(`Failed to get Instagram dashboard data: ${error.message}`);
  }
};

/**
 * Save Instagram profile data to Firebase
 * @param {string} userId - User ID
 * @param {Object} profileData - Profile data from Instagram Profile Scraper
 * @returns {Promise<Object>} - Save result
 */
const saveInstagramProfileData = async (userId, profileData) => {
  try {
    const timestamp = new Date().toISOString();
    
    // Prepare the profile data structure for Firebase
    const instagramProfile = {
      userId: userId,
      username: profileData.username,
      fullName: profileData.fullName || '',
      bio: profileData.bio || '',
      avatarUrl: profileData.avatarUrl || '',
      profilePicUrlHd: profileData.profilePicUrlHd || '',
      followers: profileData.followers || 0,
      following: profileData.following || 0,
      postsCount: profileData.postsCount || 0,
      isVerified: profileData.isVerified || false,
      isPrivate: profileData.isPrivate || false,
      userId: profileData.userId || '',
      externalUrl: profileData.externalUrl || '',
      businessCategoryName: profileData.businessCategoryName || '',
      categoryName: profileData.categoryName || '',
      isBusinessAccount: profileData.isBusinessAccount || false,
      isProfessionalAccount: profileData.isProfessionalAccount || false,
      businessEmail: profileData.businessEmail || '',
      businessPhoneNumber: profileData.businessPhoneNumber || '',
      businessAddressJson: profileData.businessAddressJson || null,
      engagementRate: profileData.engagementRate || 0,
      lastUpdated: timestamp,
      createdAt: timestamp
    };

    // Save to Firebase under users/{userId}/instagram/profile
    const docRef = db.collection('users').doc(userId).collection('instagram').doc('profile');
    await docRef.set(instagramProfile, { merge: true });

    console.log(`Instagram profile data saved for user ${userId}, username: ${profileData.username}`);
    
    return {
      success: true,
      message: 'Instagram profile data saved successfully',
      username: profileData.username,
      followers: profileData.followers,
      timestamp: timestamp
    };
  } catch (error) {
    console.error('Error saving Instagram profile data:', error);
    throw new Error(`Failed to save Instagram profile data: ${error.message}`);
  }
};

/**
 * Get Instagram profile data from Firebase
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Profile data result
 */
const getInstagramProfileData = async (userId) => {
  try {
    const profileRef = db.collection('users').doc(userId).collection('instagram').doc('profile');
    const profileDoc = await profileRef.get();
    
    if (!profileDoc.exists) {
      return {
        success: false,
        message: 'No Instagram profile data found',
        data: null
      };
    }
    
    const profileData = profileDoc.data();
    console.log(`Retrieved Instagram profile data for user ${userId}:`, {
      username: profileData.username,
      followers: profileData.followers,
      following: profileData.following,
      postsCount: profileData.postsCount
    });
    
    return {
      success: true,
      message: 'Instagram profile data retrieved successfully',
      data: profileData
    };
  } catch (error) {
    console.error('Error getting Instagram profile data:', error);
    return {
      success: false,
      message: `Failed to get Instagram profile data: ${error.message}`,
      data: null
    };
  }
};

module.exports = {
  saveInstagramReelData,
  saveInstagramProfileData,
  getInstagramReelData,
  getInstagramProfileData,
  updateInstagramConnection,
  getInstagramDashboardData
};