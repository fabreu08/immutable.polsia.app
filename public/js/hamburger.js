/**
 * Hamburger menu controller for Immutable QC app nav
 * Works with views/partials/app-nav.ejs
 */
(function () {
  function initHamburger() {
    const hamburger = document.getElementById('navHamburger');
    const navLinks = document.getElementById('navLinks');
    const overlay = document.getElementById('navOverlay');

    if (!hamburger || !navLinks) return;

    function setOpen(isOpen) {
      if (isOpen) {
        navLinks.classList.add('open');
        hamburger.classList.add('open');
        hamburger.setAttribute('aria-expanded', 'true');
        if (overlay) {
          overlay.classList.add('visible');
          overlay.setAttribute('aria-hidden', 'false');
        }
        document.body.classList.add('nav-open');

        // Change icon to close when open (works with both ☰ and span versions)
        if (hamburger.textContent.trim() === '☰') hamburger.textContent = '✕';
      } else {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        if (overlay) {
          overlay.classList.remove('visible');
          overlay.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('nav-open');

        if (hamburger.textContent.trim() === '✕') hamburger.textContent = '☰';
      }
    }

    // Toggle on hamburger click
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = navLinks.classList.contains('open');
      setOpen(!isOpen);
    });

    // Close on overlay click
    if (overlay) {
      overlay.addEventListener('click', function () {
        setOpen(false);
      });
    }

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        setOpen(false);
      }
    });

    // Close when clicking a nav link (improves UX on all screen sizes)
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        setTimeout(() => setOpen(false), 80);
      }
    });

    // Click outside to close (works on desktop too)
    document.addEventListener('click', function (e) {
      if (!navLinks.classList.contains('open')) return;
      if (navLinks.contains(e.target) || hamburger.contains(e.target)) return;
      setOpen(false);
    });

    // No longer auto-closing on desktop resize — hamburger works on all screen sizes
    // let resizeTimer;
    // window.addEventListener('resize', function () { ... });

    // Ensure initial aria state
    hamburger.setAttribute('aria-expanded', navLinks.classList.contains('open') ? 'true' : 'false');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHamburger);
  } else {
    initHamburger();
  }
})();