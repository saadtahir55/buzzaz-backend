const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { scrapeInstagramComplete } = require('../services/apifyService');
const pg = require('../services/db');
const {
  saveInstagramProfileData,
  saveInstagramReelData,
  updateInstagramConnection,
  getInstagramDashboardData,
} = require('../services/postgresInstagram');
const youtubeService = require('../services/youtubeService');

const router = express.Router();

// Validate Instagram username via Apify and persist to Postgres
router.post('/validate-apify', authMiddleware, requireRole('influencer'), [
  body('instagramUsername').isLength({ min: 1 }).trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const { instagramUsername } = req.body;
    const data = await scrapeInstagramComplete(instagramUsername);
    if (!data || !data.success) {
      return res.json({
        success: true,
        message: 'Instagram username validated by format. Data will sync after connect.',
        requiresSync: true,
        data: {
          username: instagramUsername.replace('@', ''),
          profile: null,
          reels: { totalReels: 0, reelsPreview: [] },
          scrapedAt: null,
          errors: data?.errors || [],
        },
      });
    }

    // Persist to Postgres
    if (data.profile) {
      await saveInstagramProfileData(req.user.uid, data.profile);
    }
    if (Array.isArray(data.reels) && data.reels.length > 0) {
      await saveInstagramReelData(req.user.uid, data.username, data.reels);
    }
    await updateInstagramConnection(req.user.uid, data.username, true);

    return res.json({
      success: true,
      message: 'Instagram account validated successfully with complete data',
      data: {
        username: data.username,
        profile: data.profile ? {
          fullName: data.profile.fullName,
          bio: data.profile.bio,
          followers: data.profile.followers,
          following: data.profile.following,
          postsCount: data.profile.postsCount,
          isVerified: data.profile.isVerified,
          avatarUrl: data.profile.avatarUrl,
        } : null,
        reels: {
          totalReels: data.totalReels || data.reels?.length || 0,
          reelsPreview: data.reels?.slice(0, 5) || [],
        },
        scrapedAt: data.scrapedAt,
        errors: data.errors,
      },
    });
  } catch (error) {
    console.error('validate-apify error (PG):', error);
    res.status(500).json({ success: false, message: 'Server error during validation', error: error.message });
  }
});

