/*
  Onboarding flow tests for influencer role.
  Verifies role selection → wizard gating → profile creation → dashboard access.
*/
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const pg = require('../services/db');

const BASE_URL = process.env.TEST_API_BASE_URL || 'http://127.0.0.1:5000/api';

async function registerContentCreator(email, password) {
  const res = await axios.post(`${BASE_URL}/auth/register`, { email, password, role: 'content_creator' });
  if (![200, 201].includes(res.status)) throw new Error(`Register failed: ${res.status}`);
  if (!res.data?.token) throw new Error('Register missing token');
  return res.data;
}

async function login(email, password) {
  const res = await axios.post(`${BASE_URL}/auth/login`, { email, password });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  return res.data;
}

async function setRole(token, role) {
  const res = await axios.put(
    `${BASE_URL}/user/role`,
    { role },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status !== 200) throw new Error(`Set role failed: ${res.status}`);
  return res.data;
}

async function getProfileStatus(token) {
  const res = await axios.get(`${BASE_URL}/user/profile-status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) throw new Error(`profile-status failed: ${res.status}`);
  return res.data;
}

async function getInfluencerProfile(token) {
  try {
    const res = await axios.get(`${BASE_URL}/influencer/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    return { status: err.response?.status || 500, data: err.response?.data };
  }
}

async function createInfluencerProfile(token, payload) {
  const res = await axios.post(`${BASE_URL}/influencer`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) throw new Error(`Create influencer profile failed: ${res.status}`);
  return res.data;
}

async function run() {
  const email = `onboarding_${Date.now()}_${crypto.randomBytes(4).toString('hex')}@example.com`;
  const password = 'Passw0rd!';

  console.log('Onboarding Test: register content_creator');
  const reg = await registerContentCreator(email, password);
  console.log('  ✓ registered:', reg.user.email, reg.user.role);

  console.log('Onboarding Test: login');
  const loginRes = await login(email, password);
  const token = loginRes.token;
  console.log('  ✓ logged in, role:', loginRes.user.role);

  console.log('Onboarding Test: set role to influencer');
  const roleRes = await setRole(token, 'influencer');
  if (roleRes.role !== 'influencer') throw new Error('Role did not update to influencer');
  console.log('  ✓ role updated to influencer');

  console.log('Onboarding Test: profile-status requiresOnboarding should be true');
  const statusBefore = await getProfileStatus(token);
  if (!statusBefore.requiresOnboarding) throw new Error('Expected requiresOnboarding=true before profile creation');
  console.log('  ✓ requiresOnboarding is true');

  console.log('Onboarding Test: GET /influencer/profile should be 404');
  const profBefore = await getInfluencerProfile(token);
  if (profBefore.status !== 404) throw new Error(`Expected 404, got ${profBefore.status}`);
  console.log('  ✓ influencer/profile returns 404');

  console.log('Onboarding Test: create minimal influencer profile (wizard submit)');
  await createInfluencerProfile(token, {
    fullName: 'Test Influencer',
    instagramUsername: 'test_influencer',
    bio: 'Test bio',
    location: 'Test City',
    categories: ['fashion'],
    contentTypes: ['reels'],
  });
  console.log('  ✓ profile created');

  console.log('Onboarding Test: profile-status requiresOnboarding should be false');
  const statusAfter = await getProfileStatus(token);
  if (statusAfter.requiresOnboarding) throw new Error('Expected requiresOnboarding=false after profile creation');
  console.log('  ✓ requiresOnboarding is false');

  console.log('Onboarding Test: GET /influencer/profile should be 200');
  const profAfter = await getInfluencerProfile(token);
  if (profAfter.status !== 200) throw new Error(`Expected 200, got ${profAfter.status}`);
  console.log('  ✓ influencer/profile returns 200');

  console.log('All onboarding tests passed');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Onboarding tests failed:', err.message || err);
    process.exit(1);
  });

