const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateInstagramUsername, validateTikTokUsername, scrapeTikTokProfile, scrapeInstagramComplete } = require('../services/apifyService');
const { fetchInstagramUserData, categorizeInstagramPosts, getInstagramAnalytics, validateInstagramUsername: validateInstagramUsernameNew } = require('../services/instagramService');
const youtubeService = require('../services/youtubeService');
const { admin, db } = require('../config/firebase');
const { saveInstagramReelData, saveInstagramProfileData, updateInstagramConnection } = require('../services/firebaseService');

const router = express.Router();

// Validate Instagram username via Apify - Updated to use both Profile and Reels scrapers
router.post('/validate-apify', authMiddleware, requireRole('influencer'), [
  body('instagramUsername').isLength({ min: 1 }).trim()
], async (req, res) => {
  console.log('=== VALIDATE APIFY ENDPOINT REACHED ===');
  
  // Check for validation errors first
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    console.log('=== VALIDATE APIFY ENDPOINT - DUAL SCRAPER MODE ===');
    const { instagramUsername } = req.body;
    const cleanUsername = instagramUsername.replace('@', '');
    const hasApifyToken = !!(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN);
    
    console.log('Received Instagram username:', instagramUsername);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('APIFY token available:', hasApifyToken);

    // If Apify token is missing, perform format-only validation and return success with sync requirement
    if (!hasApifyToken) {
      const isFormatValid = validateInstagramUsernameNew(instagramUsername);
      if (!isFormatValid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Instagram username format',
          error: 'Username must be 1-30 chars: letters, numbers, dot, underscore'
        });
      }

      return res.json({
        success: true,
        message: 'Instagram username validated by format. Data will sync after connect.',
        requiresSync: true,
        data: {
          username: cleanUsername,
          profile: null,
          reels: { totalReels: 0, reelsPreview: [] },
          scrapedAt: null,
          errors: ['Apify token not configured; skipping scrape']
        }
      });
    }
    
    // Call the new complete Instagram scraper to get both profile and reels data
    console.log('Calling scrapeInstagramComplete for both profile and reels data...');
    const instagramData = await scrapeInstagramComplete(instagramUsername);
    console.log('Instagram complete scrape result:', JSON.stringify({
      username: instagramData.username,
      success: instagramData.success,
      hasProfile: !!instagramData.profile,
      reelsCount: instagramData.reels?.length || 0,
      errors: instagramData.errors
    }, null, 2));
    
    if (instagramData && instagramData.success) {
      // Save complete Instagram data to Firebase
      try {
        // Save profile data if available
        if (instagramData.profile) {
          await saveInstagramProfileData(req.user.uid, instagramData.profile);
          console.log('Instagram profile data saved to Firebase successfully');
        }
        
        // Save reels data if available
        if (instagramData.reels && instagramData.reels.length > 0) {
          await saveInstagramReelData(req.user.uid, instagramData.username, instagramData.reels);
          console.log('Instagram reels data saved to Firebase successfully');
        }
        
        // Update connection status
        await updateInstagramConnection(req.user.uid, instagramData.username, true);
        console.log('Instagram connection status updated successfully');
        
      } catch (firebaseError) {
        console.error('Error saving to Firebase:', firebaseError);
        // Continue with response even if Firebase save fails
      }

      return res.json({
        success: true,
        message: 'Instagram account validated successfully with complete data',
        data: {
          username: instagramData.username,
          profile: instagramData.profile ? {
            fullName: instagramData.profile.fullName,
            bio: instagramData.profile.bio,
            followers: instagramData.profile.followers,
            following: instagramData.profile.following,
            postsCount: instagramData.profile.postsCount,
            isVerified: instagramData.profile.isVerified,
            avatarUrl: instagramData.profile.avatarUrl
          } : null,
          reels: {
            totalReels: instagramData.totalReels || instagramData.reels?.length || 0,
            reelsPreview: instagramData.reels?.slice(0, 5) || [] // Return first 5 reels for preview
          },
          scrapedAt: instagramData.scrapedAt,
          errors: instagramData.errors
        }
      });
    } else {
      // Fallback: if scrapers failed, still allow validation based on format
      const isFormatValid = validateInstagramUsernameNew(instagramUsername);
      if (!isFormatValid) {
        console.log('Username format invalid during fallback');
        return res.status(400).json({
          success: false,
          message: 'Invalid Instagram username format',
          errors: instagramData.errors || ['Invalid format']
        });
      }

      console.log('Scrapers failed; returning format-only validation with sync required');
      return res.json({
        success: true,
        message: 'Instagram username validated by format. Data will sync after connect.',
        requiresSync: true,
        data: {
          username: cleanUsername,
          profile: null,
          reels: { totalReels: 0, reelsPreview: [] },
          scrapedAt: null,
          errors: instagramData.errors || ['Scrapers failed']
        }
      });
    }

  } catch (error) {
    console.error('=== VALIDATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=== END ERROR ===');
    
    // Check if this is an Apify usage limit error
    if (error.message.includes('Monthly usage hard limit exceeded') || 
        error.message.includes('403') || 
        error.message.includes('platform-feature-disabled')) {
      
      console.log('Apify usage limit exceeded, attempting database fallback...');
      
      try {
        // Try to get existing data from database
        const userDoc = await db.collection('influencers').doc(req.user.uid).get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          console.log('Found existing user data for fallback:', userData.instagramUsername);
          
          // Get latest stats from stats subcollection
          const statsSnapshot = await db.collection('influencers')
            .doc(req.user.uid)
            .collection('stats')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
          
          let latestStats = {};
          if (!statsSnapshot.empty) {
            latestStats = statsSnapshot.docs[0].data();
            console.log('Found latest stats for fallback:', latestStats);
          }
          
          // Return cached data with a warning
          return res.json({
            success: true,
            message: 'Instagram profile validated using cached data (API limit reached)',
            warning: 'Using cached data due to API usage limits. Data may not be current.',
            profileData: {
              username: userData.instagramUsername || username,
              fullName: userData.fullName || 'Unknown User',
              bio: userData.bio || '',
              avatarUrl: userData.avatarUrl || '',
              followers: latestStats.followers || userData.followers || 0,
              following: latestStats.following || userData.following || 0,
              postsCount: latestStats.posts || userData.postsCount || 0,
              reelsCount: userData.reelsCount || 0,
              engagementRate: latestStats.engagementRate || userData.engagementRate || 0,
              isVerified: userData.isVerified || false,
              isPrivate: userData.isPrivate || false,
              totalPosts: userData.totalPosts || 0,
              totalReels: userData.totalReels || 0,
              actorIds: ['cached-data'],
              dataSource: 'cached',
              lastUpdated: userData.lastUpdated || new Date().toISOString()
            }
          });
        }
      } catch (dbError) {
        console.error('Database fallback failed:', dbError.message);
      }
      
      // For new users with no cached data, provide manual validation option
      console.log('No cached data available, providing manual validation option...');
      
      return res.json({
        success: true,
        message: 'Instagram API temporarily unavailable - Manual validation enabled',
        warning: 'Our Instagram data service is temporarily unavailable due to API limits. You can proceed with manual validation.',
        requiresManualValidation: true,
        profileData: {
          username: username,
          fullName: 'Please update after connecting',
          bio: 'Please update after connecting',
          avatarUrl: '',
          followers: 0,
          following: 0,
          postsCount: 0,
          reelsCount: 0,
          engagementRate: 0,
          isVerified: false,
          isPrivate: false,
          totalPosts: 0,
          totalReels: 0,
          actorIds: ['manual-validation'],
          dataSource: 'manual',
          lastUpdated: new Date().toISOString(),
          manualValidationInstructions: [
            'Please verify that your Instagram username is correct',
            'Make sure your Instagram account is public for better visibility',
            'You can update your profile information manually after connecting',
            'Our data service will be restored soon for automatic updates'
          ]
        }
      });
    }
    
    // For other errors, return generic server error
    res.status(500).json({ 
      success: false,
      message: 'Server error during validation',
      error: error.message,
      errorType: 'server_error'
    });
  }
});

