/**
 * SafeStreets Mumbai - Automated Backend Test Suite
 * Tests DB, PII Redaction, Route Engine, Moderation, and HTTP API Integration
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { getDb, recalculateLocation } = require('../server/db.js');
const { scanAndRedact } = require('../server/moderation.js');
const { compareRoutes } = require('../server/routes.js');
const { loginModerator, verifySession, generateAnonymousToken } = require('../server/auth.js');
const { startServer, server } = require('../server/server.js');

const TEST_PORT = 3199;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, raw: data, json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('SafeStreets Mumbai - Core Engine Tests', () => {

  describe('1. PII Detection & Auto-Redaction', () => {
    test('detects and redacts Indian phone numbers', () => {
      const input = 'Met a person with number 9820012345 near the stall, call +91 9876543210 for details.';
      const result = scanAndRedact(input);
      assert.strictEqual(result.hasPII, true);
      assert.ok(result.detectedFlags.includes('phone_number'));
      assert.ok(result.redactedText.includes('[REDACTED PHONE]'));
      assert.ok(!result.redactedText.includes('9820012345'));
    });

    test('detects and redacts emails', () => {
      const input = 'Send reports to community.helper@mumbai-safety.org please.';
      const result = scanAndRedact(input);
      assert.strictEqual(result.hasPII, true);
      assert.ok(result.detectedFlags.includes('email_address'));
      assert.ok(result.redactedText.includes('[REDACTED EMAIL]'));
      assert.ok(!result.redactedText.includes('community.helper@mumbai-safety.org'));
    });

    test('detects vehicle numbers', () => {
      const input = 'Auto with plate MH 02 AB 1234 was waiting at the corner.';
      const result = scanAndRedact(input);
      assert.strictEqual(result.hasPII, true);
      assert.ok(result.detectedFlags.includes('vehicle_number'));
      assert.ok(result.redactedText.includes('[REDACTED VEHICLE NO]'));
    });

    test('detects residential flat and apartment patterns', () => {
      const input = 'Near Flat 402, Sunshine Heights Bldg, lane is dim.';
      const result = scanAndRedact(input);
      assert.strictEqual(result.hasPII, true);
      assert.ok(result.detectedFlags.includes('residential_address'));
      assert.ok(result.redactedText.includes('[REDACTED ADDRESS]'));
    });

    test('passes clean community advice without PII', () => {
      const input = 'Street is well-lit with active fruit sellers until 10 PM. Prefer walking on the east side.';
      const result = scanAndRedact(input);
      assert.strictEqual(result.hasPII, false);
      assert.strictEqual(result.detectedFlags.length, 0);
      assert.strictEqual(result.redactedText, input);
    });
  });

  describe('2. Database & Aggregation Logic', () => {
    test('seeds 12 authentic Mumbai locations', () => {
      const db = getDb();
      const count = db.prepare('SELECT count(*) as count FROM locations').get().count;
      assert.ok(count >= 12);
    });

    test('seeds verified emergency contacts', () => {
      const db = getDb();
      const settings = db.prepare("SELECT value FROM settings WHERE key = 'emergency_contacts'").get();
      assert.ok(settings);
      const contacts = JSON.parse(settings.value);
      assert.ok(contacts.some(c => c.number === '103')); // Mumbai Women Helpline
      assert.ok(contacts.some(c => c.number === '112')); // National Emergency
      assert.ok(contacts.some(c => c.number === '1512')); // GRP Railway
    });

    test('recalculates aggregate scores cleanly', () => {
      const db = getDb();
      recalculateLocation(db, 1);
      const loc = db.prepare('SELECT * FROM locations WHERE id = 1').get();
      assert.ok(loc.review_count >= 0);
      assert.ok(loc.confidence_score >= 10);
      assert.ok(['comfortable', 'use_caution', 'avoid_alone'].includes(loc.community_signal));
    });
  });

  describe('3. Route Comparison Engine', () => {
    test('returns structured options for known corridor Dadar to Shivaji Park', () => {
      const result = compareRoutes('Dadar Station', 'Shivaji Park', 'after_dark', 'walk');
      assert.ok(result.routes.length >= 2);
      assert.strictEqual(result.timeOfDay, 'after_dark');
      assert.ok(result.disclaimer.includes('cannot guarantee safety'));
      const rec = result.routes.find(r => r.isRecommended);
      assert.ok(rec);
      assert.ok(rec.title.includes('Option 1'));
    });

    test('dynamically generates safe comparison for custom points', () => {
      const result = compareRoutes('Bandra Kurla Complex', 'Kurla Station', 'evening', 'cab_auto');
      assert.ok(result.routes.length >= 2);
      assert.ok(result.routes[0].travelMode === 'cab_auto');
    });
  });

  describe('4. Authentication & Anonymous Access', () => {
    test('moderator login with valid credentials', () => {
      const res = loginModerator('moderator', 'safestreets2026');
      assert.strictEqual(res.success, true);
      assert.ok(res.token.startsWith('mod_'));
      const session = verifySession(res.token);
      assert.strictEqual(session.username, 'moderator');
    });

    test('rejects invalid moderator login', () => {
      const res = loginModerator('moderator', 'wrongpassword');
      assert.strictEqual(res.success, false);
    });

    test('generates anonymous contributor token format', () => {
      const token = generateAnonymousToken();
      assert.ok(token.startsWith('sst-anon-'));
      assert.strictEqual(token.length, 41);
    });
  });

  describe('5. HTTP Server & API Integration Tests', () => {
    before(async () => {
      await startServer(TEST_PORT, '127.0.0.1');
    });

    after(() => {
      server.close();
    });

    let modAuthToken = '';
    let testAnonToken = '';
    let testReviewId = null;

    test('GET / returns HTML index with security headers', async () => {
      const res = await request('GET', '/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
    });

    test('Path traversal attempt is rejected with 403', async () => {
      const res = await request('GET', '/../../server/db.js');
      assert.strictEqual(res.status, 403);
    });

    test('GET /api/stats returns statistics', async () => {
      const res = await request('GET', '/api/stats');
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.locationsCovered >= 12);
      assert.ok(res.json.totalReviews >= 0);
    });

    test('GET /api/locations supports filter and search', async () => {
      const resAll = await request('GET', '/api/locations?filter=all');
      assert.strictEqual(resAll.status, 200);
      assert.ok(resAll.json.locations.length >= 12);

      const resSearch = await request('GET', '/api/locations?search=Dadar');
      assert.strictEqual(resSearch.status, 200);
      assert.ok(resSearch.json.locations.some(l => l.name.includes('Dadar')));
    });

    test('GET /api/locations/:id returns location details and review list', async () => {
      const res = await request('GET', '/api/locations/1');
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.location);
      assert.strictEqual(res.json.location.id, 1);
      assert.ok(Array.isArray(res.json.reviews));
    });

    test('POST /api/routes/compare computes comparison routes', async () => {
      const res = await request('POST', '/api/routes/compare', {
        origin: 'Dadar Station',
        destination: 'Shivaji Park',
        time_of_day: 'evening',
        travel_mode: 'walk'
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.routes.length >= 2);
    });

    test('POST /api/reviews rejects invalid short text', async () => {
      const res = await request('POST', '/api/reviews', {
        location_id: 1,
        experience_text: 'short'
      });
      assert.strictEqual(res.status, 400);
    });

    test('POST /api/reviews submits valid review and scans PII', async () => {
      const res = await request('POST', '/api/reviews', {
        location_id: 1,
        date_of_experience: '2026-09-17',
        time_of_day: 'after_dark',
        travel_mode: 'walk',
        overall_feeling: 'comfortable',
        experience_text: 'Test community report: well-lit road, phone 9820098200 was shown on shop sign.',
        advice: 'Walk along the main market area.',
        lighting: 'well_lit',
        foot_traffic: 'active',
        shops_open: 'some',
        transit_access: 'short_walk',
        security_presence: 'occasional_patrol',
        road_condition: 'paved',
        harassment_concern: false,
        stalking_concern: false,
        isolated_area: false,
        user_confirmed_no_pii: true
      });
      assert.strictEqual(res.status, 201);
      assert.ok(res.json.success);
      assert.ok(res.json.anonymousToken);
      assert.strictEqual(res.json.hasPII, true);
      assert.ok(res.json.detectedFlags.includes('phone_number'));
      testAnonToken = res.json.anonymousToken;
      testReviewId = res.json.reviewId;
    });

    test('GET /api/my-review/:token fetches submitted review', async () => {
      const res = await request('GET', `/api/my-review/${testAnonToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.review);
      assert.strictEqual(res.json.review.moderationStatus, 'pending');
      assert.ok(res.json.review.experienceText.includes('[REDACTED PHONE]'));
    });

    test('POST /api/flags submits a content report', async () => {
      const res = await request('POST', '/api/flags', {
        target_type: 'review',
        target_id: testReviewId,
        reason: 'pii_leak',
        details: 'Verifying automated flag report'
      });
      assert.strictEqual(res.status, 201);
      assert.ok(res.json.success);
    });

    test('POST /api/auth/login logs in moderator and provides bearer token', async () => {
      const res = await request('POST', '/api/auth/login', {
        username: 'moderator',
        password: 'safestreets2026'
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.token);
      modAuthToken = res.json.token;
    });

    test('GET /api/mod/pending lists pending reviews for authenticated moderator', async () => {
      const res = await request('GET', '/api/mod/pending', null, {
        Authorization: `Bearer ${modAuthToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.json.pending));
      assert.ok(res.json.pending.some(p => p.id === testReviewId));
    });

    test('POST /api/mod/action escalates review for supervisor', async () => {
      const res = await request('POST', '/api/mod/action', {
        review_id: testReviewId,
        action: 'escalate',
        reason: 'Check phone number redaction'
      }, {
        Authorization: `Bearer ${modAuthToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.success);
    });

    test('POST /api/mod/action approves review to public map', async () => {
      const res = await request('POST', '/api/mod/action', {
        review_id: testReviewId,
        action: 'approve'
      }, {
        Authorization: `Bearer ${modAuthToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.success);
    });

    test('DELETE /api/my-review/:token allows contributor to withdraw review', async () => {
      const res = await request('DELETE', `/api/my-review/${testAnonToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.success);
    });

    test('POST /api/auth/logout invalidates session', async () => {
      const res = await request('POST', '/api/auth/logout', null, {
        Authorization: `Bearer ${modAuthToken}`
      });
      assert.strictEqual(res.status, 200);

      // Subsequent access with old token is rejected
      const resCheck = await request('GET', '/api/mod/pending', null, {
        Authorization: `Bearer ${modAuthToken}`
      });
      assert.strictEqual(resCheck.status, 401);
    });
  });
});
