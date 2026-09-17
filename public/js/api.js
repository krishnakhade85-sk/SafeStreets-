/**
 * SafeStreets Mumbai - API Client Wrapper
 */

// Cloud-aware dynamic API Base (Render, Railway, Fly.io, Cloud Run, or same-origin)
const API_BASE = (typeof window !== 'undefined' && window.SAFE_STREETS_CONFIG && window.SAFE_STREETS_CONFIG.API_BASE)
  || (typeof localStorage !== 'undefined' && localStorage.getItem('safestreets_cloud_api'))
  || '';

const API = {
  // Stats
  async getStats() {
    const res = await fetch(`${API_BASE}/api/stats`);
    return res.json();
  },

  // Locations & Exploration
  async getLocations(filter = 'all', search = '') {
    const params = new URLSearchParams();
    if (filter && filter !== 'all') params.set('filter', filter);
    if (search) params.set('search', search);
    const res = await fetch(`${API_BASE}/api/locations?${params.toString()}`);
    return res.json();
  },

  async getLocationDetails(id, timeOfDay = 'all') {
    const params = new URLSearchParams();
    if (timeOfDay && timeOfDay !== 'all') params.set('time_of_day', timeOfDay);
    const res = await fetch(`${API_BASE}/api/locations/${id}?${params.toString()}`);
    return res.json();
  },

  // Route Comparison
  async compareRoutes(origin, destination, timeOfDay, travelMode) {
    const res = await fetch(`${API_BASE}/api/routes/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination, time_of_day: timeOfDay, travel_mode: travelMode })
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`API returned HTTP ${res.status}: ${res.statusText || 'Unable to compute route'}`);
    }
    if (!res.ok) {
      throw new Error(json.error || `HTTP ${res.status}: Failed to calculate route comparison`);
    }
    return json;
  },

  // Submit Anonymous Review
  async submitReview(reviewData) {
    const res = await fetch(`${API_BASE}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewData)
    });
    return res.json();
  },

  // Contributor Lookup & Self-Deletion via Anonymous Token
  async getMyReview(token) {
    const res = await fetch(`${API_BASE}/api/my-review/${encodeURIComponent(token)}`);
    return res.json();
  },

  async deleteMyReview(token) {
    const res = await fetch(`${API_BASE}/api/my-review/${encodeURIComponent(token)}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  // Report Inaccurate / Harmful Content
  async submitFlag(flagData) {
    const res = await fetch(`${API_BASE}/api/flags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flagData)
    });
    return res.json();
  },

  // Settings & Helplines
  async getSettings() {
    const res = await fetch(`${API_BASE}/api/settings`);
    return res.json();
  },

  // Moderator Auth & Endpoints
  async modLogin(username, password) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return res.json();
  },

  async modLogout(token) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    } catch {
      return { success: true };
    }
  },

  async getModPending(token) {
    const res = await fetch(`${API_BASE}/api/mod/pending`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  async takeModAction(token, actionData) {
    const res = await fetch(`${API_BASE}/api/mod/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(actionData)
    });
    return res.json();
  },

  async getModFlags(token) {
    const res = await fetch(`${API_BASE}/api/mod/flags`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  async resolveModFlag(token, flagId) {
    const res = await fetch(`${API_BASE}/api/mod/flags/${flagId}/resolve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  async getModAudit(token) {
    const res = await fetch(`${API_BASE}/api/mod/audit`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  async updateAdminSettings(token, settingsObj) {
    const res = await fetch(`${API_BASE}/api/admin/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(settingsObj)
    });
    return res.json();
  }
};

window.SafeStreetsAPI = API;
