/* UTC arithmetic represents calendar days only; 'today' comes from the host application. */
window.AlshivalGantt = (root, lifecycle, {refresh, report, saveDates}) => {
  const DAY = 86400000;
  const day = value => value ? Math.floor(Date.parse(value + 'T00:00:00Z') / DAY) : null;
  const date = value => value === null ? '' : new Date(value * DAY).toISOString().slice(0, 10);
  let drag = null, saving = false, editing = null, blocked = false;
  const scales = new Map();
  const busy = () => Boolean(drag || saving || editing);
  const rows = chart => [...chart.querySelectorAll('.sp-gantt-row')];
  function paint(row, start = day(row.dataset.start), due = day(row.dataset.due)) {
    const chart = row.closest('[data-gantt]'), bar = row.querySelector('.sp-gantt-bar');
    if (!bar) return;
    const {first, span} = chart.ganttRange;
    bar.style.left = `${100 * ((start ?? due) - first) / span}%`;
    bar.style.width = `${100 * (start !== null && due !== null ? Math.max(1, due - start + 1) : 1) / span}%`;
    bar.classList.toggle('is-marker', start === null || due === null);
    row.querySelector('.sp-gantt-dates').textContent = start !== null && due !== null ? `${date(start)} → ${date(due)}` : `${start !== null ? 'Starts' : 'Due'} ${date(start ?? due)}`;
    row.querySelector('.sp-gantt-dates').classList.toggle('sp-due-date', due !== null);
  }
  function layout(chart) {
    const scale = chart.querySelector('[data-gantt-scale]').value;
    scales.set(chart.classList.contains('sp-schedule-compact'), scale);
    const today = day(chart.dataset.today), dates = [today];
    rows(chart).forEach(row => { for (const value of [row.dataset.start, row.dataset.due]) if (value) dates.push(day(value)); });
    const step = scale === 'week' ? 7 : 30;
    const first = Math.min(...dates) - 2, span = Math.max(step * 2, Math.max(...dates) - first + 3);
    chart.ganttRange = {first, span};
    // Cap the canvas width for widely separated dates while keeping all items visible.
    const width = Math.min(10000, Math.max(640, 280 + span * (scale === 'week' ? 24 : 8)));
    const axis = chart.querySelector('[data-gantt-axis]'); axis.replaceChildren();
    const axisRow = chart.querySelector('.sp-gantt-axis'); axisRow.style.minWidth = `${width}px`;
    // Keep the axis and vertically scrolling rows on one horizontal canvas.
    chart.querySelector('.sp-gantt-body').style.minWidth = `${width}px`;
    const tick = Math.max(step, Math.ceil(span / 100 / step) * step);
    for (let value = first; value <= first + span; value += tick) {
      const label = document.createElement('span'); label.textContent = date(value).slice(5); label.style.left = `${100 * (value - first) / span}%`; axis.append(label);
    }
    const now = document.createElement('span'); now.textContent = 'Today'; now.className = 'sp-axis-today'; now.style.left = `${100 * (today - first) / span}%`; axis.append(now);
    rows(chart).forEach(row => {
      row.style.minWidth = `${width}px`;
      row.querySelector('.sp-gantt-track').style.setProperty('--gantt-step', `${100 * step / span}%`);
      row.querySelector('.sp-gantt-today').style.left = `${100 * (today - first) / span}%`;
      paint(row);
    });
  }
  function init() {
    root.querySelectorAll('[data-gantt]').forEach(chart => {
      chart.querySelector('[data-gantt-scale]').value = scales.get(chart.classList.contains('sp-schedule-compact')) || 'week';
      chart.querySelector('.sp-gantt').hidden = false;
      chart.setAttribute('data-gantt-ready', ''); layout(chart);
    });
  }
  function finishDialog() {
    if (!editing) return;
    const {dialog, button} = editing; editing = null; dialog.close(); button.focus();
  }
  async function save(row, start, due, revision = row.dataset.revision) {
    if (saving || blocked) return;
    if (!row.isConnected) { report("This item changed. Reload the board before editing its dates."); return; }
    saving = true; root.setAttribute('data-gantt-busy', '');
    const chart = row.closest('[data-gantt]');
    let message = 'Dates saved.', saved = false;
    try {
      if (saveDates) {
        const item = await saveDates({kind: row.dataset.kind, id: row.dataset.id, revision: Number(revision), starts_on: date(start) || null, due_on: date(due) || null});
        row.dataset.start = item.starts_on || ''; row.dataset.due = item.due_on || ''; row.dataset.revision = item.revision;
      } else {
        const body = new URLSearchParams({kind: row.dataset.kind, id: row.dataset.id, revision, starts_on: date(start), due_on: date(due), csrfmiddlewaretoken: root.querySelector('[name="csrfmiddlewaretoken"]').value});
        const response = await fetch(chart.dataset.scheduleUrl, {method: 'POST', body, credentials: 'same-origin', headers: {'X-Requested-With': 'XMLHttpRequest'}});
        const data = await response.json().catch(() => null);
        if (!data) throw new Error(response.status === 403
          ? 'Your access changed or the session expired. Reload the page.'
          : 'The server could not confirm this change.');
        if (data.item) {
          row.dataset.start = data.item.starts_on || ''; row.dataset.due = data.item.due_on || ''; row.dataset.revision = data.item.revision;
        }
        if (!response.ok || !data.saved) throw new Error(data.error || 'Dates could not be saved.');
      }
      saved = true;
    } catch (error) { message = `Schedule could not be confirmed: ${error instanceof TypeError ? 'The connection was interrupted.' : error.message}`; }
    // Reconcile even an interrupted response: the request may have committed.
    try { await refresh(); blocked = false; }
    catch (_) {
      blocked = true;
      message += ' Reload the page to confirm saved dates before editing again.';
      root.querySelectorAll('[data-gantt-edit]').forEach(button => { button.disabled = true; });
      root.querySelectorAll('[data-schedule-editable]').forEach(item => item.removeAttribute('data-schedule-editable'));
    }
    finally { saving = false; root.removeAttribute('data-gantt-busy'); report(message); }
    if (!saved && !blocked) report(message + ' The schedule now shows saved dates.');
  }
  lifecycle.listen(root, 'change', event => { if (event.target.matches('[data-gantt-scale]')) layout(event.target.closest('[data-gantt]')); });
  lifecycle.listen(root, 'click', event => {
    const button = event.target.closest('[data-gantt-edit]');
    if (button) {
      event.preventDefault();
      if (busy() || blocked || root.workspaceLive?.busy()) return;
      const row = button.closest('.sp-gantt-row'), dialog = row.closest('[data-gantt]').querySelector('dialog');
      dialog.querySelector('[data-gantt-title]').textContent = row.querySelector('.sp-gantt-name > a').textContent;
      dialog.querySelector('[name="starts_on"]').value = row.dataset.start;
      dialog.querySelector('[name="due_on"]').value = row.dataset.due;
      editing = {row, dialog, button, revision: row.dataset.revision}; dialog.showModal();
    }
    if (event.target.closest('[data-gantt-cancel]')) finishDialog();
  });
  lifecycle.listen(root, 'cancel', event => { if (event.target.matches('.sp-gantt-dialog')) { event.preventDefault(); finishDialog(); } }, true);
  lifecycle.listen(root, 'submit', event => {
    if (!event.target.matches('[data-gantt-form]') || !editing) return;
    event.preventDefault(); event.stopPropagation();
    const {row, dialog, revision} = editing;
    const start = day(dialog.querySelector('[name="starts_on"]').value), due = day(dialog.querySelector('[name="due_on"]').value);
    finishDialog(); save(row, start, due, revision);
  });
  lifecycle.listen(root, 'pointerdown', event => {
    const bar = event.target.closest('.sp-gantt-bar'), row = bar?.closest('[data-schedule-editable]');
    if (!row || busy() || blocked || root.workspaceLive?.busy() || event.button !== 0 || event.ctrlKey || event.metaKey || !matchMedia('(min-width: 761px)').matches) return;
    event.preventDefault();
    drag = {row, bar, revision: row.dataset.revision, x: event.clientX, start: day(row.dataset.start), due: day(row.dataset.due), edge: event.target.dataset.ganttEdge, delta: 0, moved: false, pointerId: event.pointerId};
    bar.setPointerCapture(event.pointerId);
  });
  lifecycle.listen(window, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.row.isConnected) { end(true); return; }
    const chart = drag.row.closest('[data-gantt]');
    drag.delta = Math.round((event.clientX - drag.x) / drag.row.querySelector('.sp-gantt-track').getBoundingClientRect().width * chart.ganttRange.span);
    drag.moved ||= Math.abs(event.clientX - drag.x) > 4;
    const [start, due] = proposed(); paint(drag.row, start, due);
    chart.querySelector('.sp-gantt-feedback').textContent = `Preview: ${start === null ? 'Start unset' : date(start)} → ${due === null ? 'Due unset' : date(due)}`;
  });
  function proposed() {
    let {start, due, delta, edge} = drag;
    if (edge === 'start') start = Math.min(start + delta, due);
    else if (edge === 'due') due = Math.max(start, due + delta);
    else { if (start !== null) start += delta; if (due !== null) due += delta; }
    return [start, due];
  }
  let ignoreClick = false;
  function end(cancel = false) {
    if (!drag) return;
    const {row, bar, moved, pointerId, revision} = drag, [start, due] = proposed();
    drag = null;
    if (bar.hasPointerCapture(pointerId)) bar.releasePointerCapture(pointerId);
    if (row.isConnected) { paint(row); row.closest('[data-gantt]').querySelector('.sp-gantt-feedback').textContent = ''; }
    if (moved || cancel) { ignoreClick = true; setTimeout(() => { ignoreClick = false; }, 0); }
    if (moved && !cancel) save(row, start, due, revision);
  }
  lifecycle.listen(root, 'click', event => { if (ignoreClick && event.target.closest('.sp-gantt-bar')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  lifecycle.listen(window, 'pointerup', () => end());
  lifecycle.listen(window, 'pointercancel', () => end(true));
  lifecycle.listen(window, 'keydown', event => { if (event.key === 'Escape' && drag) { event.preventDefault(); end(true); } });
  lifecycle.listen(window, 'beforeunload', event => { if (busy()) { event.preventDefault(); event.returnValue = ''; } });
  lifecycle.listen(root, 'scrapbook:refresh', init);
  lifecycle.onClose(() => { end(true); finishDialog(); });
  init();
  return {busy};
};