// TikTok validation endpoint
router.post('/validate-tiktok', authMiddleware, requireRole('influencer'), [
  body('tiktokUsername').isLength({ min: 1 }).trim()
], async (req, res) => {
  console.log('=== VALIDATE TIKTOK ENDPOINT REACHED ===');
  
  // Check for validation errors first
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('TikTok Validation errors:', errors.array());
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    console.log('=== VALIDATE TIKTOK ENDPOINT ===');
    const { tiktokUsername } = req.body;
    
    console.log('Received TikTok username:', tiktokUsername);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Call the APIFY service to validate and get profile data
    console.log('Calling validateTikTokUsername...');
    const validationResult = await validateTikTokUsername(tiktokUsername);
    console.log('TikTok Validation result:', JSON.stringify(validationResult, null, 2));
    
    if (validationResult.isValid) {
      // Check if we have existing TikTok data in database
      if (req.user) {
        try {
          console.log('Checking for existing TikTok profile data in database...');
          const userDoc = await db.collection('influencers').doc(req.user.uid).get();
          
          if (userDoc.exists) {
            const userData = userDoc.data();
            console.log('Found existing user data with TikTok info:', userData);
            
            // If we have existing TikTok data, merge it with validation result
            if (userData.tiktokUsername) {
              validationResult.profileData = {
                ...validationResult.profileData,
                existingData: {
                  tiktokUsername: userData.tiktokUsername,
                  tiktokVideosCount: userData.tiktokVideosCount || 0,
                  tiktokTotalLikes: userData.tiktokTotalLikes || 0,
                  tiktokTotalViews: userData.tiktokTotalViews || 0,
                  tiktokEngagementRate: userData.tiktokEngagementRate || 0
                },
                note: 'TikTok profile data includes existing database info'
              };
              console.log('Updated TikTok validation result with database data');
            }
          }
        } catch (dbError) {
          console.log('TikTok database check failed, using original validation result:', dbError.message);
        }
      }
      
      console.log('TikTok validation successful, sending success response');
      res.json({
        success: true,
        message: 'TikTok profile validated successfully',
        profileData: validationResult.profileData
      });
    } else {
      console.log('TikTok validation failed, sending error response');
      res.status(400).json({
        success: false,
        message: 'TikTok username validation failed',
        error: validationResult.message
      });
    }

  } catch (error) {
    console.error('=== TIKTOK VALIDATION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=== END TIKTOK ERROR ===');
    res.status(500).json({ 
      success: false,
      message: 'Server error during TikTok validation',
      error: error.message 
    });
  }
});

