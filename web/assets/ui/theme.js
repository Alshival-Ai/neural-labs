// Run before styles load: the saved preference and resolved appearance are distinct.
(() => {
  'use strict';
  const key = 'neural-labs-public-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  let preference = 'system';
  // Legacy `auto`, missing values, and invalid values all resolve to System.
  try { preference = valid(localStorage.getItem(key)); } catch (_) {}

  function render() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    root.classList.toggle('dark-style', dark);
    root.classList.toggle('light-style', !dark);
    root.dataset.theme = preference;
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f6f4ef');
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const selected = button.dataset.themeChoice === preference;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }
  function choose(value) {
    preference = valid(value);
    try { localStorage.setItem(key, preference); } catch (_) {}
    render();
  }
  render();
  system.addEventListener('change', render);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = valid(event.newValue);
      render();
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-control]').forEach(control => {
      const buttons = [...control.querySelectorAll('[data-theme-choice]')];
      buttons.forEach((button, index) => {
        button.addEventListener('click', () => choose(button.dataset.themeChoice));
        button.addEventListener('keydown', event => {
          let next;
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = buttons.length - 1;
          else return; // Native buttons handle Space and Enter.
          event.preventDefault();
          choose(buttons[next].dataset.themeChoice);
          buttons[next].focus();
        });
      });
      control.hidden = false;
    });
    render();
  });
})();
