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

    // Close when clicking a nav link on mobile (improves UX)
    navLinks.addEventListener('click', function (e) {
      if (window.innerWidth <= 768 && e.target.closest('a')) {
        // Small delay so the navigation can start before menu closes
        setTimeout(() => setOpen(false), 80);
      }
    });

    // Click outside to close (only when open on mobile)
    document.addEventListener('click', function (e) {
      if (window.innerWidth > 768) return;
      if (!navLinks.classList.contains('open')) return;
      if (navLinks.contains(e.target) || hamburger.contains(e.target)) return;
      setOpen(false);
    });

    // Reset state on desktop resize
    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (window.innerWidth > 768 && navLinks.classList.contains('open')) {
          setOpen(false);
        }
      }, 150);
    });

    // Ensure initial aria state
    hamburger.setAttribute('aria-expanded', navLinks.classList.contains('open') ? 'true' : 'false');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHamburger);
  } else {
    initHamburger();
  }
})();