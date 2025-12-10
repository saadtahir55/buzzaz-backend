// Load env from root and backend (fallback)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db: firestore } = require('../config/firebase');
const pg = require('../services/db');

function printEnvSummary() {
  try {
    const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
    const host = url ? url.hostname : '(missing)';
    const dbName = url ? url.pathname.replace('/', '') : '(missing)';
    const ssl = process.env.PGSSL === 'true' ? 'enabled' : 'disabled';
    const hasSvcEnv = !!process.env.FIREBASE_SERVICE_ACCOUNT;
    const localSvc = fs.existsSync(path.join(__dirname, '..', 'config', 'serviceAccount.json'));
    console.log(`Env summary → PG host: ${host}, DB: ${dbName}, SSL: ${ssl}, Firebase SA via env: ${hasSvcEnv}, local file: ${localSvc}`);
  } catch (_) {
    console.log('Env summary unavailable; check DATABASE_URL and PGSSL.');
  }
}

async function ensureSchema() {
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  // Quick connectivity check
  await pg.query('SELECT 1');
  await pg.query(ddl);
}

async function migrateUsers() {
  const usersSnap = await firestore.collection('users').get();
  let count = 0;
  for (const doc of usersSnap.docs) {
    const data = doc.data() || {};
    const uid = doc.id;
    const email = data.email || null;
    const role = data.role || 'content_creator';
    const displayName = data.displayName || data.name || null;
    const socialConnections = data.socialConnections || null;

    await pg.query(
      `INSERT INTO users (uid, email, role, display_name, social_connections)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uid) DO UPDATE SET
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         display_name = EXCLUDED.display_name,
         social_connections = EXCLUDED.social_connections`,
      [uid, email, role, displayName, socialConnections]
    );
    count++;
  }
  console.log(`Migrated users: ${count}`);
}

async function migrateInstagramProfile(uid) {
  const profileDoc = await firestore.collection('users').doc(uid).collection('instagram').doc('profile').get();
  if (!profileDoc.exists) return false;
  const p = profileDoc.data();

  await pg.query(
    `INSERT INTO instagram_profiles (
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
      created_at = EXCLUDED.created_at,
      last_updated = EXCLUDED.last_updated,
      original_json = EXCLUDED.original_json`,
    [
      uid,
      p.username || null,
      p.fullName || null,
      p.bio || null,
      p.avatarUrl || null,
      p.profilePicUrlHd || null,
      p.followers || 0,
      p.following || 0,
      p.postsCount || 0,
      !!p.isVerified,
      !!p.isPrivate,
      p.externalUrl || null,
      p.businessCategoryName || null,
      p.categoryName || null,
      !!p.isBusinessAccount,
      !!p.isProfessionalAccount,
      p.businessEmail || null,
      p.businessPhoneNumber || null,
      p.businessAddressJson || null,
      p.engagementRate || 0,
      p.createdAt ? new Date(p.createdAt) : null,
      p.lastUpdated ? new Date(p.lastUpdated) : null,
      p
    ]
  );
  return true;
}

