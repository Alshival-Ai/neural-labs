const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, 'assets/ui/theme.js'), 'utf8');
const key = 'neural-labs-public-theme';

function setup({ saved, dark = false, blocked = false, copies = 1 } = {}) {
  let focused;
  const target = () => ({ events: {}, attrs: {}, hidden: true,
    addEventListener(name, fn) { this.events[name] = fn; },
    fire(name, event) { this.events[name]?.(event); },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() { focused = this; },
  });
  const controls = Array.from({ length: copies }, () => {
    const buttons = ['light', 'dark', 'system'].map(mode => Object.assign(target(), { dataset: { themeChoice: mode } }));
    return Object.assign(target(), { buttons, querySelectorAll: () => buttons });
  });
  const meta = target();
  const classes = new Set();
  const root = { dataset: {}, style: {}, classList: {
    toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
    contains(name) { return classes.has(name); },
  }};
  const doc = Object.assign(target(), { documentElement: root,
    querySelector: () => meta,
    querySelectorAll: selector => ({
      '[data-theme-choice]': controls.flatMap(control => control.buttons),
      '[data-theme-control]': controls,
    })[selector] || [],
  });
  const system = Object.assign(target(), { matches: dark });
  const win = Object.assign(target(), { matchMedia: () => system });
  const storage = new Map([[key, saved]]);
  vm.runInNewContext(code, { document: doc, window: win, localStorage: {
    getItem(key) { if (blocked) throw Error('blocked'); return storage.get(key); },
    setItem(key, value) { if (blocked) throw Error('blocked'); storage.set(key, value); },
  }});
  const [light, darkButton, systemButton] = controls[0].buttons;
  return { root, doc, system, win, controls, light, darkButton, systemButton, meta, storage, focused: () => focused };
}
function assertSelection(e, mode, appearance) {
  assert.equal(e.root.dataset.theme, mode);
  assert.equal(e.root.style.colorScheme, appearance);
  assert.equal(e.root.classList.contains('dark-style'), appearance === 'dark');
  assert.equal(e.root.classList.contains('light-style'), appearance === 'light');
  assert.equal(e.meta.attrs.content, appearance === 'dark' ? '#000000' : '#f6f4ef');
  for (const control of e.controls) {
    for (const button of control.buttons) {
      const selected = button.dataset.themeChoice === mode;
      assert.equal(button.attrs['aria-checked'], String(selected));
      assert.equal(button.tabIndex, selected ? 0 : -1);
    }
  }
}
test('System applies before DOM ready, stays selected, and follows the device', () => {
  const e = setup({ dark: true });
  assertSelection(e, 'system', 'dark');
  e.doc.fire('DOMContentLoaded');
  assert.equal(e.controls[0].hidden, false);
  e.system.matches = false; e.system.fire('change');
  assertSelection(e, 'system', 'light');
});
test('explicit choices persist and ignore device changes until System is selected', () => {
  const e = setup(); e.doc.fire('DOMContentLoaded'); e.darkButton.fire('click');
  assert.equal(e.storage.get(key), 'dark');
  e.system.fire('change');
  assertSelection(e, 'dark', 'dark');
  e.light.fire('click');
  assert.equal(e.storage.get(key), 'light');
  e.system.matches = true; e.system.fire('change');
  assertSelection(e, 'light', 'light');
  e.systemButton.fire('click');
  assert.equal(e.storage.get(key), 'system');
  assertSelection(e, 'system', 'dark');
});
test('saved explicit preferences prevent an opposite-device flash on reload', () => {
  assertSelection(setup({ saved: 'light', dark: true }), 'light', 'light');
  assertSelection(setup({ saved: 'dark', dark: false }), 'dark', 'dark');
});
test('legacy Auto, missing, invalid, and System preferences follow the device', () => {
  for (const saved of ['auto', 'system', 'invalid', null, undefined]) {
    assertSelection(setup({ saved, dark: true }), 'system', 'dark');
    assertSelection(setup({ saved }), 'system', 'light');
  }
});
test('theme remains usable when browser storage is blocked', () => {
  const e = setup({ dark: true, blocked: true });
  e.doc.fire('DOMContentLoaded'); e.light.fire('click');
  assertSelection(e, 'light', 'light');
  e.systemButton.fire('click');
  assertSelection(e, 'system', 'dark');
});
test('cross-tab changes update all selectors without moving focus; clear resets to System', () => {
  const e = setup({ copies: 2 }); e.doc.fire('DOMContentLoaded'); e.light.focus();
  e.win.fire('storage', { key, newValue: 'dark' });
  assertSelection(e, 'dark', 'dark');
  assert.equal(e.focused(), e.light);
  e.win.fire('storage', { key: 'unrelated', newValue: 'light' });
  assertSelection(e, 'dark', 'dark');
  e.win.fire('storage', { key, newValue: 'auto' });
  assertSelection(e, 'system', 'light');
  e.darkButton.fire('click');
  assertSelection(e, 'dark', 'dark');
  e.win.fire('storage', { key, newValue: null });
  assertSelection(e, 'system', 'light');
  e.darkButton.fire('click');
  e.win.fire('storage', { key: null, newValue: null });
  assertSelection(e, 'system', 'light');
});
test('radio keyboard navigation selects, wraps, and focuses within its own group', () => {
  const e = setup({ copies: 2 }); e.doc.fire('DOMContentLoaded');
  function press(button, key, expected, mode) {
    let prevented = false;
    button.fire('keydown', { key, preventDefault() { prevented = true; } });
    assert.ok(prevented);
    assert.equal(e.focused(), expected);
    assertSelection(e, mode, mode === 'dark' ? 'dark' : 'light');
    assert.equal(e.storage.get('neural-labs-public-theme'), mode);
  }
  press(e.systemButton, 'ArrowRight', e.light, 'light');
  press(e.light, 'ArrowLeft', e.systemButton, 'system');
  press(e.systemButton, 'ArrowUp', e.darkButton, 'dark');
  press(e.darkButton, 'ArrowDown', e.systemButton, 'system');
  press(e.systemButton, 'Home', e.light, 'light');
  press(e.light, 'End', e.systemButton, 'system');
  const [secondLight, secondDark] = e.controls[1].buttons;
  press(secondLight, 'ArrowRight', secondDark, 'dark');
  secondDark.fire('keydown', { key: 'Tab', preventDefault() { assert.fail('Tab must remain native'); } });
});
