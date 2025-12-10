const { ApifyClient } = require('apify-client');
require('dotenv').config();

const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
  timeoutSecs: 30, // Set timeout to 30 seconds
});

// Function to get real profile data from database for known profiles
const getRealProfileData = (username) => {
  // Known profile data for testing - in production this would come from database
  const knownProfiles = {
    'motogp': {
      username: 'motogp',
      fullName: 'MotoGP™',
      bio: 'The Official MotoGP™ Account',
      avatarUrl: 'https://instagram.com/motogp/profile.jpg',
      followers: 17787820,
      following: 211,
      postsCount: 25788,
      isVerified: true,
      isPrivate: false,
      posts: [],
      engagementRate: 3.2
    }
  };
  
  return knownProfiles[username.toLowerCase()] || null;
};

const scrapeTikTokProfile = async (username) => {
  try {
    // Use the TikTok User Information Scraper that provides follower count
    const input = {
      usernames: [username]
    };

    console.log(`Starting TikTok profile scrape for: ${username}`);
    
    // Add a timeout wrapper for the entire operation
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Apify TikTok request timeout after 25 seconds')), 25000);
    });
    
    const scrapePromise = (async () => {
      // Use the TikTok User Information Scraper actor that provides follower count
      const run = await client.actor("xtdata/tiktok-user-information-scraper").call(input);
      
      console.log(`TikTok Run ID: ${run.id}, Status: ${run.status}`);
      
      // Fetch and print Actor results from the run's dataset
      console.log('TikTok Results from dataset');
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      
      console.log(`Raw TikTok Apify response for ${username}:`, JSON.stringify(items, null, 2));
      console.log(`TikTok Items length:`, items.length);

      if (!items || items.length === 0) {
        throw new Error('No data returned from TikTok profile scraper');
      }

      // Extract profile data from the first item
      const profileInfo = items[0];
      console.log(`TikTok Profile data structure:`, Object.keys(profileInfo));
      
      const profileData = {
        // Basic profile info
        username: profileInfo.unique_id || profileInfo.nickname || username,
        fullName: profileInfo.nickname || profileInfo.unique_id || username,
        bio: profileInfo.signature || profileInfo.biography || '',
        avatarUrl: profileInfo.avatar_larger?.url_list?.[0] || profileInfo.avatar_300x300?.url_list?.[0] || profileInfo.profile_pic_url || '',
        
        // Follower metrics
        followers: profileInfo.follower_count || profileInfo.fans || 0,
        following: profileInfo.following_count || profileInfo.following || 0,
        videosCount: profileInfo.aweme_count || profileInfo.video || profileInfo.videos_count || 0,
        
        // Engagement metrics
        totalLikes: profileInfo.total_favorited || profileInfo.heart || profileInfo.likes || 0,
        totalViews: profileInfo.total_views || 0,
        totalShares: profileInfo.total_shares || 0,
        totalComments: profileInfo.total_comments || 0,
        engagementRate: profileInfo.awg_engagement_rate || 0,
        
        // Account status and verification
        isVerified: profileInfo.is_verified || profileInfo.verified || false,
        isPrivate: profileInfo.is_private || profileInfo.privateAccount || false,
        
        // Additional profile data from APIFY
        uid: profileInfo.uid || profileInfo.id || '',
        region: profileInfo.region || '',
        language: profileInfo.language || '',
        
        // Avatar variations
        avatarMedium: profileInfo.avatar_medium?.url_list?.[0] || '',
        avatarThumb: profileInfo.avatar_thumb?.url_list?.[0] || '',
        
        // Profile URLs and links
        profileDeepLink: profileInfo.profile_deep_link || '',
        
        // Account creation and activity
        createTime: profileInfo.create_time || null,
        modifyTime: profileInfo.modify_time || null,
        
        // Business/Creator info
        commerceUserLevel: profileInfo.commerce_user_level || 0,
        enterpriseVerifyReason: profileInfo.enterprise_verify_reason || '',
        
        // Raw APIFY response for future reference
        rawApifyData: profileInfo,
        
        // Metadata
        scrapedAt: new Date().toISOString(),
        recentVideos: [] // User info scraper doesn't provide videos
      };

      console.log(`Successfully scraped TikTok profile for ${username}`);
      console.log(`Followers: ${profileData.followers}, Following: ${profileData.following}, Videos: ${profileData.videosCount}`);
      console.log(`Full TikTok profile data:`, JSON.stringify(profileData, null, 2));
      return profileData;
    })();
    
    // Race between the scrape operation and timeout
    return await Promise.race([scrapePromise, timeoutPromise]);

  } catch (error) {
    console.error(`Error scraping TikTok profile ${username}:`, error);
    throw new Error(`Failed to scrape TikTok profile: ${error.message}`);
  }
};