// Get current user's influencer profile (Postgres)
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.uid;
    // Prefer instagram_profiles; fallback to influencers
    const profRes = await pg.query('SELECT * FROM instagram_profiles WHERE uid = $1 LIMIT 1', [uid]);
    const infRes = await pg.query('SELECT * FROM influencers WHERE uid = $1 LIMIT 1', [uid]);
    const userRes = await pg.query('SELECT uid, email, role, display_name, social_connections FROM users WHERE uid = $1 LIMIT 1', [uid]);

    // If user exists and is an influencer but has no influencer/instagram profile yet,
    // respond with 404 to trigger onboarding on the frontend.
    if (userRes.rowCount > 0) {
      const userRole = userRes.rows[0]?.role;
      const noInfluencerData = profRes.rowCount === 0 && infRes.rowCount === 0;
      if (userRole === 'influencer' && noInfluencerData) {
        return res.status(404).json({ message: 'Influencer profile not found', requiresOnboarding: true });
      }
    }

    // If user itself is missing
    if (userRes.rowCount === 0 && profRes.rowCount === 0 && infRes.rowCount === 0) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const ip = profRes.rows[0] || {};
    const inf = infRes.rows[0] || {};
    const user = userRes.rows[0] || {};

    const profile = {
      id: uid,
      fullName: ip.full_name || inf.full_name || user.display_name || user.email || 'Unknown',
      bio: ip.bio || inf.bio || '',
      instagramUsername: ip.username || inf.instagram_username || '',
      followers: ip.followers || inf.followers || 0,
      following: ip.following || inf.following || 0,
      postsCount: ip.posts_count || inf.posts_count || 0,
      engagementRate: ip.engagement_rate || inf.engagement_rate || 0,
      isVerified: ip.is_verified || inf.is_verified || false,
      isPrivate: ip.is_private || inf.is_private || false,
      avatarUrl: ip.avatar_url || inf.avatar_url || null,
      location: ip.location || inf.location || null,
      categories: ip.categories || inf.niche || [],
      contentTypes: ip.content_types || inf.content_style || [],
      createdAt: ip.created_at || inf.created_at || new Date().toISOString(),
    };

    // No separate stats table yet; derive a single latest snapshot
    const latestStats = profile.instagramUsername ? {
      followers: profile.followers,
      following: profile.following,
      postsCount: profile.postsCount,
      engagementRate: profile.engagementRate,
      timestamp: ip.last_updated || inf.updated_at || new Date().toISOString(),
    } : null;

    res.json({ profile, latestStats });
  } catch (error) {
    console.error('Get influencer profile error (PG):', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create influencer profile (wizard submit)
router.post('/', authMiddleware, requireRole('influencer'), [
  body('fullName').isLength({ min: 2 }).trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const uid = req.user.uid;
    const {
      fullName,
      instagramUsername,
      bio,
      location,
      categories,
      contentTypes,
    } = req.body;

    const now = new Date();
    // Upsert into influencers table
    await pg.query(
      `INSERT INTO influencers (uid, email, full_name, bio, instagram_username, followers, following, posts_count, engagement_rate, is_verified, is_private, avatar_url, location, niche, content_style, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (uid) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         bio = EXCLUDED.bio,
         instagram_username = EXCLUDED.instagram_username,
         location = EXCLUDED.location,
         niche = EXCLUDED.niche,
         content_style = EXCLUDED.content_style,
         updated_at = EXCLUDED.updated_at`,
      [
        uid,
        req.user.email || null,
        fullName,
        bio || null,
        instagramUsername || null,
        0, 0, 0, null, false, false, null,
        location || null,
        categories || [],
        contentTypes || [],
        now,
        now,
      ]
    );

    // Also upsert minimal instagram profile for consistency
    await saveInstagramProfileData(uid, {
      username: instagramUsername || null,
      fullName: fullName || null,
      bio: bio || null,
      followers: 0,
      following: 0,
      postsCount: 0,
      isVerified: false,
      isPrivate: false,
      avatarUrl: null,
      engagementRate: null,
      categories: categories || [],
      contentTypes: contentTypes || [],
    });

    res.json({ success: true, message: 'Profile created successfully' });
  } catch (error) {
    console.error('Create influencer profile error (PG):', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update influencer profile
router.put('/:id', authMiddleware, requireRole('influencer'), async (req, res) => {
  try {
    const influencerId = req.params.id;
    if (influencerId !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const {
      fullName,
      bio,
      location,
      categories,
      contentTypes,
      instagramUsername,
    } = req.body || {};

    const now = new Date();
    await pg.query(
      `UPDATE influencers SET
         full_name = COALESCE($2, full_name),
         bio = COALESCE($3, bio),
         location = COALESCE($4, location),
         niche = COALESCE($5, niche),
         content_style = COALESCE($6, content_style),
         instagram_username = COALESCE($7, instagram_username),
         updated_at = $8
       WHERE uid = $1`,
      [influencerId, fullName, bio, location, categories, contentTypes, instagramUsername, now]
    );

    // Keep instagram_profiles in sync if provided
    if (instagramUsername || fullName || bio || location || categories || contentTypes) {
      await saveInstagramProfileData(influencerId, {
        username: instagramUsername,
        fullName,
        bio,
        followers: undefined,
        following: undefined,
        postsCount: undefined,
        isVerified: undefined,
        isPrivate: undefined,
        avatarUrl: undefined,
        engagementRate: undefined,
        categories,
        contentTypes,
        location,
      });
    }

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update influencer profile error (PG):', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get influencer stats history (derived)
router.get('/:id/stats', authMiddleware, async (req, res) => {
  try {
    const uid = req.params.id;
    const profRes = await pg.query('SELECT followers, following, posts_count, last_updated FROM instagram_profiles WHERE uid = $1 LIMIT 1', [uid]);
    const ip = profRes.rows[0];
    if (!ip) return res.json({ stats: [] });
    const stats = [{
      id: uid,
      followers: ip.followers || 0,
      following: ip.following || 0,
      postsCount: ip.posts_count || 0,
      engagementRate: null,
      timestamp: ip.last_updated || new Date().toISOString(),
    }];
    res.json({ stats });
  } catch (error) {
    console.error('Get influencer stats error (PG):', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get Instagram posts (reels) for influencer
router.get('/:id/instagram/posts', authMiddleware, async (req, res) => {
  try {
    const uid = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 12, 100);
    const reelsRes = await pg.query(
      'SELECT * FROM instagram_reels WHERE uid = $1 ORDER BY timestamp DESC LIMIT $2',
      [uid, limit]
    );
    const posts = reelsRes.rows.map(r => ({
      id: r.reel_id || r.id,
      shortCode: r.short_code,
      url: r.url,
      displayUrl: r.display_url,
      caption: r.caption,
      likesCount: r.likes_count,
      commentsCount: r.comments_count,
      viewsCount: r.views_count,
      timestamp: r.timestamp,
      videoDuration: r.video_duration,
      videoUrl: r.video_url,
      hashtags: r.hashtags,
      mentions: r.mentions,
    }));
    res.json({ posts });
  } catch (error) {
    console.error('Get Instagram posts error (PG):', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Connect YouTube channel (store analytics snapshot)
router.post('/:id/youtube/connect', authMiddleware, requireRole('influencer'), async (req, res) => {
  try {
    const uid = req.params.id;
    if (uid !== req.user.uid) return res.status(403).json({ message: 'Forbidden' });
    const { channelQuery } = req.body;

    if (!channelQuery || String(channelQuery).trim() === '') {
      return res.status(400).json({ message: 'Channel query is required' });
    }

    // Normalize query: support URL, @handle, bare handle token, or channel ID
    let rawQuery = String(channelQuery).trim();
    rawQuery = rawQuery.replace(/^https:\/\//, 'https://').replace(/^https:\//, 'https://').replace(/^http:\/\//, 'http://').replace(/^http:\//, 'http://');
    const isUrl = /youtube\.com\//i.test(rawQuery);
    const isChannelId = /^UC[A-Za-z0-9_-]+$/.test(rawQuery);
    const hasAt = rawQuery.startsWith('@');
    const looksLikeHandleToken = /^[A-Za-z0-9._-]+$/.test(rawQuery);
    const normalizedQuery = isUrl || isChannelId || hasAt ? rawQuery : (looksLikeHandleToken ? `@${rawQuery}` : rawQuery);

    // Resolve the channel via search to obtain a valid channelId and clean URL
    const resolved = await youtubeService.searchChannel(normalizedQuery);

    // Fetch comprehensive data using the resolved channelId (handles API-key fallback internally)
    const data = await youtubeService.getComprehensiveChannelData(resolved.channelId);

    // Prefer resolved title/url from search to avoid mock placeholders and malformed URLs
    const channelId = data.channelId || resolved.channelId || null;
    const channelTitle = resolved.channelTitle || data.channelTitle || null;
    const channelUrl = (resolved.channelUrl || data.channelUrl || normalizedQuery)
      .replace(/^https:\/\//, 'https://')
      .replace(/^https:\//, 'https://')
      .replace(/^http:\/\//, 'http://')
      .replace(/^http:\//, 'http://');

    await pg.query(
      `INSERT INTO youtube_analytics (uid, channel_id, channel_title, channel_url, user_type, subscriber_count, view_count, video_count, analytics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uid,
        channelId,
        channelTitle,
        channelUrl,
        'influencer',
        data.subscriberCount || 0,
        data.viewCount || 0,
        data.videoCount || 0,
        JSON.stringify(data.analytics || {}),
      ]
    );

    // Return complete channel data so the frontend wizard can render the success state
    const channelData = {
      channelId,
      channelTitle,
      channelUrl,
      subscriberCount: data.subscriberCount || 0,
      viewCount: data.viewCount || 0,
      videoCount: data.videoCount || 0,
      description: data.description || '',
      publishedAt: data.publishedAt || null,
      country: data.country || null,
      thumbnails: data.thumbnails || {},
      dataSource: data.analytics?.dataSource || null,
      lastUpdated: data.lastUpdated || new Date().toISOString(),
    };
    res.json({ success: true, message: 'YouTube channel connected', channelData });
  } catch (error) {
    console.error('YouTube connect error (PG):', error);
    res.status(500).json({ message: 'Failed to connect YouTube', error: error.message });
  }
});

// Refresh YouTube analytics
router.post('/:id/youtube/refresh', authMiddleware, requireRole('influencer'), async (req, res) => {
  try {
    const uid = req.params.id;
    if (uid !== req.user.uid) return res.status(403).json({ message: 'Forbidden' });
    const lastRes = await pg.query('SELECT channel_id FROM youtube_analytics WHERE uid = $1 ORDER BY created_at DESC LIMIT 1', [uid]);
    const channelId = lastRes.rows[0]?.channel_id;
    if (!channelId) return res.status(400).json({ message: 'YouTube channel not connected' });
    const data = await youtubeService.getComprehensiveChannelData(channelId);
    await pg.query(
      `INSERT INTO youtube_analytics (uid, channel_id, channel_title, channel_url, user_type, subscriber_count, view_count, video_count, analytics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uid,
        data.channelId || channelId,
        data.channelTitle || null,
        data.channelUrl || null,
        'influencer',
        data.subscriberCount || 0,
        data.viewCount || 0,
        data.videoCount || 0,
        JSON.stringify(data.analytics || {}),
      ]
    );
    res.json({ success: true, message: 'YouTube analytics refreshed' });
  } catch (error) {
    console.error('YouTube refresh error (PG):', error);
    res.status(500).json({ message: 'Failed to refresh YouTube', error: error.message });
  }
});

// Get detailed YouTube analytics
router.get('/:id/youtube/detailed', authMiddleware, async (req, res) => {
  try {
    const uid = req.params.id;
    const result = await pg.query('SELECT * FROM youtube_analytics WHERE uid = $1 ORDER BY created_at DESC LIMIT 1', [uid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No analytics found' });
    }
    const row = result.rows[0];
    // Ensure analytics is an object and expose recentVideos top-level for UI convenience
    const rawAnalytics = row.analytics;
    let analytics;
    try {
      analytics = typeof rawAnalytics === 'string' ? JSON.parse(rawAnalytics) : (rawAnalytics || {});
    } catch (e) {
      analytics = rawAnalytics || {};
    }
    const recentVideos = Array.isArray(analytics?.recentVideos) ? analytics.recentVideos : [];

    // Derive a simple dataSource hint for UI badges
    const looksMock = (analytics?.dataSource === 'mock') || recentVideos.some(v => v.videoId === 'dQw4w9WgXcQ' || v.videoId === 'jNQXAC9IVRw');
    const dataSource = looksMock ? 'mock' : (analytics?.dataSource || 'live');

    res.json({
      success: true,
      analytics,
      recentVideos,
      summary: {
        subscriberCount: row.subscriber_count,
        viewCount: row.view_count,
        videoCount: row.video_count,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        channelUrl: row.channel_url,
      },
      dataSource,
      lastUpdated: analytics?.lastUpdated || row.created_at || null,
    });
  } catch (error) {
    console.error('YouTube detailed error (PG):', error);
    res.status(500).json({ message: 'Failed to fetch YouTube analytics', error: error.message });
  }
});

module.exports = router;
