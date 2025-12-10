const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { admin, db } = require('../config/firebase');
const upload = require('../middleware/upload');
const { uploadBufferToBlob } = require('../services/blob');
const youtubeService = require('../services/youtubeService');

const router = express.Router();

// Create UGC Creator profile
router.post('/profile', 
  authMiddleware, 
  requireRole('ugc_creator'),
  upload.single('sampleContent'),
  async (req, res) => {
  try {
    console.log('UGC Profile creation request received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User ID:', req.user.uid);
    
    const userId = req.user.uid;
    
    // Handle file upload or links
    let sampleContentValue = '';
    if (req.body.sampleContentType === 'upload' && req.file) {
      // Upload to Vercel Blob and store public URL
      const { url } = await uploadBufferToBlob(req.file.buffer, req.file.mimetype, req.file.originalname || 'sampleContent');
      sampleContentValue = url;
    } else if (req.body.sampleContentType === 'link') {
      // Parse the JSON array of links
      try {
        const links = typeof req.body.sampleContent === 'string' 
          ? JSON.parse(req.body.sampleContent) 
          : req.body.sampleContent;
        sampleContentValue = Array.isArray(links) ? links : [links];
      } catch (error) {
        return res.status(400).json({ 
          errors: [{ msg: 'Invalid format for sample content links' }] 
        });
      }
    }
    
    // Validate sample content
    if (!sampleContentValue || (Array.isArray(sampleContentValue) && sampleContentValue.length === 0)) {
      return res.status(400).json({ 
        errors: [{ msg: 'Sample content is required (either file upload or links)' }] 
      });
    }
    
    // Parse array fields that come as JSON strings from FormData
    let parsedNiche, parsedContentStyle, parsedLanguages;
    try {
      parsedNiche = typeof req.body.niche === 'string' ? JSON.parse(req.body.niche) : req.body.niche;
      parsedContentStyle = typeof req.body.contentStyle === 'string' ? JSON.parse(req.body.contentStyle) : req.body.contentStyle;
      parsedLanguages = typeof req.body.languages === 'string' ? JSON.parse(req.body.languages) : req.body.languages;
    } catch (error) {
      return res.status(400).json({ 
        errors: [{ msg: 'Invalid format for niche, content style, or languages' }] 
      });
    }
    
    const {
      fullName,
      email,
      phoneNumber,
      city,
      country,
      dateOfBirth,
      gender,
      maritalStatus,
      children,
      bio,
      location,
      sampleContentType,
      faceOrFaceless
    } = req.body;
    
    console.log('Extracted fields:', {
      fullName,
      email,
      phoneNumber,
      city,
      country,
      dateOfBirth,
      gender,
      maritalStatus,
      children,
      bio,
      location,
      sampleContent: sampleContentValue,
      sampleContentType,
      niche: parsedNiche,
      contentStyle: parsedContentStyle,
      faceOrFaceless,
      languages: parsedLanguages,
      uploadedFile: req.file ? (req.file.originalname || 'uploaded') : null
    });

    // Check if profile already exists
    const existingProfile = await db.collection('ugc_creators').doc(userId).get();
    if (existingProfile.exists) {
      return res.status(400).json({ message: 'UGC Creator profile already exists' });
    }

    // Create UGC Creator profile data
    const ugcData = {
      userId,
      fullName: fullName || null,
      email: email || null,
      phoneNumber: phoneNumber || null,
      city: city || null,
      country: country || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      maritalStatus: maritalStatus || null,
      children: children || null,
      bio: bio || null,
      location: location || null,
      sampleContent: sampleContentValue,
      sampleContentType: sampleContentType || null,
      niche: parsedNiche || [],
      contentStyle: parsedContentStyle || [],
      faceOrFaceless: faceOrFaceless || null,
      languages: parsedLanguages || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      totalProjects: 0,
      completedProjects: 0,
      activeProjects: 0,
      averageRating: 0,
      totalEarnings: 0
    };

    // Save to database
    await db.collection('ugc_creators').doc(userId).set(ugcData);

    // Update user's role to 'ugc_creator' after successful profile creation
    if (req.user.role === 'content_creator') {
      await db.collection('users').doc(userId).update({
        role: 'ugc_creator',
        userType: 'ugc_creator',
        roleChosenAt: new Date().toISOString()
      });
      console.log('User role updated to ugc_creator');
    }

    res.status(201).json({
      message: 'UGC Creator profile created successfully',
      profile: ugcData
    });

  } catch (error) {
    console.error('UGC Creator profile creation error:', error);
    res.status(500).json({ message: 'Server error during profile creation' });
  }
});