async function migrateInstagramReels(uid) {
  const reelsDoc = await firestore.collection('users').doc(uid).collection('instagram').doc('reels').get();
  if (!reelsDoc.exists) return 0;
  const data = reelsDoc.data() || {};
  const reels = Array.isArray(data.reels) ? data.reels : [];
  let count = 0;
  for (const r of reels) {
    // Normalize hashtags/mentions to valid JSON arrays for JSONB columns
    const toArray = (val) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        // Split by commas or spaces, trim empties and leading '#' or '@'
        return val
          .split(/[\s,]+/)
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => s.replace(/^([#@])+/, ''));
      }
      return null;
    };
    const hashtagsJson = toArray(r.hashtags);
    const mentionsJson = toArray(r.mentions);

    // Ensure numeric fields are valid integers where required
    const videoDurationVal = (() => {
      if (typeof r.videoDuration === 'number') return Math.round(r.videoDuration);
      if (typeof r.videoDuration === 'string') {
        const n = parseFloat(r.videoDuration);
        return Number.isFinite(n) ? Math.round(n) : 0;
      }
      return 0;
    })();

    await pg.query(
      `INSERT INTO instagram_reels (
        uid, reel_id, short_code, display_url, caption, owner_full_name, owner_username,
        url, comments_count, likes_count, views_count, timestamp, video_duration, video_url,
        hashtags, mentions, is_sponsored, original_json
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18
      )`,
      [
        uid,
        r.id || r.postId || r.shortcode || r.shortCode || null,
        r.shortCode || r.shortcode || null,
        r.displayUrl || r.thumbnailUrl || (Array.isArray(r.images) ? r.images[0] : null),
        r.caption || null,
        r.ownerFullName || null,
        r.ownerUsername || null,
        r.url || (r.shortCode || r.shortcode ? `https://www.instagram.com/p/${r.shortCode || r.shortcode}/` : null),
        r.commentsCount || 0,
        r.likesCount || 0,
        r.viewsCount || r.playCount || r.videoPlayCount || 0,
        r.timestamp ? new Date(r.timestamp) : (r.takenAt ? new Date(r.takenAt) : null),
        videoDurationVal,
        r.videoUrl || null,
        hashtagsJson ? JSON.stringify(hashtagsJson) : null,
        mentionsJson ? JSON.stringify(mentionsJson) : null,
        !!r.isSponsored,
        r
      ]
    );
    count++;
  }
  return count;
}

async function migrateDetailed(uid) {
  const detailedDoc = await firestore.collection('instagramDetailedData').doc(uid).get();
  if (!detailedDoc.exists) return false;
  const d = detailedDoc.data();
  await pg.query(
    `INSERT INTO instagram_detailed_data (uid, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (uid) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [uid, d]
  );
  return true;
}

// Migrate influencers collection
async function migrateInfluencers() {
  const snap = await firestore.collection('influencers').get();
  if (snap.empty) {
    console.log('No influencers found in Firestore.');
    return 0;
  }
  let count = 0;
  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data() || {};

    // Ensure user exists (role influencer)
    await pg.query(
      `INSERT INTO users (uid, email, role, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         role = EXCLUDED.role,
         display_name = COALESCE(EXCLUDED.display_name, users.display_name)`,
      [uid, data.email || null, 'influencer', data.fullName || data.displayName || null]
    );

    await pg.query(
      `INSERT INTO influencers (
        uid, email, full_name, bio, instagram_username, followers, following,
        posts_count, engagement_rate, is_verified, is_private, avatar_url,
        location, niche, content_style, created_at, updated_at, original_json
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18
      )
      ON CONFLICT (uid) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        bio = EXCLUDED.bio,
        instagram_username = EXCLUDED.instagram_username,
        followers = EXCLUDED.followers,
        following = EXCLUDED.following,
        posts_count = EXCLUDED.posts_count,
        engagement_rate = EXCLUDED.engagement_rate,
        is_verified = EXCLUDED.is_verified,
        is_private = EXCLUDED.is_private,
        avatar_url = EXCLUDED.avatar_url,
        location = EXCLUDED.location,
        niche = EXCLUDED.niche,
        content_style = EXCLUDED.content_style,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        original_json = EXCLUDED.original_json`,
      [
        uid,
        data.email || null,
        data.fullName || data.displayName || null,
        data.bio || null,
        data.instagramUsername || data.username || null,
        data.followers || 0,
        data.following || 0,
        data.postsCount || 0,
        data.engagementRate || 0,
        !!data.isVerified,
        !!data.isPrivate,
        data.avatarUrl || null,
        data.location || null,
        Array.isArray(data.niche) ? data.niche : (Array.isArray(data.categories) ? data.categories : null),
        Array.isArray(data.contentStyle) ? data.contentStyle : null,
        data.createdAt ? new Date(data.createdAt) : null,
        data.updatedAt ? new Date(data.updatedAt) : (data.lastUpdated ? new Date(data.lastUpdated) : null),
        data
      ]
    );
    count++;
  }
  console.log(`Migrated influencers: ${count}`);
  return count;
}

// Migrate UGC creators collection
async function migrateUGCCreators() {
  const snap = await firestore.collection('ugc_creators').get();
  if (snap.empty) {
    console.log('No ugc_creators found in Firestore.');
    return 0;
  }
  let count = 0;
  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data() || {};

    // Ensure user exists (role content_creator by default)
    await pg.query(
      `INSERT INTO users (uid, email, role, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         display_name = COALESCE(EXCLUDED.display_name, users.display_name)`,
      [uid, data.email || null, data.role || 'content_creator', data.fullName || data.displayName || null]
    );

    // Normalize JSONB fields that may be stored as strings in Firestore
    const toJsonValue = (val) => {
      if (val === undefined || val === null) return null;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return JSON.stringify(val);
      }
      if (Array.isArray(val) || typeof val === 'object') {
        return JSON.stringify(val);
      }
      return null;
    };
    const pricingJson = toJsonValue(data.pricing);
    const sampleContentJson = toJsonValue(data.sampleContent);

    // Robust timestamp conversion from Firestore formats
    const toDateVal = (val) => {
      if (!val) return null;
      if (val instanceof Date) return val;
      if (typeof val?.toDate === 'function') {
        try { return val.toDate(); } catch { return null; }
      }
      if (typeof val === 'number') return new Date(val);
      if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
      }
      if (typeof val === 'object') {
        const s = (val.seconds ?? val._seconds);
        const ns = (val.nanoseconds ?? val._nanoseconds ?? 0);
        if (typeof s === 'number') return new Date(s * 1000 + Math.floor(ns / 1e6));
      }
      return null;
    };

    await pg.query(
      `INSERT INTO ugc_creators (
        uid, email, full_name, bio, location, categories, content_types,
        is_active, pricing, sample_content, created_at, updated_at, original_json
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13
      )
      ON CONFLICT (uid) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        bio = EXCLUDED.bio,
        location = EXCLUDED.location,
        categories = EXCLUDED.categories,
        content_types = EXCLUDED.content_types,
        is_active = EXCLUDED.is_active,
        pricing = EXCLUDED.pricing,
        sample_content = EXCLUDED.sample_content,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        original_json = EXCLUDED.original_json`,
      [
        uid,
        data.email || null,
        data.fullName || data.displayName || null,
        data.bio || null,
        data.location || null,
        Array.isArray(data.categories) ? data.categories : null,
        Array.isArray(data.contentTypes) ? data.contentTypes : null,
        typeof data.isActive === 'boolean' ? data.isActive : true,
        pricingJson,
        sampleContentJson,
        toDateVal(data.createdAt),
        toDateVal(data.updatedAt) || toDateVal(data.lastUpdated),
        data
      ]
    );
    count++;
  }
  console.log(`Migrated UGC creators: ${count}`);
  return count;
}

// Migrate conversations and nested messages
async function migrateConversationsAndMessages() {
  const convSnap = await firestore.collection('conversations').get();
  if (convSnap.empty) {
    console.log('No conversations found in Firestore.');
    return { conversations: 0, messages: 0 };
  }
  let convCount = 0;
  let msgCount = 0;
  for (const doc of convSnap.docs) {
    const id = doc.id;
    const data = doc.data() || {};
    const participants = Array.isArray(data.participants)
      ? data.participants.map(p => p.userId || p.uid || p.id || p)
      : Array.isArray(data.participantIds)
        ? data.participantIds
        : [];
    const participantDetails = Array.isArray(data.participants) ? data.participants : null;
    const lastMessage = data.lastMessage && (data.lastMessage.message || data.lastMessage.text) ? (data.lastMessage.message || data.lastMessage.text) : (data.lastMessage || null);
    const lastMessageSender = data.lastMessage && (data.lastMessage.senderId || data.lastMessage.userId) ? (data.lastMessage.senderId || data.lastMessage.userId) : data.lastMessageSender || null;
    const createdAt = data.createdAt ? new Date(data.createdAt) : null;
    const updatedAt = data.updatedAt ? new Date(data.updatedAt) : (data.lastMessageTime ? new Date(data.lastMessageTime) : null);
    const lastMessageTime = data.lastMessageTime ? new Date(data.lastMessageTime) : updatedAt;

    await pg.query(
      `INSERT INTO conversations (
        id, participants, participant_details, last_message, last_message_time, last_message_sender,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8
      )
      ON CONFLICT (id) DO UPDATE SET
        participants = EXCLUDED.participants,
        participant_details = EXCLUDED.participant_details,
        last_message = EXCLUDED.last_message,
        last_message_time = EXCLUDED.last_message_time,
        last_message_sender = EXCLUDED.last_message_sender,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        participants,
        participantDetails ? JSON.stringify(participantDetails) : null,
        lastMessage || null,
        lastMessageTime || null,
        lastMessageSender || null,
        createdAt || new Date(),
        updatedAt || new Date()
      ]
    );
    convCount++;

    // Nested messages
    const msgsSnap = await firestore.collection('conversations').doc(id).collection('messages').get();
    for (const mdoc of msgsSnap.docs) {
      const mid = mdoc.id;
      const m = mdoc.data() || {};
      await pg.query(
        `INSERT INTO messages (
          id, conversation_id, sender_id, sender_name, message, timestamp, is_filtered
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          mid,
          id,
          m.senderId || m.userId || null,
          m.senderName || m.displayName || null,
          m.message || m.text || '',
          m.timestamp ? new Date(m.timestamp) : new Date(),
          !!m.isFiltered
        ]
      );
      msgCount++;
    }
  }
  console.log(`Migrated conversations: ${convCount}, messages: ${msgCount}`);
  return { conversations: convCount, messages: msgCount };
}

// Migrate YouTube analytics collection
async function migrateYouTubeAnalytics() {
  const snap = await firestore.collection('youtubeAnalytics').get();
  if (snap.empty) {
    console.log('No youtubeAnalytics found in Firestore.');
    return 0;
  }
  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const uid = data.uid || data.userId || doc.id;
    const clampInt = (val) => {
      const n = typeof val === 'number' ? val : parseInt(val, 10);
      if (!Number.isFinite(n)) return 0;
      return Math.min(Math.max(Math.round(n), 0), 2147483647);
    };
    // Ensure user exists for FK constraint
    await pg.query(
      `INSERT INTO users (uid) VALUES ($1) ON CONFLICT (uid) DO NOTHING`,
      [uid]
    );
    await pg.query(
      `INSERT INTO youtube_analytics (
        uid, channel_id, channel_title, channel_url, user_type,
        subscriber_count, view_count, video_count, analytics
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9
      )`,
      [
        uid,
        data.channelId || null,
        data.channelTitle || null,
        data.channelUrl || null,
        data.userType || null,
        clampInt(data.subscriberCount),
        clampInt(data.viewCount),
        clampInt(data.videoCount),
        data
      ]
    );
    count++;
  }
  console.log(`Migrated youtubeAnalytics rows: ${count}`);
  return count;
}

async function migrateAll() {
  printEnvSummary();
  await ensureSchema();
  const usersSnap = await firestore.collection('users').get();
  let totalProfiles = 0;
  let totalReels = 0;
  let totalDetailed = 0;

  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    const data = doc.data() || {};
    const email = data.email || null;
    const role = data.role || 'content_creator';
    const displayName = data.displayName || data.name || null;
    const socialConnections = data.socialConnections || null;

    // Upsert user
    await pg.query(
      `INSERT INTO users (uid, email, role, display_name, social_connections)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uid) DO UPDATE SET
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         display_name = EXCLUDED.display_name,
         social_connections = EXCLUDED.social_connections`,
      [uid, email, role, displayName, socialConnections]
    );

    // Migrate instagram subdocs
    const profOk = await migrateInstagramProfile(uid);
    const reelsCount = await migrateInstagramReels(uid);
    const detOk = await migrateDetailed(uid);
    if (profOk) totalProfiles++;
    totalReels += reelsCount;
    if (detOk) totalDetailed++;
  }

  console.log(`Profiles migrated: ${totalProfiles}`);
  console.log(`Reels migrated: ${totalReels}`);
  console.log(`Detailed data migrated: ${totalDetailed}`);

  // Collections independent of per-user loop
  await migrateInfluencers();
  await migrateUGCCreators();
  await migrateConversationsAndMessages();
  await migrateYouTubeAnalytics();
}

migrateAll()
  .then(() => {
    console.log('Migration completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
