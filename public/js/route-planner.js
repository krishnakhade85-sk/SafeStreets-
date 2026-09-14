/**
 * SafeStreets Mumbai - Route Planner & Comparison Controller
 */

let selectedTimeOfDay = 'evening';
let selectedTravelMode = 'walk';

function initRoutePlanner() {
  const timeBtns = document.querySelectorAll('.route-time-chip');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      timeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTimeOfDay = btn.getAttribute('data-time');
    });
  });

  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTravelMode = btn.getAttribute('data-mode');
    });
  });

  const compareForm = document.getElementById('route-plan-form');
  if (compareForm) {
    compareForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await executeRouteComparison();
    });
  }

  // Bind presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const from = chip.getAttribute('data-from');
      const to = chip.getAttribute('data-to');
      document.getElementById('route-origin').value = from;
      document.getElementById('route-destination').value = to;
      executeRouteComparison();
    });
  });
}

async function executeRouteComparison() {
  const origin = document.getElementById('route-origin')?.value?.trim();
  const destination = document.getElementById('route-destination')?.value?.trim();
  const resultsContainer = document.getElementById('route-results');

  if (!origin || !destination) {
    SafeStreetsApp.showToast('Please enter both origin and destination in Mumbai');
    return;
  }

  if (resultsContainer) {
    resultsContainer.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem;">
        <div class="pulse-dot" style="margin: 0 auto 1rem; width: 16px; height: 16px;"></div>
        <p style="font-weight: 600; color: var(--color-plum);">Synthesizing community safety reports for this corridor...</p>
      </div>
    `;
  }

  try {
    const data = await SafeStreetsAPI.compareRoutes(origin, destination, selectedTimeOfDay, selectedTravelMode);
    renderRouteResults(data);
  } catch (err) {
    console.error('Route comparison error:', err);
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="alert-box danger">
          Failed to calculate route comparison. Please try again.
        </div>
      `;
    }
  }
}

function renderRouteResults(data) {
  const container = document.getElementById('route-results');
  if (!container) return;

  const routes = data.routes || [];

  if (routes.length === 0) {
    container.innerHTML = `
      <div class="alert-box info">
        No specific community routes found for this path yet. Try using recognized landmarks such as "Dadar Station", "Bandra West", or "Andheri Station".
      </div>
    `;
    return;
  }

  const timeLabelMap = {
    morning: 'Morning (6 AM - 12 PM)',
    afternoon: 'Afternoon (12 PM - 5 PM)',
    evening: 'Evening (5 PM - 9 PM)',
    after_dark: 'After Dark (9 PM - 6 AM)'
  };

  const modeIconMap = {
    walk: 'Walking',
    public_transit: 'Transit (Train/Metro/Bus)',
    cab_auto: 'Cab / Auto-Rickshaw',
    bike: 'Two-Wheeler'
  };

  let html = `
    <div style="margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="color: var(--color-plum); font-size: 1.35rem;">
          Comparing Routes: ${data.origin} → ${data.destination}
        </h3>
        <p style="font-size: 0.85rem; color: var(--text-muted);">
          Context: <strong>${timeLabelMap[data.timeOfDay] || data.timeOfDay}</strong> • Mode: <strong>${modeIconMap[data.travelMode] || data.travelMode}</strong>
        </p>
      </div>
      <span style="font-size: 0.85rem; font-weight: 700; color: var(--color-plum); background: var(--color-plum-subtle); padding: 0.35rem 0.85rem; border-radius: var(--radius-full);">
        ${routes.length} Community Options Evaluated
      </span>
    </div>

    <div class="routes-comparison-container">
  `;

  routes.forEach((route, index) => {
    const isRec = route.isRecommended;
    const signal = route.communitySignal || 'comfortable';
    const signalLabel = signal === 'comfortable' ? 'Comfortable' :
                        signal === 'use_caution' ? 'Use Caution' : 'Avoid Alone';

    const cautionsListHtml = (route.segmentCautionNotes || []).map(note => `
      <li>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${signal === 'avoid_alone' ? 'var(--signal-avoid)' : 'var(--signal-caution)'}" stroke-width="2.5" style="flex-shrink: 0; margin-top: 3px;">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${note}</span>
      </li>
    `).join('');

    html += `
      <div class="route-card ${isRec ? 'recommended' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
          <span class="route-card-banner ${isRec ? 'recommended' : 'alternate'}">
            ${isRec ? '★ Community Recommended Option' : 'Alternative Option'}
          </span>
          <span class="signal-badge ${signal}">
            <span class="signal-dot"></span>
            ${signalLabel}
          </span>
        </div>

        <div class="route-card-header">
          <div>
            <h4 style="font-size: 1.25rem; color: var(--color-plum); margin-bottom: 0.25rem;">
              ${route.title}
            </h4>
            <p style="font-size: 0.9rem; color: var(--text-muted);">${route.description}</p>
          </div>
        </div>

        <div class="route-metrics-bar">
          <div class="route-metric-group">
            <span class="route-metric-val">~${route.travelTimeMinutes} mins</span>
            <span class="route-metric-label">Travel Time</span>
          </div>
          <div class="route-metric-group">
            <span class="route-metric-val">${route.distanceKm} km</span>
            <span class="route-metric-label">Distance</span>
          </div>
          <div class="route-metric-group">
            <span class="route-metric-val">${route.lightingScore} / 5</span>
            <span class="route-metric-label">Lighting Status</span>
          </div>
          <div class="route-metric-group">
            <span class="route-metric-val">${route.footTrafficScore} / 5</span>
            <span class="route-metric-label">Crowd & Activity</span>
          </div>
          <div class="route-metric-group">
            <span class="route-metric-val">${route.recentReportsCount}</span>
            <span class="route-metric-label">Verified Reports</span>
          </div>
        </div>

        <div style="margin-bottom: 0.75rem;">
          <div style="font-size: 0.8rem; text-transform: uppercase; font-weight: 700; color: var(--color-plum); letter-spacing: 0.03em; margin-bottom: 0.35rem;">
            Segment Observations & Caution Points:
          </div>
          <ul class="route-cautions-list">
            ${cautionsListHtml}
          </ul>
        </div>

        ${route.timeSpecificNote ? `
          <div style="font-size: 0.85rem; background: var(--bg-card-muted); padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); margin-bottom: 0.75rem;">
            <strong>${timeLabelMap[data.timeOfDay] || 'Time Context'}:</strong> ${route.timeSpecificNote}
          </div>
        ` : ''}

        <div class="route-advice-callout">
          <strong>Community Advice:</strong> ${route.communityAdvice}
        </div>
      </div>
    `;
  });

  html += `
    </div>

    <div class="mandatory-disclaimer-box">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-plum)" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <div>
        <strong>Notice:</strong> ${data.disclaimer}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

window.SafeStreetsRoutePlanner = {
  initRoutePlanner,
  executeRouteComparison
};
