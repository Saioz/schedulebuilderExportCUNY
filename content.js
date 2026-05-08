/**
 * CUNY Schedule Builder → .ics Calendar Exporter
 * ONLY runs on sb.cunyfirst.cuny.edu
 */

// ── VERIFY WE'RE ON THE RIGHT SITE ─────────────────────────────────────
if (!window.location.href.match(/^https:\/\/sb\.cunyfirst\.cuny\.edu\//i)) {
  console.log('[CUNY ICS] Not on Schedule Builder - extension disabled');
  // Don't inject anything or run any code
} else {
  // Main extension code only runs on sb.cunyfirst.cuny.edu
  initExtension();
}

function initExtension() {
  // Inject the floating button once
  if (!document.getElementById('cuny-ics-export-btn')) {
    injectExportButton();
  }

  // Listen for messages from popup.js
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'exportCalendar') {
      (async () => {
        try {
          const result = await exportSchedule();
          sendResponse(result);
        } catch (error) {
          console.error('[CUNY ICS] Export error:', error);
          sendResponse({ success: false, message: error.message });
        }
      })();
      return true;
    }
    return true;
  });
}

// ... rest of your existing functions (injectExportButton, exportSchedule, etc.)
// Make sure to wrap everything inside initExtension() or keep them as is
// since they're only called from within initExtension()