// Get UGC Creator profile
router.get('/profile/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get UGC Creator profile
    const profileDoc = await db.collection('ugc_creators').doc(userId).get();
    
    if (!profileDoc.exists) {
      return res.status(404).json({ message: 'UGC Creator profile not found' });
    }

    const profileData = profileDoc.data();
    
    // Debug logging for sampleContent
    console.log('=== UGC Profile GET Debug ===');
    console.log('Raw profileData from DB:', JSON.stringify(profileData, null, 2));
    console.log('sampleContent:', profileData.sampleContent);
    console.log('sampleContent type:', typeof profileData.sampleContent);
    console.log('sampleContent is array:', Array.isArray(profileData.sampleContent));
    console.log('sampleContentType:', profileData.sampleContentType);

    // Get latest stats (mock data for now)
    const latestStats = {
      totalProjects: profileData.totalProjects || 0,
      completedProjects: profileData.completedProjects || 0,
      activeProjects: profileData.activeProjects || 0,
      averageRating: profileData.averageRating || 0,
      totalEarnings: profileData.totalEarnings || 0
    };

    res.json({
      profile: profileData,
      latestStats
    });

  } catch (error) {
    console.error('Get UGC Creator profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Middleware to parse JSON strings from FormData
const parseFormDataArrays = (req, res, next) => {
  // Parse JSON strings for array fields when using FormData
  const arrayFields = ['categories', 'contentTypes', 'niche', 'contentStyle', 'languages'];
  
  arrayFields.forEach(field => {
    if (req.body[field] && typeof req.body[field] === 'string') {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch (error) {
        console.log(`Failed to parse ${field} as JSON:`, req.body[field]);
      }
    }
  });
  
  next();
};

// Update UGC Creator profile
router.put('/profile/:userId', 
  authMiddleware, 
  upload.single('sampleContent'),
  parseFormDataArrays,
  [
    body('fullName').optional().notEmpty().withMessage('Full name cannot be empty'),
    body('bio').optional().notEmpty().withMessage('Bio cannot be empty'),
    body('location').optional().notEmpty().withMessage('Location cannot be empty'),
    body('categories').optional().isArray({ min: 1 }).withMessage('At least one category is required'),
    body('contentTypes').optional().isArray({ min: 1 }).withMessage('At least one content type is required'),
    // New detailed pricing validation
    body('reelPostPrice').optional().isFloat({ min: 0.01 }).withMessage('Reel post price must be greater than 0'),
    body('staticPostPrice').optional().isFloat({ min: 0.01 }).withMessage('Static post price must be greater than 0'),
    body('reelStaticComboPrice').optional().isFloat({ min: 0.01 }).withMessage('Reel + Static combo price must be greater than 0'),
    body('storyVideoPrice').optional().isFloat({ min: 0.01 }).withMessage('Story video price must be greater than 0'),
    body('storyShoutoutPrice').optional().isFloat({ min: 0.01 }).withMessage('Story shoutout price must be greater than 0'),
    body('storyUnboxingPrice').optional().isFloat({ min: 0.01 }).withMessage('Story unboxing price must be greater than 0'),
    body('eventAttendancePrice').optional().isFloat({ min: 0.01 }).withMessage('Event attendance price must be greater than 0'),
    body('outdoorShootPrice').optional().isFloat({ min: 0.01 }).withMessage('Outdoor shoot price must be greater than 0'),
    body('expressDeliveryCharge').optional().isFloat({ min: 0.01 }).withMessage('Express delivery charge must be greater than 0'),
    // Delivery time validation
    body('productBasedDelivery').optional().isString().withMessage('Product-based delivery time must be a string'),
    body('noProductDelivery').optional().isString().withMessage('No product delivery time must be a string'),
    body('expressDelivery').optional().isString().withMessage('Express delivery time must be a string'),
    body('outdoorEventDelivery').optional().isString().withMessage('Outdoor event delivery time must be a string'),
    body('revisionsDelivery').optional().isString().withMessage('Revisions delivery time must be a string')
  ], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const requestingUserId = req.user.uid;

    // Check if user is updating their own profile
    if (userId !== requestingUserId) {
      return res.status(403).json({ message: 'Unauthorized to update this profile' });
    }

    const docRef = db.collection('ugc_creators').doc(userId);
    const profileDoc = await docRef.get();

    const updateData = { ...req.body };
    
    // Debug logging for file upload
    console.log('=== UGC UPDATE DEBUG ===');
    console.log('req.body.sampleContentType:', req.body.sampleContentType);
    console.log('req.file:', req.file);
    console.log('req.body.sampleContent:', req.body.sampleContent);
    console.log('typeof req.body.sampleContent:', typeof req.body.sampleContent);
    
    // Handle file upload for sample content
    if (req.body.sampleContentType === 'upload' && req.file) {
      const { url } = await uploadBufferToBlob(req.file.buffer, req.file.mimetype, req.file.originalname || 'sampleContent');
      updateData.sampleContent = url;
      console.log('File uploaded for update to Blob:', url);
    } else if (req.body.sampleContentType === 'upload' && !req.file) {
      // File upload was attempted but failed
      console.log('File upload attempted but no file received');
      // Check if sampleContent is an empty array or contains empty objects
      if (Array.isArray(req.body.sampleContent) && 
          (req.body.sampleContent.length === 0 || 
           req.body.sampleContent.every(item => typeof item === 'object' && Object.keys(item).length === 0))) {
        console.log('Removing empty sampleContent array');
        delete updateData.sampleContent;
      } else {
        // Don't update sampleContent if file upload failed
        delete updateData.sampleContent;
      }
    } else if (req.body.sampleContentType === 'link' && req.body.sampleContent) {
      // Handle links - parse if it's a JSON string
      try {
        const links = typeof req.body.sampleContent === 'string' 
          ? JSON.parse(req.body.sampleContent) 
          : req.body.sampleContent;
        updateData.sampleContent = Array.isArray(links) ? links : [links];
      } catch (error) {
        console.log('Sample content links (not JSON):', req.body.sampleContent);
        updateData.sampleContent = req.body.sampleContent;
      }
    }
    
    // Map frontend field names to database field names
    if (updateData.categories) {
      updateData.niche = updateData.categories;
      delete updateData.categories;
    }
    if (updateData.contentTypes) {
      updateData.contentStyle = updateData.contentTypes;
      delete updateData.contentTypes;
    }
    
    // Process new pricing structure - convert to numbers
    const pricingFields = [
      'reelPostPrice', 'staticPostPrice', 'reelStaticComboPrice', 
      'storyVideoPrice', 'storyShoutoutPrice', 'storyUnboxingPrice',
      'eventAttendancePrice', 'outdoorShootPrice', 'expressDeliveryCharge'
    ];
    
    pricingFields.forEach(field => {
      if (updateData[field]) {
        updateData[field] = parseFloat(updateData[field]);
      }
    });

    updateData.updatedAt = new Date().toISOString();

    // Upsert profile: create minimal doc if it doesn't exist yet
    if (!profileDoc.exists) {
      await docRef.set({
        ...updateData,
        createdAt: new Date().toISOString(),
        isActive: true
      }, { merge: true });
      const createdProfileDoc = await docRef.get();
      const createdProfile = createdProfileDoc.data();
      return res.json({
        message: 'Profile created successfully',
        profile: createdProfile
      });
    }

    // Update existing profile
    await docRef.update(updateData);

    // Get updated profile
    const updatedProfileDoc = await docRef.get();
    const updatedProfile = updatedProfileDoc.data();

    res.json({
      message: 'Profile updated successfully',
      profile: updatedProfile
    });

  } catch (error) {
    console.error('Update UGC Creator profile error:', error);
    res.status(500).json({ message: 'Server error during profile update' });
  }
});

