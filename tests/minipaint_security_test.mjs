import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { test as it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const desktopRequire = createRequire(resolve('workspace/desktop/package.json'));
const { JSDOM } = desktopRequire('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
const document = window.document;
globalThis.document = document;
const vendor = resolve('workspace/vendor/minipaint');
const requireVendor = createRequire(join(vendor, 'package.json'));
afterEach(() => { document.body.replaceChildren(); });
it('renders saved image settings as text while preserving the static information panel', () => {
  const source = readFileSync(join(vendor, 'src/js/core/gui/gui-information.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default GUI_information_class;', 'return GUI_information_class;');
  const attack = '<img src=x onerror=alert(1)>';
  class Settings { get_setting() { return attack; } }
  class Helper { get_user_unit(value) { return value; } }
  const Gui = new Function('config', 'Base_layers_class', 'Tools_settings_class', 'Helper_class', 'Tools_translate_class', source)(
    { WIDTH: 640, HEIGHT: 480, LANG: 'en' }, class {}, Settings, Helper, class {});
  document.body.innerHTML = '<div id="toggle_info"></div><canvas id="canvas_minipaint"></canvas>';
  new Gui().render_main_information();
  assert.equal(document.getElementById('mouse_info_size')?.textContent, '640 x 480');
  assert.equal(document.getElementById('mouse_info_resolution')?.textContent, attack);
  assert.equal(document.querySelector('.id-mouse_info_units')?.textContent, attack);
  assert.equal(document.querySelector('img'), null);
});
it('does not reinterpret text or translation keys as HTML', () => {
  const jquery = requireVendor('jquery')(window);
  new Function('jQuery', readFileSync(join(vendor, 'src/js/libs/jquery.translate.js'), 'utf8'))(jquery);
  const root = document.createElement('div'), text = document.createElement('span');
  text.className = 'trn'; text.textContent = '<img src=x onerror=alert(1)>';
  root.append(text); document.body.append(root);
  jquery(root).translate({ lang: 'en', t: {} });
  assert.equal(root.querySelector('img'), null);
  assert.equal(text.textContent, '<img src=x onerror=alert(1)>');
  jquery(root).translate({ lang: 'fr', t: { [text.textContent]: { fr: '<script>alert(1)</script>' } } });
  assert.equal(root.querySelector('script'), null);
  assert.equal(text.textContent, '<script>alert(1)</script>');
});
