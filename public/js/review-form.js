/**
 * SafeStreets Mumbai - Anonymous Review Submission & PII Redaction Controller
 */

// Selected observation values
const reviewFormData = {
  location_id: null,
  location_name: '',
  date_of_experience: new Date().toISOString().split('T')[0],
  time_of_day: 'evening',
  travel_mode: 'walk',
  overall_feeling: 'comfortable',
  lighting: 'well_lit',
  foot_traffic: 'active',
  shops_open: 'some',
  transit_access: 'short_walk',
  security_presence: 'occasional_patrol',
  road_condition: 'paved',
  harassment_concern: false,
  stalking_concern: false,
  isolated_area: false,
  photo_url: null
};

// Client-side PII detector patterns
const CLIENT_PII_PATTERNS = {
  phone: /(?:(?:\+91|91|0)[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}\b|\b(?:\d{3}[\s.-]?\d{3}[\s.-]?\d{4})\b/,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  vehiclePlate: /\b(?:MH|DL|KA|TN|GJ|HR|UP|WB)[\s.-]?\d{1,2}[\s.-]?[A-Z]{1,3}[\s.-]?\d{3,4}\b/i,
  address: /\b(?:flat|apt|apartment|room|bldg|building|wing|house|chawl|chawla)[\s#.-]*\d+[A-Za-z0-9\s,-]*(?:co-op|chs|society|nagar|lane)?\b/i
};

function initReviewForm() {
  const form = document.getElementById('anonymous-review-form');
  if (!form) return;

  // Set default date to today
  const dateInput = document.getElementById('rev-date');
  if (dateInput) {
    dateInput.value = reviewFormData.date_of_experience;
    dateInput.max = reviewFormData.date_of_experience;
  }

  // Populate location select
  populateLocationSelect();

  // Setup single-choice observation buttons
  setupObsButtons('obs-feeling', (val) => { reviewFormData.overall_feeling = val; });
  setupObsButtons('obs-time', (val) => { reviewFormData.time_of_day = val; });
  setupObsButtons('obs-mode', (val) => { reviewFormData.travel_mode = val; });
  setupObsButtons('obs-lighting', (val) => { reviewFormData.lighting = val; });
  setupObsButtons('obs-foot-traffic', (val) => { reviewFormData.foot_traffic = val; });
  setupObsButtons('obs-shops', (val) => { reviewFormData.shops_open = val; });
  setupObsButtons('obs-transit', (val) => { reviewFormData.transit_access = val; });
  setupObsButtons('obs-security', (val) => { reviewFormData.security_presence = val; });
  setupObsButtons('obs-road', (val) => { reviewFormData.road_condition = val; });

  // Concern checkboxes
  document.getElementById('concern-harassment')?.addEventListener('change', (e) => {
    reviewFormData.harassment_concern = e.target.checked;
  });
  document.getElementById('concern-stalking')?.addEventListener('change', (e) => {
    reviewFormData.stalking_concern = e.target.checked;
  });
  document.getElementById('concern-isolated')?.addEventListener('change', (e) => {
    reviewFormData.isolated_area = e.target.checked;
  });

  // Real-time client-side PII detector on textareas
  const expTextarea = document.getElementById('rev-experience');
  const adviceTextarea = document.getElementById('rev-advice');

  [expTextarea, adviceTextarea].forEach(elem => {
    if (elem) {
      elem.addEventListener('input', checkLivePII);
    }
  });

  // Photo upload with EXIF metadata stripper
  const photoInput = document.getElementById('rev-photo-input');
  if (photoInput) {
    photoInput.addEventListener('change', handlePrivacySafePhoto);
  }

  // Form submit handler
  form.addEventListener('submit', handleReviewSubmit);
}

let locationsLoadedPromise = null;
let pendingPrefillId = null;

async function populateLocationSelect() {
  const select = document.getElementById('rev-location-select');
  if (!select) return;

  locationsLoadedPromise = SafeStreetsAPI.getLocations('all')
    .then(data => {
      const locs = data.locations || [];
      let html = '<option value="">Select a known road, station, or landmark...</option>';
      locs.forEach(l => {
        html += `<option value="${l.id}">${l.name} (${l.zone})</option>`;
      });
      html += '<option value="custom">+ Add another road or public area in Mumbai...</option>';
      select.innerHTML = html;

      if (pendingPrefillId) {
        select.value = String(pendingPrefillId);
        reviewFormData.location_id = parseInt(pendingPrefillId, 10);
      }
    })
    .catch(err => {
      console.error('Failed to populate locations:', err);
    });

  select.addEventListener('change', (e) => {
    const customWrap = document.getElementById('rev-custom-location-wrap');
    if (e.target.value === 'custom') {
      if (customWrap) customWrap.style.display = 'block';
      reviewFormData.location_id = null;
    } else {
      if (customWrap) customWrap.style.display = 'none';
      reviewFormData.location_id = e.target.value ? parseInt(e.target.value, 10) : null;
    }
  });

  return locationsLoadedPromise;
}

function setupObsButtons(groupClass, onChange) {
  document.querySelectorAll(`.${groupClass}`).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll(`.${groupClass}`).forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const val = btn.getAttribute('data-value');
      onChange(val);
    });
  });
}

