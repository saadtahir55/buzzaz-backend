/**
 * Simple unit-like tests for youtubeService live vs mock selection.
 * - Uses real API if YOUTUBE_API_KEY is present.
 * - Falls back to mock when API key is missing/invalid.
 */

const path = require('path');
const assert = require('assert');

// Load backend .env so YOUTUBE_API_KEY is available
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const youtubeService = require('../services/youtubeService');

async function testLiveData() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey.trim().length < 10) {
    console.log('Skipping live test: YOUTUBE_API_KEY not set or invalid.');
    return { skipped: true };
  }

  console.log('Running live YouTube data test...');
  const channelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'; // Google Developers
  const data = await youtubeService.getComprehensiveChannelData(channelId);
  assert.ok(data, 'Expected comprehensive data object');
  assert.strictEqual(data.analytics?.dataSource, 'live', 'Expected dataSource=live');
  assert.ok(data.subscriberCount >= 0, 'subscriberCount should be >= 0');
  assert.ok(Array.isArray(data.videos), 'videos should be an array');
  console.log('✅ Live test passed: dataSource=live, videos:', data.videos.length);
  return { passed: true };
}

async function testMockData() {
  console.log('Running mock fallback test...');
  const originalKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = 'INVALID_KEY';
  // Re-require service to pick up updated env
  delete require.cache[require.resolve('../services/youtubeService')];
  const youtubeServiceMock = require('../services/youtubeService');
  const channelId = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
  const data = await youtubeServiceMock.getComprehensiveChannelData(channelId);
  assert.ok(data, 'Expected comprehensive data object');
  assert.strictEqual(data.analytics?.dataSource, 'mock', 'Expected dataSource=mock');
  assert.ok(Array.isArray(data.videos), 'videos should be an array');
  console.log('✅ Mock test passed: dataSource=mock, videos:', data.videos.length);
  // Restore env
  process.env.YOUTUBE_API_KEY = originalKey;
  return { passed: true };
}

(async () => {
  try {
    const live = await testLiveData();
    const mock = await testMockData();
    const summary = {
      live,
      mock
    };
    console.log('Test Summary:', JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failure:', err.message || err);
    process.exit(1);
  }
})();
