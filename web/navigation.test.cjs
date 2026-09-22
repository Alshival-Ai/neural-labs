const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, 'assets/ui/navigation.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ mobile = false, pinned = false, signedIn = false, storageFails = false } = {}) {
  let doc;
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = { ...attrs }; this.events = {}; this.children = [];
      this.hidden = false; this.inert = false; this.textContent = '';
      const classes = new Set();
      this.classList = { add: value => classes.add(value), contains: value => classes.has(value),
        toggle: (value, on) => { on ? classes.add(value) : classes.delete(value); } };
    }
    on(type, callback) { (this.events[type] ||= []).push(callback); }
    addEventListener(type, callback) { this.on(type, callback); }
    fire(type, values = {}) {
      const event = { target: this, preventDefault() { this.prevented = true; }, ...values };
      for (const callback of this.events[type] || []) callback(event);
      return event;
    }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    removeAttribute(key) { delete this.attrs[key]; }
    getAttribute(key) { return this.attrs[key]; }
    hasAttribute(key) { return key in this.attrs; }
    get href() { return this.attrs.href; }
    set href(value) { this.attrs.href = value; }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    closest(selector) { return selector === 'a' && this.tag === 'a' ? this : null; }
    focus() {
      const old = doc.activeElement;
      doc.activeElement = this;
      if (sidebar.contains(old)) sidebar.fire('focusout');
      if (sidebar.contains(this)) sidebar.fire('focusin');
    }
    querySelector(selector) { return this.selectors?.[selector] || null; }
    querySelectorAll(selector) { const result = this.multiple?.[selector]; return typeof result === 'function' ? result() : result || []; }
  }
  const body = new Element(), sidebar = new Element(), nav = new Element('nav');
  const toggle = new Element('button'), pin = new Element('button'), opener = new Element('button'), backdrop = new Element('button');
  const entry = new Element('a', { 'data-site-entry': '', href: '/signup' });
  const account = new Element('a', { 'data-site-signin': '', href: '/login' });
  const home = new Element('a', { href: '#top' }), services = new Element('a', { href: '#workspace' });
  const section = new Element('section');
  const header = new Element('header'), main = new Element('main'), footer = new Element('footer');
  const page = new Element(); page.children = [header, main, footer];
  const toggleLabel = new Element('span');
  for (const item of [entry, account]) item.selectors = { '[data-account-label]': new Element('span') };
  toggle.selectors = { '[data-sidebar-toggle-label]': toggleLabel };
  sidebar.selectors = { '.sidebar-toggle': toggle, '.sidebar-pin': pin };
  sidebar.multiple = { 'a[href], button:not([hidden])': () => [toggle, pin, home, services, account].filter(item => !item.hidden) };
  nav.children = [home, services]; nav.multiple = { 'a[href]': [home, services] }; sidebar.children = [toggle, pin, nav, account];
  const query = { '.site-menu-toggle': opener, '.sidebar-backdrop': backdrop };
  const ids = { 'site-sidebar': sidebar, 'primary-navigation': nav, workspace: section };
  doc = new Element();
  Object.assign(doc, { body, activeElement: body, hidden: false, getElementById: id => ids[id] || null,
    querySelector: selector => query[selector], querySelectorAll: selector => ({
      '.public-page': [page],
      '[data-site-signin], [data-site-entry]': [account, entry], '[data-chat-signin]': [],
    })[selector] || [] });
  const mobileMedia = new Element(), fineMedia = new Element();
  mobileMedia.matches = mobile; fineMedia.matches = true;
  const storage = new Map([['neural-labs-public-sidebar-pinned', String(pinned)]]);
  const win = new Element();
  Object.assign(win, { location: { href: 'https://neural-labs.ai/', origin: 'https://neural-labs.ai', pathname: '/' },
    setTimeout, clearTimeout, matchMedia: query => query.includes('max-width') ? mobileMedia : fineMedia,
    fetch: async () => ({ ok: true, json: async () => ({ authenticated: signedIn }) }) });
  vm.runInNewContext(code, { document: doc, window: win, URL, AbortController,
    localStorage: {
      getItem(key) { if (storageFails) throw Error('blocked'); return storage.get(key); },
      setItem(key, value) { if (storageFails) throw Error('blocked'); storage.set(key, value); },
    } });
  return { body, sidebar, toggle, pin, opener, backdrop, entry, account, home, services, section,
    doc, header, main, page, win, storage, mobileMedia, toggleLabel };
}

test('hover temporarily expands without pinning; leaving closes', async () => {
  const e = setup(); await tick();
  assert.equal(e.body.classList.contains('sidebar-expanded'), false);
  e.sidebar.fire('pointerenter');
  assert.equal(e.body.classList.contains('sidebar-expanded'), true);
  assert.equal(e.body.classList.contains('sidebar-pinned'), false);
  e.sidebar.fire('pointerleave');
  assert.equal(e.body.classList.contains('sidebar-expanded'), false);
});

