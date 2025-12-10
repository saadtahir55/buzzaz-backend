const { ApifyClient } = require('apify-client');
const axios = require('axios');
require('dotenv').config();

// Read Apify token from environment (preferred: APIFY_TOKEN)
const APIFY_API_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;

// Initialize the ApifyClient with API token from env
const client = new ApifyClient({
  token: APIFY_API_TOKEN,
  timeoutSecs: 30, // Reduced timeout to prevent frontend timeout issues
});
const PROFILE_ACTOR_ID = 'apify/instagram-scraper'; // Instagram Profile Scraper
const REEL_ACTOR_ID = 'apify/instagram-reel-scraper'; // Instagram Reel Scraper
// COMMENTED OUT - Using only Instagram Reel Scraper as requested
// async function fetchProfileData(username, resultsLimit) {
//   try {
//     const response = await axios.post(
//       `https://api.apify.com/v2/acts/${PROFILE_ACTOR_ID}/run-sync-get-dataset-items`,
//       {
//         directUrls: [`https://www.instagram.com/${username}/`],
//         resultsType: 'posts',
//         resultsLimit: resultsLimit
//       },
//       {
//         headers: {
//           'Authorization': `Bearer ${APIFY_API_TOKEN}`,
//           'Content-Type': 'application/json'
//         },
//         timeout: 25000 // 25 second timeout
//       }
//     );

//     if (!response.data || response.data.length === 0) {
//       console.warn('No profile data returned from Instagram Profile API');
//       return null;
//     }

//     return response.data;
//   } catch (error) {
//     console.error('Error fetching Instagram profile data:', error.message);
//     return null; // Return null instead of throwing to allow reel data to still be processed
//   }
// }

async function fetchReelData(username, resultsLimit = 10) {
  try {
    // Create a timeout promise that rejects after 25 seconds
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Apify request timeout after 25 seconds')), 25000);
    });

    // Create the main fetch promise
    const fetchPromise = (async () => {
      // Prepare Actor input following the example structure
      const input = {
        usernames: [username],
        resultsLimit: resultsLimit,
        includeSharesCount: false
      };

      console.log(`Fetching reel data for username: ${username} with limit: ${resultsLimit}`);
      console.log('Input:', JSON.stringify(input, null, 2));
      
      // Run the Actor using the configured reel actor ID
      const run = await client.actor(REEL_ACTOR_ID).call(input);
      console.log('Actor run completed, run ID:', run.id);
      
      // Fetch Actor results from the run's dataset
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      console.log(`Dataset items fetched: ${items ? items.length : 0}`);
      
      if (!items || items.length === 0) {
        console.warn('No reel data returned from Instagram Reel API');
        return null;
      }

      console.log(`Successfully fetched ${items.length} reels for ${username}`);
      return items;
    })();

    // Race between the fetch operation and timeout
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    console.error('Error fetching Instagram reel data:', error.message);
    console.error('Error details:', error);
    return null; // Return null instead of throwing to allow other processes to continue
  }
}

/**
 * Fetch Instagram reel data using Apify Instagram Reel Scraper
 * @param {string} username - Instagram username (without @)
 * @param {number} resultsLimit - Number of reels to fetch (default: 10)
 * @returns {Object} - Instagram reel data
 */
