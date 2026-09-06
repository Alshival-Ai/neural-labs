import app from './app.js';
import Helper from './libs/helpers.js';

// An opaque-origin iframe cannot use cookies. Editor preferences are transient.
const settings = new Map();
Helper.prototype.getCookie = function (key) { return settings.has(key) ? settings.get(key) : null; };
Helper.prototype.setCookie = function (key, value) { settings.set(key, value); };
Helper.prototype.delCookie = function (key) { settings.delete(key); };

let port;
let loading = false;
let revision = 0;
const send = (data) => port && port.postMessage(data);
const raster = /^data:image\/(png|jpeg|webp|bmp|avif);base64,/i;
function dimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 40000000) throw new Error('Images are limited to 40 megapixels.');
}
function validateProject(project) {
  dimensions(Number(project.info?.width), Number(project.info?.height));
  if (!Array.isArray(project.layers) || project.layers.length > 500 || !Array.isArray(project.data)) throw new Error('Invalid or oversized layered project');
  for (const image of project.data) if (!raster.test(image.data || '')) throw new Error('Projects may only contain embedded raster images');
  for (const layer of project.layers) {
    if (layer.width_original && layer.height_original) dimensions(layer.width_original, layer.height_original);
    if (layer.link && typeof layer.link === 'string') throw new Error('External image links are not supported');
  }
  project.user_fonts = {};
  return project;
}
async function importFile(data) {
  loading = true;
  try {
    if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > 50 * 1024 * 1024) throw new Error('Image imports are limited to 50 MB.');
    if (data.name.endsWith('.minipaint.json')) {
      const project = validateProject(JSON.parse(new TextDecoder().decode(data.bytes)));
      // Decode embedded images first to enforce the pixel limit before miniPaint allocates canvases.
      for (const entry of project.data) { const image = new Image(); image.src = entry.data; await image.decode(); dimensions(image.naturalWidth, image.naturalHeight); }
      await app.FileOpen.load_json(project);
    } else {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp'].includes(data.mimeType)) throw new Error('Use PNG, JPEG, WebP, AVIF, BMP or a miniPaint project.');
      const url = URL.createObjectURL(new Blob([data.bytes], { type: data.mimeType }));
      try {
        const image = new Image(); image.src = url; await image.decode(); dimensions(image.naturalWidth, image.naturalHeight);
        await app.State.do_action(new app.Actions.Bundle_action('workspace_open', 'Open workspace image', [
          new app.Actions.Reset_layers_action(),
          new app.Actions.Insert_layer_action({ name: data.name, type: 'image', link: image, width: image.naturalWidth, height: image.naturalHeight, width_original: image.naturalWidth, height_original: image.naturalHeight }),
          new app.Actions.Autoresize_canvas_action(image.naturalWidth, image.naturalHeight, null, true, true)
        ]));
      } finally { URL.revokeObjectURL(url); }
    }
    revision++;
    send({ type: 'loaded', revision });
  } finally { loading = false; }
}
async function exportFile(data) {
  const exportedRevision = revision;
  dimensions(app.Config.WIDTH, app.Config.HEIGHT);
  let blob;
  if (data.format === 'project') blob = new Blob([app.FileSave.export_as_json()], { type: 'application/json' });
  else {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(data.format)) throw new Error('Unsupported export format');
    const canvas = document.createElement('canvas'); canvas.width = app.Config.WIDTH; canvas.height = app.Config.HEIGHT;
    const ctx = canvas.getContext('2d'); app.Layers.convert_layers_to_canvas(ctx, null, false);
    if (data.format === 'image/jpeg') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    blob = await new Promise((resolve) => canvas.toBlob(resolve, data.format, 0.92));
    canvas.width = canvas.height = 1;
  }
  if (!blob || blob.size > 50 * 1024 * 1024) throw new Error('Editor exports are limited to 50 MB.');
  const bytes = await blob.arrayBuffer(); port.postMessage({ type: 'exported', requestId: data.requestId, bytes, mimeType: blob.type, revision: exportedRevision }, [bytes]);
}
window.addEventListener('message', (event) => {
  if (port || event.source !== window.parent || event.data?.type !== 'neural-image-connect' || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = async ({ data }) => {
    try { if (data?.type === 'load') await importFile(data); else if (data?.type === 'export') await exportFile(data); }
    catch (error) { send({ type: 'error', requestId: data?.requestId, message: error.message }); }
  };
  port.start(); send({ type: 'ready' });
});
window.addEventListener('load', () => setTimeout(() => {
  for (const method of ['do_action', 'undo', 'redo']) {
    if (typeof app.State[method] !== 'function') continue;
    const original = app.State[method].bind(app.State);
    app.State[method] = async (...args) => { const result = await original(...args); if (!loading) send({ type: 'dirty', revision: ++revision }); return result; };
  }
  app.FileSave.save = () => send({ type: 'save-as', format: 'project' });
  app.FileSave.export = () => send({ type: 'save' });
  app.FileOpen.open_file = () => send({ type: 'open' });
  app.FileOpen.open_dir = () => send({ type: 'open' });
  app.FileOpen.open_handler = () => send({ type: 'error', message: 'Upload images in Files, then use Open workspace image.' });
  const paste = app.FileOpen.on_paste.bind(app.FileOpen);
  app.FileOpen.on_paste = (data, width, height) => {
    try {
      dimensions(width, height);
      if (typeof data !== 'string' || data.length > 70 * 1024 * 1024) throw new Error('Pasted images are limited to 50 MB.');
      paste(data, width, height);
    } catch (error) { send({ type: 'error', message: error.message }); }
  };
  app.FileOpen.open_url = () => send({ type: 'error', message: 'Open an image from your workspace instead.' });
  app.FileOpen.search = app.FileOpen.open_url;
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopImmediatePropagation(); send({ type: event.shiftKey ? 'save-as' : 'save' }); }
  }, true);
  send({ type: 'initialized' });
}, 0));
