/**
 * Smoke test: residents by-area export API (admin + manager)
 * Run: node scripts/smoke-resident-export.js
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api';

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login ${email}: ${body.message}`);
  const token = body.token || body.data?.token;
  if (!token) throw new Error(`Login ${email}: no token`);
  return token;
}

async function api(method, path, token, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function getFirstBuildingId(token) {
  const res = await api('GET', '/facilities/buildings?activeOnly=true', token);
  if (res.status !== 200) throw new Error(`Buildings list failed: ${res.status}`);
  const buildings = res.body?.data || res.body || [];
  const first = Array.isArray(buildings) ? buildings[0] : null;
  if (!first?._id) throw new Error('No building found for by-area export test');
  return first._id;
}

async function main() {
  const adminToken = await login('admin@test.com', 'password123');
  const managerToken = await login('manager@test.com', 'password123');
  const buildingId = await getFirstBuildingId(adminToken);

  const adminByArea = await api(
    'GET',
    `/residents/by-area?buildingId=${buildingId}&status=admitted&limit=100&page=1`,
    adminToken
  );
  if (adminByArea.status !== 200) throw new Error(`Admin by-area failed: ${adminByArea.status}`);
  if (!Array.isArray(adminByArea.body?.data)) throw new Error('Admin by-area missing data array');
  console.log('PASS admin GET /residents/by-area', adminByArea.body.total, 'total');

  const managerByArea = await api(
    'GET',
    `/residents/by-area?buildingId=${buildingId}&status=admitted&limit=100&page=1`,
    managerToken
  );
  if (managerByArea.status !== 200) throw new Error(`Manager by-area failed: ${managerByArea.status}`);
  console.log('PASS manager GET /residents/by-area', managerByArea.body.total, 'total');

  const managerPost = await api(
    'POST',
    '/admin/residents',
    managerToken,
    { fullName: 'Should Fail' }
  );
  if (managerPost.status !== 403) {
    throw new Error(`Expected manager POST 403, got ${managerPost.status}`);
  }
  console.log('PASS manager POST /admin/residents blocked (403)');

  console.log('\nAll smoke-resident-export checks passed.');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