const validateTikTokUsername = async (username) => {
  try {
    console.log(`=== VALIDATING TIKTOK USERNAME: ${username} ===`);
    
    // Clean the username (remove @ if present)
    const cleanUsername = username.replace('@', '');
    
    console.log(`Cleaned username: ${cleanUsername}`);
    
    // Try to scrape the profile
    const profileData = await scrapeTikTokProfile(cleanUsername);
    
    console.log(`TikTok validation successful for ${cleanUsername}`);
    console.log(`Profile data:`, JSON.stringify(profileData, null, 2));
    
    return {
      isValid: true,
      profileData: profileData,
      message: 'TikTok username is valid and accessible'
    };
    
  } catch (error) {
    console.error(`TikTok validation failed for ${username}:`, error);
    
    // Determine the type of error
    let errorMessage = 'TikTok username validation failed';
    if (error.message.includes('timeout')) {
      errorMessage = 'TikTok validation timed out. Please try again.';
    } else if (error.message.includes('No data returned')) {
      errorMessage = 'TikTok profile not found or is private';
    } else {
      errorMessage = `TikTok validation error: ${error.message}`;
    }
    
    return {
      isValid: false,
      profileData: null,
      message: errorMessage
    };
  }
};

// Re-enabled Instagram Profile Scraper for dual scraper functionality
const scrapeInstagramProfile = async (username) => {
  try {
    const input = {
      usernames: [username]
    };

    console.log(`Starting Instagram profile scrape for: ${username}`);
    
    // Add a timeout wrapper for the entire operation
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Apify request timeout after 25 seconds')), 25000);
    });
    
    const scrapePromise = (async () => {
      // Use the specific actor ID from the user's example
      const run = await client.actor("dSCLg0C3YEZ83HzYX").call(input);
      
      console.log(`Run ID: ${run.id}, Status: ${run.status}`);
      
      // Fetch and print Actor results from the run's dataset
      console.log('Results from dataset');
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      
      console.log(`Raw Apify response for ${username}:`, JSON.stringify(items, null, 2));
      console.log(`Items length:`, items.length);

      if (!items || items.length === 0) {
        throw new Error('No data returned from Instagram profile scraper');
      }

      // Extract profile data from the first item
      const profile = items[0];
      console.log(`Profile data structure:`, Object.keys(profile));
      console.log(`Full profile object:`, JSON.stringify(profile, null, 2));
      
      const profileData = {
        // Basic profile info
        username: profile.username || username,
        fullName: profile.fullName || '',
        bio: profile.biography || '',
        avatarUrl: profile.profilePicUrl || '',
        
        // Follower metrics
        followers: profile.followersCount || 0,
        following: profile.followsCount || 0,
        postsCount: profile.postsCount || 0,
        
        // Account status
        isVerified: profile.verified || false,
        isPrivate: profile.private || false,
        
        // Additional profile data from APIFY
        userId: profile.id || '',
        externalUrl: profile.externalUrl || '',
        businessCategoryName: profile.businessCategoryName || '',
        categoryName: profile.categoryName || '',
        isBusinessAccount: profile.isBusinessAccount || false,
        isProfessionalAccount: profile.isProfessionalAccount || false,
        
        // Contact info
        businessEmail: profile.businessEmail || '',
        businessPhoneNumber: profile.businessPhoneNumber || '',
        businessAddressJson: profile.businessAddressJson || null,
        
        // Profile URLs and media
        profilePicUrlHd: profile.profilePicUrlHd || '',
        
        // Engagement and activity data
        engagementRate: 0, // Will be calculated if posts are available
        
        // Raw APIFY response for future reference
        rawApifyData: profile,
        
        // Metadata
        scrapedAt: new Date().toISOString(),
        posts: [] // Profile scraper doesn't return posts, only profile info
      };

      console.log(`Successfully scraped profile for ${username}: ${profileData.followers} followers`);
      console.log(`Full profile data:`, JSON.stringify(profileData, null, 2));
      return profileData;
    })();
    
    // Race between the scrape operation and timeout
    return await Promise.race([scrapePromise, timeoutPromise]);

  } catch (error) {
    console.error(`Error scraping Instagram profile ${username}:`, error);
    throw new Error(`Failed to scrape Instagram profile: ${error.message}`);
  }
};