// Get current user's profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    console.log('Getting profile for user:', userId);
    
    const influencerDoc = await db.collection('influencers').doc(userId).get();
    if (!influencerDoc.exists) {
      try {
        if (userEmail) {
          const byEmailSnap = await db.collection('influencers').where('email', '==', userEmail).limit(1).get();
          if (!byEmailSnap.empty) {
            const data = byEmailSnap.docs[0].data();
            await db.collection('influencers').doc(userId).set(data, { merge: true });
            const newDoc = await db.collection('influencers').doc(userId).get();
            const newData = newDoc.data();
            const statsSnapshot = await db.collection('influencers')
              .doc(userId)
              .collection('stats')
              .orderBy('timestamp', 'desc')
              .limit(1)
              .get();
            let latestStats = null;
            if (!statsSnapshot.empty) {
              latestStats = statsSnapshot.docs[0].data();
            }
            return res.json({
              profile: { id: userId, ...newData },
              latestStats
            });
          }
        }
      } catch (linkErr) {}

      try {
        const igProfileRef = db.collection('users').doc(userId).collection('instagram').doc('profile');
        const igProfileDoc = await igProfileRef.get();
        if (igProfileDoc.exists) {
          const p = igProfileDoc.data();
          const synthesized = {
            instagramUsername: p.username || '',
            fullName: p.fullName || (userEmail || 'Unknown User'),
            bio: p.bio || '',
            location: '',
            categories: ['lifestyle'],
            contentTypes: ['posts'],
            followers: p.followers || 0,
            following: p.following || 0,
            postsCount: p.postsCount || 0,
            isVerified: !!p.isVerified,
            isPrivate: !!p.isPrivate,
            createdAt: new Date().toISOString()
          };
          await db.collection('influencers').doc(userId).set(synthesized, { merge: true });
          const statsSnapshot = await db.collection('influencers')
            .doc(userId)
            .collection('stats')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
          let latestStats = null;
          if (!statsSnapshot.empty) {
            latestStats = statsSnapshot.docs[0].data();
          }
          return res.json({
            profile: { id: userId, ...synthesized },
            latestStats
          });
        }
      } catch (subErr) {}

      if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH === '1') {
        const minimal = {
          fullName: req.user.displayName || userEmail || 'Unknown User',
          instagramUsername: '',
          bio: '',
          location: '',
          categories: ['lifestyle'],
          contentTypes: ['posts'],
          createdAt: new Date().toISOString()
        };
        await db.collection('influencers').doc(userId).set(minimal, { merge: true });
        return res.json({
          profile: { id: userId, ...minimal },
          latestStats: null
        });
      }

      return res.status(404).json({ message: 'Influencer not found' });
    }

    const influencerData = influencerDoc.data();
    console.log('Profile data found:', influencerData);
    
    // Get latest stats
    const statsSnapshot = await db.collection('influencers')
      .doc(userId)
      .collection('stats')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    let latestStats = null;
    if (!statsSnapshot.empty) {
      latestStats = statsSnapshot.docs[0].data();
      console.log('Found latest stats:', latestStats);
    } else {
      console.log('No stats found for user:', userId);
    }

    const response = {
      profile: {
        id: userId,
        ...influencerData
      },
      latestStats
    };
    
    console.log('Sending profile response:', JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error('Error getting profile:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Test route for debugging
router.get('/', authMiddleware, async (req, res) => {
  res.json({ 
    message: 'Influencer routes are working', 
    user: req.user ? { uid: req.user.uid, email: req.user.email } : null 
  });
});

// Create influencer profile
router.post('/', authMiddleware, requireRole('influencer'), [
  body('fullName').isLength({ min: 2 }).trim(),
  body('instagramUsername').optional().trim(),
  body('bio').optional().isLength({ max: 500 }).trim(),
  body('location').optional().isLength({ max: 100 }).trim(),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer_not_to_say']),
  body('categories').optional().isArray(),
  body('contentTypes').optional().isArray(),
  body('priceRangeMin').optional().isNumeric().isFloat({ min: 0 }),
  body('priceRangeMax').optional().isNumeric().isFloat({ min: 0 })
], async (req, res) => {
  console.log('=== PROFILE CREATION START ===');
  try {
    console.log('Step 1: Profile creation request received:', JSON.stringify(req.body, null, 2));
    
    console.log('Step 2: Checking validation...');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Step 2: Validation errors:', JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }
    console.log('Step 2: Validation passed ✓');

    console.log('Step 3: Getting user ID...');
    const userId = req.user.uid;
    console.log('Step 3: User ID:', userId, '✓');
    
    console.log('Step 4: Checking for existing profile...');
    const existingProfile = await db.collection('influencers').doc(userId).get();
    console.log('Step 4: Firestore query completed');
    if (existingProfile.exists) {
      console.log('Profile already exists for user:', userId);
      return res.status(400).json({ message: 'Influencer profile already exists' });
    }
    console.log('Step 4: No existing profile found, proceeding with creation ✓');

    console.log('Step 5: Extracting request data...');
    const {
      fullName,
      instagramUsername,
      bio,
      location,
      gender,
      categories,
      contentTypes,
      priceRangeMin,
      priceRangeMax,
      // YouTube fields
      youtubeChannelId,
      youtubeChannelTitle,
      youtubeChannelUrl,
      // TikTok fields
      tiktokUsername,
      // Quiz fields
      averageDeliveryTime,
      phoneNumber,
      city,
      country,
      languages,
      maritalStatus,
      children,
      pricingTier,
      deliverables,
      deliveryProductBased,
      deliveryNoProduct,
      deliveryOutdoorShoot,
      deliveryRevisions
    } = req.body;
    console.log('Step 5: Data extraction completed ✓');

    console.log('Step 6: Processing Instagram username...');
    let apifyData = null;
    
    // COMMENTED OUT - Using only Instagram Reel Scraper as requested
    // If Instagram username is provided, fetch data from APIFY
    // if (instagramUsername && instagramUsername.trim()) {
    //   try {
    //     console.log('Step 6a: Fetching Instagram data from APIFY...');
    //     apifyData = await scrapeInstagramProfile(instagramUsername.replace('@', ''));
    //     console.log('Step 6a: APIFY data fetched successfully:', apifyData);
    //   } catch (apifyError) {
    //     console.warn('Step 6a: APIFY fetch failed, continuing with default values:', apifyError.message);
    //     // Continue with profile creation even if APIFY fails
    //     apifyData = null;
    //   }
    // }
    console.log('Step 6: Instagram processing completed ✓ (Profile scraper disabled - using only Instagram Reel Scraper)');

    console.log('Step 6.5: Processing TikTok username...');
    let tiktokData = null;
    
    // If TikTok username is provided, fetch data from APIFY
    if (tiktokUsername && tiktokUsername.trim()) {
      try {
        console.log('Step 6.5a: Fetching TikTok data from APIFY...');
        tiktokData = await scrapeTikTokProfile(tiktokUsername.replace('@', ''));
        console.log('Step 6.5a: TikTok APIFY data fetched successfully:', tiktokData);
      } catch (tiktokError) {
        console.warn('Step 6.5a: TikTok APIFY fetch failed, continuing with default values:', tiktokError.message);
        // Continue with profile creation even if TikTok APIFY fails
        tiktokData = null;
      }
    }
    console.log('Step 6.5: TikTok processing completed ✓');

    console.log('Step 7: Creating influencer data object...');
    // Create influencer profile
    const influencerData = {
      fullName: fullName || 'Unknown User',
      instagramUsername: instagramUsername || '',
      bio: bio || '',
      location: location || '',
      gender: gender || 'prefer_not_to_say',
      categories: Array.isArray(categories) && categories.length > 0 ? categories : ['lifestyle'],
      contentTypes: Array.isArray(contentTypes) && contentTypes.length > 0 ? contentTypes : ['posts'],
      priceRangeMin: parseFloat(priceRangeMin) || 100,
      priceRangeMax: parseFloat(priceRangeMax) || 1000,
      averageDeliveryTime: Number(averageDeliveryTime) || null,
      
      // YouTube fields
      youtubeChannelId: youtubeChannelId || '',
      youtubeChannelTitle: youtubeChannelTitle || '',
      youtubeChannelUrl: youtubeChannelUrl || '',
      
      // TikTok fields
      tiktokUsername: tiktokUsername || '',
      tiktokFollowers: tiktokData?.followers || 0,
      tiktokFollowing: tiktokData?.following || 0,
      tiktokVideosCount: tiktokData?.videosCount || 0,
      tiktokTotalLikes: tiktokData?.totalLikes || 0,
      tiktokTotalViews: tiktokData?.totalViews || 0,
      tiktokTotalShares: tiktokData?.totalShares || 0,
      tiktokTotalComments: tiktokData?.totalComments || 0,
      tiktokEngagementRate: tiktokData?.engagementRate || 0,
      tiktokAvatarUrl: tiktokData?.avatarUrl || '',
      
      // Enhanced TikTok data from APIFY
      tiktokUid: tiktokData?.uid || '',
      tiktokFullName: tiktokData?.fullName || '',
      tiktokBio: tiktokData?.bio || '',
      tiktokRegion: tiktokData?.region || '',
      tiktokLanguage: tiktokData?.language || '',
      tiktokIsVerified: tiktokData?.isVerified || false,
      tiktokIsPrivate: tiktokData?.isPrivate || false,
      tiktokAvatarMedium: tiktokData?.avatarMedium || '',
      tiktokAvatarThumb: tiktokData?.avatarThumb || '',
      tiktokProfileDeepLink: tiktokData?.profileDeepLink || '',
      tiktokCreateTime: tiktokData?.createTime || null,
      tiktokModifyTime: tiktokData?.modifyTime || null,
      tiktokCommerceUserLevel: tiktokData?.commerceUserLevel || 0,
      tiktokEnterpriseVerifyReason: tiktokData?.enterpriseVerifyReason || '',
      tiktokRawData: tiktokData?.rawApifyData || null,
      tiktokScrapedAt: tiktokData?.scrapedAt || null,
      
      // Additional quiz fields
      phoneNumber: phoneNumber || '',
      city: city || '',
      country: country || '',
      languages: Array.isArray(languages) ? languages : [],
      maritalStatus: maritalStatus || '',
      children: children || '',
      pricingTier: pricingTier || '',
      deliverables: Array.isArray(deliverables) ? deliverables : [],
      deliveryProductBased: deliveryProductBased || '',
      deliveryNoProduct: deliveryNoProduct || '',
      deliveryOutdoorShoot: deliveryOutdoorShoot || '',
      deliveryRevisions: deliveryRevisions || '',
      
      // Instagram metrics from APIFY or defaults
      avatarUrl: apifyData?.avatarUrl || '/images/profiles/placeholder.svg',
      followers: apifyData?.followers || 0,
      following: apifyData?.following || 0,
      postsCount: apifyData?.postsCount || 0,
      engagementRate: apifyData?.engagementRate || 0,
      isVerified: apifyData?.isVerified || false,
      isPrivate: apifyData?.isPrivate || false,
      
      // Enhanced Instagram data from APIFY
      instagramUserId: apifyData?.userId || '',
      instagramFullName: apifyData?.fullName || '',
      instagramBio: apifyData?.bio || '',
      instagramExternalUrl: apifyData?.externalUrl || '',
      instagramBusinessCategory: apifyData?.businessCategoryName || '',
      instagramCategory: apifyData?.categoryName || '',
      instagramIsBusinessAccount: apifyData?.isBusinessAccount || false,
      instagramIsProfessionalAccount: apifyData?.isProfessionalAccount || false,
      instagramBusinessEmail: apifyData?.businessEmail || '',
      instagramBusinessPhone: apifyData?.businessPhoneNumber || '',
      instagramBusinessAddress: apifyData?.businessAddressJson || null,
      instagramProfilePicHd: apifyData?.profilePicUrlHd || '',
      instagramRawData: apifyData?.rawApifyData || null,
      instagramScrapedAt: apifyData?.scrapedAt || null,
      
      // Metadata
      createdAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      isActive: true
    };
    console.log('Step 7: Influencer data object created ✓');

    console.log('Step 8: Attempting to save profile to Firestore...');
    await db.collection('influencers').doc(userId).set(influencerData);
    console.log('Step 8: Profile saved successfully to Firestore ✓');

    console.log('Step 8.5: Updating user role to influencer...');
    // Update user's role to 'influencer' after successful profile creation
    if (req.user.role === 'content_creator') {
      await db.collection('users').doc(userId).update({
        role: 'influencer',
        userType: 'influencer',
        roleChosenAt: new Date().toISOString()
      });
      console.log('Step 8.5: User role updated to influencer ✓');
    }

    console.log('Step 9: Checking if stats snapshot needed...');
    // Store initial stats snapshot only if we have Instagram data
    if (apifyData) {
      console.log('Step 9: Saving initial stats snapshot...');
      const timestamp = new Date().toISOString();
      const statsData = {
        followers: apifyData.followers,
        following: apifyData.following,
        postsCount: apifyData.postsCount,
        engagementRate: apifyData.engagementRate,
        timestamp,
        rawApifyResponse: apifyData
      };

      await db.collection('influencers')
        .doc(userId)
        .collection('stats')
        .doc(timestamp.replace(/[:.]/g, '-'))
        .set(statsData);
      console.log('Step 9: Stats snapshot saved successfully ✓');
    } else {
      console.log('Step 9: No Instagram data, skipping stats snapshot ✓');
    }

    // Store TikTok stats snapshot if we have TikTok data
    if (tiktokData) {
      console.log('Step 9.5: Saving TikTok stats snapshot...');
      const timestamp = new Date().toISOString();
      const tiktokStatsData = {
        platform: 'tiktok',
        followers: tiktokData.followers,
        following: tiktokData.following,
        videosCount: tiktokData.videosCount,
        totalLikes: tiktokData.totalLikes,
        totalViews: tiktokData.totalViews,
        totalShares: tiktokData.totalShares,
        totalComments: tiktokData.totalComments,
        engagementRate: tiktokData.engagementRate,
        timestamp,
        rawApifyResponse: tiktokData
      };

      await db.collection('influencers')
        .doc(userId)
        .collection('tiktokStats')
        .doc(timestamp.replace(/[:.]/g, '-'))
        .set(tiktokStatsData);
      console.log('Step 9.5: TikTok stats snapshot saved successfully ✓');
    } else {
      console.log('Step 9.5: No TikTok data, skipping TikTok stats snapshot ✓');
    }

    console.log('Step 10: Sending success response...');
    res.status(201).json({
      message: 'Influencer profile created successfully',
      profile: influencerData
    });
    console.log('Step 10: Success response sent ✓');
    console.log('=== PROFILE CREATION COMPLETE ===');

  } catch (error) {
    console.error('=== PROFILE CREATION ERROR ===');
    console.error('Create influencer profile error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=== END ERROR ===');
    res.status(500).json({ message: 'Server error during profile creation', error: error.message });
  }
});

// Get influencer profile by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    
    console.log('=== GET PROFILE ROUTE ===');
    console.log('Requested influencer ID:', influencerId);
    console.log('Requesting user:', req.user?.uid);
    
    const influencerDoc = await db.collection('influencers').doc(influencerId).get();
    if (!influencerDoc.exists) {
      console.log('Influencer not found for ID:', influencerId);
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const influencerData = influencerDoc.data();
    console.log('Found influencer data:', JSON.stringify(influencerData, null, 2));
    
    // Get latest stats
    const statsSnapshot = await db.collection('influencers')
      .doc(influencerId)
      .collection('stats')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    let latestStats = null;
    if (!statsSnapshot.empty) {
      latestStats = statsSnapshot.docs[0].data();
      console.log('Found latest stats:', JSON.stringify(latestStats, null, 2));
    } else {
      console.log('No stats found for influencer:', influencerId);
    }

    const response = {
      profile: {
        id: influencerId,
        ...influencerData
      },
      latestStats
    };
    
    console.log('Sending response:', JSON.stringify(response, null, 2));
    console.log('=== END GET PROFILE ROUTE ===');

    res.json(response);

  } catch (error) {
    console.error('Get influencer profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update influencer profile
router.put('/:id', authMiddleware, requireRole('influencer'), async (req, res) => {
  try {
    console.log('=== INFLUENCER UPDATE ROUTE REACHED ===');
    console.log('Route params:', req.params);
    console.log('User from auth:', req.user);
    console.log('Request body received:', JSON.stringify(req.body, null, 2));
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body type:', typeof req.body);
    
    const influencerId = req.params.id;
    const userId = req.user.uid;

    // Check if user owns this profile
    if (influencerId !== userId) {
      console.log('Access denied: influencerId !== userId', { influencerId, userId });
      return res.status(403).json({ message: 'Access denied' });
    }

    const allowedUpdates = [
      'fullName',
      'bio',
      'location',
      'categories',
      'contentTypes',
      'priceRangeMin',
      'priceRangeMax',
      'averageDeliveryTime',
      'phoneNumber',
      'city',
      'country',
      'languages',
      'maritalStatus',
      'children',
      'pricingTier',
      'deliverables',
      'deliveryProductBased',
      'deliveryNoProduct',
      'deliveryOutdoorShoot',
      'deliveryRevisions',
      // New profile completion fields
      'niche',
      'contentStyle',
      'reelPrice',
      'storyPrice',
      'eventPrice',
      'multiplePlatformsPrice',
      // Social connections
      'instagramUsername',
      'youtubeChannelId',
      'youtubeChannelTitle',
      'youtubeChannelUrl',
      'tiktokUsername'
    ];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      console.log(`Checking key: "${key}", value: "${req.body[key]}", type: "${typeof req.body[key]}", allowed: ${allowedUpdates.includes(key)}`);
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // Debug logging for all update requests
    console.log('=== BACKEND UPDATE DEBUG ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Allowed updates:', allowedUpdates);
    console.log('Updates object after filtering:', JSON.stringify(updates, null, 2));
    console.log('Number of valid updates:', Object.keys(updates).length);
    console.log('=== END BACKEND UPDATE DEBUG ===');
    console.log('=== END BACKEND UPDATE DEBUG ===');

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid updates provided' });
    }

    updates.updatedAt = new Date().toISOString();

    const docRef = db.collection('influencers').doc(influencerId);
    const existing = await docRef.get();

    if (!existing.exists) {
      // Upsert: create a minimal profile document if it doesn't exist yet
      await docRef.set({
        ...updates,
        createdAt: new Date().toISOString(),
        isActive: true
      }, { merge: true });
    } else {
      await docRef.update(updates);
    }

    // COMMENTED OUT - Using only Instagram Reel Scraper as requested
    // If Instagram username was connected/updated, scrape immediately and store data
    // if (updates.instagramUsername) {
    //   try {
    //     console.log('Instagram username updated, fetching profile data...');
    //     const instagramData = await scrapeInstagramProfile(updates.instagramUsername.replace('@', ''));
    //     console.log('Instagram profile data fetched:', instagramData);
        
    //     // Update the document with Instagram data
    //     const instagramUpdates = {
    //       instagramFollowers: instagramData?.followers || 0,
    //       instagramFollowing: instagramData?.following || 0,
    //       instagramPostsCount: instagramData?.postsCount || 0,
    //       instagramEngagementRate: instagramData?.engagementRate || 0,
    //       instagramAvatarUrl: instagramData?.avatarUrl || '',
    //       instagramFullName: instagramData?.fullName || '',
    //       instagramBio: instagramData?.bio || '',
    //       instagramIsVerified: instagramData?.isVerified || false,
    //       instagramIsPrivate: instagramData?.isPrivate || false,
    //       updatedAt: new Date().toISOString()
    //     };
        
    //     await docRef.update(instagramUpdates);
    //     console.log('Instagram profile data updated successfully');
    //   } catch (instagramError) {
    //     console.warn('Instagram profile data fetch failed:', instagramError.message);
    //     // Continue without failing the entire update
    //   }
    // }

    // If YouTube channel data was connected/updated, store the data
    if (updates.youtubeChannelId || updates.youtubeChannelTitle || updates.youtubeChannelUrl) {
      try {
        console.log('YouTube channel data updated, storing information...');
        
        // Update the document with YouTube data
        const youtubeUpdates = {
          youtubeChannelId: updates.youtubeChannelId || '',
          youtubeChannelTitle: updates.youtubeChannelTitle || '',
          youtubeChannelUrl: updates.youtubeChannelUrl || '',
          youtubeSubscribers: updates.youtubeSubscribers || 0,
          youtubeViews: updates.youtubeViews || 0,
          youtubeVideos: updates.youtubeVideos || 0,
          updatedAt: new Date().toISOString()
        };
        
        await docRef.update(youtubeUpdates);
        console.log('YouTube channel data updated successfully');
      } catch (youtubeError) {
        console.warn('YouTube channel data update failed:', youtubeError.message);
        // Continue without failing the entire update
      }
    }

    // Auto-refresh Instagram data when instagramUsername is connected/updated
    if (updates.instagramUsername) {
      try {
        console.log('Instagram username updated, refreshing detailed data (reels + profile)...');

        // Run dual-actor scrape with a timeout to avoid hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Instagram fetch timeout')), 30000);
        });

        const instagramData = await Promise.race([
          scrapeInstagramComplete(updates.instagramUsername),
          timeoutPromise
        ]);

        // Cap to recent 10 reels by default on auto-refresh
        const recentReels = instagramData?.reels ? instagramData.reels.slice(0, 10) : [];

        // Save reels and profile to Firebase for dashboard consumption
        await saveInstagramReelData(influencerId, updates.instagramUsername, recentReels);
        if (instagramData?.profile) {
          await saveInstagramProfileData(influencerId, instagramData.profile);
        }

        console.log(`Instagram data refreshed on connect for ${updates.instagramUsername}`, {
          totalReels: recentReels.length,
          hasProfile: !!instagramData?.profile
        });
      } catch (instagramError) {
        console.warn('Instagram refresh on connect failed:', instagramError.message);
        // Continue without failing the profile update
      }
    }

    // If TikTok username was connected/updated, scrape immediately and store data
    if (updates.tiktokUsername) {
      try {
        console.log('TikTok username updated, fetching profile data...');
        const tiktokData = await scrapeTikTokProfile(updates.tiktokUsername.replace('@', ''));
        console.log('TikTok profile data fetched:', tiktokData);
        
        // Update the document with TikTok data
        const tiktokUpdates = {
          tiktokFollowers: tiktokData?.followers || 0,
          tiktokFollowing: tiktokData?.following || 0,
          tiktokVideosCount: tiktokData?.videosCount || 0,
          tiktokTotalLikes: tiktokData?.totalLikes || 0,
          tiktokTotalViews: tiktokData?.totalViews || 0,
          tiktokTotalShares: tiktokData?.totalShares || 0,
          tiktokTotalComments: tiktokData?.totalComments || 0,
          tiktokEngagementRate: tiktokData?.engagementRate || 0,
          tiktokAvatarUrl: tiktokData?.avatarUrl || '',
          updatedAt: new Date().toISOString()
        };
        
        await docRef.update(tiktokUpdates);
        console.log('TikTok profile data updated successfully');
      } catch (tiktokError) {
        console.warn('TikTok profile data fetch failed:', tiktokError.message);
        // Continue without failing the entire update
      }
    }

    res.json({ success: true, message: 'Profile updated successfully' });

  } catch (error) {
    console.error('Update influencer profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get influencer stats history
router.get('/:id/stats', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    const limit = parseInt(req.query.limit) || 30;
    
    const statsSnapshot = await db.collection('influencers')
      .doc(influencerId)
      .collection('stats')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const stats = [];
    statsSnapshot.forEach(doc => {
      const data = doc.data();
      stats.push({
        id: doc.id,
        followers: data.followers,
        following: data.following,
        postsCount: data.postsCount,
        engagementRate: data.engagementRate,
        timestamp: data.timestamp
      });
    });

    res.json({ stats: stats.reverse() }); // Return in chronological order

  } catch (error) {
    console.error('Get influencer stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Fetch and save Instagram data to Firebase (called once to refresh data)
router.post('/:id/instagram/refresh', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    const defaultLimit = 10;
    const limitParam = req.query.limit ? parseInt(req.query.limit, 10) : defaultLimit; // Save recent 10 by default

    const docRef = db.collection('influencers').doc(influencerId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const data = doc.data();
    if (!data.instagramUsername) {
      return res.status(400).json({ message: 'Instagram username not connected' });
    }

    console.log(`Refreshing Instagram data for: ${data.instagramUsername} (fetching ${limitParam} reels)`);

    try {
      // Set a timeout for the Instagram data fetch
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Instagram fetch timeout')), 30000); // 30 second timeout
      });

      // Fetch detailed Instagram data using the complete dual actor service
      const instagramData = await Promise.race([
        scrapeInstagramComplete(data.instagramUsername),
        timeoutPromise
      ]);
      
      // Save recent reels capped by limitParam (default 10)
      const recentReels = instagramData.reels
        ? instagramData.reels.slice(0, limitParam)
        : [];
      
      // Save Instagram reel data using the Firebase service
      const { saveInstagramReelData, saveInstagramProfileData } = require('../services/firebaseService');
      await saveInstagramReelData(influencerId, data.instagramUsername, recentReels);
      
      // Save Instagram profile data if available
      if (instagramData.profile) {
        await saveInstagramProfileData(influencerId, instagramData.profile);
      }
      
      // Also save to instagramDetailedData collection for compatibility
      const cacheData = {
        profile: instagramData.profile || {
          username: data.instagramUsername,
          fullName: data.fullName || '',
          bio: data.bio || '',
          avatarUrl: data.avatarUrl || '',
          followers: 0,
          following: 0,
          postsCount: 0,
          isVerified: false,
          isPrivate: false,
          engagementRate: 0
        },
        reels: recentReels,
        analytics: {
          totalLikes: recentReels.reduce((sum, reel) => sum + (reel.likesCount || 0), 0),
          totalComments: recentReels.reduce((sum, reel) => sum + (reel.commentsCount || 0), 0),
          averageLikes: recentReels.length > 0 ? Math.round(recentReels.reduce((sum, reel) => sum + (reel.likesCount || 0), 0) / recentReels.length) : 0,
          averageComments: recentReels.length > 0 ? Math.round(recentReels.reduce((sum, reel) => sum + (reel.commentsCount || 0), 0) / recentReels.length) : 0,
          engagementRate: instagramData.profile?.engagementRate || 0
        },
        metadata: {
          cachedAt: new Date().toISOString(),
          scrapedAt: new Date().toISOString(),
          influencerId: influencerId,
          lastRefresh: new Date().toISOString(),
          totalReels: recentReels.length,
          dataSource: 'apify'
        }
      };
      
      // Store in instagramDetailedData collection
      await db.collection('instagramDetailedData').doc(influencerId).set(cacheData);
      
      console.log(`Successfully saved ${recentReels.length} recent reels for ${data.instagramUsername}`);
      
      res.json({
        success: true,
        message: `Instagram reels data refreshed and saved to Firebase (recent ${recentReels.length})`,
        stats: {
          reelsCount: recentReels.length,
          lastRefresh: new Date().toISOString(),
          username: data.instagramUsername
        }
      });
      
    } catch (fetchError) {
      console.error('Error fetching Instagram data:', fetchError);
      return res.status(500).json({ 
        message: 'Failed to fetch Instagram data', 
        error: fetchError.message 
      });
    }

  } catch (error) {
    console.error('Refresh Instagram data error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get detailed Instagram data from Firebase database (no API calls)
router.get('/:id/instagram/detailed', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;

    const docRef = db.collection('influencers').doc(influencerId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const data = doc.data();
    if (!data.instagramUsername) {
      return res.status(400).json({ message: 'Instagram username not connected' });
    }

    console.log(`Loading Instagram data from database for: ${data.instagramUsername}`);

    try {
      // Get Instagram reel data from Firebase using the new service
      const { getInstagramReelData, getInstagramProfileData } = require('../services/firebaseService');
      
      const reelResult = await getInstagramReelData(influencerId);
      const profileResult = await getInstagramProfileData(influencerId);
      
      if (!reelResult.success && !profileResult.success) {
        return res.status(404).json({ 
          message: 'No Instagram data found in database. Please refresh data first.',
          needsRefresh: true
        });
      }

      const reelData = reelResult.data;
      const profileData = profileResult.data;
      
      // Use profile data if available, otherwise fall back to reel data or influencer data
      const profile = profileData || {};
      const reels = reelData || []; // reelData is now the array directly
      
      // Calculate analytics from reel data
      const totalLikes = reels.reduce((sum, reel) => sum + (reel.likesCount || 0), 0);
      const totalComments = reels.reduce((sum, reel) => sum + (reel.commentsCount || 0), 0);
      const totalViews = reels.reduce((sum, reel) => sum + (reel.viewsCount || 0), 0);
      const totalEngagement = totalLikes + totalComments;
      const avgLikes = reels.length > 0 ? Math.round(totalLikes / reels.length) : 0;
      const avgComments = reels.length > 0 ? Math.round(totalComments / reels.length) : 0;
      
      // Calculate engagement rate if profile data is available
      const followers = profile.followers || data.followers || 0;
      const engagementRate = followers > 0 && reels.length > 0 ? 
        ((totalEngagement / reels.length) / followers * 100).toFixed(2) : 0;

      // Compute reach and breakdown
      // Reach approximated by total views (from scraped reels). If missing, fallback to a conservative estimate.
      const reach = totalViews > 0 ? totalViews : Math.max(followers, Math.round(totalEngagement * 20));
      const followersReach = Math.min(followers, reach);
      const nonFollowersReach = Math.max(reach - followersReach, 0);
      
      console.log(`Returning Instagram data from Firebase for ${data.instagramUsername}`, {
        totalReels: reels.length,
        username: profile.username || data.instagramUsername,
        hasProfile: !!profileData,
        engagementRate: engagementRate
      });
      
      res.json({
        success: true,
        fromDatabase: true,
        profile: {
          username: profile.username || data.instagramUsername,
          fullName: profile.fullName || data.fullName,
          bio: profile.bio || data.bio,
          avatarUrl: profile.avatarUrl || data.avatarUrl,
          followers: profile.followers || data.followers || 0,
          following: profile.following || 0,
          postsCount: profile.postsCount || 0,
          isVerified: profile.isVerified || false,
          isPrivate: profile.isPrivate || false,
          businessCategoryName: profile.businessCategoryName || '',
          isBusinessAccount: profile.isBusinessAccount || false,
          lastUpdated: profile.lastUpdated
        },
        posts: { posts: [], reels: [], videos: [] }, // Empty posts since we're only using reel scraper
        reels: reels, // Return all reels from Firebase
        analytics: {
          totalPosts: reels.length,
          totalLikes: totalLikes,
          totalComments: totalComments,
          averageLikes: avgLikes,
          averageComments: avgComments,
          totalEngagement: totalEngagement,
          engagementRate: parseFloat(engagementRate),
          reach: reach,
          followersReach: followersReach,
          nonFollowersReach: nonFollowersReach,
          // Add derived metrics for richer UI display
          impressions: Math.max(reach, Math.round(reach * 1.2)),
          profileVisits: Math.round(reach * 0.18)
        },
        metadata: {
          totalEngagement: totalEngagement,
          engagementRate: parseFloat(engagementRate),
          lastUpdated: profile.lastUpdated,
          scrapedAt: profile.createdAt,
          totalReels: reels.length,
          actorIds: ['instagram-reel-scraper']
        }
      });

    } catch (error) {
      console.error('Error loading Instagram data from Firebase:', error);
      return res.status(500).json({ 
        message: 'Failed to load Instagram data from database',
        error: error.message
      });
    }

  } catch (error) {
    console.error('Get detailed Instagram data error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get recent Instagram posts (likes/comments) for engagement calculations
router.get('/:id/instagram/posts', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    const limit = parseInt(req.query.limit) || 10;

    const docRef = db.collection('influencers').doc(influencerId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const data = doc.data();
    if (!data.instagramUsername) {
      return res.status(400).json({ message: 'Instagram username not connected' });
    }

    const followers = Number(data.followers) || 0;
    const postsRef = docRef.collection('posts');
    const cachedSnap = await postsRef.orderBy('takenAt', 'desc').limit(limit).get();
    const cached = [];
    cachedSnap.forEach((d) => {
      const pd = d.data();
      cached.push({
        id: pd.id || d.id,
        url: pd.url,
        likes: Number(pd.likes) || 0,
        comments: Number(pd.comments) || 0,
        takenAt: pd.takenAt || null,
      });
    });

    const latestScrapedAt = cachedSnap.empty ? 0 : new Date(cachedSnap.docs[0].data().scrapedAt || 0).getTime();
    const isStale = Date.now() - latestScrapedAt > 6 * 60 * 60 * 1000; // 6 hours

    // If we have fresh cache, return immediately
    if (cached.length > 0 && !isStale) {
      return res.json({ followers, posts: cached });
    }

    // If cache exists but stale, return cached immediately without triggering Apify
    if (cached.length > 0 && isStale) {
      return res.json({ followers, posts: cached });
    }

    // No cache: return empty results immediately to prevent timeouts.
    // Scraping is disabled due to Apify quota limits. A scheduled job can backfill when available.
    return res.json({ followers, posts: [] });
  } catch (error) {
    console.error('Get Instagram recent posts error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// YouTube Analytics Endpoints

// Refresh YouTube data and analytics
router.post('/:id/youtube/refresh', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    
    // Get influencer document
    const docRef = db.collection('influencers').doc(influencerId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ message: 'Influencer not found' });
    }
    
    const data = doc.data();
    if (!data.youtubeChannelId && !data.youtubeChannelUrl) {
      return res.status(400).json({ message: 'YouTube channel not connected' });
    }
    
    // Resolve channelId if stored as handle or mock
    let channelId = data.youtubeChannelId || '';
    let channelUrl = data.youtubeChannelUrl || '';

    if (!channelId.startsWith('UC')) {
      try {
        const query = channelUrl || channelId || '';
        const resolved = await youtubeService.searchChannel(query);
        if (resolved?.channelId?.startsWith('UC')) {
          channelId = resolved.channelId;
          channelUrl = resolved.channelUrl || channelUrl;
          await docRef.update({
            youtubeChannelId: channelId,
            youtubeChannelUrl: channelUrl,
            youtubeChannelTitle: resolved.channelTitle || data.youtubeChannelTitle || ''
          });
          console.log('Resolved channelId via searchChannel:', channelId);
        } else {
          console.warn('Could not resolve to a valid UC* channelId, proceeding with existing value:', channelId);
        }
      } catch (resolveErr) {
        console.warn('Error resolving channelId from handle/mock:', resolveErr?.message || resolveErr);
      }
    }
    
    console.log('Refreshing YouTube data for channel:', channelId);
    
    // Fetch comprehensive YouTube data
    const youtubeData = await youtubeService.getComprehensiveChannelData(channelId);
    
    // Save to youtubeAnalytics collection
    const analyticsData = {
      userId: influencerId,
      channelId: channelId,
      channelTitle: youtubeData.channelTitle,
      
      // Basic metrics
      subscriberCount: youtubeData.subscriberCount,
      viewCount: youtubeData.viewCount,
      videoCount: youtubeData.videoCount,
      
      // Detailed analytics
      views: youtubeData.analytics.views,
      likes: youtubeData.aggregatedMetrics.totalLikes,
      comments: youtubeData.aggregatedMetrics.totalComments,
      estimatedMinutesWatched: youtubeData.analytics.estimatedMinutesWatched,
      averageViewDuration: youtubeData.analytics.averageViewDuration,
      subscribersGained: youtubeData.analytics.subscribersGained,
      subscribersLost: youtubeData.analytics.subscribersLost,
      // Source marker for UI badges
      dataSource: youtubeData.analytics?.dataSource || 'live',
      
      // Traffic sources
      trafficSourceType: youtubeData.analytics.trafficSourceType,
      
      // Device breakdown
      deviceType: youtubeData.analytics.deviceType,
      
      // Geographic data
      country: youtubeData.analytics.country,
      
      // Demographics
      gender: youtubeData.analytics.gender,
      ageGroup: youtubeData.analytics.ageGroup,
      
      // Engagement metrics
      engagementRate: parseFloat(youtubeData.aggregatedMetrics.engagementRate),
      
      // Video data
      recentVideos: youtubeData.videos.slice(0, 30), // Store up to 30 recent videos with iframe data
      
      // Metadata
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: youtubeData.lastUpdated
    };
    
    // Save analytics data
    await db.collection('youtubeAnalytics').add(analyticsData);
    
    // Update influencer document with latest stats
    await docRef.update({
      youtubeSubscribers: youtubeData.subscriberCount,
      youtubeViews: youtubeData.viewCount,
      youtubeVideos: youtubeData.videoCount,
      youtubeLastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('YouTube data refreshed and saved successfully');
    
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
    console.error('YouTube refresh error:', error);
    res.status(500).json({ 
      message: 'Failed to refresh YouTube data', 
      error: error.message 
    });
  }
});

// Get detailed YouTube analytics
router.get('/:id/youtube/detailed', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    
    // Get influencer document
    const docRef = db.collection('influencers').doc(influencerId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ message: 'Influencer not found' });
    }
    
    const data = doc.data();
    if (!data.youtubeChannelId) {
      return res.status(400).json({ message: 'YouTube channel not connected' });
    }
    
    // Get latest analytics data from database
    // Using simple query to avoid composite index requirement
    const analyticsSnapshot = await db.collection('youtubeAnalytics')
      .where('userId', '==', influencerId)
      .get();
    
      if (analyticsSnapshot.empty) {
        // Auto-refresh: fetch comprehensive channel data and save a new analytics snapshot
        try {
          const youtubeData = await youtubeService.getComprehensiveChannelData(data.youtubeChannelId);
          const analyticsData = {
            userId: influencerId,
            channelId: data.youtubeChannelId,
            channelTitle: youtubeData.channelTitle,
            subscriberCount: youtubeData.subscriberCount,
            viewCount: youtubeData.viewCount,
            videoCount: youtubeData.videoCount,
            views: youtubeData.analytics.views,
            likes: youtubeData.aggregatedMetrics.totalLikes,
            comments: youtubeData.aggregatedMetrics.totalComments,
            estimatedMinutesWatched: youtubeData.analytics.estimatedMinutesWatched,
            averageViewDuration: youtubeData.analytics.averageViewDuration,
            subscribersGained: youtubeData.analytics.subscribersGained,
            subscribersLost: youtubeData.analytics.subscribersLost,
            trafficSourceType: youtubeData.analytics.trafficSourceType,
            deviceType: youtubeData.analytics.deviceType,
            country: youtubeData.analytics.country,
            gender: youtubeData.analytics.gender,
            ageGroup: youtubeData.analytics.ageGroup,
            engagementRate: parseFloat(youtubeData.aggregatedMetrics.engagementRate),
            // Source marker for UI badges
            dataSource: youtubeData.analytics?.dataSource || 'live',
      recentVideos: youtubeData.videos.slice(0, 30),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: youtubeData.lastUpdated
          };
          await db.collection('youtubeAnalytics').add(analyticsData);

        // Return the same response format as below using the freshly created data
        const response = {
          channelInfo: {
            channelId: data.youtubeChannelId,
            channelTitle: analyticsData.channelTitle,
            subscriberCount: analyticsData.subscriberCount,
            viewCount: analyticsData.viewCount,
            videoCount: analyticsData.videoCount
          },
          metrics: {
            views: analyticsData.views,
            likes: analyticsData.likes,
            comments: analyticsData.comments,
            estimatedMinutesWatched: analyticsData.estimatedMinutesWatched,
            averageViewDuration: analyticsData.averageViewDuration,
            subscribersGained: analyticsData.subscribersGained,
            subscribersLost: analyticsData.subscribersLost,
            engagementRate: analyticsData.engagementRate
          },
          trafficSourceType: analyticsData.trafficSourceType,
          deviceType: analyticsData.deviceType,
          country: analyticsData.country,
          gender: analyticsData.gender,
          ageGroup: analyticsData.ageGroup,
          recentVideos: analyticsData.recentVideos || [],
          dataSource: analyticsData.dataSource || 'live',
          lastUpdated: analyticsData.lastUpdated,
          dataFreshness: analyticsData.createdAt
        };
        return res.json(response);
      } catch (refreshError) {
        console.warn('Auto-refresh for YouTube analytics failed:', refreshError.message);
        return res.status(404).json({
          message: 'No YouTube analytics data found. Please refresh data first.',
          needsRefresh: true
        });
      }
    }
    
    // Get the most recent document manually
    const sortedDocs = analyticsSnapshot.docs.sort((a, b) => {
      const aTime = a.data().createdAt?.toDate() || new Date(0);
      const bTime = b.data().createdAt?.toDate() || new Date(0);
      return bTime - aTime;
    });
    
    const latestDoc = sortedDocs[0];
    const analyticsData = latestDoc.data();

    // Backfill recentVideos if missing in existing analytics snapshot
    let recentVideos = analyticsData.recentVideos || [];
    if (!Array.isArray(recentVideos) || recentVideos.length === 0) {
      try {
        // Ensure we have a valid UC* channelId; resolve from handle/URL if needed
        let resolvedChannelId = data.youtubeChannelId || '';
        let resolvedChannelUrl = data.youtubeChannelUrl || '';
        if (!resolvedChannelId || !resolvedChannelId.startsWith('UC')) {
          try {
            const query = resolvedChannelUrl || resolvedChannelId || '';
            const resolved = await youtubeService.searchChannel(query);
            if (resolved?.channelId?.startsWith('UC')) {
              resolvedChannelId = resolved.channelId;
              resolvedChannelUrl = resolved.channelUrl || resolvedChannelUrl;
              try {
                await docRef.update({
                  youtubeChannelId: resolvedChannelId,
                  youtubeChannelUrl: resolvedChannelUrl,
                  youtubeChannelTitle: resolved.channelTitle || data.youtubeChannelTitle || ''
                });
              } catch (_) {}
              console.log('Resolved channelId for backfill:', resolvedChannelId);
            } else {
              console.warn('Backfill: could not resolve a valid UC channelId, using existing value:', resolvedChannelId);
            }
          } catch (resolveErr) {
            console.warn('Backfill: error resolving channelId from handle/URL:', resolveErr?.message || resolveErr);
          }
        }

        const fetchedVideos = await youtubeService.fetchChannelVideos(resolvedChannelId || data.youtubeChannelId, 30);
        recentVideos = (fetchedVideos || []).slice(0, 30);
        try {
          await latestDoc.ref.update({ recentVideos });
        } catch (_) {}
      } catch (fetchErr) {
        console.warn('Backfill: fetchChannelVideos failed:', fetchErr?.message || fetchErr);
        recentVideos = [];
      }
    }
    
    // Determine data source for UI badges
    const mockVideoIds = new Set(['dQw4w9WgXcQ','jNQXAC9IVRw','M7lc1UVf-VE','YQHsXMglC9A','kJQP7kiw5Fk','Zi_XLOBDo_Y','fJ9rUzIMcZQ','QH2-TGUlwu4','PT13M35S']);
    const looksMock = (Array.isArray(recentVideos) ? recentVideos : []).some(v => v && mockVideoIds.has(v.videoId));
    const inferredDataSource = (analyticsData.dataSource) ? analyticsData.dataSource : (looksMock ? 'mock' : 'live');

    // Format response with all requested metrics
    const response = {
      channelInfo: {
        channelId: data.youtubeChannelId,
        channelTitle: analyticsData.channelTitle,
        subscriberCount: analyticsData.subscriberCount,
        viewCount: analyticsData.viewCount,
        videoCount: analyticsData.videoCount
      },
      
      // Core metrics requested by user
      metrics: {
        views: analyticsData.views,
        likes: analyticsData.likes,
        comments: analyticsData.comments,
        estimatedMinutesWatched: analyticsData.estimatedMinutesWatched,
        averageViewDuration: analyticsData.averageViewDuration,
        subscribersGained: analyticsData.subscribersGained,
        subscribersLost: analyticsData.subscribersLost,
        engagementRate: analyticsData.engagementRate
      },
      
      // Traffic sources breakdown
      trafficSourceType: analyticsData.trafficSourceType,
      
      // Device type breakdown
      deviceType: analyticsData.deviceType,
      
      // Geographic breakdown
      country: analyticsData.country,
      
      // Demographic breakdown
      gender: analyticsData.gender,
      ageGroup: analyticsData.ageGroup,
      
      // Recent videos performance
      recentVideos,
      
      // Metadata
      dataSource: inferredDataSource,
      lastUpdated: analyticsData.lastUpdated,
      dataFreshness: analyticsData.createdAt
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Get detailed YouTube analytics error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch YouTube analytics', 
      error: error.message 
    });
  }
});

// Search and connect YouTube channel
router.post('/:id/youtube/connect', authMiddleware, async (req, res) => {
  try {
    const influencerId = req.params.id;
    const { channelQuery } = req.body;

    if (!channelQuery) {
      return res.status(400).json({ message: 'Channel query is required' });
    }

    // Normalize query: if it's a bare token (likely a handle), prefix '@' to trigger handle resolution
    let rawQuery = (channelQuery || '').trim();
    // Fix malformed protocol variants like 'https:/www.youtube.com/@handle'
    rawQuery = rawQuery.replace(/^https:\/\//, 'https://').replace(/^https:\//, 'https://').replace(/^http:\/\//, 'http://').replace(/^http:\//, 'http://');
    const isUrl = /youtube\.com\//i.test(rawQuery);
    const isChannelId = /^UC[A-Za-z0-9_-]+$/.test(rawQuery);
    const hasAt = rawQuery.startsWith('@');
    const looksLikeHandleToken = /^[A-Za-z0-9._-]+$/.test(rawQuery);
    const normalizedQuery = isUrl || isChannelId || hasAt ? rawQuery : (looksLikeHandleToken ? `@${rawQuery}` : rawQuery);

    // Search for the channel (supports URL, @handle, or name)
    const channelData = await youtubeService.searchChannel(normalizedQuery);

    // Fetch comprehensive channel data (handles API-key fallback internally)
    const comprehensiveData = await youtubeService.getComprehensiveChannelData(channelData.channelId);

    // Prefer resolved title/url from search results to avoid mock placeholders
    const combinedData = {
      ...comprehensiveData,
      channelTitle: channelData.channelTitle || comprehensiveData.channelTitle,
      // Prefer clean channelUrl from search; fallback to comprehensive; last-resort sanitized input
      channelUrl: (channelData.channelUrl || comprehensiveData.channelUrl || normalizedQuery).replace(/^https:\/\//, 'https://').replace(/^https:\//, 'https://').replace(/^http:\/\//, 'http://').replace(/^http:\//, 'http://')
    };

    // Update influencer document with enhanced data
    const docRef = db.collection('influencers').doc(influencerId);
    await docRef.set({
      youtubeChannelId: combinedData.channelId,
      youtubeChannelTitle: combinedData.channelTitle,
      youtubeChannelUrl: combinedData.channelUrl,
      youtubeSubscribers: combinedData.subscriberCount,
      youtubeViews: combinedData.viewCount,
      youtubeVideos: combinedData.videoCount,
      youtubeDescription: combinedData.description,
      youtubePublishedAt: combinedData.publishedAt,
      youtubeThumbnails: combinedData.thumbnails,
      youtubeLastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Save analytics snapshot
    await db.collection('youtubeAnalytics').add({
      userId: influencerId,
      channelId: combinedData.channelId,
      channelTitle: combinedData.channelTitle,
      subscriberCount: combinedData.subscriberCount,
      viewCount: combinedData.viewCount,
      videoCount: combinedData.videoCount,
      recentVideos: (combinedData.videos || []).slice(0, 30),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: combinedData.lastUpdated
    });

    res.json({ success: true, message: 'YouTube channel connected successfully', channelData: combinedData });
  } catch (error) {
    console.error('Connect YouTube channel error:', error);
    res.status(500).json({ message: 'Failed to connect YouTube channel', error: error.message });
  }
});

module.exports = router;
