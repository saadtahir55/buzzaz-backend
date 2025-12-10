const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const pg = require('../services/db');

const router = express.Router();

// Get all influencers and UGC creators for chat (brands only)
router.get('/all', authMiddleware, requireRole('brand'), async (req, res) => {
  try {
    const result = await pg.query(
      `SELECT u.uid AS id,
              COALESCE(ip.full_name, u.display_name, u.email, 'Unknown') AS name,
              'influencer' AS role,
              ip.avatar_url AS avatar,
              ip.username AS instagram_username,
              COALESCE(ip.followers, 0) AS followers
       FROM instagram_profiles ip
       JOIN users u ON u.uid = ip.uid`
    );
    const users = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      avatar: r.avatar,
      instagramUsername: r.instagram_username,
      followers: r.followers,
    }));

    res.json({ users });
  } catch (error) {
    console.error('Get all influencers error (PG):', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
});

// Get list of influencers with filters and pagination
router.get('/', authMiddleware, requireRole('brand'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      minFollowers,
      maxFollowers,
      sortBy = 'followers',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const rowsRes = await pg.query(
      `SELECT ip.uid AS id,
              ip.full_name,
              ip.username AS instagram_username,
              ip.bio,
              ip.avatar_url,
              COALESCE(ip.followers, 0) AS followers,
              COALESCE(ip.following, 0) AS following,
              COALESCE(ip.posts_count, 0) AS posts_count,
              ip.engagement_rate,
              ip.is_verified,
              ip.last_updated
       FROM instagram_profiles ip
       JOIN users u ON u.uid = ip.uid`
    );

    let influencers = rowsRes.rows.map(r => ({
      id: r.id,
      fullName: r.full_name,
      instagramUsername: r.instagram_username,
      bio: r.bio,
      avatarUrl: r.avatar_url,
      followers: r.followers,
      following: r.following,
      postsCount: r.posts_count,
      engagementRate: r.engagement_rate,
      isVerified: r.is_verified,
      lastSyncedAt: r.last_updated,
    }));

    if (minFollowers) {
      const min = parseInt(minFollowers);
      influencers = influencers.filter(i => (i.followers || 0) >= min);
    }
    if (maxFollowers) {
      const max = parseInt(maxFollowers);
      influencers = influencers.filter(i => (i.followers || 0) <= max);
    }

    const validSortFields = ['followers', 'engagementRate', 'lastSyncedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'followers';
    const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';
    influencers.sort((a, b) => {
      const aVal = a[sortField] || 0;
      const bVal = b[sortField] || 0;
      if (sortDirection === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? -1 : 1;
    });

    const total = influencers.length;
    const paginatedInfluencers = influencers.slice(offset, offset + limitNum);
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      influencers: paginatedInfluencers,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      filters: {
        minFollowers,
        maxFollowers,
        sortBy: sortField,
        sortOrder: sortDirection
      }
    });

  } catch (error) {
    console.error('Get influencers list error (PG):', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get filter options for the frontend
router.get('/filters', authMiddleware, requireRole('brand'), async (req, res) => {
  try {
    const resFollowers = await pg.query('SELECT followers FROM instagram_profiles WHERE followers IS NOT NULL');
    const followersArr = resFollowers.rows.map(r => r.followers);
    const followerRange = {
      min: followersArr.length ? Math.min(...followersArr) : 0,
      max: followersArr.length ? Math.max(...followersArr) : 0,
    };

    res.json({
      locations: [],
      categories: [],
      contentTypes: [],
      genders: [],
      followerRange,
    });
  } catch (error) {
    console.error('Get filter options error (PG):', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search influencers by name or username
router.get('/search', authMiddleware, requireRole('brand'), async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });
    }

    const limitNum = parseInt(limit);
    const term = `%${q.trim()}%`;

    const searchRes = await pg.query(
      `SELECT uid AS id, full_name, username AS instagram_username, avatar_url, followers
       FROM instagram_profiles
       WHERE (full_name ILIKE $1 OR username ILIKE $1)
       LIMIT $2`,
      [term, limitNum]
    );
    const results = searchRes.rows.map(r => ({
      id: r.id,
      fullName: r.full_name,
      instagramUsername: r.instagram_username,
      avatarUrl: r.avatar_url,
      followers: r.followers || 0,
    }));

    res.json({
      results,
      query: q,
      total: results.length,
    });

  } catch (error) {
    console.error('Search influencers error (PG):', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
