/**
 * SafeStreets Mumbai - Moderator Authentication & Token Management
 */

const crypto = require('node:crypto');
const { getDb } = require('./db.js');

// In-memory cache for fast session verification
const activeSessions = new Map();

/**
 * Timing-safe string comparison to prevent side-channel timing attacks
 */
function safeCompare(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  const hashInput = crypto.createHash('sha256').update(input).digest();
  const hashExpected = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashInput, hashExpected);
}

/**
 * Authenticate moderator credentials and issue a secure bearer token.
 */
function loginModerator(username, password) {
  const isProduction = process.env.NODE_ENV === 'production';
  const expectedUser = process.env.MOD_USER || 'moderator';
  const expectedPass = process.env.MOD_PASSWORD || (isProduction ? null : 'safestreets2026');

  if (!expectedPass) {
    console.error('[SafeStreets Auth] Error: MOD_PASSWORD environment variable must be set in production');
    return { success: false, error: 'Moderator authentication misconfigured in production' };
  }

  if (safeCompare(username, expectedUser) && safeCompare(password, expectedPass)) {
    const token = 'mod_' + crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    const now = new Date().toISOString();

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO sessions (token, username, role, expires_at, created_at)
        VALUES (?, ?, 'moderator', ?, ?)
      `).run(token, username, expiresAt, now);
    } catch (e) {
      console.warn('[SafeStreets Auth] Could not persist session to DB:', e.message);
    }

    activeSessions.set(token, {
      username,
      role: 'moderator',
      expiresAt
    });

    return { success: true, token, expiresAt, username };
  }

  return { success: false, error: 'Invalid moderator credentials' };
}

/**
 * Validates a bearer token against in-memory cache and persistent database.
 */
function verifySession(token) {
  if (!token) return null;
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) return null;

  // 1. Check in-memory cache
  const cached = activeSessions.get(cleanToken);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      activeSessions.delete(cleanToken);
      try {
        getDb().prepare('DELETE FROM sessions WHERE token = ?').run(cleanToken);
      } catch {}
      return null;
    }
    return cached;
  }

  // 2. Check persistent database
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(cleanToken);
    if (!row) return null;

    if (Date.now() > row.expires_at) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(cleanToken);
      return null;
    }

    const session = {
      username: row.username,
      role: row.role,
      expiresAt: row.expires_at
    };
    activeSessions.set(cleanToken, session);
    return session;
  } catch (err) {
    return null;
  }
}

/**
 * Invalidates and removes a session.
 */
function logoutModerator(token) {
  if (!token) return;
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  activeSessions.delete(cleanToken);
  try {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(cleanToken);
  } catch {}
}

/**
 * Generates an anonymous access token for a review contributor (e.g. sst-anon-...)
 */
function generateAnonymousToken() {
  return 'sst-anon-' + crypto.randomBytes(16).toString('hex');
}

module.exports = {
  loginModerator,
  verifySession,
  logoutModerator,
  generateAnonymousToken,
  safeCompare
};