function checkLivePII() {
  const exp = document.getElementById('rev-experience')?.value || '';
  const adv = document.getElementById('rev-advice')?.value || '';
  const combined = exp + ' ' + adv;

  const detected = [];
  if (CLIENT_PII_PATTERNS.phone.test(combined)) detected.push('Phone number');
  if (CLIENT_PII_PATTERNS.email.test(combined)) detected.push('Email address');
  if (CLIENT_PII_PATTERNS.vehiclePlate.test(combined)) detected.push('Vehicle plate number');
  if (CLIENT_PII_PATTERNS.address.test(combined)) detected.push('Private building or flat address');

  const previewBox = document.getElementById('pii-preview-box');
  const tagsRow = document.getElementById('pii-detected-tags');

  if (detected.length > 0) {
    if (previewBox) previewBox.classList.add('active');
    if (tagsRow) {
      tagsRow.innerHTML = detected.map(d => `<span class="pii-tag">⚠ ${d} detected</span>`).join(' ');
    }
  } else {
    if (previewBox) previewBox.classList.remove('active');
  }
}

// Strip EXIF metadata via canvas
function handlePrivacySafePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  const preview = document.getElementById('rev-photo-preview');
  const reader = new FileReader();

  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Draw to in-memory canvas to cleanly strip all EXIF GPS metadata
      const canvas = document.createElement('canvas');
      const maxDim = 800;
      let width = img.width;
      let height = img.height;

      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Export privacy-safe stripped base64
      reviewFormData.photo_url = canvas.toDataURL('image/jpeg', 0.85);

      if (preview) {
        preview.src = reviewFormData.photo_url;
        preview.style.display = 'block';
      }
      SafeStreetsApp.showToast('Photo GPS & metadata stripped for privacy');
    };
    img.src = event.target.result;
  };

  reader.readAsDataURL(file);
}

async function handleReviewSubmit(e) {
  e.preventDefault();

  const confirmedNoPII = document.getElementById('rev-confirm-no-pii')?.checked;
  if (!confirmedNoPII) {
    SafeStreetsApp.showToast('Please confirm that your report contains no personal details or names.');
    return;
  }

  const select = document.getElementById('rev-location-select');
  const customLocInput = document.getElementById('rev-custom-location');
  
  if (select.value === 'custom') {
    reviewFormData.location_id = null;
    reviewFormData.location_name = customLocInput?.value?.trim();
    if (!reviewFormData.location_name) {
      SafeStreetsApp.showToast('Please enter the road or area name.');
      return;
    }
  } else if (!select.value) {
    SafeStreetsApp.showToast('Please select a road or station.');
    return;
  } else {
    reviewFormData.location_id = parseInt(select.value, 10);
    reviewFormData.location_name = '';
  }

  const expText = document.getElementById('rev-experience')?.value?.trim();
  const adviceText = document.getElementById('rev-advice')?.value?.trim();

  if (!expText) {
    SafeStreetsApp.showToast('Please provide a brief description of your observation.');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-review');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting report...';
  }

  try {
    const payload = {
      ...reviewFormData,
      experience_text: expText,
      advice: adviceText,
      user_confirmed_no_pii: true
    };

    const result = await SafeStreetsAPI.submitReview(payload);

    if (result.success) {
      showSubmissionSuccess(result);
    } else {
      SafeStreetsApp.showToast(result.error || 'Submission failed');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Anonymous Review';
      }
    }
  } catch (err) {
    console.error('Submit review error:', err);
    SafeStreetsApp.showToast('Network error while submitting review');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Anonymous Review';
    }
  }
}