test('keyboard focus keeps labels visible after pointer leaves', async () => {
  const e = setup(); await tick(); e.home.focus(); e.sidebar.fire('pointerleave');
  assert.equal(e.body.classList.contains('sidebar-expanded'), true);
  e.opener.focus(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(e.body.classList.contains('sidebar-expanded'), false);
});

test('arrow and pin have distinct roles; collapsing unpins the menu', async () => {
  const e = setup(); await tick();
  assert.equal(e.pin.hidden, true);
  assert.equal(e.toggle.getAttribute('aria-label'), 'Expand menu');
  e.toggle.fire('click');
  assert.equal(e.body.classList.contains('sidebar-expanded'), true);
  assert.equal(e.body.classList.contains('sidebar-pinned'), false);
  assert.equal(e.pin.hidden, false);
  assert.equal(e.toggle.getAttribute('aria-label'), 'Collapse menu');
  e.pin.fire('click');
  assert.equal(e.body.classList.contains('sidebar-pinned'), true);
  assert.equal(e.pin.getAttribute('aria-pressed'), 'true');
  assert.equal(e.storage.get('neural-labs-public-sidebar-pinned'), 'true');
  e.toggle.fire('click');
  assert.equal(e.body.classList.contains('sidebar-expanded'), false);
  assert.equal(e.pin.hidden, true);
  assert.equal(e.storage.get('neural-labs-public-sidebar-pinned'), 'false');
});

test('saved pin preference is restored without requiring storage', async () => {
  const e = setup({ pinned: true }); const blocked = setup({ storageFails: true }); await tick();
  assert.equal(e.body.classList.contains('sidebar-expanded'), true);
  blocked.toggle.fire('click'); blocked.pin.fire('click');
  assert.equal(blocked.body.classList.contains('sidebar-pinned'), true);
});

test('mobile rail stays accessible and expanded menu traps focus until Escape', async () => {
  const e = setup({ mobile: true }); await tick();
  assert.equal(e.sidebar.inert, false);
  e.toggle.fire('click');
  assert.equal(e.sidebar.getAttribute('role'), 'dialog');
  assert.equal(e.page.inert, true); assert.equal(e.doc.activeElement, e.toggle);
  e.doc.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(e.doc.activeElement, e.account);
  e.doc.fire('keydown', { key: 'Tab' });
  assert.equal(e.doc.activeElement, e.toggle);
  e.doc.fire('keydown', { key: 'Escape' });
  assert.equal(e.doc.activeElement, e.toggle); assert.equal(e.sidebar.inert, false);
  assert.equal(e.page.inert, false); assert.equal(e.backdrop.hidden, true);
});

test('mobile link navigation closes drawer and focuses its same-page target', async () => {
  const e = setup({ mobile: true }); await tick(); e.toggle.fire('click');
  e.sidebar.fire('click', { target: e.services });
  assert.equal(e.body.classList.contains('sidebar-mobile-open'), false);
  assert.equal(e.doc.activeElement, e.section); assert.equal(e.page.inert, false);
});

test('pin preference survives breakpoints; mobile back arrow returns to the narrow rail', async () => {
  const e = setup({ pinned: true }); await tick();
  e.mobileMedia.matches = true; e.mobileMedia.fire('change');
  assert.equal(e.body.classList.contains('sidebar-expanded'), true);
  assert.equal(e.sidebar.inert, false);
  assert.equal(e.page.inert, true);
  e.toggle.fire('click');
  assert.equal(e.body.classList.contains('sidebar-expanded'), false);
  assert.equal(e.page.inert, false);
  assert.equal(e.sidebar.inert, false);
  assert.equal(e.pin.hidden, true);
  assert.equal(e.storage.get('neural-labs-public-sidebar-pinned'), 'false');
});

test('auth refresh changes only account labels and destinations; failure restores guest links', async () => {
  const e = setup({ signedIn: true }); await tick();
  assert.equal(e.entry.href, '/login'); assert.equal(e.account.href, '/login');
  assert.equal(e.entry.querySelector('[data-account-label]').textContent, 'Workspace');
  e.win.fetch = async () => ({ ok: true, json: async () => ({ authenticated: false }) });
  e.win.fire('focus'); await tick();
  assert.equal(e.entry.href, '/signup'); assert.equal(e.account.href, '/login');
  e.win.fetch = async () => { throw Error('offline'); }; e.win.fire('focus'); await tick();
  assert.equal(e.entry.querySelector('[data-account-label]').textContent, 'Sign up');
  assert.equal(e.account.querySelector('[data-account-label]').textContent, 'Log in');
});


test('section selection follows the URL and preserves a single current item', async () => {
  const e = setup(); await tick();
  assert.equal(e.home.getAttribute('aria-current'), 'page');
  e.win.location.href = 'https://neural-labs.ai/#workspace';
  e.win.fire('hashchange');
  assert.equal(e.services.getAttribute('aria-current'), 'location');
  assert.equal(e.home.hasAttribute('aria-current'), false);
  e.win.location.href = 'https://neural-labs.ai/#top';
  e.win.fire('hashchange');
  assert.equal(e.home.getAttribute('aria-current'), 'page');
  assert.equal(e.services.hasAttribute('aria-current'), false);
});
