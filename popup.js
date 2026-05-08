/**
 * popup.js
 * Manages the extension popup UI.
 * Checks whether the active tab is a CUNY schedule page,
 * enables/disables the export button accordingly, and
 * triggers the export via a message to content.js.
 */

const exportBtn   = document.getElementById('export-btn');
const pageIcon    = document.getElementById('page-icon');
const pageStatus  = document.getElementById('page-status');
const pageDetail  = document.getElementById('page-detail');
const resultBanner= document.getElementById('result-banner');
const resultIcon  = document.getElementById('result-icon');
const resultMsg   = document.getElementById('result-msg');

// ── CUNY hostnames the extension works on ─────────────────────────────────
const CUNY_PATTERN = /cuny\.edu|cunyfirst/i;

// ── On popup open: detect active tab ─────────────────────────────────────
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url) {
    setPageState('unknown');
    return;
  }

  if (CUNY_PATTERN.test(tab.url)) {
    setPageState('cuny');
  } else {
    setPageState('other');
  }
})();

// ── Export button click ───────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  exportBtn.disabled = true;
  exportBtn.innerHTML = '<span>⏳</span><span>Scanning schedule…</span>';
  hideBanner();

  try {
    // Inject content script if not already present (for manually opened tabs)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch(() => {
      // Ignore — script may already be injected
    });

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'exportCalendar' });

    if (response && response.success) {
      showBanner('success', `✅ Exported ${response.count} class${response.count !== 1 ? 'es' : ''}! Check your downloads.`);
    } else {
      const msg = (response && response.message) || 'No schedule data found on this page.';
      showBanner('error', `❌ ${msg}`);
    }
  } catch (err) {
    console.error('[CUNY ICS Popup] Error:', err);
    showBanner('error', '❌ Could not reach the page. Make sure your schedule is visible and try again.');
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = '<span>📥</span><span>Export to Calendar (.ics)</span>';
  }
});

// ── UI helpers ────────────────────────────────────────────────────────────

function setPageState(state) {
  switch (state) {
    case 'cuny':
      pageIcon.textContent   = '✅';
      pageStatus.textContent = 'CUNY page detected';
      pageDetail.textContent = 'Navigate to your schedule results, then click export.';
      exportBtn.disabled     = false;
      break;

    case 'other':
      pageIcon.textContent   = '⚠️';
      pageStatus.textContent = 'Not a CUNY page';
      pageDetail.textContent = 'Open CUNY Schedule Builder and search for classes first.';
      exportBtn.disabled     = true;
      break;

    case 'unknown':
    default:
      pageIcon.textContent   = '❓';
      pageStatus.textContent = 'Unknown page';
      pageDetail.textContent = 'Navigate to your CUNY Schedule Builder results.';
      exportBtn.disabled     = true;
  }
}

function showBanner(type, message) {
  resultBanner.className = `result-banner ${type}`;
  resultMsg.textContent  = message;
}

function hideBanner() {
  resultBanner.className = 'result-banner';
}
