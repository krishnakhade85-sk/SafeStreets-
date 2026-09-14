/**
 * SafeStreets Mumbai - Automated Backend Test Suite
 * Tests DB, PII Redaction, Route Engine, and Moderation
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { getDb, recalculateLocation } = require('../server/db.js');
const { scanAndRedact } = require('../server/moderation.js');
const { compareRoutes } = require('../server/routes.js');
const { loginModerator, verifySession, generateAnonymousToken } = require('../server/auth.js');
const { startServer, server } = require('../server/server.js');

const TEST_PORT = 3099;

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
});
