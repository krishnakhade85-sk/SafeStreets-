/**
 * SafeStreets Mumbai - Moderator Authentication & Token Management
 */

const crypto = require('node:crypto');

// In-memory active session tokens for moderators: token -> { user, expiresAt }
const activeSessions = new Map();

const MOD_CREDENTIALS = {
  username: process.env.MOD_USER || 'moderator',
  password: process.env.MOD_PASSWORD || 'safestreets2026'
};

/**
 * Authenticate moderator credentials and issue a secure bearer token.
 */
function loginModerator(username, password) {
  if (username === MOD_CREDENTIALS.username && password === MOD_CREDENTIALS.password) {
    const token = 'mod_' + crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
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
 * Validates a bearer token.
 */
function verifySession(token) {
  if (!token) return null;
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  const session = activeSessions.get(cleanToken);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(cleanToken);
    return null;
  }

  return session;
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
  generateAnonymousToken
};
