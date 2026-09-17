/**
 * SafeStreets Mumbai - Moderator Dashboard & Queue Controller
 */

let modToken = sessionStorage.getItem('safestreets_mod_token') || null;
let currentPendingReviews = [];

function initModerator() {
  // Check if logged in
  if (modToken) {
    showDashboardView();
    loadPendingQueue();
  } else {
    showLoginView();
  }

  // Setup login form
  const loginForm = document.getElementById('mod-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleModLogin);
  }

  // Setup tabs
  document.querySelectorAll('.mod-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mod-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.mod-tab-pane').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      const pane = document.getElementById(`mod-tab-${target}`);
      if (pane) pane.style.display = 'block';

      if (target === 'pending') loadPendingQueue();
      else if (target === 'flags') loadFlagsQueue();
      else if (target === 'audit') loadAuditLog();
      else if (target === 'settings') loadModSettings();
    });
  });

  // Settings form
  const settingsForm = document.getElementById('mod-settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSaveSettings);
  }
}

async function handleModLogin(e) {
  e.preventDefault();
  const u = document.getElementById('mod-username')?.value?.trim();
  const p = document.getElementById('mod-password')?.value?.trim();
  const errEl = document.getElementById('mod-login-error');

  if (errEl) errEl.style.display = 'none';

  try {
    const res = await SafeStreetsAPI.modLogin(u, p);
    if (res.success && res.token) {
      modToken = res.token;
      sessionStorage.setItem('safestreets_mod_token', modToken);
      showDashboardView();
      loadPendingQueue();
      SafeStreetsApp.showToast('Moderator session verified');
    } else {
      if (errEl) {
        errEl.textContent = res.error || 'Invalid credentials';
        errEl.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Login error:', err);
    if (errEl) {
      errEl.textContent = 'Server connection error';
      errEl.style.display = 'block';
    }
  }
}

async function handleModLogout() {
  if (modToken) {
    try {
      await SafeStreetsAPI.modLogout(modToken);
    } catch (e) {
      console.warn('Logout API error:', e);
    }
  }
  modToken = null;
  sessionStorage.removeItem('safestreets_mod_token');
  showLoginView();
  SafeStreetsApp.showToast('Logged out of moderator portal');
}

function showLoginView() {
  const loginSection = document.getElementById('mod-login-section');
  const dashSection = document.getElementById('mod-dashboard-section');
  if (loginSection) loginSection.style.display = 'block';
  if (dashSection) dashSection.style.display = 'none';
}

function showDashboardView() {
  const loginSection = document.getElementById('mod-login-section');
  const dashSection = document.getElementById('mod-dashboard-section');
  if (loginSection) loginSection.style.display = 'none';
  if (dashSection) dashSection.style.display = 'block';
}

// 1. Pending Queue
async function loadPendingQueue() {
  const container = document.getElementById('mod-pending-list');
  const badge = document.getElementById('mod-pending-badge');
  if (!container) return;

  container.innerHTML = `<p style="padding: 2rem 0; color: var(--text-muted);">Loading pending moderation queue...</p>`;

  try {
    const data = await SafeStreetsAPI.getModPending(modToken);
    currentPendingReviews = data.pending || [];

    if (badge) badge.textContent = currentPendingReviews.length;

    if (currentPendingReviews.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem 1.5rem;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--signal-comfortable-bg); color: var(--signal-comfortable); display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
            ✓
          </div>
          <h3 style="color: var(--color-plum);">Moderation Queue Clear</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem;">
            All submitted Mumbai reports have been peer-reviewed and verified.
          </p>
        </div>
      `;
      return;
    }

    let html = '';
    currentPendingReviews.forEach(rev => {
      let flags = [];
      try { flags = JSON.parse(rev.moderation_flags || '[]'); } catch {}

      const hasPIIFlag = flags.length > 0;
      const flagsBadges = flags.map(f => `<span class="pii-tag">⚠ ${f.replace(/_/g, ' ')}</span>`).join(' ');

      html += `
        <div class="mod-review-card" id="mod-card-${rev.id}">
          <div class="mod-review-header">
            <div>
              <h4 style="font-size: 1.15rem; color: var(--color-plum);">${rev.location_name}</h4>
              <p style="font-size: 0.8rem; color: var(--text-muted);">
                Submitted: ${new Date(rev.created_at).toLocaleString('en-IN')} • Experience: ${rev.date_of_experience} (${rev.time_of_day})
              </p>
            </div>
            <span class="signal-badge ${rev.overall_feeling}">
              <span class="signal-dot"></span>
              ${rev.overall_feeling.replace('_', ' ')}
            </span>
          </div>

          ${hasPIIFlag ? `
            <div class="mod-pii-alert">
              <strong>Automated Risk Detection:</strong>
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-left: 0.5rem;">
                ${flagsBadges}
              </div>
            </div>
          ` : ''}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; background: var(--bg-app); padding: 1rem; border-radius: var(--radius-md);">
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 0.35rem;">
                Original Contributor Text:
              </div>
              <p style="font-size: 0.88rem; color: var(--text-main); line-height: 1.5;">${escapeHtml(rev.experience_text)}</p>
            </div>
            <div>
              <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--signal-comfortable-text); margin-bottom: 0.35rem;">
                Sanitized / Auto-Redacted Preview:
              </div>
              <p style="font-size: 0.88rem; color: var(--color-plum); font-weight: 600; line-height: 1.5;">${escapeHtml(rev.redacted_text)}</p>
            </div>
          </div>

          ${rev.advice ? `
            <div style="margin-bottom: 0.85rem; font-size: 0.88rem;">
              <strong>Community Advice:</strong> "${escapeHtml(rev.advice)}"
            </div>
          ` : ''}

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">
            <span>💡 Lighting: <strong>${rev.lighting}</strong></span>
            <span>👥 Crowd: <strong>${rev.foot_traffic}</strong></span>
            <span>🏪 Shops: <strong>${rev.shops_open}</strong></span>
            <span>🚆 Transport: <strong>${rev.transit_access}</strong></span>
            <span>👮 Police: <strong>${rev.security_presence}</strong></span>
            ${rev.harassment_concern ? '<span style="color: var(--signal-avoid); font-weight: 700;">⚠ Harassment Reported</span>' : ''}
            ${rev.isolated_area ? '<span style="color: var(--signal-caution); font-weight: 700;">⚠ Isolated Stretch</span>' : ''}
          </div>

          <div class="mod-actions-row">
            <button class="btn btn-primary btn-sm" onclick="SafeStreetsMod.approveReview(${rev.id})">
              ✓ Approve to Public Map
            </button>
            <button class="btn btn-outline btn-sm" onclick="SafeStreetsMod.openRedactModal(${rev.id})">
              ✎ Edit / Redact Further
            </button>
            <button class="btn btn-outline btn-sm" style="color: var(--signal-avoid); border-color: var(--signal-avoid-border);" onclick="SafeStreetsMod.rejectReview(${rev.id})">
              ✕ Reject Report
            </button>
            <button class="btn btn-outline btn-sm" onclick="SafeStreetsMod.escalateReview(${rev.id})">
              ⚑ Escalate
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

  } catch (err) {
    console.error('Load pending queue error:', err);
    container.innerHTML = `<div class="alert-box danger">Failed to fetch pending queue: ${err.message}</div>`;
  }
}

// Moderation Actions
async function approveReview(reviewId) {
  try {
    const res = await SafeStreetsAPI.takeModAction(modToken, {
      review_id: reviewId,
      action: 'approve'
    });
    if (res.success) {
      SafeStreetsApp.showToast(`Review #${reviewId} approved and published`);
      loadPendingQueue();
      // Reload map if active
      if (window.SafeStreetsMap) SafeStreetsMap.loadMapLocations();
    }
  } catch (err) {
    SafeStreetsApp.showToast('Action failed: ' + err.message);
  }
}

async function rejectReview(reviewId) {
  const reason = prompt(
    'Enter rejection reason:\n1. PII or identifying details\n2. Private residence / not public area\n3. Inappropriate language or spam\n4. Other',
    'Contains private residence or identifying details'
  );
  if (reason === null) return; // cancelled

  try {
    const res = await SafeStreetsAPI.takeModAction(modToken, {
      review_id: reviewId,
      action: 'reject',
      reason
    });
    if (res.success) {
      SafeStreetsApp.showToast(`Review #${reviewId} rejected`);
      loadPendingQueue();
    }
  } catch (err) {
    SafeStreetsApp.showToast('Action failed: ' + err.message);
  }
}

function openRedactModal(reviewId) {
  const rev = currentPendingReviews.find(r => r.id === reviewId);
  if (!rev) return;

  const newText = prompt('Adjust sanitized review text before approving:', rev.redacted_text);
  if (newText === null) return;

  const newAdvice = prompt('Adjust community advice if needed:', rev.advice || '');
  if (newAdvice === null) return;

  SafeStreetsAPI.takeModAction(modToken, {
    review_id: reviewId,
    action: 'edit_redact',
    redacted_text: newText,
    advice: newAdvice
  }).then(res => {
    if (res.success) {
      SafeStreetsApp.showToast(`Review #${reviewId} redacted and approved`);
      loadPendingQueue();
      if (window.SafeStreetsMap) SafeStreetsMap.loadMapLocations();
    }
  });
}

async function escalateReview(reviewId) {
  const reason = prompt('Enter escalation reason or context for senior moderation:', 'Requires supervisor verification');
  if (reason === null) return;

  try {
    const res = await SafeStreetsAPI.takeModAction(modToken, {
      review_id: reviewId,
      action: 'escalate',
      reason
    });
    if (res.success) {
      SafeStreetsApp.showToast(`Review #${reviewId} escalated for senior verification`);
      loadPendingQueue();
    } else {
      SafeStreetsApp.showToast(res.error || 'Failed to escalate review');
    }
  } catch (err) {
    SafeStreetsApp.showToast('Escalation failed: ' + err.message);
  }
}

// 2. Flags Queue
async function loadFlagsQueue() {
  const container = document.getElementById('mod-flags-list');
  if (!container) return;

  container.innerHTML = '<p style="padding: 2rem 0; color: var(--text-muted);">Loading reported content...</p>';

  try {
    const data = await SafeStreetsAPI.getModFlags(modToken);
    const flags = data.flags || [];

    if (flags.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 2.5rem 1.5rem;">
          <h3 style="color: var(--color-plum);">No Community Content Reports</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem;">
            No reviews or locations have been flagged by users.
          </p>
        </div>
      `;
      return;
    }

    let html = '';
    flags.forEach(f => {
      html += `
        <div class="card" style="margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <div>
              <h4 style="color: var(--color-plum);">Report on ${f.target_type} #${f.target_id}</h4>
              <p style="font-size: 0.8rem; color: var(--text-muted);">
                Reason: <strong>${f.reason}</strong> • Status: <span style="font-weight: 700; color: ${f.status === 'open' ? 'var(--signal-avoid)' : 'var(--signal-comfortable)'};">${f.status.toUpperCase()}</span>
              </p>
            </div>
            ${f.status === 'open' ? `
              <button class="btn btn-outline btn-sm" onclick="SafeStreetsMod.resolveFlag(${f.id})">
                Mark Resolved
              </button>
            ` : ''}
          </div>
          <p style="font-size: 0.88rem; color: var(--text-main); margin-bottom: 0.5rem;">
            Details: "${escapeHtml(f.details || 'No additional details')}"
          </p>
          ${f.redacted_text ? `
            <div style="font-size: 0.82rem; background: var(--bg-app); padding: 0.6rem; border-radius: var(--radius-sm); color: var(--text-muted);">
              Associated Review Content: "${escapeHtml(f.redacted_text)}" (${f.location_name || 'Location'})
            </div>
          ` : ''}
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="alert-box danger">Failed to load flags: ${err.message}</div>`;
  }
}

async function resolveFlag(flagId) {
  try {
    const res = await SafeStreetsAPI.resolveModFlag(modToken, flagId);
    if (res.success) {
      SafeStreetsApp.showToast(`Flag #${flagId} marked as resolved`);
      loadFlagsQueue();
    }
  } catch (err) {
    SafeStreetsApp.showToast('Failed to resolve flag');
  }
}

// 3. Audit Log
async function loadAuditLog() {
  const container = document.getElementById('mod-audit-list');
  if (!container) return;

  container.innerHTML = '<p style="padding: 2rem 0; color: var(--text-muted);">Loading audit log...</p>';

  try {
    const data = await SafeStreetsAPI.getModAudit(modToken);
    const logs = data.auditLogs || [];

    if (logs.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted);">No audit log events recorded yet.</p>';
      return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">';
    html += `
      <thead>
        <tr style="border-bottom: 2px solid var(--border-medium); color: var(--color-plum);">
          <th style="padding: 0.6rem;">Time</th>
          <th style="padding: 0.6rem;">Action</th>
          <th style="padding: 0.6rem;">Target</th>
          <th style="padding: 0.6rem;">Moderator</th>
          <th style="padding: 0.6rem;">Details</th>
        </tr>
      </thead>
      <tbody>
    `;

    logs.forEach(l => {
      html += `
        <tr style="border-bottom: 1px solid var(--border-light);">
          <td style="padding: 0.6rem; white-space: nowrap; color: var(--text-muted);">${new Date(l.created_at).toLocaleString('en-IN')}</td>
          <td style="padding: 0.6rem; font-weight: 700;">${l.action}</td>
          <td style="padding: 0.6rem;">#${l.target_id || 'System'}</td>
          <td style="padding: 0.6rem;">${l.moderator}</td>
          <td style="padding: 0.6rem; color: var(--text-main);">${escapeHtml(l.details || '')}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="alert-box danger">Failed to load audit log: ${err.message}</div>`;
  }
}

// 4. Admin Settings
async function loadModSettings() {
  try {
    const data = await SafeStreetsAPI.getSettings();
    const s = data.settings || {};

    const autoHold = document.getElementById('setting-autohold');
    const minReviews = document.getElementById('setting-min-reviews');
    const cityName = document.getElementById('setting-city');

    if (autoHold) autoHold.checked = s.moderation_auto_hold_pii === 'true' || s.moderation_auto_hold_pii === true;
    if (minReviews) minReviews.value = s.min_reviews_for_signal || '2';
    if (cityName) cityName.value = s.city_name || 'Mumbai';
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const autoHold = document.getElementById('setting-autohold')?.checked;
  const minReviews = document.getElementById('setting-min-reviews')?.value;
  const cityName = document.getElementById('setting-city')?.value;

  try {
    const res = await SafeStreetsAPI.updateAdminSettings(modToken, {
      moderation_auto_hold_pii: String(autoHold),
      min_reviews_for_signal: String(minReviews),
      city_name: cityName
    });
    if (res.success) {
      SafeStreetsApp.showToast('System moderation settings updated');
    }
  } catch (err) {
    SafeStreetsApp.showToast('Failed to save settings: ' + err.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.SafeStreetsMod = {
  initModerator,
  handleModLogout,
  approveReview,
  rejectReview,
  openRedactModal,
  escalateReview,
  resolveFlag
};
