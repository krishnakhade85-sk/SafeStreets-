/**
 * SafeStreets Mumbai - SQLite Database Module (using Node.js v24 native node:sqlite)
 */

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (sqliteErr) {
  console.warn('[SafeStreets] node:sqlite not available in this runtime:', sqliteErr.message);
  console.warn('[SafeStreets] Route comparison for known corridors will still work. DB-dependent features will be degraded.');
}
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, '..', 'safestreets.db');

let dbInstance = null;

function getDb() {
  if (!DatabaseSync) {
    // node:sqlite not available in this runtime (e.g. Vercel running older Node)
    // Known-corridor route comparison works without DB; DB-backed features degrade gracefully.
    return null;
  }
  if (!dbInstance) {
    let targetPath = DB_PATH;
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (isServerless) {
      const tmpPath = path.join('/tmp', 'safestreets.db');
      try {
        if (!fs.existsSync(tmpPath) && fs.existsSync(DB_PATH)) {
          fs.copyFileSync(DB_PATH, tmpPath);
        }
        targetPath = tmpPath;
      } catch (copyErr) {
        console.warn('Could not copy db to /tmp, falling back to source path:', copyErr.message);
      }
    }
    dbInstance = new DatabaseSync(targetPath);
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db) {
  // SQLite PRAGMAs for concurrency, foreign keys, and reliability
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  } catch (pragmaErr) {
    console.warn('PRAGMA configuration note:', pragmaErr.message);
  }

  // 1. Locations Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      zone TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      address_hint TEXT,
      community_signal TEXT DEFAULT 'comfortable',
      confidence_score INTEGER DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      lighting_score REAL DEFAULT 4.0,
      crowd_score REAL DEFAULT 4.0,
      transit_access_score REAL DEFAULT 4.5,
      last_updated TEXT
    );
  `);

  // 2. Reviews Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      anonymous_token TEXT UNIQUE NOT NULL,
      date_of_experience TEXT NOT NULL,
      time_of_day TEXT NOT NULL,
      travel_mode TEXT NOT NULL,
      overall_feeling TEXT NOT NULL,
      experience_text TEXT NOT NULL,
      redacted_text TEXT NOT NULL,
      advice TEXT,
      lighting TEXT NOT NULL,
      foot_traffic TEXT NOT NULL,
      shops_open TEXT NOT NULL,
      transit_access TEXT NOT NULL,
      security_presence TEXT NOT NULL,
      road_condition TEXT NOT NULL,
      harassment_concern INTEGER DEFAULT 0,
      stalking_concern INTEGER DEFAULT 0,
      isolated_area INTEGER DEFAULT 0,
      photo_url TEXT,
      moderation_status TEXT DEFAULT 'pending',
      moderation_flags TEXT DEFAULT '[]',
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );
  `);

  // 3. Flags & Content Reports Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT NOT NULL
    );
  `);

  // 4. Audit Log Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_id INTEGER,
      moderator TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 5. App Settings Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 6. Persistent Moderator Sessions Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'moderator',
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 7. Performance & Integrity Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reviews_loc_status ON reviews(location_id, moderation_status);
    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(moderation_status);
    CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at);
    CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // Seed default settings if not exists
  const checkSettings = db.prepare('SELECT COUNT(*) as count FROM settings').get();
  if (checkSettings.count === 0) {
    const defaultSettings = [
      ['moderation_auto_hold_pii', 'true'],
      ['min_reviews_for_signal', '2'],
      ['city_name', 'Mumbai'],
      ['emergency_contacts', JSON.stringify([
        { id: 'police_women', name: 'Mumbai Police Women Helpline', number: '103', verified: true, desc: 'Dedicated 24/7 helpline for women in distress across Mumbai' },
        { id: 'national_emergency', name: 'National Emergency Helpline', number: '112', verified: true, desc: 'All-in-one emergency response for Police, Fire, and Ambulance' },
        { id: 'grp_railway', name: 'GRP Railway Police Helpline', number: '1512', verified: true, desc: 'Assistance for Mumbai Suburban Railway stations and trains' },
        { id: 'grp_whatsapp', name: 'Railway Police Helpline (WhatsApp)', number: '+919833312222', verified: true, desc: 'Quick WhatsApp SOS dispatch for suburban local train commuters' },
        { id: 'mumbai_police', name: 'Mumbai Police Control Room', number: '100', verified: true, desc: 'General police control dispatch across Greater Mumbai' },
        { id: 'ambulance', name: 'Medical Emergency (Ambulance)', number: '108', verified: true, desc: 'Free Government Emergency Medical & Ambulance Service' }
      ])]
    ];

    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of defaultSettings) {
      insertSetting.run(k, v);
    }
  }

  // Seed initial Mumbai locations & fictional demo reviews
  seedLocationsAndReviews(db);
}

function seedLocationsAndReviews(db) {
  const locCount = db.prepare('SELECT COUNT(*) as count FROM locations').get();
  if (locCount.count > 0) return; // already seeded

  const now = new Date().toISOString();

  // 12 Authentic Mumbai Hubs
  const seedLocations = [
    {
      slug: 'dadar-west-station',
      name: 'Dadar West Railway Station & Flower Market',
      zone: 'Central Mumbai',
      category: 'transit_station',
      lat: 19.0178,
      lng: 72.8427,
      address_hint: 'Senapati Bapat Marg, outside platform 1 & Flower Market',
      community_signal: 'comfortable',
      confidence_score: 92,
      lighting_score: 4.4,
      crowd_score: 4.8,
      transit_access_score: 5.0
    },
    {
      slug: 'bandra-linking-road',
      name: 'Bandra West - Linking Road & Patwardhan Park',
      zone: 'Western Suburbs',
      category: 'commercial_hub',
      lat: 19.0607,
      lng: 72.8362,
      address_hint: 'Linking Road between 24th and 33rd Road',
      community_signal: 'comfortable',
      confidence_score: 88,
      lighting_score: 4.5,
      crowd_score: 4.6,
      transit_access_score: 4.3
    },
    {
      slug: 'bkc-g-block',
      name: 'BKC G Block & Diamond Bourse Corridor',
      zone: 'Western Suburbs',
      category: 'commercial_hub',
      lat: 19.0657,
      lng: 72.8687,
      address_hint: 'Bandra-Kurla Complex avenue, near Asian Heart Hospital',
      community_signal: 'use_caution',
      confidence_score: 79,
      lighting_score: 4.1,
      crowd_score: 2.3, // very quiet after 9 PM
      transit_access_score: 3.2
    },
    {
      slug: 'andheri-east-station-road',
      name: 'Andheri East Station Road & Metro Interchange',
      zone: 'Western Suburbs',
      category: 'transit_station',
      lat: 19.1197,
      lng: 72.8464,
      address_hint: 'Outside Andheri East railway exit & Line 1 Metro entry',
      community_signal: 'use_caution',
      confidence_score: 84,
      lighting_score: 3.6,
      crowd_score: 4.9,
      transit_access_score: 5.0
    },
    {
      slug: 'lower-parel-skywalk',
      name: 'Lower Parel - Senapati Bapat Marg & Skywalk',
      zone: 'South Mumbai',
      category: 'skywalk',
      lat: 19.0016,
      lng: 72.8295,
      address_hint: 'Elevated pedestrian walkway between Lower Parel & Currey Road',
      community_signal: 'use_caution',
      confidence_score: 74,
      lighting_score: 3.1,
      crowd_score: 3.2,
      transit_access_score: 4.2
    },
    {
      slug: 'marine-drive-promenade',
      name: 'Marine Drive Promenade & Churchgate Subway',
      zone: 'South Mumbai',
      category: 'promenade',
      lat: 18.9322,
      lng: 72.8228,
      address_hint: 'Netaji Subhash Chandra Bose Road, facing Arabian Sea',
      community_signal: 'comfortable',
      confidence_score: 95,
      lighting_score: 4.8,
      crowd_score: 4.5,
      transit_access_score: 4.6
    },
    {
      slug: 'kurla-west-skywalk',
      name: 'Kurla West Railway Station & LBS Marg Underpass',
      zone: 'Central Mumbai',
      category: 'transit_station',
      lat: 19.0664,
      lng: 72.8793,
      address_hint: 'West exit bridge to Lal Bahadur Shastri Marg auto stand',
      community_signal: 'avoid_alone',
      confidence_score: 86,
      lighting_score: 2.2,
      crowd_score: 4.7,
      transit_access_score: 4.8
    },
    {
      slug: 'ghatkopar-metro-link',
      name: 'Ghatkopar Railway & Metro Line 1 Concourse',
      zone: 'Eastern Suburbs',
      category: 'transit_station',
      lat: 19.0864,
      lng: 72.9080,
      address_hint: 'Pedestrian skywalk connecting Central Railway and Line 1 Metro',
      community_signal: 'comfortable',
      confidence_score: 90,
      lighting_score: 4.6,
      crowd_score: 4.9,
      transit_access_score: 5.0
    },
    {
      slug: 'powai-hiranandani',
      name: 'Powai - Central Avenue & Galleria Market',
      zone: 'Eastern Suburbs',
      category: 'commercial_hub',
      lat: 19.1176,
      lng: 72.9130,
      address_hint: 'Central Avenue pedestrian boulevard, Hiranandani Gardens',
      community_signal: 'comfortable',
      confidence_score: 89,
      lighting_score: 4.7,
      crowd_score: 4.2,
      transit_access_score: 3.5
    },
    {
      slug: 'malad-mindspace-link',
      name: 'Malad West - Mindspace IT Corridor & Backroad',
      zone: 'Western Suburbs',
      category: 'arterial_road',
      lat: 19.1764,
      lng: 72.8360,
      address_hint: 'Link Road stretch near Inorbit Mall and Interface back lane',
      community_signal: 'use_caution',
      confidence_score: 81,
      lighting_score: 3.4,
      crowd_score: 2.8,
      transit_access_score: 3.8
    },
    {
      slug: 'vile-parle-subhash-road',
      name: 'Vile Parle East - Subhash Road & Station Approach',
      zone: 'Western Suburbs',
      category: 'residential_area',
      lat: 19.0995,
      lng: 72.8532,
      address_hint: 'Walkway connecting Western Express Highway and Station East',
      community_signal: 'comfortable',
      confidence_score: 83,
      lighting_score: 4.2,
      crowd_score: 3.9,
      transit_access_score: 4.5
    },
    {
      slug: 'churchgate-oval-maidan',
      name: 'Churchgate - Maharshi Karve Road & Oval Maidan Lane',
      zone: 'South Mumbai',
      category: 'arterial_road',
      lat: 18.9298,
      lng: 72.8290,
      address_hint: 'Heritage lane between Churchgate station and Bombay High Court',
      community_signal: 'comfortable',
      confidence_score: 85,
      lighting_score: 4.1,
      crowd_score: 3.6,
      transit_access_score: 4.9
    }
  ];

  const insertLoc = db.prepare(`
    INSERT INTO locations (
      slug, name, zone, category, lat, lng, address_hint,
      community_signal, confidence_score, review_count,
      lighting_score, crowd_score, transit_access_score, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const loc of seedLocations) {
    insertLoc.run(
      loc.slug, loc.name, loc.zone, loc.category, loc.lat, loc.lng, loc.address_hint,
      loc.community_signal, loc.confidence_score, 0,
      loc.lighting_score, loc.crowd_score, loc.transit_access_score, now
    );
  }

  // Realistic, respectful community demo reviews (clearly marked as demo seed)
  const seedReviews = [
    {
      loc_slug: 'dadar-west-station',
      token: 'demo-tok-dadar-01',
      date: '2026-09-10',
      time_of_day: 'evening',
      travel_mode: 'walk',
      overall_feeling: 'comfortable',
      experience_text: 'Very active street with vegetable and flower vendors. Bright municipal sodium lamps and constant passenger flow from platform 1.',
      advice: 'Stay on the shop-facing side of the road; the footpath is uneven near the bridge pillar but well populated.',
      lighting: 'well_lit',
      foot_traffic: 'crowded',
      shops_open: 'many',
      transit_access: 'direct',
      security_presence: 'police_booth',
      road_condition: 'paved',
      harassment: 0,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'dadar-west-station',
      token: 'demo-tok-dadar-02',
      date: '2026-09-08',
      time_of_day: 'after_dark',
      travel_mode: 'public_transit',
      overall_feeling: 'comfortable',
      experience_text: 'Took local train at 10:30 PM. Railway police women staff visible near the ticket counter. Shared auto queues are organized.',
      advice: 'Directly join the official prepaid or regulated auto queue right outside the station porch.',
      lighting: 'well_lit',
      foot_traffic: 'active',
      shops_open: 'some',
      transit_access: 'direct',
      security_presence: 'police_booth',
      road_condition: 'paved',
      harassment: 0,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'bkc-g-block',
      token: 'demo-tok-bkc-01',
      date: '2026-09-12',
      time_of_day: 'after_dark',
      travel_mode: 'walk',
      overall_feeling: 'use_caution',
      experience_text: 'Wide corporate avenue is very well-lit with modern LED street lamps, but by 9:30 PM pedestrian traffic drops sharply as offices shut. Hard to hail an auto off the street.',
      advice: 'Pre-book an app cab before leaving your office lobby rather than waiting on the open avenue.',
      lighting: 'well_lit',
      foot_traffic: 'quiet',
      shops_open: 'few',
      transit_access: 'far',
      security_presence: 'private_guards',
      road_condition: 'wide_footpath',
      harassment: 0,
      stalking: 0,
      isolated: 1
    },
    {
      loc_slug: 'kurla-west-skywalk',
      token: 'demo-tok-kurla-01',
      date: '2026-09-11',
      time_of_day: 'after_dark',
      travel_mode: 'walk',
      overall_feeling: 'avoid_alone',
      experience_text: 'Several overhead light fixtures on the middle section of the skywalk are out. Multiple loitering groups near the staircase landing and narrow blind spots.',
      advice: 'Prefer taking the ground-level station road exit along the main shopfronts or travel alongside fellow commuters.',
      lighting: 'dim',
      foot_traffic: 'active',
      shops_open: 'few',
      transit_access: 'direct',
      security_presence: 'none',
      road_condition: 'broken',
      harassment: 1,
      stalking: 0,
      isolated: 1
    },
    {
      loc_slug: 'marine-drive-promenade',
      token: 'demo-tok-marine-01',
      date: '2026-09-13',
      time_of_day: 'evening',
      travel_mode: 'walk',
      overall_feeling: 'comfortable',
      experience_text: 'Pleasant, open, brightly lit promenade with families, joggers, and constant beat marshal police patrols on motorbikes.',
      advice: 'Very comfortable walk from Churchgate station through the main avenue signal.',
      lighting: 'well_lit',
      foot_traffic: 'crowded',
      shops_open: 'many',
      transit_access: 'short_walk',
      security_presence: 'police_booth',
      road_condition: 'wide_footpath',
      harassment: 0,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'lower-parel-skywalk',
      token: 'demo-tok-lparel-01',
      date: '2026-09-09',
      time_of_day: 'after_dark',
      travel_mode: 'walk',
      overall_feeling: 'use_caution',
      experience_text: 'Convenient to skip road traffic, but the connection towards Currey Road is poorly lit after 9 PM and security guard booths are often unmanned.',
      advice: 'If walking past 9 PM, use the ground-level Senapati Bapat Marg where taxi stands and commercial restaurant lights remain active.',
      lighting: 'dim',
      foot_traffic: 'quiet',
      shops_open: 'none',
      transit_access: 'short_walk',
      security_presence: 'none',
      road_condition: 'paved',
      harassment: 0,
      stalking: 0,
      isolated: 1
    },
    {
      loc_slug: 'bandra-linking-road',
      token: 'demo-tok-bandra-01',
      date: '2026-09-12',
      time_of_day: 'evening',
      travel_mode: 'walk',
      overall_feeling: 'comfortable',
      experience_text: 'High vitality, bustling retail street with reliable lighting and numerous women shoppers and staff until 10 PM.',
      advice: 'Ample auto-rickshaws available along the main road. Side lanes near the park get quiet earlier.',
      lighting: 'well_lit',
      foot_traffic: 'crowded',
      shops_open: 'many',
      transit_access: 'short_walk',
      security_presence: 'occasional_patrol',
      road_condition: 'wide_footpath',
      harassment: 0,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'andheri-east-station-road',
      token: 'demo-tok-andheri-01',
      date: '2026-09-10',
      time_of_day: 'after_dark',
      travel_mode: 'public_transit',
      overall_feeling: 'use_caution',
      experience_text: 'Extremely crowded with buses and hawkers. Pavement is congested forcing pedestrians onto the road. Watch your belongings in the bottleneck near the ticket bridge.',
      advice: 'Take the elevated Metro concourse if you are transferring directly between Line 1 and Western Railway.',
      lighting: 'moderate',
      foot_traffic: 'crowded',
      shops_open: 'many',
      transit_access: 'direct',
      security_presence: 'occasional_patrol',
      road_condition: 'broken',
      harassment: 1,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'powai-hiranandani',
      token: 'demo-tok-powai-01',
      date: '2026-09-13',
      time_of_day: 'after_dark',
      travel_mode: 'walk',
      overall_feeling: 'comfortable',
      experience_text: 'Wide tree-lined European style walkways, excellent decorative and civic streetlighting, active cafes and security presence till late.',
      advice: 'One of the easiest walks in the central suburbs. Buses to Kanjurmarg stop right at the central circle.',
      lighting: 'well_lit',
      foot_traffic: 'active',
      shops_open: 'many',
      transit_access: 'short_walk',
      security_presence: 'private_guards',
      road_condition: 'wide_footpath',
      harassment: 0,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'ghatkopar-metro-link',
      token: 'demo-tok-ghatkopar-01',
      date: '2026-09-14',
      time_of_day: 'morning',
      travel_mode: 'public_transit',
      overall_feeling: 'comfortable',
      experience_text: 'Very seamless interchange with clean signages, female security staff at Metro bag scan, and CCTV surveillance throughout.',
      advice: 'The dedicated women’s compartment on the Metro is situated closest to the interchange escalator.',
      lighting: 'well_lit',
      foot_traffic: 'crowded',
      shops_open: 'many',
      transit_access: 'direct',
      security_presence: 'police_booth',
      road_condition: 'wide_footpath',
      harassment: 0,
      stalking: 0,
      isolated: 0
    },
    {
      loc_slug: 'malad-mindspace-link',
      token: 'demo-tok-malad-01',
      date: '2026-09-07',
      time_of_day: 'after_dark',
      travel_mode: 'cab_auto',
      overall_feeling: 'use_caution',
      experience_text: 'The main Link road is fine, but the back service lane behind the tech park has dim streetlights and long stretches of blank boundary walls.',
      advice: 'Ask your cab driver to drop you at the main gate rather than the back service gate after 8 PM.',
      lighting: 'dim',
      foot_traffic: 'quiet',
      shops_open: 'few',
      transit_access: 'short_walk',
      security_presence: 'private_guards',
      road_condition: 'paved',
      harassment: 0,
      stalking: 0,
      isolated: 1
    },
    {
      loc_slug: 'vile-parle-subhash-road',
      token: 'demo-tok-vileparle-01',
      date: '2026-09-11',
      time_of_day: 'evening',
      travel_mode: 'walk',
      overall_feeling: 'comfortable',
      experience_text: 'Pleasant residential neighborhood with local grocery stores, pharmacies, and regular commuter foot traffic from the station.',
      advice: 'The western end near the station gate has an active auto stand.',
      lighting: 'well_lit',
      foot_traffic: 'active',
      shops_open: 'many',
      transit_access: 'short_walk',
      security_presence: 'occasional_patrol',
      road_condition: 'paved',
      harassment: 0,
      stalking: 0,
      isolated: 0
    }
  ];

  const insertReview = db.prepare(`
    INSERT INTO reviews (
      location_id, anonymous_token, date_of_experience, time_of_day,
      travel_mode, overall_feeling, experience_text, redacted_text,
      advice, lighting, foot_traffic, shops_open, transit_access,
      security_presence, road_condition, harassment_concern,
      stalking_concern, isolated_area, photo_url, moderation_status,
      moderation_flags, rejection_reason, created_at
    ) VALUES (
      (SELECT id FROM locations WHERE slug = ?),
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'approved', '[]', NULL, ?
    )
  `);

  for (const rev of seedReviews) {
    insertReview.run(
      rev.loc_slug, rev.token, rev.date, rev.time_of_day,
      rev.travel_mode, rev.overall_feeling, rev.experience_text, rev.experience_text,
      rev.advice, rev.lighting, rev.foot_traffic, rev.shops_open, rev.transit_access,
      rev.security_presence, rev.road_condition, rev.harassment,
      rev.stalking, rev.isolated, now
    );
  }

  // Recalculate review counts and signals for all locations
  recalculateAllLocations(db);
}