const validateInstagramUsername = async (username) => {
  try {
    console.log(`=== VALIDATING INSTAGRAM USERNAME: ${username} ===`);
    
    // Clean the username
    const cleanUsername = username.replace('@', '');
    console.log(`Cleaned username: ${cleanUsername}`);
    
    // Basic validation
    if (!cleanUsername || cleanUsername.length === 0) {
      console.log('Username is empty after cleaning');
      throw new Error('Username cannot be empty');
    }

    if (!/^[a-zA-Z0-9._]{1,30}$/.test(cleanUsername)) {
      console.log('Username failed regex validation');
      throw new Error('Invalid Instagram username format');
    }

    console.log('Username passed basic validation, attempting to scrape profile...');
    
    // COMMENTED OUT - Using only Instagram Reel Scraper as requested
    // try {
    //   const profileData = await scrapeInstagramProfile(cleanUsername);
    //   console.log('Profile data received successfully');
      
    //   return {
    //     isValid: true,
    //     profileData
    //   };
    // } catch (scrapeError) {
    //   console.log('Scraping failed, but username format is valid. Error:', scrapeError.message);
      
    //   // If scraping fails due to Apify limits or timeouts, 
    //   // still return valid if username format is correct
    //   if (scrapeError.message.includes('memory limit') || 
    //       scrapeError.message.includes('timeout') ||
    //       scrapeError.message.includes('Apify request timeout') ||
    //       scrapeError.message.includes('Authentication token was not provided')) {
        
    //     console.log('Returning valid due to external service issues, using real data from database if available');
        
    //     // Try to get real data from database for known profiles
    //     const realProfileData = getRealProfileData(cleanUsername);
        
    //     if (realProfileData) {
    //       console.log('Using real profile data from database');
    //       return {
    //         isValid: true,
    //         profileData: realProfileData
    //       };
    //     }
        
    //     // Return a basic valid response with mock data as fallback
    //     return {
    //       isValid: true,
    //       profileData: {
    //         username: cleanUsername,
    //         fullName: 'Instagram User',
    //         bio: 'Profile validation successful',
    //         avatarUrl: '',
    //         followers: 0,
    //         following: 0,
    //         postsCount: 0,
    //         isVerified: false,
    //         isPrivate: false,
    //         posts: [],
    //         engagementRate: 0,
    //         note: 'Profile data unavailable due to service limitations'
    //       }
    //     };
    //   }
      
    //   // For other errors, still fail validation
    //   throw scrapeError;
    // }
    
    // Since profile scraper is disabled, return basic validation with mock data
    console.log('Profile scraper disabled, returning basic validation with mock data');
    return {
      isValid: true,
      profileData: {
        username: cleanUsername,
        fullName: 'Instagram User',
        bio: 'Profile validation successful - using reel data only',
        avatarUrl: '',
        followers: 0,
        following: 0,
        postsCount: 0,
        isVerified: false,
        isPrivate: false,
        posts: [],
        engagementRate: 0,
        note: 'Profile scraper disabled - using Instagram Reel Scraper only'
      }
    };
  } catch (error) {
    console.log('Validation failed with error:', error.message);
    return {
      isValid: false,
      error: error.message
    };
  }
};

// COMMENTED OUT - Using only Instagram Reel Scraper as requested
// const scrapeInstagramRecentPosts = async (username, limit = 10) => {
//   try {
//     const cleanUsername = username.replace('@', '');
//     const input = {
//       directUrls: [`https://www.instagram.com/${cleanUsername}/`],
//       resultsType: 'posts',
//       maxItems: limit,
//     };

//     console.log(`Starting Instagram posts scrape for: ${cleanUsername}`);
//     let run;
//     try {
//       // apify/instagram-scraper returns after completion when using .call
//       run = await client.actor('apify/instagram-scraper').call(input);
//     } catch (primaryErr) {
//       console.warn('Primary posts actor failed, trying fallback actor:', primaryErr?.message);
//       run = await client.actor('dSCLg0C3YEZ83HzYX').call(input);
//     }

//     }

//     console.log(`Posts run ID: ${run.id}, Status: ${run.status}`);

//     const { items } = await client.dataset(run.defaultDatasetId).listItems();
//     if (!items || items.length === 0) {
//       const runDetails = await client.run(run.id).get();
//       console.log('Posts run details:', JSON.stringify(runDetails, null, 2));
//       throw new Error('No posts data returned from Instagram scraper');
//     }

//     const posts = items.slice(0, limit).map((p) => {
//       const shortCode = p.shortCode || p.code || p.postCode;
//       const id = p.id || p.postId || shortCode || (p.url && p.url.split('/').filter(Boolean).pop());
//       const url = p.url || p.postUrl || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : undefined);
//       const likes = p.likes ?? p.likesCount ?? p.likeCount ?? p.likes_count ?? 0;
//       const comments = p.comments ?? p.commentsCount ?? p.commentCount ?? p.comments_count ?? 0;
//       const takenAt = p.takenAt ?? p.timestamp ?? p.createdAt ?? p.taken_at ?? null;
//       return { id, url, likes, comments, takenAt };
//     });