const fetchInstagramUserData = async (username, resultsLimit = 10) => {
  try {
    console.log(`Fetching Instagram reel data for ${username} with limit ${resultsLimit}`);
    
    // Clean username
    const cleanUsername = username.replace('@', '');
    
    // Fetch only reel data as requested
    const reelResponse = await fetchReelData(cleanUsername, resultsLimit);
    
    console.log(`Instagram Reel API response: ${reelResponse ? 'success' : 'failed'}`);
    
    if (!reelResponse) {
      throw new Error('Failed to fetch Instagram reel data');
    }

    // Return processed reel data
    return {
      success: true,
      username: cleanUsername,
      reels: reelResponse,
      totalReels: reelResponse.length,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching Instagram reel data:', error.message);
    throw error;
  }
};

function processInstagramData(profileData, reelData, username) {
  const profilePosts = [];
  const reels = [];
  
  // Process profile posts
  if (profileData && Array.isArray(profileData)) {
    profilePosts.push(...profileData);
  }
  
  // Process reels separately
  if (reelData && Array.isArray(reelData)) {
    // Mark reels with type and limit to 10 most recent
    const processedReels = reelData.slice(0, 10).map(reel => ({ 
      ...reel, 
      type: 'reel',
      isReel: true 
    }));
    reels.push(...processedReels);
  }
  
  // Combine all items for general metrics
  const allItems = [...profilePosts, ...reels];
  
  if (allItems.length === 0) {
    throw new Error(`No data returned for Instagram user: ${username}`);
  }

  console.log(`Fetched ${profilePosts.length} posts and ${reels.length} reels for ${username}`);
  
  // Process the data - the first item usually contains profile info
  const profileInfo = profilePosts[0] || reels[0] || {};
  console.log('Sample item structure:', Object.keys(profileInfo));

  // Extract profile information
  const processedData = {
    // Profile information
    username: username,
    fullName: profileInfo.ownerFullName || 'Unknown User',
    bio: profileInfo.bio || profileInfo.description || '',
    avatarUrl: profileInfo.ownerProfilePicUrl || profileInfo.profilePicUrl || '',
    
    // Follower metrics (these might not be available in post data)
    followers: profileInfo.followersCount || 0,
    following: profileInfo.followingCount || 0,
    postsCount: profilePosts.length,
    reelsCount: reels.length,
    
    // Account status
    isVerified: profileInfo.ownerVerified || false,
    isPrivate: profileInfo.isPrivate || false,
      
    // Posts data (profile posts only)
    posts: profilePosts.map(item => ({
      id: item.id || item.shortcode || Math.random().toString(36).substr(2, 9),
      url: item.url || `https://www.instagram.com/p/${item.shortcode}/`,
      displayUrl: item.displayUrl,
      caption: item.caption || '',
      likesCount: item.likesCount || 0,
      commentsCount: item.commentsCount || 0,
      timestamp: item.timestamp,
      firstComment: item.firstComment || '',
      type: item.type || 'post',
      isVideo: item.isVideo || false,
      videoUrl: item.videoUrl || null,
      dimensions: {
        width: item.width || item.dimensionsWidth || 0,
        height: item.height || item.dimensionsHeight || 0
      },
      hashtags: item.hashtags || [],
      mentions: item.mentions || [],
      location: item.location || null
    })),
    
    // Reels data (separate from posts)
    reels: reels.map(item => ({
      reelId: item.id || item.shortcode || Math.random().toString(36).substr(2, 9),
      reelUrl: item.url || `https://www.instagram.com/p/${item.shortcode}/`,
      caption: item.caption || '',
      hashtags: item.hashtags || [],
      mentions: item.mentions || [],
      taggedUsers: item.taggedUsers || [],
      thumbnailUrl: item.displayUrl || (item.images && item.images[0]) || '',
      videoUrl: item.videoUrl || null,
      videoDuration: item.videoDuration || 0,
      timestamp: item.timestamp,
      likesCount: item.likesCount || 0,
      commentsCount: item.commentsCount || 0,
      viewsCount: item.viewsCount || item.playCount || 0,
      latestComments: item.latestComments || [],
      audioName: item.audioName || item.musicInfo?.name || '',
      location: item.location || null,
      // Profile information for each reel
      profileUsername: item.ownerUsername || username,
      profileFullName: item.ownerFullName || '',
      profilePicUrl: item.ownerProfilePicUrl || '',
      profileIsVerified: item.ownerVerified || false,
      profileFollowers: item.ownerFollowersCount || 0,
      profileFollowing: item.ownerFollowingCount || 0,
      profileBio: item.ownerBio || '',
      // Additional metadata
      type: 'reel',
      isVideo: true,
      isReel: true,
      dimensions: {
        width: item.dimensionsWidth || 0,
        height: item.dimensionsHeight || 0
      },
      // Enhanced engagement data
      engagementRate: item.likesCount && item.viewsCount ? 
        ((item.likesCount + item.commentsCount) / item.viewsCount * 100).toFixed(2) : 0,
      // Raw data for debugging
      rawData: item
    })),
    
    // Engagement metrics (calculated from all content)
    totalLikes: allItems.reduce((sum, item) => sum + (item.likesCount || 0), 0),
    totalComments: allItems.reduce((sum, item) => sum + (item.commentsCount || 0), 0),
    averageLikes: allItems.length > 0 ? Math.round(allItems.reduce((sum, item) => sum + (item.likesCount || 0), 0) / allItems.length) : 0,
    averageComments: allItems.length > 0 ? Math.round(allItems.reduce((sum, item) => sum + (item.commentsCount || 0), 0) / allItems.length) : 0,
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    dataSource: 'apify',
    actorIds: [PROFILE_ACTOR_ID, REEL_ACTOR_ID]
  };

  // Calculate engagement rate if we have follower data
  if (processedData.followers > 0) {
    const totalEngagement = processedData.totalLikes + processedData.totalComments;
    const avgEngagementPerPost = totalEngagement / Math.max(allItems.length, 1);
    processedData.engagementRate = ((avgEngagementPerPost / processedData.followers) * 100).toFixed(2);
  } else {
    processedData.engagementRate = 0;
  }

  console.log(`Successfully processed Instagram data for ${username}:`);
  console.log(`- Posts: ${processedData.posts.length}`);
  console.log(`- Reels: ${processedData.reels.length}`);
  console.log(`- Total Likes: ${processedData.totalLikes}`);
  console.log(`- Total Comments: ${processedData.totalComments}`);
  console.log(`- Average Likes: ${processedData.averageLikes}`);
  console.log(`- Engagement Rate: ${processedData.engagementRate}%`);

  return processedData;
}

/**
 * Separate posts into different types (posts, reels, videos)
 * @param {Array} posts - Array of Instagram posts
 * @returns {Object} - Categorized posts
 */
const categorizeInstagramPosts = (posts) => {
  const categorized = {
    posts: [],
    reels: [],
    videos: [],
    all: posts
  };

  posts.forEach(post => {
    if (post.type === 'reel' || (post.url && post.url.includes('/reel/'))) {
      categorized.reels.push(post);
    } else if (post.isVideo || post.videoUrl) {
      categorized.videos.push(post);
    } else {
      categorized.posts.push(post);
    }
  });

  return categorized;
};

/**
 * Get Instagram analytics summary
 * @param {Object} instagramData - Processed Instagram data
 * @returns {Object} - Analytics summary
 */
const getInstagramAnalytics = (instagramData) => {
  const { posts } = instagramData;
  
  if (!posts || posts.length === 0) {
    return {
      totalPosts: 0,
      totalLikes: 0,
      totalComments: 0,
      averageLikes: 0,
      averageComments: 0,
      engagementRate: 0,
      topPost: null,
      recentActivity: []
    };
  }

  // Find top performing post
  const topPost = posts.reduce((max, post) => 
    (post.likesCount + post.commentsCount) > (max.likesCount + max.commentsCount) ? post : max
  );

  // Get recent activity (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const recentActivity = posts.filter(post => 
    post.timestamp && new Date(post.timestamp) > sevenDaysAgo
  );

  return {
    totalPosts: posts.length,
    totalLikes: instagramData.totalLikes || 0,
    totalComments: instagramData.totalComments || 0,
    averageLikes: instagramData.averageLikes || 0,
    averageComments: instagramData.averageComments || 0,
    engagementRate: parseFloat(instagramData.engagementRate || 0),
    topPost: {
      url: topPost.url || '',
      caption: (topPost.caption || '').substring(0, 100) + '...',
      likes: topPost.likesCount || 0,
      comments: topPost.commentsCount || 0,
      timestamp: topPost.timestamp || null
    },
    recentActivity: recentActivity.length,
    categorized: categorizeInstagramPosts(posts)
  };
};

/**
 * Validate Instagram username format
 * @param {string} username - Instagram username
 * @returns {boolean} - Whether username is valid
 */
const validateInstagramUsername = (username) => {
  const cleanUsername = username.replace('@', '');
  
  // Instagram username validation rules
  const usernameRegex = /^[a-zA-Z0-9._]{1,30}$/;
  
  return usernameRegex.test(cleanUsername) && 
         cleanUsername.length >= 1 && 
         cleanUsername.length <= 30 &&
         !cleanUsername.startsWith('.') &&
         !cleanUsername.endsWith('.') &&
         !cleanUsername.includes('..');
};

module.exports = {
  fetchInstagramUserData,
  categorizeInstagramPosts,
  getInstagramAnalytics,
  validateInstagramUsername
};