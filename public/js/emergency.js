/**
 * SafeStreets Mumbai - Urgent Help & Verified Helplines Controller
 */

let emergencyContacts = [];

async function initEmergency() {
  try {
    const data = await SafeStreetsAPI.getSettings();
    const contacts = data.settings?.emergency_contacts;
    if (Array.isArray(contacts)) {
      emergencyContacts = contacts;
      renderEmergencyHelplines();
    }
  } catch (err) {
    console.error('Failed to load emergency contacts:', err);
  }
}

function renderEmergencyHelplines() {
  const container = document.getElementById('urgent-helplines-grid');
  const modalContainer = document.getElementById('modal-urgent-helplines-grid');

  const html = emergencyContacts.map(c => `
    <div class="helpline-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <span class="helpline-name">${c.name}</span>
        ${c.verified ? `<span style="font-size: 0.7rem; background: rgba(255,255,255,0.25); padding: 0.15rem 0.45rem; border-radius: var(--radius-full); font-weight: 700;">VERIFIED</span>` : ''}
      </div>
      <div class="helpline-number">${c.number}</div>
      <p style="font-size: 0.8rem; color: rgba(255,255,255,0.85); line-height: 1.35; margin-bottom: 0.5rem;">
        ${c.desc || '24/7 Mumbai assistance'}
      </p>
      <a href="tel:${c.number.replace(/\s+/g, '')}" class="helpline-call-btn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        Call ${c.number}
      </a>
    </div>
  `).join('');

  if (container) container.innerHTML = html;
  if (modalContainer) modalContainer.innerHTML = html;
}

function openUrgentHelpModal() {
  const modal = document.getElementById('urgent-help-modal');
  if (modal) modal.classList.add('active');
}

function closeUrgentHelpModal() {
  const modal = document.getElementById('urgent-help-modal');
  if (modal) modal.classList.remove('active');
}

window.SafeStreetsEmergency = {
  initEmergency,
  openUrgentHelpModal,
  closeUrgentHelpModal
};
