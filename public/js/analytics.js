/**
 * public/js/analytics.js — Client-side event tracking for Immutable QC.
 * Captures button clicks, form submissions, CSV uploads, wallet connections.
 * Works without any external analytics provider — all events go to /api/analytics/event.
 * Does NOT own server-side event storage.
 */
(function () {
  const ANALYTICS_ENDPOINT = '/api/analytics/event';
  const SESSION_KEY = 'iqc_session_id';

  // ── Session ID (anonymous, no auth required) ──
  function getOrCreateSessionId() {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  // ── Core track function ──
  function track(eventName, properties) {
    properties = properties || {};
    // Add session + timestamp
    properties._session = getOrCreateSessionId();
    properties._ts = new Date().toISOString();

    // Fire-and-forget; don't block UI
    if (navigator.sendBeacon) {
      const payload = JSON.stringify({ event_name: eventName, properties, session_id: getOrCreateSessionId() });
      navigator.sendBeacon(ANALYTICS_ENDPOINT + '?beacon=1', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: eventName, properties, session_id: getOrCreateSessionId() }),
      }).catch(() => {}); // swallow errors — analytics is non-critical
    }
  }

  // ── Auto-track page views ──
  function trackPageView() {
    track('page_view', {
      path: window.location.pathname,
      title: document.title,
    });
  }

  // ── Button click tracking ──
  function attachButtonTracking() {
    document.querySelectorAll('[data-track]').forEach(function (el) {
      el.addEventListener('click', function () {
        track('button_click', {
          label: el.dataset.track,
          text: el.textContent.trim().slice(0, 100),
          href: el.href || null,
        });
      });
    });
  }

  // ── Specific event bindings ──
  function initWalletTracking() {
    const btn = document.querySelector('[data-connect-wallet]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      track('wallet_connect_click', {
        label: btn.textContent.trim(),
      });
    });
  }

  function initCSVUploadTracking() {
    const form = document.getElementById('hplcForm');
    if (!form) return;
    form.addEventListener('submit', function () {
      track('hplc_csv_upload', {
        file: document.getElementById('csvFile')?.files[0]?.name || 'unknown',
      });
    });
  }

  function initDemoRequestTracking() {
    const form = document.getElementById('demoRequestForm');
    if (!form) return;
    form.addEventListener('submit', function () {
      track('demo_request_submit', {
        source: window.location.pathname,
      });
    });
  }

  // ── Demo request form detection (landing page) ──
  function initDemoFormTracking() {
    const demoForms = document.querySelectorAll('form');
    demoForms.forEach(function (form) {
      const emailInput = form.querySelector('input[name="email"], input[type="email"]');
      if (emailInput && !form.dataset.tracked) {
        form.dataset.tracked = 'true';
        form.addEventListener('submit', function () {
          track('demo_request_submit', { source: window.location.pathname });
        });
      }
    });
  }

  // ── Ledger / QC submit tracking ──
  function initManualSubmitTracking() {
    const form = document.getElementById('readingForm');
    if (!form) return;
    form.addEventListener('submit', function () {
      const fd = new FormData(form);
      track('reading_submit', {
        sensor_type: fd.get('sensorType'),
        instrument: fd.get('instrumentSerial'),
      });
    });
  }

  // ── Init ──
  function init() {
    // Page view
    trackPageView();

    // Track hash changes for SPA-style navigation (if any)
    if (window.location.pathname.startsWith('/dashboard') ||
        window.location.pathname.startsWith('/submit') ||
        window.location.pathname.startsWith('/review') ||
        window.location.pathname.startsWith('/readings') ||
        window.location.pathname.startsWith('/ledger') ||
        window.location.pathname.startsWith('/pricing')) {
      // Bind all event trackers
      initWalletTracking();
      initCSVUploadTracking();
      initDemoRequestTracking();
      initManualSubmitTracking();
    }

    // Also check landing page demo forms
    initDemoFormTracking();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose globally so other scripts can call track()
  window.IQC_ANALYTICS = { track, trackPageView };
})();