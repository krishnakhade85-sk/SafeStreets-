/**
 * SafeStreets Mumbai - Main Application HTTP Server & REST API
 * 
 * Built with native Node.js v24 modules (node:http, node:sqlite, node:crypto, node:fs, node:path)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getDb, recalculateLocation, recalculateAllLocations } = require('./db.js');
const { scanAndRedact } = require('./moderation.js');
const { compareRoutes } = require('./routes.js');
const { loginModerator, verifySession, logoutModerator, generateAnonymousToken } = require('./auth.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Sliding window rate limiter for security & abuse prevention
const rateLimitStores = {
  login: new Map(),
  reviews: new Map(),
  flags: new Map()
};

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
}

function checkRateLimit(type, clientIp, limit, windowMs) {
  const now = Date.now();
  const store = rateLimitStores[type];
  if (!store) return true;

  let record = store.get(clientIp);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    store.set(clientIp, record);
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

// JSON helper
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  res.end(JSON.stringify(data));
}

// Request body reader
function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) { // 2MB max
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        resolve(json);
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Check moderator authorization
function requireModerator(req, res) {
  const authHeader = req.headers['authorization'];
  const session = verifySession(authHeader);
  if (!session) {
    sendJson(res, 401, { error: 'Unauthorized: Moderator access required' });
    return null;
  }
  return session;
}

async function handleRequest(req, res) {
  let parsedUrl;
  let pathname = '/';
  try {
    const rawUrl = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url || '/';
    parsedUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    pathname = parsedUrl.pathname;
  } catch {
    pathname = req.url || '/';
  }

  // Handle Vercel wildcard rewrite where req.query.path contains the subpaths
  if (req.query && req.query.path) {
    const sub = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    pathname = '/api/' + sub;
  }

  const getParam = (key) => {
    if (parsedUrl && parsedUrl.searchParams && parsedUrl.searchParams.has(key)) {
      return parsedUrl.searchParams.get(key);
    }
    if (req.query && req.query[key]) return req.query[key];
    return null;
  };

  const method = req.method.toUpperCase();
  const clientIp = getClientIp(req);

  // Safe CORS support with configurable allowed origins
  const origin = req.headers['origin'];
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedOrigins.length > 0) {
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const db = getDb();

    // ==========================================
    // API ENDPOINTS
    // ==========================================

    // 1. GET /api/stats
    if (method === 'GET' && pathname === '/api/stats') {
      const locStats = db.prepare('SELECT COUNT(*) as total_locations FROM locations').get();
      const revStats = db.prepare(`
        SELECT 
          COUNT(*) as total_reviews,
          SUM(CASE WHEN moderation_status = 'approved' THEN 1 ELSE 0 END) as approved_reviews,
          SUM(CASE WHEN moderation_status = 'pending' THEN 1 ELSE 0 END) as pending_reviews
        FROM reviews
      `).get();
      const avgConfidence = db.prepare('SELECT AVG(confidence_score) as avg_conf FROM locations WHERE review_count > 0').get();

      return sendJson(res, 200, {
        locationsCovered: locStats.total_locations,
        totalReviews: revStats.total_reviews,
        approvedReviews: revStats.approved_reviews,
        pendingReviews: revStats.pending_reviews,
        avgConfidence: Math.round(avgConfidence.avg_conf || 85),
        city: 'Mumbai',
        activeCorridors: ['Western Line', 'Central Line', 'Metro Line 1', 'BKC Hub', 'South Mumbai Heritage']
      });
    }

    // 2. GET /api/locations
    if (method === 'GET' && pathname === '/api/locations') {
      const filter = getParam('filter') || 'all';
      const search = (getParam('search') || '').trim().toLowerCase();

      let query = 'SELECT * FROM locations';
      const params = [];
      const conditions = [];

      if (search) {
        conditions.push('(LOWER(name) LIKE ? OR LOWER(address_hint) LIKE ? OR LOWER(zone) LIKE ?)');
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      if (filter === 'near_transit') {
        conditions.push("category = 'transit_station' OR category = 'skywalk'");
      } else if (filter === 'good_lighting') {
        conditions.push('lighting_score >= 4.0');
      } else if (filter === 'busy_area') {
        conditions.push('crowd_score >= 4.0');
      } else if (filter === 'low_visibility') {
        conditions.push('lighting_score <= 3.2');
      } else if (filter === 'harassment_concern') {
        conditions.push("(community_signal = 'avoid_alone' OR community_signal = 'use_caution')");
      } else if (['after_dark', 'evening', 'morning', 'afternoon'].includes(filter)) {
        conditions.push(`id IN (
          SELECT DISTINCT location_id FROM reviews
          WHERE time_of_day = ? AND moderation_status = 'approved'
        )`);
        params.push(filter);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY name ASC';
      const locations = db.prepare(query).all(...params);

      // Add recent reviews summary to each location
      const getRecentAdvice = db.prepare(`
        SELECT advice, time_of_day, overall_feeling, created_at 
        FROM reviews 
        WHERE location_id = ? AND moderation_status = 'approved' AND advice IS NOT NULL AND advice != ''
        ORDER BY created_at DESC LIMIT 2
      `);

      const enriched = locations.map(loc => {
        const adviceItems = getRecentAdvice.all(loc.id);
        return {
          ...loc,
          recentAdvice: adviceItems
        };
      });

      return sendJson(res, 200, { locations: enriched, total: enriched.length });
    }

    // 3. GET /api/locations/:id
    const locationMatch = pathname.match(/^\/api\/locations\/(\d+)$/);
    if (method === 'GET' && locationMatch) {
      const locationId = parseInt(locationMatch[1], 10);
      const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId);

      if (!location) {
        return sendJson(res, 404, { error: 'Location not found' });
      }

      // Approved community reviews for this location
      const timeFilter = getParam('time_of_day');
      let revQuery = `
        SELECT id, date_of_experience, time_of_day, travel_mode,
               overall_feeling, redacted_text as experience_text, advice,
               lighting, foot_traffic, shops_open, transit_access,
               security_presence, road_condition, harassment_concern,
               stalking_concern, isolated_area, photo_url, created_at
        FROM reviews
        WHERE location_id = ? AND moderation_status = 'approved'
      `;
      const revParams = [locationId];
      if (timeFilter && timeFilter !== 'all') {
        revQuery += ' AND time_of_day = ?';
        revParams.push(timeFilter);
      }
      revQuery += ' ORDER BY created_at DESC';

      const reviews = db.prepare(revQuery).all(...revParams);

      // Structured observations stats
      const obsStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN lighting = 'well_lit' THEN 1 ELSE 0 END) as well_lit_count,
          SUM(CASE WHEN foot_traffic IN ('crowded', 'active') THEN 1 ELSE 0 END) as active_crowd_count,
          SUM(CASE WHEN shops_open IN ('many', 'some') THEN 1 ELSE 0 END) as active_shops_count,
          SUM(CASE WHEN transit_access IN ('direct', 'short_walk') THEN 1 ELSE 0 END) as good_transit_count,
          SUM(CASE WHEN security_presence IN ('police_booth', 'occasional_patrol', 'private_guards') THEN 1 ELSE 0 END) as security_count,
          SUM(harassment_concern) as harassment_reports,
          SUM(isolated_area) as isolated_reports
        FROM reviews
        WHERE location_id = ? AND moderation_status = 'approved'
      `).get(locationId);

      return sendJson(res, 200, {
        location,
        reviews,
        stats: obsStats
      });
    }

    // 4. POST /api/reviews (Submit anonymous review)
    if (method === 'POST' && pathname === '/api/reviews') {
      if (!checkRateLimit('reviews', clientIp, 15, 60 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Rate limit exceeded: Please wait before submitting more reviews.' });
      }

      const data = await parseJsonBody(req);

      if (!data.user_confirmed_no_pii) {
        return sendJson(res, 400, {
          error: 'You must confirm that this report does not contain names, phone numbers, addresses, or private details.'
        });
      }

      if (!data.location_id && !data.location_name) {
        return sendJson(res, 400, { error: 'A road, area, landmark, or station is required.' });
      }

      const rawText = String(data.experience_text || '').trim();
      const rawAdvice = String(data.advice || '').trim();

      if (rawText.length < 5 || rawText.length > 2500) {
        return sendJson(res, 400, { error: 'Observation text must be between 5 and 2500 characters.' });
      }

      if (rawAdvice.length > 500) {
        return sendJson(res, 400, { error: 'Advice must be under 500 characters.' });
      }

      // Validate enum fields
      const VALID_FEELINGS = ['comfortable', 'use_caution', 'avoid_alone'];
      const VALID_TIMES = ['morning', 'afternoon', 'evening', 'after_dark'];
      const VALID_MODES = ['walk', 'public_transit', 'cab_auto', 'bike'];
      const VALID_LIGHTINGS = ['well_lit', 'moderate', 'dim', 'pitch_dark'];
      const VALID_TRAFFIC = ['crowded', 'active', 'quiet', 'deserted'];
      const VALID_SHOPS = ['many', 'some', 'few', 'none'];
      const VALID_TRANSIT = ['direct', 'short_walk', 'far', 'none'];
      const VALID_SECURITY = ['police_booth', 'occasional_patrol', 'private_guards', 'none'];
      const VALID_ROAD = ['wide_footpath', 'paved', 'broken', 'construction'];

      const feeling = VALID_FEELINGS.includes(data.overall_feeling) ? data.overall_feeling : 'comfortable';
      const timeOfDay = VALID_TIMES.includes(data.time_of_day) ? data.time_of_day : 'evening';
      const travelMode = VALID_MODES.includes(data.travel_mode) ? data.travel_mode : 'walk';
      const lighting = VALID_LIGHTINGS.includes(data.lighting) ? data.lighting : 'moderate';
      const footTraffic = VALID_TRAFFIC.includes(data.foot_traffic) ? data.foot_traffic : 'active';
      const shopsOpen = VALID_SHOPS.includes(data.shops_open) ? data.shops_open : 'some';
      const transitAccess = VALID_TRANSIT.includes(data.transit_access) ? data.transit_access : 'short_walk';
      const securityPresence = VALID_SECURITY.includes(data.security_presence) ? data.security_presence : 'occasional_patrol';
      const roadCondition = VALID_ROAD.includes(data.road_condition) ? data.road_condition : 'paved';

      // Validate optional photo
      let photoUrl = null;
      if (data.photo_url && typeof data.photo_url === 'string') {
        if ((data.photo_url.startsWith('data:image/') || data.photo_url.startsWith('https://')) && data.photo_url.length <= 1500000) {
          photoUrl = data.photo_url;
        }
      }

      // If location is a new name entered by user, insert into locations table
      let locId = data.location_id;
      if (!locId && data.location_name) {
        const cleanName = String(data.location_name).trim().slice(0, 150);
        const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const existing = db.prepare('SELECT id FROM locations WHERE slug = ?').get(slug);
        if (existing) {
          locId = existing.id;
        } else {
          const insertLoc = db.prepare(`
            INSERT INTO locations (
              slug, name, zone, category, lat, lng, address_hint,
              community_signal, confidence_score, review_count, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'comfortable', 20, 0, ?)
          `);
          const result = insertLoc.run(
            slug,
            cleanName,
            String(data.zone || 'Mumbai').slice(0, 50),
            String(data.category || 'arterial_road').slice(0, 50),
            Number(data.lat) || 19.0760,
            Number(data.lng) || 72.8777,
            String(data.address_hint || 'Community added location').slice(0, 150),
            new Date().toISOString()
          );
          locId = result.lastInsertRowid;
        }
      }

      // Anti-duplicate spam check (same text within 60s)
      const duplicateCheck = db.prepare(`
        SELECT id FROM reviews 
        WHERE location_id = ? AND experience_text = ? AND created_at >= datetime('now', '-60 seconds')
      `).get(locId, rawText);
      if (duplicateCheck) {
        return sendJson(res, 429, { error: 'Duplicate review detected. Please wait before submitting again.' });
      }

      // Perform server-side PII scan and auto-redaction
      const textScan = scanAndRedact(rawText);
      const adviceScan = scanAndRedact(rawAdvice);

      const allFlags = [...new Set([...textScan.detectedFlags, ...adviceScan.detectedFlags])];
      const hasPII = textScan.hasPII || adviceScan.hasPII;

      const anonymousToken = generateAnonymousToken();
      const now = new Date().toISOString();

      // All new reviews enter 'pending' moderation status
      const insertRev = db.prepare(`
        INSERT INTO reviews (
          location_id, anonymous_token, date_of_experience, time_of_day,
          travel_mode, overall_feeling, experience_text, redacted_text,
          advice, lighting, foot_traffic, shops_open, transit_access,
          security_presence, road_condition, harassment_concern,
          stalking_concern, isolated_area, photo_url, moderation_status,
          moderation_flags, rejection_reason, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?
        )
      `);

      const result = insertRev.run(
        locId,
        anonymousToken,
        data.date_of_experience || now.split('T')[0],
        timeOfDay,
        travelMode,
        feeling,
        rawText,
        textScan.redactedText,
        adviceScan.redactedText,
        lighting,
        footTraffic,
        shopsOpen,
        transitAccess,
        securityPresence,
        roadCondition,
        data.harassment_concern ? 1 : 0,
        data.stalking_concern ? 1 : 0,
        data.isolated_area ? 1 : 0,
        photoUrl,
        JSON.stringify(allFlags),
        now
      );

      return sendJson(res, 201, {
        success: true,
        reviewId: result.lastInsertRowid,
        anonymousToken,
        status: 'pending',
        hasPII,
        detectedFlags: allFlags,
        message: 'Thank you for helping keep Mumbai informed. Your review has entered the peer moderation queue to protect community privacy and accuracy before going public.'
      });
    }

    // 5. GET /api/my-review/:token (Lookup review anonymously)
    const myReviewMatch = pathname.match(/^\/api\/my-review\/([a-zA-Z0-9_-]+)$/);
    if (method === 'GET' && myReviewMatch) {
      const token = myReviewMatch[1];
      const review = db.prepare(`
        SELECT r.*, l.name as location_name 
        FROM reviews r 
        JOIN locations l ON r.location_id = l.id 
        WHERE r.anonymous_token = ?
      `).get(token);

      if (!review) {
        return sendJson(res, 404, { error: 'Review not found with this private token.' });
      }

      return sendJson(res, 200, {
        review: {
          id: review.id,
          locationName: review.location_name,
          dateOfExperience: review.date_of_experience,
          timeOfDay: review.time_of_day,
          travelMode: review.travel_mode,
          overallFeeling: review.overall_feeling,
          experienceText: review.redacted_text,
          advice: review.advice,
          moderationStatus: review.moderation_status,
          rejectionReason: review.rejection_reason,
          createdAt: review.created_at
        }
      });
    }

    // 6. DELETE /api/my-review/:token (Contributor deletes their own report)
    if (method === 'DELETE' && myReviewMatch) {
      const token = myReviewMatch[1];
      const review = db.prepare('SELECT id, location_id, moderation_status FROM reviews WHERE anonymous_token = ?').get(token);

      if (!review) {
        return sendJson(res, 404, { error: 'Review not found with this token.' });
      }

      db.prepare('DELETE FROM reviews WHERE id = ?').run(review.id);

      // If review was approved, recalculate location score
      if (review.moderation_status === 'approved') {
        recalculateLocation(db, review.location_id);
      }

      // Record in audit log
      db.prepare(`
        INSERT INTO audit_log (action, target_id, moderator, details, created_at)
        VALUES ('contributor_self_deleted', ?, 'anonymous_contributor', 'Review removed via private access link', ?)
      `).run(review.id, new Date().toISOString());

      return sendJson(res, 200, {
        success: true,
        message: 'Your report has been permanently deleted from SafeStreets Mumbai.'
      });
    }

    // 7. POST /api/routes/compare (Route comparison engine)
    if (method === 'POST' && pathname === '/api/routes/compare') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (parseErr) {
        return sendJson(res, 400, { error: 'Invalid JSON in request payload' });
      }

      const origin = (body.origin || body.from || body.starting_location || body.start || '').trim();
      const destination = (body.destination || body.to || body.end || '').trim();

      if (!origin || !destination) {
        return sendJson(res, 400, {
          error: 'Both starting location and destination are required.'
        });
      }

      if (origin.toLowerCase() === destination.toLowerCase()) {
        return sendJson(res, 400, {
          error: 'Starting location and destination cannot be the same place.'
        });
      }

      const timeInput = body.time_of_day || body.travel_time || body.travelTime || body.timeOfDay || body.time;
      const modeInput = body.travel_mode || body.travelMode || body.mode;

      try {
        const comparison = compareRoutes(origin, destination, timeInput, modeInput);
        return sendJson(res, 200, comparison);
      } catch (calcErr) {
        console.error('Route comparison calculation error:', calcErr);
        return sendJson(res, 400, {
          error: calcErr.message || 'Failed to calculate route comparison. Please try again.'
        });
      }
    }

    // 8. POST /api/flags (Report a review or content)
    // 8. POST /api/flags (Report a review or content)
    if (method === 'POST' && pathname === '/api/flags') {
      if (!checkRateLimit('flags', clientIp, 15, 60 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Rate limit exceeded: Please wait before submitting more reports.' });
      }

      const body = await parseJsonBody(req);
      if (!body.target_id || !body.reason) {
        return sendJson(res, 400, { error: 'Target ID and reason are required.' });
      }

      const VALID_FLAG_REASONS = ['pii_leak', 'private_residence', 'inaccurate', 'inappropriate', 'other'];
      const reason = VALID_FLAG_REASONS.includes(body.reason) ? body.reason : 'other';
      const details = String(body.details || '').slice(0, 1000);

      const insertFlag = db.prepare(`
        INSERT INTO flags (target_type, target_id, reason, details, status, created_at)
        VALUES (?, ?, ?, ?, 'open', ?)
      `);
      insertFlag.run(
        String(body.target_type || 'review').slice(0, 50),
        parseInt(body.target_id, 10) || 1,
        reason,
        details,
        new Date().toISOString()
      );

      return sendJson(res, 201, {
        success: true,
        message: 'Thank you for alerting our community moderators. This report has been flagged for prioritized verification.'
      });
    }

    // 9. POST /api/auth/login (Moderator login)
    if (method === 'POST' && pathname === '/api/auth/login') {
      if (!checkRateLimit('login', clientIp, 5, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many login attempts. Please wait 15 minutes before trying again.' });
      }

      const body = await parseJsonBody(req);
      const result = loginModerator(body.username, body.password);
      if (!result.success) {
        return sendJson(res, 401, { error: result.error });
      }
      return sendJson(res, 200, result);
    }

    // 9b. POST /api/auth/logout (Moderator logout)
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const authHeader = req.headers['authorization'];
      logoutModerator(authHeader);
      return sendJson(res, 200, { success: true, message: 'Logged out successfully' });
    }

    // 10. GET /api/mod/pending (List pending & escalated reviews for moderation)
    if (method === 'GET' && pathname === '/api/mod/pending') {
      const session = requireModerator(req, res);
      if (!session) return;

      const pending = db.prepare(`
        SELECT r.*, l.name as location_name 
        FROM reviews r 
        JOIN locations l ON r.location_id = l.id 
        WHERE r.moderation_status IN ('pending', 'escalated')
        ORDER BY CASE WHEN r.moderation_status = 'escalated' THEN 0 ELSE 1 END, r.created_at ASC
      `).all();

      return sendJson(res, 200, { pending, total: pending.length });
    }

    // 11. POST /api/mod/action (Approve, reject, edit/redact, escalate, or hide review)
    if (method === 'POST' && pathname === '/api/mod/action') {
      const session = requireModerator(req, res);
      if (!session) return;

      const body = await parseJsonBody(req);
      const { review_id, action, reason, redacted_text, advice } = body;

      const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(review_id);
      if (!review) {
        return sendJson(res, 404, { error: 'Review not found' });
      }

      const now = new Date().toISOString();

      if (action === 'approve') {
        db.prepare(`
          UPDATE reviews 
          SET moderation_status = 'approved', rejection_reason = NULL
          WHERE id = ?
        `).run(review_id);
        recalculateLocation(db, review.location_id);
      } else if (action === 'reject') {
        db.prepare(`
          UPDATE reviews 
          SET moderation_status = 'rejected', rejection_reason = ?
          WHERE id = ?
        `).run(reason || 'Violated privacy or submission guidelines', review_id);
        if (review.moderation_status === 'approved') {
          recalculateLocation(db, review.location_id);
        }
      } else if (action === 'edit_redact') {
        db.prepare(`
          UPDATE reviews 
          SET redacted_text = ?, advice = ?, moderation_status = 'approved', rejection_reason = NULL
          WHERE id = ?
        `).run(redacted_text || review.redacted_text, advice || review.advice, review_id);
        recalculateLocation(db, review.location_id);
      } else if (action === 'escalate') {
        db.prepare(`
          UPDATE reviews 
          SET moderation_status = 'escalated'
          WHERE id = ?
        `).run(review_id);
      } else if (action === 'hide') {
        db.prepare(`
          UPDATE reviews 
          SET moderation_status = 'hidden'
          WHERE id = ?
        `).run(review_id);
        recalculateLocation(db, review.location_id);
      } else {
        return sendJson(res, 400, { error: 'Invalid moderation action' });
      }

      // Record audit log
      db.prepare(`
        INSERT INTO audit_log (action, target_id, moderator, details, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        `mod_${action}`,
        review_id,
        session.username,
        `Action ${action} taken. Reason: ${reason || 'N/A'}`,
        now
      );

      return sendJson(res, 200, { success: true, action, review_id });
    }

    // 12. GET /api/mod/flags (List flagged reviews / content reports)
    if (method === 'GET' && pathname === '/api/mod/flags') {
      const session = requireModerator(req, res);
      if (!session) return;

      const flags = db.prepare(`
        SELECT f.*, r.redacted_text, r.moderation_status, l.name as location_name
        FROM flags f
        LEFT JOIN reviews r ON f.target_type = 'review' AND f.target_id = r.id
        LEFT JOIN locations l ON r.location_id = l.id
        ORDER BY f.created_at DESC
      `).all();

      return sendJson(res, 200, { flags, total: flags.length });
    }

    // 13. POST /api/mod/flags/:id/resolve
    const resolveFlagMatch = pathname.match(/^\/api\/mod\/flags\/(\d+)\/resolve$/);
    if (method === 'POST' && resolveFlagMatch) {
      const session = requireModerator(req, res);
      if (!session) return;

      const flagId = parseInt(resolveFlagMatch[1], 10);
      db.prepare("UPDATE flags SET status = 'resolved' WHERE id = ?").run(flagId);
      return sendJson(res, 200, { success: true, flagId });
    }

    // 14. GET /api/mod/audit (Audit log)
    if (method === 'GET' && pathname === '/api/mod/audit') {
      const session = requireModerator(req, res);
      if (!session) return;

      const logs = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50').all();
      return sendJson(res, 200, { auditLogs: logs });
    }

    // 15. GET /api/settings
    if (method === 'GET' && pathname === '/api/settings') {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const r of rows) {
        try {
          settings[r.key] = JSON.parse(r.value);
        } catch {
          settings[r.key] = r.value;
        }
      }
      return sendJson(res, 200, { settings });
    }

    // 16. POST /api/admin/settings (Update settings)
    if (method === 'POST' && pathname === '/api/admin/settings') {
      const session = requireModerator(req, res);
      if (!session) return;

      const body = await parseJsonBody(req);
      const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

      for (const [k, v] of Object.entries(body)) {
        const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        updateStmt.run(k, valStr);
      }

      db.prepare(`
        INSERT INTO audit_log (action, target_id, moderator, details, created_at)
        VALUES ('update_settings', NULL, ?, 'Admin modified system settings', ?)
      `).run(session.username, new Date().toISOString());

      return sendJson(res, 200, { success: true, message: 'Settings updated successfully' });
    }

    // ==========================================
    // STATIC ASSETS SERVING
    // ==========================================
    if (req.url.includes('..') || pathname.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    const resolvedPublic = path.resolve(PUBLIC_DIR);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(resolvedPublic + path.sep) && resolvedPath !== path.join(resolvedPublic, 'index.html')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Check file existence
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Fallback to index.html for client-side routing
        filePath = path.join(PUBLIC_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Server Error');
          return;
        }

        res.writeHead(200, {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN'
        });
        res.end(content);
      });
    });

  } catch (serverErr) {
    console.error('Server error:', serverErr);
    sendJson(res, 500, { error: 'Internal Server Error', message: serverErr.message });
  }
}

const server = http.createServer(handleRequest);

const HOST = process.env.HOST || '0.0.0.0';

function startServer(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`[SafeStreets Mumbai] Server active and listening on ${host}:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer,
  handleRequest
};
