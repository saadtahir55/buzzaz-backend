const { db } = require('../config/firebase');
const { scrapeInstagramProfile } = require('./apifyService');

const syncInfluencerStats = async (options = {}) => {
  const { limit = 10, dryRun = false } = options;
  console.log(`Starting influencer stats sync (limit=${limit}, dryRun=${dryRun})...`);
  
  try {
    // Firestore instance from Firebase config
    const influencersSnapshot = await db.collection('influencers').get();
    
    if (influencersSnapshot.empty) {
      console.log('No influencers found to sync');
      return;
    }
    
    const syncPromises = [];
    
    let processed = 0;
    influencersSnapshot.forEach(doc => {
      if (processed >= limit) return;
      const influencerData = doc.data();
      const influencerId = doc.id;
      
      if (influencerData.instagramUsername) {
        if (!dryRun) {
          syncPromises.push(syncSingleInfluencer(influencerId, influencerData.instagramUsername));
        }
        processed += 1;
      }
    });

    const results = dryRun ? [] : await Promise.allSettled(syncPromises);
    
    let successCount = 0;
    let errorCount = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        errorCount++;
        console.error(`Failed to sync influencer ${index}:`, result.reason);
      }
    });

    console.log(`Influencer stats sync completed: ${successCount} successful, ${errorCount} failed (processed=${dryRun ? 0 : results.length})`);
    
  } catch (error) {
    console.error('Error in influencer stats sync:', error);
  }
};

const syncSingleInfluencer = async (influencerId, username) => {
  try {
    // Firestore instance from Firebase config
    const profileData = await scrapeInstagramProfile(username);
    
    const timestamp = new Date().toISOString();
    const statsData = {
      followers: profileData.followers,
      following: profileData.following,
      postsCount: profileData.postsCount,
      engagementRate: profileData.engagementRate,
      timestamp: timestamp,
      rawApifyResponse: profileData
    };

    // Save stats snapshot
    await db.collection('influencers')
      .doc(influencerId)
      .collection('stats')
      .doc(timestamp.replace(/[:.]/g, '-'))
      .set(statsData);

    // Update main influencer document
    await db.collection('influencers').doc(influencerId).update({
      followers: profileData.followers,
      following: profileData.following,
      postsCount: profileData.postsCount,
      engagementRate: profileData.engagementRate,
      lastSyncedAt: timestamp,
      avatarUrl: profileData.avatarUrl
    });

    console.log(`Successfully synced stats for influencer ${influencerId} (${username})`);
    return { success: true, influencerId, username };
    
  } catch (error) {
    console.error(`Error syncing influencer ${influencerId} (${username}):`, error);
    throw error;
  }
};

module.exports = syncInfluencerStats;
