// ==========================================================================
// BiaDone — Personal Context OS — main interactions
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------- Mobile menu ---------------- */
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      const isOpen = !mobileMenu.hasAttribute('hidden');
      if (isOpen) {
        mobileMenu.setAttribute('hidden', '');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      } else {
        mobileMenu.removeAttribute('hidden');
        menuToggle.setAttribute('aria-expanded', 'true');
        menuToggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      }
    });

    // Close mobile menu when a link is clicked
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.setAttribute('hidden', '');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      });
    });
  }

  /* ---------------- Sticky nav shadow on scroll ---------------- */
  const header = document.getElementById('site-header');
  const onScroll = () => {
    if (window.scrollY > 8) {
      header.style.boxShadow = '0 4px 24px rgba(15,23,42,0.08)';
    } else {
      header.style.boxShadow = 'none';
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- Reveal-on-scroll ---------------- */
  const revealTargets = document.querySelectorAll(
    '.problem-card, .definition-card, .step-card, .pe-card, .usecase-card, .eco-card, .trust-principle'
  );
  revealTargets.forEach(el => el.classList.add('reveal'));

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealTargets.forEach(el => observer.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('is-visible'));
  }

  /* ---------------- Beta waitlist form (client-side only) ---------------- */
  const betaForm = document.getElementById('tiv-form');
  const betaStatus = document.getElementById('beta-form-status');

  if (betaForm) {
    betaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('beta-email');
      const email = emailInput.value.trim();
      if (!email) return;

      betaStatus.textContent = `Thanks — we'll reach out to ${email} when the T.I.V beta opens.`;
      betaForm.reset();
    });
  }

});
