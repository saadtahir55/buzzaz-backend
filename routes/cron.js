const express = require('express');
const syncInfluencerStats = require('../services/cronService');

const router = express.Router();

// Manual trigger for syncing influencer stats (protected endpoint)
router.post('/sync-influencer-stats', async (req, res) => {
  try {
    // Simple protection - check for a secret header or API key
    const cronSecret = req.header('X-Cron-Secret');
    if (cronSecret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
 
    const limit = parseInt(req.query.limit || process.env.CRON_LIMIT || '10', 10);
    const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';

    console.log('Manual sync triggered via API', { limit, dryRun });

    // Run the sync synchronously for predictability on serverless
    await syncInfluencerStats({ limit, dryRun });

    res.json({
      message: 'Influencer stats sync completed',
      timestamp: new Date().toISOString(),
      limit,
      dryRun
    });

  } catch (error) {
    console.error('Manual sync trigger error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get sync status and last run information
router.get('/sync-status', async (req, res) => {
  try {
    const cronSecret = req.header('X-Cron-Secret');
    if (cronSecret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // This is a simple status endpoint
    // In a production environment, you might want to store sync status in the database
    res.json({
      status: 'active',
      schedule: process.env.CRON_SCHEDULE || '0 * * * *',
      lastCheck: new Date().toISOString(),
      message: 'Cron service is running'
    });

  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