//     console.log(`Fetched ${posts.length} posts for ${cleanUsername}`);
//     return posts;
//   } catch (error) {
//     console.error(`Error scraping Instagram posts for ${username}:`, error);
//     throw new Error(`Failed to scrape Instagram posts: ${error.message}`);
//   }
// };

// New function to run both Instagram scrapers asynchronously and combine their data
const scrapeInstagramComplete = async (username) => {
  try {
    console.log(`=== STARTING COMPLETE INSTAGRAM SCRAPE FOR: ${username} ===`);
    
    const cleanUsername = username.replace('@', '');
    
    // Run both scrapers asynchronously
    const [profileData, reelsData] = await Promise.allSettled([
      scrapeInstagramProfile(cleanUsername),
      // Use the Instagram service for reels data
      require('./instagramService').fetchInstagramUserData(cleanUsername, 50) // Fetch up to 50 reels
    ]);
    
    console.log('Profile scraper result:', profileData.status);
    console.log('Reels scraper result:', reelsData.status);
    
    // Initialize combined data structure
    const combinedData = {
      username: cleanUsername,
      scrapedAt: new Date().toISOString(),
      success: false,
      profile: null,
      reels: [],
      errors: []
    };
    
    // Handle profile data
    if (profileData.status === 'fulfilled' && profileData.value) {
      combinedData.profile = {
        username: profileData.value.username,
        fullName: profileData.value.fullName,
        bio: profileData.value.bio,
        avatarUrl: profileData.value.avatarUrl,
        profilePicUrlHd: profileData.value.profilePicUrlHd,
        followers: profileData.value.followers,
        following: profileData.value.following,
        postsCount: profileData.value.postsCount,
        isVerified: profileData.value.isVerified,
        isPrivate: profileData.value.isPrivate,
        userId: profileData.value.userId,
        externalUrl: profileData.value.externalUrl,
        businessCategoryName: profileData.value.businessCategoryName,
        categoryName: profileData.value.categoryName,
        isBusinessAccount: profileData.value.isBusinessAccount,
        isProfessionalAccount: profileData.value.isProfessionalAccount,
        businessEmail: profileData.value.businessEmail,
        businessPhoneNumber: profileData.value.businessPhoneNumber,
        businessAddressJson: profileData.value.businessAddressJson,
        engagementRate: profileData.value.engagementRate || 0
      };
      console.log(`✓ Profile data scraped successfully: ${combinedData.profile.followers} followers`);
    } else {
      combinedData.errors.push(`Profile scraper failed: ${profileData.reason?.message || 'Unknown error'}`);
      console.warn('✗ Profile scraper failed:', profileData.reason?.message);
    }
    
    // Handle reels data
    if (reelsData.status === 'fulfilled' && reelsData.value && reelsData.value.success) {
      combinedData.reels = reelsData.value.reels || [];
      combinedData.totalReels = reelsData.value.totalReels || combinedData.reels.length;
      console.log(`✓ Reels data scraped successfully: ${combinedData.reels.length} reels found`);
    } else {
      combinedData.errors.push(`Reels scraper failed: ${reelsData.reason?.message || 'Unknown error'}`);
      console.warn('✗ Reels scraper failed:', reelsData.reason?.message);
    }
    
    // Determine overall success
    combinedData.success = combinedData.profile !== null || combinedData.reels.length > 0;
    
    if (combinedData.success) {
      console.log(`=== COMPLETE INSTAGRAM SCRAPE SUCCESS FOR: ${username} ===`);
      console.log(`Profile: ${combinedData.profile ? '✓' : '✗'}`);
      console.log(`Reels: ${combinedData.reels.length} found`);
    } else {
      console.log(`=== COMPLETE INSTAGRAM SCRAPE FAILED FOR: ${username} ===`);
      console.log('Errors:', combinedData.errors);
    }
    
    return combinedData;
    
  } catch (error) {
    console.error(`Error in complete Instagram scrape for ${username}:`, error);
    return {
      username: username.replace('@', ''),
      scrapedAt: new Date().toISOString(),
      success: false,
      profile: null,
      reels: [],
      errors: [`Complete scrape failed: ${error.message}`]
    };
  }
};

module.exports = {
  scrapeInstagramProfile, // Re-enabled for dual scraper functionality
  scrapeInstagramComplete,
  validateInstagramUsername,
  // scrapeInstagramRecentPosts, // Still commented out - using only Instagram Reel Scraper for posts
  scrapeTikTokProfile,
  validateTikTokUsername
};