// Get UGC Creator stats history (mock endpoint for now)
router.get('/stats/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if profile exists
    const profileDoc = await db.collection('ugc_creators').doc(userId).get();
    if (!profileDoc.exists) {
      return res.status(404).json({ message: 'UGC Creator profile not found' });
    }

    // Mock stats history data
    const statsHistory = [
      { month: 'Jan', projects: 2, earnings: 500 },
      { month: 'Feb', projects: 3, earnings: 750 },
      { month: 'Mar', projects: 4, earnings: 1000 },
      { month: 'Apr', projects: 3, earnings: 800 },
      { month: 'May', projects: 5, earnings: 1200 },
      { month: 'Jun', projects: 4, earnings: 950 }
    ];

    res.json(statsHistory);

  } catch (error) {
    console.error('Get UGC Creator stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all UGC Creators (for brands to browse)
router.get('/browse', authMiddleware, async (req, res) => {
  try {
    const {
      categories,
      contentTypes,
      minPrice,
      maxPrice,
      location,
      page = 1,
      limit = 10
    } = req.query;

    let query = db.collection('ugc_creators').where('isActive', '==', true);

    // Apply filters
    if (categories) {
      const categoryArray = categories.split(',');
      query = query.where('niche', 'array-contains-any', categoryArray);
    }

    if (contentTypes) {
      const contentTypeArray = contentTypes.split(',');
      query = query.where('contentStyle', 'array-contains-any', contentTypeArray);
    }

    if (location) {
      query = query.where('location', '==', location);
    }

    // Execute query
    const snapshot = await query.get();
    let creators = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Filter by price range if specified
      if (minPrice || maxPrice) {
        const min = minPrice ? parseFloat(minPrice) : 0;
        const max = maxPrice ? parseFloat(maxPrice) : Infinity;
        
        // Check if any of the new pricing fields fall within the requested range
        const pricingFields = [
          'reelPostPrice', 'staticPostPrice', 'reelStaticComboPrice', 
          'storyVideoPrice', 'storyShoutoutPrice', 'storyUnboxingPrice',
          'eventAttendancePrice', 'outdoorShootPrice'
        ];
        
        const hasMatchingPrice = pricingFields.some(field => {
          const price = data[field];
          return price && price >= min && price <= max;
        });
        
        // Also check old price range fields for backward compatibility
        const hasOldPriceRange = data.priceRangeMin && data.priceRangeMax && 
          !(data.priceRangeMax < min || data.priceRangeMin > max);
        
        if (!hasMatchingPrice && !hasOldPriceRange) {
          return; // Skip this creator
        }
      }

      creators.push({
        id: doc.id,
        ...data
      });
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedCreators = creators.slice(startIndex, endIndex);

    res.json({
      creators: paginatedCreators,
      totalCount: creators.length,
      currentPage: parseInt(page),
      totalPages: Math.ceil(creators.length / limit)
    });

  } catch (error) {
    console.error('Browse UGC Creators error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// YouTube Analytics Endpoints for UGC Creators

// Refresh YouTube data and analytics
router.post('/:id/youtube/refresh', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.uid;

    // Check if user is updating their own profile
    if (id !== requestingUserId) {
      return res.status(403).json({ message: 'Unauthorized to refresh this profile' });
    }

    const docRef = db.collection('ugc_creators').doc(id);
    const doc = await docRef.get();
    const data = doc.data();

    if (!data.youtubeChannelId) {
      return res.status(400).json({ message: 'YouTube channel not connected' });
    }

    console.log('Refreshing YouTube data for UGC creator channel:', data.youtubeChannelId);

    // Fetch comprehensive YouTube data
    const youtubeData = await youtubeService.getComprehensiveChannelData(data.youtubeChannelId);

    // Save to youtubeAnalytics collection
    const analyticsData = {
      userId: id,
      channelId: data.youtubeChannelId,
      channelTitle: youtubeData.channelTitle,
      userType: 'ugc_creator',
      // Basic metrics
      subscriberCount: youtubeData.subscriberCount,
      viewCount: youtubeData.viewCount,
      videoCount: youtubeData.videoCount,
      // Analytics data
      analytics: {
        views: youtubeData.analytics.views,
        likes: youtubeData.aggregatedMetrics.totalLikes,
        comments: youtubeData.aggregatedMetrics.totalComments,
        estimatedMinutesWatched: youtubeData.analytics.estimatedMinutesWatched,
        averageViewDuration: youtubeData.analytics.averageViewDuration,
        subscribersGained: youtubeData.analytics.subscribersGained,
        subscribersLost: youtubeData.analytics.subscribersLost,
        // Traffic sources
        trafficSourceType: youtubeData.analytics.trafficSourceType,
        // Device types
        deviceType: youtubeData.analytics.deviceType,
        // Demographics
        country: youtubeData.analytics.country,
        // Audience demographics
        gender: youtubeData.analytics.gender,
        ageGroup: youtubeData.analytics.ageGroup,
        // Engagement metrics
        engagementRate: parseFloat(youtubeData.aggregatedMetrics.engagementRate),
      },
      // Recent videos with iframe data
      recentVideos: youtubeData.videos.slice(0, 30), // Store up to 30 recent videos with iframe data
      // Metadata
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: youtubeData.lastUpdated
    };

    await db.collection('youtubeAnalytics').add(analyticsData);

    // Update UGC creator profile with latest stats
    const profileUpdates = {
      youtubeSubscribers: youtubeData.subscriberCount,
      youtubeViews: youtubeData.viewCount,
      youtubeVideos: youtubeData.videoCount,
      youtubeLastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };
    await docRef.update(profileUpdates);

    console.log('YouTube data refreshed and saved successfully for UGC creator');

    res.json({
      success: true,
      message: 'YouTube data refreshed successfully',
      data: {
        subscriberCount: youtubeData.subscriberCount,
        viewCount: youtubeData.viewCount,
        videoCount: youtubeData.videoCount,
        totalVideosAnalyzed: youtubeData.videos.length,
        lastUpdated: youtubeData.lastUpdated
      }
    });

  } catch (error) {
    console.error('YouTube refresh error for UGC creator:', error);
    res.status(500).json({
      message: 'Failed to refresh YouTube data',
      error: error.message
    });
  }
});

// Get detailed YouTube analytics
router.get('/:id/youtube/detailed', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.uid;

    // Check if user is accessing their own profile
    if (id !== requestingUserId) {
      return res.status(403).json({ message: 'Unauthorized to access this profile' });
    }

    const docRef = db.collection('ugc_creators').doc(id);
    const doc = await docRef.get();
    const data = doc.data();

    if (!data.youtubeChannelId) {
      return res.status(400).json({ message: 'YouTube channel not connected' });
    }

    // Get the most recent analytics data
    // Temporary workaround: Query by userId only and filter in memory
    const analyticsSnapshot = await db.collection('youtubeAnalytics')
      .where('userId', '==', id)
      .get();

    // Filter for UGC creators and get the most recent
    const ugcAnalytics = analyticsSnapshot.docs
      .filter(doc => doc.data().userType === 'ugc_creator')
      .sort((a, b) => b.data().createdAt.toDate() - a.data().createdAt.toDate());

    if (ugcAnalytics.length === 0) {
      return res.status(404).json({
        message: 'No YouTube analytics data found. Please refresh data first.',
        shouldRefresh: true
      });
    }

    const analyticsDoc = ugcAnalytics[0];
    const analyticsData = analyticsDoc.data();

    // Structure the response data
    const responseData = {
      channelInfo: {
        channelId: data.youtubeChannelId,
        channelTitle: analyticsData.channelTitle,
        subscriberCount: analyticsData.subscriberCount,
        viewCount: analyticsData.viewCount,
        videoCount: analyticsData.videoCount
      },
      analytics: analyticsData.analytics,
      recentVideos: analyticsData.recentVideos || [],
      lastUpdated: analyticsData.lastUpdated,
      createdAt: analyticsData.createdAt
    };

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get detailed YouTube analytics error for UGC creator:', error);
    res.status(500).json({
      message: 'Failed to fetch YouTube analytics',
      error: error.message
    });
  }
});

// Search and connect YouTube channel
router.post('/:id/youtube/connect', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { channelQuery } = req.body;
    const requestingUserId = req.user.uid;

    // Check if user is updating their own profile
    if (id !== requestingUserId) {
      return res.status(403).json({ message: 'Unauthorized to update this profile' });
    }

    // Search for the channel
    const channelData = await youtubeService.searchChannel(channelQuery);

    // Get channel statistics
    const channelStats = await youtubeService.fetchChannelStats(channelData.channelId);

    // Get recent videos
    const recentVideos = await youtubeService.fetchChannelVideos(channelData.channelId);
    const videoIds = recentVideos.map(video => video.videoId);

    // Get video statistics
    const videoStats = await youtubeService.fetchVideoStats(videoIds);

    // Get analytics data
    const analyticsData = await youtubeService.fetchAnalyticsData(channelData.channelId);

    // Update UGC creator profile
    const docRef = db.collection('ugc_creators').doc(id);
    const updateData = {
      youtubeChannelId: channelData.channelId,
      youtubeChannelTitle: channelData.channelTitle,
      youtubeChannelUrl: channelData.channelUrl,
      youtubeSubscribers: channelStats.subscriberCount,
      youtubeViews: channelStats.viewCount,
      youtubeVideos: channelStats.videoCount,
      youtubeConnectedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Store recent video data
      youtubeRecentVideos: videoStats,
      // Store analytics data
      youtubeAnalytics: analyticsData
    };

    await docRef.update(updateData);

    res.json({
      success: true,
      message: 'YouTube channel connected successfully',
      data: {
        channelId: channelData.channelId,
        channelTitle: channelData.channelTitle,
        channelUrl: channelData.channelUrl,
        subscriberCount: channelStats.subscriberCount,
        viewCount: channelStats.viewCount,
        videoCount: channelStats.videoCount
      }
    });

  } catch (error) {
    console.error('YouTube connect error for UGC creator:', error);
    res.status(500).json({
      message: 'Failed to connect YouTube channel',
      error: error.message
    });
  }
});

module.exports = router;