/**
 * Recalculates aggregate score and community signal for a given location ID.
 * Follows the core rule: Never label an area permanently unsafe based on one review.
 * Aggregates recent reports and calculates confidence levels.
 */
function recalculateLocation(db, locationId) {
  const reviews = db.prepare(`
    SELECT * FROM reviews 
    WHERE location_id = ? AND moderation_status = 'approved'
    ORDER BY created_at DESC
  `).all(locationId);

  const count = reviews.length;
  if (count === 0) {
    db.prepare(`
      UPDATE locations 
      SET review_count = 0, confidence_score = 10, last_updated = ?
      WHERE id = ?
    `).run(new Date().toISOString(), locationId);
    return;
  }

  let feelScore = 0;
  let lightSum = 0;
  let crowdSum = 0;
  let transitSum = 0;
  let harassmentCount = 0;
  let isolatedCount = 0;

  for (const r of reviews) {
    if (r.overall_feeling === 'comfortable') feelScore += 1.0;
    else if (r.overall_feeling === 'use_caution') feelScore -= 0.4;
    else if (r.overall_feeling === 'avoid_alone') feelScore -= 1.2;

    if (r.lighting === 'well_lit') lightSum += 5;
    else if (r.lighting === 'moderate') lightSum += 3.5;
    else if (r.lighting === 'dim') lightSum += 2;
    else lightSum += 1;

    if (r.foot_traffic === 'crowded') crowdSum += 5;
    else if (r.foot_traffic === 'active') crowdSum += 4;
    else if (r.foot_traffic === 'quiet') crowdSum += 2.5;
    else crowdSum += 1;

    if (r.transit_access === 'direct') transitSum += 5;
    else if (r.transit_access === 'short_walk') transitSum += 4;
    else if (r.transit_access === 'far') transitSum += 2.5;
    else transitSum += 1;

    if (r.harassment_concern) harassmentCount++;
    if (r.isolated_area) isolatedCount++;
  }

  const avgFeel = feelScore / count;
  const avgLight = Number((lightSum / count).toFixed(1));
  const avgCrowd = Number((crowdSum / count).toFixed(1));
  const avgTransit = Number((transitSum / count).toFixed(1));

  // Determine signal with nuance
  let signal = 'comfortable';
  if (avgFeel < -0.6 || (harassmentCount >= 2 && count >= 3)) {
    signal = 'avoid_alone';
  } else if (avgFeel < 0.3 || isolatedCount >= Math.ceil(count * 0.4)) {
    signal = 'use_caution';
  } else {
    signal = 'comfortable';
  }

  // Confidence is higher with more recent reviews (up to 95%)
  const confidence = Math.min(95, Math.max(35, 40 + (count * 10)));

  db.prepare(`
    UPDATE locations 
    SET review_count = ?,
        community_signal = ?,
        confidence_score = ?,
        lighting_score = ?,
        crowd_score = ?,
        transit_access_score = ?,
        last_updated = ?
    WHERE id = ?
  `).run(
    count, signal, confidence,
    avgLight, avgCrowd, avgTransit,
    new Date().toISOString(), locationId
  );
}

function recalculateAllLocations(db) {
  const locs = db.prepare('SELECT id FROM locations').all();
  for (const loc of locs) {
    recalculateLocation(db, loc.id);
  }
}

module.exports = {
  getDb,
  recalculateLocation,
  recalculateAllLocations
};
