/**
 * SafeStreets Mumbai - Main Application Orchestrator & Router
 */

const SafeStreetsApp = {
  currentView: 'home',

  init() {
    // 1. Initialize submodules
    SafeStreetsI18n.applyTranslations();
    SafeStreetsMap.setupMapControls();
    SafeStreetsRoutePlanner.initRoutePlanner();
    SafeStreetsReview.initReviewForm();
    SafeStreetsEmergency.initEmergency();
    SafeStreetsMod.initModerator();

    // 2. Setup navigation links
    document.querySelectorAll('[data-navigate]').forEach(elem => {
      elem.addEventListener('click', (e) => {
        e.preventDefault();
        const view = elem.getAttribute('data-navigate');
        this.navigate(view);
      });
    });

    // 3. Language switcher
    const langSelect = document.getElementById('app-lang-select');
    if (langSelect) {
      langSelect.addEventListener('change', (e) => {
        SafeStreetsI18n.setLanguage(e.target.value);
      });
    }

    // 4. Load initial stats on home
    this.loadAppStats();

    // 5. Handle direct hash routing
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && ['home', 'map', 'route', 'review', 'guidelines', 'moderator'].includes(hash)) {
      this.navigate(hash);
    } else {
      this.navigate('home');
    }

    // 6. Setup report content form
    const flagForm = document.getElementById('report-content-form');
    if (flagForm) {
      flagForm.addEventListener('submit', this.handleReportContentSubmit.bind(this));
    }

    // 7. Setup token lookup form
    const tokenForm = document.getElementById('lookup-token-form');
    if (tokenForm) {
      tokenForm.addEventListener('submit', this.handleLookupToken.bind(this));
    }
  },

  navigate(viewName) {
    this.currentView = viewName;
    window.location.hash = viewName;

    // Toggle screen containers
    document.querySelectorAll('.screen-view').forEach(screen => {
      screen.style.display = 'none';
    });

    const targetScreen = document.getElementById(`screen-${viewName}`);
    if (targetScreen) {
      targetScreen.style.display = 'block';
    }

    // Update nav link active states
    document.querySelectorAll('[data-navigate]').forEach(link => {
      if (link.getAttribute('data-navigate') === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Specific screen initializers
    if (viewName === 'map') {
      setTimeout(() => {
        SafeStreetsMap.initMap();
        SafeStreetsMap.loadMapLocations();
      }, 100);
    } else if (viewName === 'route') {
      SafeStreetsRoutePlanner.executeRouteComparison();
    } else if (viewName === 'moderator') {
      SafeStreetsMod.initModerator();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async loadAppStats() {
    try {
      const stats = await SafeStreetsAPI.getStats();
      const numLocations = document.getElementById('stat-locations');
      const numReviews = document.getElementById('stat-reviews');
      const numConfidence = document.getElementById('stat-confidence');
      const numCorridors = document.getElementById('stat-corridors');

      if (numLocations) numLocations.textContent = stats.locationsCovered || '12';
      if (numReviews) numReviews.textContent = stats.approvedReviews || '24';
      if (numConfidence) numConfidence.textContent = `${stats.avgConfidence || 88}%`;
      if (numCorridors) numCorridors.textContent = (stats.activeCorridors?.length || 5);
    } catch (err) {
      console.warn('Could not fetch stats:', err);
    }
  },

  // Focus specific location on the interactive map
  focusLocationOnMap(locationId) {
    this.navigate('map');
    setTimeout(() => {
      if (window.SafeStreetsMap) {
        SafeStreetsMap.focusLocation(locationId);
      }
    }, 250);
  },

  // Location Detail Modal
  async openLocationModal(locationId) {
    const modal = document.getElementById('location-detail-modal');
    const body = document.getElementById('location-modal-body');
    if (!modal || !body) return;

    modal.classList.add('active');
    body.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem;">
        <div class="pulse-dot" style="margin: 0 auto 1rem; width: 16px; height: 16px;"></div>
        <p style="color: var(--text-muted);">Loading community reviews for this location...</p>
      </div>
    `;

    try {
      const data = await SafeStreetsAPI.getLocationDetails(locationId);
      const loc = data.location;
      const reviews = data.reviews || [];
      const stats = data.stats || {};

      const signal = loc.community_signal || 'comfortable';
      const signalLabel = signal === 'comfortable' ? 'Comfortable' :
                          signal === 'use_caution' ? 'Use Caution' : 'Avoid Alone';

      let reviewsHtml = '';
      if (reviews.length === 0) {
        reviewsHtml = `
          <div class="card" style="text-align: center; padding: 2rem;">
            <p style="color: var(--text-muted); font-size: 0.9rem;">
              No detailed reviews yet. Be the first woman to share your experience of ${this.escapeHtml(loc.name)}.
            </p>
            <button class="btn btn-primary btn-sm" style="margin-top: 1rem;" onclick="SafeStreetsApp.openReviewForLocation(${loc.id}, '${this.escapeQuote(loc.name)}')">
              Share Your Experience
            </button>
          </div>
        `;
      } else {
        reviews.forEach(r => {
          const photoHtml = r.photo_url ? `
            <div style="margin-top: 0.75rem;">
              <img src="${this.escapeHtml(r.photo_url)}" alt="Street condition" style="max-height: 180px; width: 100%; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border-light); cursor: pointer;" onclick="window.open('${this.escapeHtml(r.photo_url)}', '_blank')">
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.25rem;">📷 Privacy-Safe Road Observation Photo</div>
            </div>
          ` : '';

          reviewsHtml += `
            <div class="card" style="margin-bottom: 1rem; padding: 1.25rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <span class="signal-badge ${r.overall_feeling}">
                  <span class="signal-dot"></span>
                  ${r.overall_feeling.replace('_', ' ')}
                </span>
                <span style="font-size: 0.8rem; color: var(--text-muted);">
                  ${this.escapeHtml(r.date_of_experience)} • ${r.time_of_day.replace('_', ' ')}
                </span>
              </div>
              <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.5rem; line-height: 1.5;">
                "${this.escapeHtml(r.experience_text)}"
              </p>
              ${r.advice ? `
                <div style="font-size: 0.85rem; color: var(--color-plum); font-weight: 600; background: var(--color-plum-subtle); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm); margin-bottom: 0.6rem;">
                  Tip: ${this.escapeHtml(r.advice)}
                </div>
              ` : ''}
              ${photoHtml}
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted); border-top: 1px solid var(--border-light); padding-top: 0.5rem; margin-top: 0.5rem;">
                <span>Mode: ${r.travel_mode.replace('_', ' ')}</span>
                <button style="background: none; border: none; color: var(--text-light); cursor: pointer; text-decoration: underline;" onclick="SafeStreetsApp.openFlagModal('review', ${r.id})">
                  Report review
                </button>
              </div>
            </div>
          `;
        });
      }

      body.innerHTML = `
        <div style="margin-bottom: 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
            <div>
              <h2 style="font-size: 1.5rem; color: var(--color-plum);">${this.escapeHtml(loc.name)}</h2>
              <p style="font-size: 0.85rem; color: var(--text-muted);">${this.escapeHtml(loc.address_hint || loc.zone)}</p>
            </div>
            <span class="signal-badge ${signal}">
              <span class="signal-dot"></span>
              ${signalLabel}
            </span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; text-align: center;">
          <div style="background: var(--bg-app); border: 1px solid var(--border-light); padding: 0.75rem; border-radius: var(--radius-md);">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Lighting</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--color-plum);">${loc.lighting_score} / 5.0</div>
          </div>
          <div style="background: var(--bg-app); border: 1px solid var(--border-light); padding: 0.75rem; border-radius: var(--radius-md);">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Foot Traffic</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--color-plum);">${loc.crowd_score} / 5.0</div>
          </div>
          <div style="background: var(--bg-app); border: 1px solid var(--border-light); padding: 0.75rem; border-radius: var(--radius-md);">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Transport</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--color-plum);">${loc.transit_access_score} / 5.0</div>
          </div>
        </div>

        <div style="margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <h3 style="font-size: 1.1rem; color: var(--color-plum);">Community Experiences (${reviews.length})</h3>
            <button class="btn btn-outline btn-sm" onclick="SafeStreetsApp.openReviewForLocation(${loc.id}, '${this.escapeQuote(loc.name)}')">
              + Add Experience
            </button>
          </div>
          ${reviewsHtml}
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div class="alert-box danger">Failed to load location details.</div>`;
    }
  },

  closeLocationModal() {
    const modal = document.getElementById('location-detail-modal');
    if (modal) modal.classList.remove('active');
  },

  openReviewForLocation(locId, locName) {
    this.closeLocationModal();
    this.navigate('review');
    SafeStreetsReview.prefillLocation(locId, locName);
  },

  focusLocationOnMap(id) {
    this.navigate('map');
    setTimeout(() => {
      if (window.SafeStreetsMap && SafeStreetsMap.focusLocation) {
        SafeStreetsMap.focusLocation(id);
      }
    }, 200);
  },

  // Content Flagging / Removal Request
  openFlagModal(targetType, targetId) {
    const modal = document.getElementById('flag-modal');
    const inputType = document.getElementById('flag-modal-target-type') || document.getElementById('flag-target-type');
    const inputId = document.getElementById('flag-modal-target-id') || document.getElementById('flag-target-id');
    if (modal) {
      if (inputType) inputType.value = targetType;
      if (inputId) inputId.value = targetId;
      modal.classList.add('active');
    }
  },

  closeFlagModal() {
    const modal = document.getElementById('flag-modal');
    if (modal) modal.classList.remove('active');
  },

  // Modal flag submission handler
  async handleModalFlagSubmit(e) {
    e.preventDefault();
    const targetType = document.getElementById('flag-modal-target-type')?.value || 'review';
    const targetId = document.getElementById('flag-modal-target-id')?.value;
    const reason = document.getElementById('flag-modal-reason')?.value || 'other';
    const details = document.getElementById('flag-modal-details')?.value || '';

    try {
      const res = await SafeStreetsAPI.submitFlag({
        target_type: targetType,
        target_id: parseInt(targetId, 10) || 1,
        reason,
        details
      });
      if (res.success) {
        this.closeFlagModal();
        const detailsInput = document.getElementById('flag-modal-details');
        if (detailsInput) detailsInput.value = '';
        this.showToast(res.message);
      } else {
        this.showToast(res.error || 'Failed to submit report');
      }
    } catch (err) {
      this.showToast('Failed to submit content report');
    }
  },

  // Guidelines page static flag form handler
  async handleReportContentSubmit(e) {
    e.preventDefault();
    const targetType = document.getElementById('flag-target-type')?.value || 'review';
    const targetId = document.getElementById('flag-target-id')?.value;
    const reason = document.getElementById('flag-reason')?.value;
    const details = document.getElementById('flag-details')?.value;

    try {
      const res = await SafeStreetsAPI.submitFlag({
        target_type: targetType,
        target_id: parseInt(targetId, 10) || 1,
        reason,
        details
      });
      if (res.success) {
        const detailsInput = document.getElementById('flag-details');
        if (detailsInput) detailsInput.value = '';
        this.showToast(res.message);
      } else {
        this.showToast(res.error || 'Failed to submit report');
      }
    } catch (err) {
      this.showToast('Failed to submit content report');
    }
  },

  // Lookup review by anonymous token
  async handleLookupToken(e) {
    e.preventDefault();
    const token = document.getElementById('lookup-token-input')?.value?.trim();
    const container = document.getElementById('lookup-token-result');
    if (!token || !container) return;

    container.innerHTML = `<p style="color: var(--text-muted); padding: 1rem 0;">Searching for report...</p>`;

    try {
      const res = await SafeStreetsAPI.getMyReview(token);
      if (res.error) {
        container.innerHTML = `<div class="alert-box danger">${res.error}</div>`;
        return;
      }

      const r = res.review;
      const statusColor = r.moderationStatus === 'approved' ? 'var(--signal-comfortable)' :
                          r.moderationStatus === 'pending' ? 'var(--signal-caution)' : 'var(--signal-avoid)';

      container.innerHTML = `
        <div class="card" style="margin-top: 1rem; border-color: var(--border-medium);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <div>
              <h4 style="color: var(--color-plum);">${r.locationName}</h4>
              <p style="font-size: 0.8rem; color: var(--text-muted);">${r.dateOfExperience} (${r.timeOfDay})</p>
            </div>
            <span style="font-weight: 700; font-size: 0.85rem; padding: 0.25rem 0.75rem; border-radius: var(--radius-full); background: var(--bg-app); color: ${statusColor}; border: 1px solid var(--border-medium);">
              ● Status: ${r.moderationStatus.toUpperCase()}
            </span>
          </div>

          <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.75rem; line-height: 1.5;">
            "${this.escapeHtml(r.experienceText)}"
          </p>

          ${r.advice ? `<div style="font-size: 0.85rem; font-style: italic; color: var(--color-plum); margin-bottom: 0.75rem;">Advice: "${this.escapeHtml(r.advice)}"</div>` : ''}

          <div style="padding-top: 0.75rem; border-top: 1px solid var(--border-light); display: flex; justify-content: flex-end;">
            <button class="btn btn-outline btn-sm" style="color: var(--signal-avoid); border-color: var(--signal-avoid-border);" onclick="SafeStreetsApp.deleteReviewByToken('${token}')">
              Delete / Withdraw This Report
            </button>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="alert-box danger">Network error checking report.</div>`;
    }
  },

  async deleteReviewByToken(token) {
    if (!confirm('Are you sure you want to permanently withdraw this report from SafeStreets?')) return;

    try {
      const res = await SafeStreetsAPI.deleteMyReview(token);
      if (res.success) {
        this.showToast(res.message);
        const container = document.getElementById('lookup-token-result');
        if (container) container.innerHTML = `<div class="alert-box success">Your report has been deleted.</div>`;
        if (window.SafeStreetsMap) SafeStreetsMap.loadMapLocations();
      } else {
        this.showToast(res.error || 'Failed to delete report');
      }
    } catch (err) {
      this.showToast('Network error while deleting report');
    }
  },

  // Toast Notification System
  showToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>${this.escapeHtml(message)}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  escapeQuote(str) {
    return (str || '').replace(/'/g, "\\'");
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.SafeStreetsApp = SafeStreetsApp;

// Auto-start when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  SafeStreetsApp.init();
});
