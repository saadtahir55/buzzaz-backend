const { db } = require('../config/firebase');

async function addSampleData() {
  const userId = 'wWqud9tZPdjQTcacqjoo'; // Current user ID from logs
  
  try {
    console.log('Adding sample data for user:', userId);
    
    // Update the influencer profile with sample Instagram data
    const profileData = {
      followers: 15420,
      following: 892,
      postsCount: 156,
      engagementRate: 4.2,
      instagramUsername: 'sample_influencer',
      lastUpdated: new Date().toISOString()
    };
    
    await db.collection('influencers').doc(userId).update(profileData);
    console.log('✓ Updated profile with sample data');
    
    // Add sample stats history (last 7 days)
    const statsHistory = [];
    const now = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const timestamp = date.toISOString();
      
      const stats = {
        followers: 15420 - (i * 50) + Math.floor(Math.random() * 100),
        following: 892 + Math.floor(Math.random() * 10),
        postsCount: 156 - Math.floor(i / 2),
        engagementRate: 4.2 + (Math.random() * 0.8 - 0.4), // 3.8 - 4.6
        timestamp
      };
      
      await db.collection('influencers')
        .doc(userId)
        .collection('stats')
        .doc(timestamp.replace(/[:.]/g, '-'))
        .set(stats);
      
      statsHistory.push(stats);
    }
    console.log('✓ Added stats history for 7 days');
    
    // Add sample Instagram posts
    const samplePosts = [
      {
        id: 'post_1',
        url: 'https://instagram.com/p/sample1',
        likes: 1250,
        comments: 89,
        takenAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        scrapedAt: new Date().toISOString()
      },
      {
        id: 'post_2', 
        url: 'https://instagram.com/p/sample2',
        likes: 980,
        comments: 67,
        takenAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
        scrapedAt: new Date().toISOString()
      },
      {
        id: 'post_3',
        url: 'https://instagram.com/p/sample3', 
        likes: 1450,
        comments: 112,
        takenAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
        scrapedAt: new Date().toISOString()
      },
      {
        id: 'post_4',
        url: 'https://instagram.com/p/sample4',
        likes: 876,
        comments: 54,
        takenAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
        scrapedAt: new Date().toISOString()
      },
      {
        id: 'post_5',
        url: 'https://instagram.com/p/sample5',
        likes: 1320,
        comments: 95,
        takenAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        scrapedAt: new Date().toISOString()
      }
    ];
    
    for (const post of samplePosts) {
      await db.collection('influencers')
        .doc(userId)
        .collection('posts')
        .doc(post.id)
        .set(post);
    }
    console.log('✓ Added 5 sample Instagram posts');
    
    console.log('Sample data added successfully!');
    console.log('Profile stats:', profileData);
    console.log('Posts added:', samplePosts.length);
    
  } catch (error) {
    console.error('Error adding sample data:', error);
  }
}

// Run the script
addSampleData().then(() => {
  console.log('Script completed');
  process.exit(0);
}).catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});