function showSubmissionSuccess(result) {
  const container = document.getElementById('review-form-container');
  if (!container) return;

  const token = result.anonymousToken;

  container.innerHTML = `
    <div class="card" style="text-align: center; padding: 2.5rem 1.5rem;">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--signal-comfortable-bg); color: var(--signal-comfortable); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      </div>

      <h2 style="font-size: 1.6rem; color: var(--color-plum); margin-bottom: 0.5rem;">
        Review Submitted Anonymously
      </h2>

      <p style="color: var(--text-muted); font-size: 0.95rem; max-width: 540px; margin: 0 auto 1.5rem; line-height: 1.6;">
        ${result.message}
      </p>

      ${result.hasPII ? `
        <div class="alert-box warning" style="text-align: left; margin: 0 auto 1.5rem; max-width: 540px;">
          <strong>Privacy Redaction Applied:</strong>
          Our automatic scanner identified sensitive patterns (${result.detectedFlags.join(', ')}). These have been automatically masked to protect your identity.
        </div>
      ` : ''}

      <div style="background-color: var(--bg-card-muted); border: 1.5px dashed var(--color-plum); border-radius: var(--radius-md); padding: 1.25rem; max-width: 540px; margin: 0 auto 1.5rem; text-align: left;">
        <div style="font-size: 0.8rem; text-transform: uppercase; font-weight: 700; color: var(--color-plum); margin-bottom: 0.35rem;">
          Your Private Contributor Access Token:
        </div>
        <div style="font-family: monospace; font-size: 0.95rem; font-weight: 700; color: var(--color-plum-dark); word-break: break-all; margin-bottom: 0.75rem;">
          ${token}
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          Keep this code private. You can use it to check your review status or permanently delete your submission at any time without creating an account.
        </p>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${token}').then(() => SafeStreetsApp.showToast('Token copied to clipboard!'))">
            Copy Token
          </button>
          <button class="btn btn-outline btn-sm" style="color: var(--signal-avoid); border-color: var(--signal-avoid-border);" onclick="SafeStreetsApp.deleteReviewByToken('${token}')">
            Withdraw / Delete Report
          </button>
        </div>
      </div>

      <div style="display: flex; justify-content: center; gap: 1rem; flex-wrap: wrap;">
        <button class="btn btn-primary" onclick="SafeStreetsApp.navigate('map')">
          Explore Mumbai Map
        </button>
        <button class="btn btn-outline" onclick="location.reload()">
          Submit Another Report
        </button>
      </div>
    </div>
  `;
}

window.SafeStreetsReview = {
  initReviewForm,
  prefillLocation: async (locId, locName) => {
    pendingPrefillId = locId;
    reviewFormData.location_id = locId ? parseInt(locId, 10) : null;
    const select = document.getElementById('rev-location-select');
    if (!select) return;

    if (locationsLoadedPromise) {
      await locationsLoadedPromise;
    }

    let found = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value == locId) {
        found = true;
        break;
      }
    }

    if (!found && locId && locName) {
      const opt = document.createElement('option');
      opt.value = locId;
      opt.textContent = locName;
      if (select.lastElementChild) {
        select.insertBefore(opt, select.lastElementChild);
      } else {
        select.appendChild(opt);
      }
    }

    select.value = String(locId);
    const customWrap = document.getElementById('rev-custom-location-wrap');
    if (customWrap) customWrap.style.display = 'none';
  }
};
