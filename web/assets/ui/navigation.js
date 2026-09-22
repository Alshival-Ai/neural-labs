(() => {
  const body = document.body;
  const sidebar = document.getElementById('site-sidebar');
  const nav = document.getElementById('primary-navigation');
  const toggle = sidebar?.querySelector('.sidebar-toggle');
  const pin = sidebar?.querySelector('.sidebar-pin');
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (!sidebar || !nav || !toggle || !pin || !backdrop) return;

  const mobile = window.matchMedia('(max-width: 900px)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const storageKey = 'neural-labs-public-sidebar-pinned';
  let pinned = false;
  try { pinned = localStorage.getItem(storageKey) === 'true'; } catch (_) {}
  let hovered = false;
  let focused = false;
  let suppressed = false;
  let mobileOpen = mobile.matches && pinned;
  let manuallyOpen = false;
  const background = new Map();

  function render() {
    const expanded = mobile.matches ? mobileOpen : pinned || manuallyOpen || (!suppressed && (hovered || focused));
    body.classList.toggle('sidebar-pinned', pinned);
    body.classList.toggle('sidebar-expanded', expanded);
    body.classList.toggle('sidebar-mobile-open', mobile.matches && mobileOpen);
    toggle.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? 'Collapse menu' : 'Expand menu';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
    pin.hidden = !expanded;
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('aria-label', pinned ? 'Unpin menu' : 'Pin menu open');
    pin.setAttribute('title', pinned ? 'Unpin menu' : 'Pin menu open');
    sidebar.inert = false;
    backdrop.hidden = !(mobile.matches && mobileOpen);
    if (mobile.matches && mobileOpen) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      document.querySelectorAll('.public-page').forEach(element => {
        if (!background.has(element)) background.set(element, element.inert);
        element.inert = true;
      });
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      background.forEach((inert, element) => { element.inert = inert; });
      background.clear();
    }
  }

  function setPinned(value) {
    pinned = value;
    try { localStorage.setItem(storageKey, String(pinned)); } catch (_) {}
  }

  function closeMobile(restore = true) {
    setPinned(false);
    mobileOpen = false;
    render();
    if (restore) toggle.focus();
  }

  toggle.addEventListener('click', () => {
    if (mobile.matches) {
      if (mobileOpen) closeMobile();
      else { mobileOpen = true; render(); toggle.focus(); }
      return;
    }
    if (body.classList.contains('sidebar-expanded')) {
      setPinned(false);
      manuallyOpen = false;
      suppressed = true;
    } else {
      manuallyOpen = true;
      suppressed = false;
    }
    render();
  });
  pin.addEventListener('click', () => {
    setPinned(!pinned);
    manuallyOpen = false;
    suppressed = false;
    render();
  });
  sidebar.addEventListener('pointerenter', () => {
    if (mobile.matches || !finePointer.matches) return;
    hovered = true;
    suppressed = false;
    render();
  });
  sidebar.addEventListener('pointerleave', () => {
    hovered = false;
    if (!focused) suppressed = false;
    render();
  });
  sidebar.addEventListener('focusin', () => {
    focused = true;
    suppressed = false;
    render();
  });
  sidebar.addEventListener('focusout', () => {
    window.setTimeout(() => {
      focused = sidebar.contains(document.activeElement);
      if (!focused) suppressed = false;
      render();
    }, 0);
  });
  backdrop.addEventListener('click', () => closeMobile());
  sidebar.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || !mobile.matches || !mobileOpen || pinned) return;
    const destination = new URL(link.href, window.location.href);
    const samePage = destination.origin === window.location.origin && destination.pathname === window.location.pathname;
    const target = samePage && destination.hash ? document.getElementById(destination.hash.slice(1)) : null;
    closeMobile(!target);
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (mobile.matches && mobileOpen) {
        event.preventDefault();
        closeMobile();
      } else if (!mobile.matches && !pinned && sidebar.contains(document.activeElement)) {
        event.preventDefault();
        toggle.focus();
        manuallyOpen = false;
        suppressed = true;
        render();
      }
    }
    if (event.key !== 'Tab' || !mobile.matches || !mobileOpen) return;
    const controls = [...sidebar.querySelectorAll('a[href], button:not([hidden])')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  mobile.addEventListener('change', () => {
    mobileOpen = mobile.matches && pinned;
    manuallyOpen = false;
    hovered = false;
    focused = false;
    suppressed = false;
    const inside = sidebar.contains(document.activeElement);
    render();
    if (mobile.matches && (inside || mobileOpen)) toggle.focus();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey) return;
    pinned = event.newValue === 'true';
    if (mobile.matches) mobileOpen = pinned;
    render();
  });

  // Mark the selected section without changing the links' destinations.
  function updateCurrentNav() {
    const links = [...nav.querySelectorAll('a[href]')];
    const here = new URL(window.location.href);
    const matches = links.filter(link => {
      const target = new URL(link.href, here);
      return target.origin === here.origin && target.pathname === here.pathname;
    });
    const selected = matches.find(link => new URL(link.href, here).hash === here.hash)
      || matches.find(link => ['', '#top'].includes(new URL(link.href, here).hash));
    links.forEach(link => {
      if (link === selected) link.setAttribute('aria-current', here.hash && here.hash !== '#top' ? 'location' : 'page');
      else link.removeAttribute('aria-current');
    });
  }
  updateCurrentNav();
  window.addEventListener('hashchange', updateCurrentNav);
  window.addEventListener('pageshow', updateCurrentNav);

  // Icons stay intact as session state changes; account labels have their own spans.
  function applyAuth(authenticated) {
    document.querySelectorAll('[data-site-signin], [data-site-entry]').forEach(control => {
      const entry = control.hasAttribute('data-site-entry');
      const label = authenticated ? 'Workspace' : entry ? 'Sign up' : 'Log in';
      control.href = authenticated ? '/login' : entry ? '/signup' : '/login';
      control.querySelector('[data-account-label]').textContent = label;
      control.setAttribute('aria-label', label);
      if (!entry) control.setAttribute('title', label);
    });
  }
  let authRequest = null;
  function refreshAuth() {
    if (authRequest) return authRequest;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    authRequest = window.fetch('/api/session', {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).then(response => {
      if (!response.ok) throw new Error('Session status unavailable');
      return response.json();
    }).then(state => applyAuth(state.authenticated === true))
      .catch(() => applyAuth(false))
      .finally(() => { window.clearTimeout(timeout); authRequest = null; });
    return authRequest;
  }
  body.classList.add('public-nav-ready');
  toggle.hidden = false;
  render();
  if (mobile.matches && mobileOpen) toggle.focus();
  refreshAuth();
  window.addEventListener('focus', refreshAuth);
  window.addEventListener('pageshow', event => { if (event.persisted) refreshAuth(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAuth(); });
})();
