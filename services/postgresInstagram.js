const db = require('./db');

// Upsert Instagram profile into Postgres
async function saveInstagramProfileData(userId, profileData) {
  const now = new Date();
  const values = [
    userId,
    profileData.username || null,
    profileData.fullName || null,
    profileData.bio || null,
    profileData.avatarUrl || null,
    profileData.profilePicUrlHd || null,
    profileData.followers || null,
    profileData.following || null,
    profileData.postsCount || null,
    !!profileData.isVerified,
    !!profileData.isPrivate,
    profileData.externalUrl || null,
    profileData.businessCategoryName || null,
    profileData.categoryName || null,
    !!profileData.isBusinessAccount,
    !!profileData.isProfessionalAccount,
    profileData.businessEmail || null,
    profileData.businessPhoneNumber || null,
    profileData.businessAddressJson || null,
    profileData.engagementRate || null,
    now,
    now,
    profileData || null,
  ];

  const sql = `
    INSERT INTO instagram_profiles (
      uid, username, full_name, bio, avatar_url, profile_pic_url_hd,
      followers, following, posts_count, is_verified, is_private, external_url,
      business_category_name, category_name, is_business_account, is_professional_account,
      business_email, business_phone_number, business_address_json, engagement_rate,
      created_at, last_updated, original_json
    ) VALUES (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,$10,$11,$12,
      $13,$14,$15,$16,
      $17,$18,$19,$20,
      $21,$22,$23
    )
    ON CONFLICT (uid) DO UPDATE SET
      username = EXCLUDED.username,
      full_name = EXCLUDED.full_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      profile_pic_url_hd = EXCLUDED.profile_pic_url_hd,
      followers = EXCLUDED.followers,
      following = EXCLUDED.following,
      posts_count = EXCLUDED.posts_count,
      is_verified = EXCLUDED.is_verified,
      is_private = EXCLUDED.is_private,
      external_url = EXCLUDED.external_url,
      business_category_name = EXCLUDED.business_category_name,
      category_name = EXCLUDED.category_name,
      is_business_account = EXCLUDED.is_business_account,
      is_professional_account = EXCLUDED.is_professional_account,
      business_email = EXCLUDED.business_email,
      business_phone_number = EXCLUDED.business_phone_number,
      business_address_json = EXCLUDED.business_address_json,
      engagement_rate = EXCLUDED.engagement_rate,
      last_updated = EXCLUDED.last_updated,
      original_json = EXCLUDED.original_json
  `;

  await db.query(sql, values);
  return { success: true, message: 'Instagram profile saved to Postgres' };
}

// Insert reels into Postgres with basic de-duplication on (uid, short_code)
async function saveInstagramReelData(userId, username, reels) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const r of reels || []) {
      const shortCode = r.shortCode || r.shortcode || r.code || null;
      const values = [
        userId,
        r.id || r.postId || r.shortcode || r.shortCode || null,
        shortCode,
        r.displayUrl || r.thumbnailUrl || (Array.isArray(r.images) ? r.images[0] : null) || null,
        r.caption || null,
        r.ownerFullName || null,
        r.ownerUsername || username || null,
        r.url || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null),
        r.commentsCount || 0,
        r.likesCount || 0,
        r.viewsCount || r.playCount || r.videoPlayCount || 0,
        r.timestamp ? new Date(r.timestamp) : (r.takenAt ? new Date(r.takenAt) : null),
        r.videoDuration || 0,
        r.videoUrl || null,
        r.hashtags || null,
        r.mentions || null,
        !!r.isSponsored,
        r || null,
      ];

      const sql = `
        INSERT INTO instagram_reels (
          uid, reel_id, short_code, display_url, caption, owner_full_name, owner_username,
          url, comments_count, likes_count, views_count, timestamp, video_duration, video_url,
          hashtags, mentions, is_sponsored, original_json
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13,$14,
          $15,$16,$17,$18
        )
        ON CONFLICT DO NOTHING
      `;
      await client.query(sql, values);
    }
    await client.query('COMMIT');
    return { success: true, message: 'Instagram reels saved to Postgres', total: reels?.length || 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Update social connection status in users.social_connections JSONB
async function updateInstagramConnection(userId, username, isConnected = true) {
  const now = new Date().toISOString();
  const payload = {
    instagram: {
      username: username,
      connected: !!isConnected,
      lastUpdated: now,
    },
  };

  // Merge jsonb: coalesce existing, then set instagram
  const sql = `
    UPDATE users
    SET social_connections = COALESCE(social_connections, '{}'::jsonb) || $2::jsonb
    WHERE uid = $1
  `;
  await db.query(sql, [userId, JSON.stringify(payload)]);
  return { success: true, message: 'Instagram connection updated in Postgres', updatedAt: now };
}

// Dashboard helper: get reels and connection status
async function getInstagramDashboardData(userId) {
  const reelsRes = await db.query(
    'SELECT * FROM instagram_reels WHERE uid = $1 ORDER BY timestamp DESC',
    [userId]
  );
  const connRes = await db.query(
    'SELECT social_connections FROM users WHERE uid = $1 LIMIT 1',
    [userId]
  );
  const social = connRes.rows[0]?.social_connections || null;
  const reels = reelsRes.rows || [];
  return {
    success: true,
    message: 'Instagram dashboard data from Postgres',
    reelData: reels,
    connectionStatus: social?.instagram || null,
    hasData: reels.length > 0,
  };
}

module.exports = {
  saveInstagramProfileData,
  saveInstagramReelData,
  updateInstagramConnection,
  getInstagramDashboardData,
};

