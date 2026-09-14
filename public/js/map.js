/**
 * SafeStreets Mumbai - Interactive Map & Discovery Controller
 */

let mapInstance = null;
let markersLayer = null;
let currentLocations = [];
let activeFilter = 'all';

// Default Mumbai coordinates
const MUMBAI_CENTER = [19.0550, 72.8550];
const DEFAULT_ZOOM = 12;

function initMap() {
  const container = document.getElementById('mumbai-map');
  if (!container || mapInstance) return;

  try {
    // Check if Leaflet is available
    if (typeof L === 'undefined') {
      console.warn('Leaflet not loaded yet, retrying...');
      setTimeout(initMap, 500);
      return;
    }

    mapInstance = L.map('mumbai-map', {
      center: MUMBAI_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false
    });

    // Clean, modern basemap tiles (CartoDB Positron / OSM)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(mapInstance);

    // Zoom controls bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);

    // Fetch and render locations
    loadMapLocations();

  } catch (err) {
    console.error('Map initialization error:', err);
  }
}

async function loadMapLocations(filter = activeFilter, searchQuery = '') {
  try {
    const data = await SafeStreetsAPI.getLocations(filter, searchQuery);
    currentLocations = data.locations || [];
    renderMarkers(currentLocations);
  } catch (err) {
    console.error('Failed to load locations:', err);
  }
}

function renderMarkers(locations) {
  if (!markersLayer || !mapInstance) return;
  markersLayer.clearLayers();

  locations.forEach(loc => {
    const pinHtml = createPinHtml(loc);
    const customIcon = L.divIcon({
      html: pinHtml,
      className: 'custom-pin-leaflet',
      iconSize: [40, 40],
      iconAnchor: [20, 36]
    });

    const marker = L.marker([loc.lat, loc.lng], { icon: customIcon });
    
    marker.on('click', () => {
      showSafetySummaryCard(loc);
      mapInstance.panTo([loc.lat, loc.lng], { animate: true, duration: 0.5 });
    });

    markersLayer.addLayer(marker);
  });
}

function createPinHtml(loc) {
  const signal = loc.community_signal || 'comfortable';
  let iconSvg = '';

  if (signal === 'comfortable') {
    // Shield checkmark
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
  } else if (signal === 'use_caution') {
    // Caution alert
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else {
    // Avoid alone / care circle
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
  }

  return `
    <div class="custom-pin-wrap" title="${loc.name} (${signal.replace('_', ' ')})">
      <div class="pin-pulse ${signal}"></div>
      <div class="pin-bubble ${signal}">
        <div class="pin-icon-inner">
          ${iconSvg}
        </div>
      </div>
    </div>
  `;
}

function showSafetySummaryCard(loc) {
  const card = document.getElementById('map-safety-card');
  if (!card) return;

  const signal = loc.community_signal || 'comfortable';
  const signalLabel = signal === 'comfortable' ? 'Comfortable' :
                      signal === 'use_caution' ? 'Use Caution' : 'Avoid Alone';

  let explainerText = '';
  if (signal === 'comfortable') {
    explainerText = 'Recent reports describe active streets, reliable lighting, and accessible transport options.';
  } else if (signal === 'use_caution') {
    explainerText = 'Some recent reports mention lower foot traffic or poor lighting after dark. Stay aware of surroundings.';
  } else {
    explainerText = 'Multiple recent reports indicate low visibility or concerns after dark. Consider travelling with someone or using an alternative route.';
  }

  const adviceQuote = (loc.recentAdvice && loc.recentAdvice.length > 0)
    ? `"${loc.recentAdvice[0].advice}"`
    : '"Prefer well-lit commercial sidewalks; taxis and autos available nearby."';

  const dateFormatted = loc.last_updated ? new Date(loc.last_updated).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  }) : 'Recently updated';

  card.innerHTML = `
    <div class="summary-card-header">
      <div>
        <h3 class="summary-card-title">${loc.name}</h3>
        <p class="summary-card-subtitle">${loc.zone} • ${formatCategory(loc.category)}</p>
      </div>
      <button class="modal-close-btn" onclick="hideSafetySummaryCard()" title="Close summary">×</button>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
      <span class="signal-badge ${signal}">
        <span class="signal-dot"></span>
        ${signalLabel}
      </span>
      <span class="confidence-indicator">
        <span class="confidence-bar-wrap">
          <div class="confidence-bar-fill" style="width: ${loc.confidence_score}%"></div>
        </span>
        ${loc.confidence_score}% confidence (${loc.review_count} reports)
      </span>
    </div>

    <div class="summary-signal-explainer">
      ${explainerText}
    </div>

    <div class="summary-metrics-row">
      <div class="summary-metric-box">
        <div class="summary-metric-label">Lighting</div>
        <div class="summary-metric-val">${loc.lighting_score} / 5.0</div>
      </div>
      <div class="summary-metric-box">
        <div class="summary-metric-label">Foot Traffic</div>
        <div class="summary-metric-val">${loc.crowd_score} / 5.0</div>
      </div>
      <div class="summary-metric-box">
        <div class="summary-metric-label">Transport</div>
        <div class="summary-metric-val">${loc.transit_access_score} / 5.0</div>
      </div>
    </div>

    <div class="summary-advice-quote">
      ${adviceQuote}
    </div>

    <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.85rem;">
      Last community update: ${dateFormatted}
    </div>

    <div class="summary-card-actions">
      <button class="btn btn-primary btn-sm btn-full" onclick="SafeStreetsApp.openLocationModal(${loc.id})">
        View Full Details
      </button>
      <button class="btn btn-outline btn-sm" onclick="SafeStreetsApp.openReviewForLocation(${loc.id}, '${escapeQuote(loc.name)}')">
        + Share Experience
      </button>
    </div>
  `;

  card.style.display = 'block';
}

function hideSafetySummaryCard() {
  const card = document.getElementById('map-safety-card');
  if (card) card.style.display = 'none';
}

function formatCategory(cat) {
  const map = {
    transit_station: 'Transit Station & Concourse',
    commercial_hub: 'Commercial & Retail Area',
    arterial_road: 'Arterial Road',
    residential_area: 'Residential Neighbourhood',
    skywalk: 'Pedestrian Skywalk',
    promenade: 'Public Promenade'
  };
  return map[cat] || 'Public Area';
}

function escapeQuote(str) {
  return (str || '').replace(/'/g, "\\'");
}

// Bind search input with debounced load
function setupMapControls() {
  const searchInput = document.getElementById('map-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadMapLocations(activeFilter, e.target.value);
      }, 250);
    });
  }

  // Filter chips in map
  document.querySelectorAll('.map-floating-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.map-floating-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.getAttribute('data-filter');
      const searchVal = document.getElementById('map-search-input')?.value || '';
      loadMapLocations(activeFilter, searchVal);
    });
  });
}

window.SafeStreetsMap = {
  initMap,
  loadMapLocations,
  renderMarkers,
  showSafetySummaryCard,
  hideSafetySummaryCard,
  setupMapControls
};
