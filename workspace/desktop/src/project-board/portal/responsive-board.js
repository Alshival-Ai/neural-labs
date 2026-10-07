/* Layout and gesture previews only. The shared-project adapter owns all writes. */
window.AlshivalResponsiveBoard = (root, lifecycle, actions) => {
  const content = root.querySelector('[data-shared-project-content]');
  if (!content?.querySelector('.sp-columns')) return null;
  const read = (storage, key, fallback) => {
    try {
      return JSON.parse(window[storage].getItem(key)) ?? fallback;
    } catch (_) {
      return fallback;
    }
  };
  const write = (storage, key, value) => {
    try {
      window[storage].setItem(key, JSON.stringify(value));
    } catch (_) {}
  };
  let identity = {};
  try {
    identity = JSON.parse(document.getElementById('app-shell-config')?.textContent || '{}');
  } catch (_) {}
  const preferenceKey = `project-board-layout:${identity.user || root.dataset.boardUser || 'guest'}`;
  const positionKey = `${preferenceKey}:${identity.workspace || root.dataset.boardUrl}`;
  let preference = read('localStorage', preferenceKey, 'swipe');
  if (!['swipe', 'stacked'].includes(preference)) preference = 'swipe';
  const remembered = read('sessionStorage', positionKey, {});
  let selected = remembered.selected || '',
    previousIndex = 0,
    layout = '',
    frame = 0,
    closed = false;
  let touch = null,
    edge = null,
    lifted = false,
    gestureHeight = 0,
    animation;
  const positions = new Map(Object.entries(remembered.positions || {}));
  const board = () => content.querySelector('.sp-columns');
  const columns = () => [...(board()?.querySelectorAll('.sp-column') || [])];
  const active = () => columns().find(column => column.dataset.spState === selected);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const persist = () => write('sessionStorage', positionKey, { selected, positions: Object.fromEntries(positions) });
  function capture() {
    columns().forEach(column => {
      if (!column.hidden) positions.set(column.dataset.spState, column.querySelector('.sp-stack').scrollTop);
    });
    persist();
  }
  function navigation() {
    const list = columns(),
      index = list.indexOf(active()),
      surface = board();
    root.querySelectorAll('[data-board-step]').forEach(button => {
      const back = Number(button.dataset.boardStep) < 0;
      button.disabled =
        layout === 'swipe'
          ? back
            ? index <= 0
            : index >= list.length - 1
          : back
            ? surface.scrollLeft <= 1
            : surface.scrollLeft + surface.clientWidth >= surface.scrollWidth - 1;
      button.hidden = layout === 'stacked';
    });
  }
  function render() {
    const list = columns();
    if (!list.some(column => column.dataset.spState === selected)) {
      selected = list[Math.min(previousIndex, list.length - 1)]?.dataset.spState || '';
    }
    previousIndex = Math.max(
      0,
      list.findIndex(column => column.dataset.spState === selected)
    );
    root.removeAttribute('data-mobile-filtered');
    const navigationRow = content.querySelector('[data-board-navigation]');
    const arrows = content.querySelector('.sp-column-navigation');
    const actionsRow = content.querySelector('.sp-actions');
    const arrowsParent = layout === 'columns' ? actionsRow : navigationRow;
    if (arrows && arrowsParent && arrows.parentElement !== arrowsParent) arrowsParent.prepend(arrows);
    const filters = content.querySelector('[data-project-filters]');
    if (navigationRow && filters && filters.parentElement !== navigationRow) navigationRow.append(filters);
    root.querySelectorAll('[data-board-layout-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.boardLayoutChoice === preference));
    });
    const tabs = content.querySelector('.sp-mobile-filter');
    tabs?.setAttribute('role', layout === 'swipe' ? 'tablist' : 'group');
    content.querySelectorAll('[data-shared-status]').forEach(button => {
      const value = button.dataset.sharedStatus,
        chosen = value === selected;
      button.hidden = value === 'all';
      button.id = `board-tab-${value}`;
      if (layout === 'swipe') {
        button.removeAttribute('aria-pressed');
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(chosen));
        button.setAttribute('aria-controls', `board-column-${value}`);
        button.tabIndex = chosen ? 0 : -1;
      } else {
        button.setAttribute('aria-pressed', String(chosen));
        button.removeAttribute('role');
        button.removeAttribute('aria-selected');
        button.removeAttribute('aria-controls');
        button.tabIndex = 0;
      }
    });
    list.forEach(column => {
      const chosen = column.dataset.spState === selected;
      column.id = `board-column-${column.dataset.spState}`;
      column.hidden = layout === 'swipe' && !chosen;
      column.toggleAttribute('data-mobile-selected', chosen);
      column.setAttribute('role', layout === 'swipe' ? 'tabpanel' : 'region');
      column.setAttribute(
        'aria-label',
        column.dataset.statusLabel || column.querySelector('h3')?.textContent || 'Tasks'
      );
      const stack = column.querySelector('.sp-stack');
      stack.tabIndex = 0;
      stack.setAttribute('aria-label', `${column.getAttribute('aria-label')} task list`);
      if (!column.hidden) stack.scrollTop = positions.get(column.dataset.spState) || 0;
    });
    navigation();
    persist();
    schedule();
  }
  function select(state, announce = true) {
    const list = columns(),
      column = list.find(item => item.dataset.spState === state);
    if (!column) return;
    const direction = list.indexOf(column) >= list.indexOf(active()) ? 1 : -1;
    capture();
    selected = state;
    render();
    animation?.cancel();
    if (layout === 'swipe' && !reduced() && column.animate) {
      animation = column.animate(
        [
          { opacity: 0.5, transform: `translateX(${direction * 18}px)` },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 180, easing: 'ease-out' }
      );
    }
    if (layout === 'stacked') column.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'instant' : 'smooth' });
    if (announce)
      actions.report(
        `${column.dataset.statusLabel}. ${column.querySelector('header > span')?.textContent || 0} tasks.`
      );
    // Scroll only the fallback status strip, never the surrounding page during a held drag.
    const button = [...content.querySelectorAll('[data-shared-status]')].find(item => item.dataset.sharedStatus === state),
      strip = button?.parentElement;
    if (button && strip && getComputedStyle(strip).display !== 'none') {
      const a = button.getBoundingClientRect(),
        b = strip.getBoundingClientRect();
      if (a.left < b.left) strip.scrollLeft -= b.left - a.left;
      if (a.right > b.right) strip.scrollLeft += a.right - b.right;
    }
  }
  function step(direction) {
    if (layout === 'swipe') {
      const list = columns(),
        next = list[list.indexOf(active()) + direction];
      if (next) select(next.dataset.spState);
    } else {
      const surface = board();
      surface.scrollBy({
        left: direction * ((columns()[0]?.getBoundingClientRect().width || 280) + 12),
        behavior: reduced() || lifted ? 'instant' : 'smooth'
      });
    }
  }
  const pixels = value => parseFloat(value) || 0;
  const median = values => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const outerHeight = element => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom);
  };
  const blockChrome = element => {
    const style = getComputedStyle(element);
    return (
      pixels(style.paddingTop) +
      pixels(style.paddingBottom) +
      pixels(style.borderTopWidth) +
      pixels(style.borderBottomWidth)
    );
  };
  function contentHeight(surface) {
    const measurements = columns()
      .filter(column => !column.hidden && getComputedStyle(column).display !== 'none')
      .map(column => {
        const stack = column.querySelector('.sp-stack');
        const items = [...stack.children].filter(item => !item.hidden && getComputedStyle(item).display !== 'none');
        const gap = pixels(getComputedStyle(stack).rowGap);
        const cards = items.filter(item => item.matches('.sp-card, [data-project-card]')).map(outerHeight);
        const itemHeight = items.reduce((total, item) => total + outerHeight(item), 0);
        const chrome = blockChrome(column) + outerHeight(column.querySelector(':scope > header')) + blockChrome(stack);
        return {
          cards,
          chrome,
          demand: chrome + itemHeight + Math.max(0, items.length - 1) * gap,
          gap
        };
      });
    if (!measurements.length) return 0;
    const demands = measurements.map(item => item.demand).sort((a, b) => a - b);
    const tallest = demands.at(-1);
    if (root.hasAttribute('data-board-expanded')) return Math.ceil(tallest + blockChrome(surface));
    const representative = demands.at(-2) ?? tallest;
    const cardHeight = median(measurements.flatMap(item => item.cards));
    const threeCardFloor = cardHeight
      ? median(measurements.map(item => item.chrome)) + cardHeight * 3 + median(measurements.map(item => item.gap)) * 2
      : representative;
    // Ignore one outlying column, but never make a short board taller than its natural content.
    const columnHeight = Math.min(tallest, Math.max(representative, threeCardFloor));
    return Math.ceil(columnHeight + blockChrome(surface));
  }
  function measure() {
    frame = 0;
    const surface = board();
    if (closed || !surface) return;
    const next = window.innerWidth <= 760 ? preference : 'columns';
    if (next !== layout) {
      actions.cancel();
      // Before enhancement, the uncapped fallback cannot restore scrollTop yet.
      // Do not overwrite stored positions with those initial zero values.
      if (layout) capture();
      layout = next;
      root.dataset.boardLayout = layout;
      render();
    }
    if (layout !== 'columns' && root.hasAttribute('data-board-expanded')) {
      root.removeAttribute('data-board-expanded');
      const expand = root.querySelector('[data-board-expand]');
      if (expand) { expand.textContent = 'Expand board'; expand.setAttribute('aria-expanded', 'false'); }
    }
    const viewport = window.visualViewport;
    const height = viewport?.height || innerHeight;
    const viewportTop = viewport?.offsetTop || 0;
    const canvas = content.querySelector('.sp-desktop-canvas');
    // Use the unscrolled toolbar footprint, so scrolling never changes the cap.
    const toolbar = surface.getBoundingClientRect().top - (canvas || content).getBoundingClientRect().top;
    const header = document.querySelector('.app-header');
    const top = Math.max(viewportTop, header?.getBoundingClientRect().bottom || 0);
    const safe = parseFloat(getComputedStyle(root).getPropertyValue('--board-safe-bottom')) || 0;
    const cap = Math.max(96, height - Math.max(0, top - viewportTop) - toolbar - 24 - safe);
    root.style.setProperty('--board-max-height', `${Math.floor(cap)}px`);
    if (layout === 'columns') root.style.setProperty('--board-content-height', `${contentHeight(surface)}px`);
    else root.style.removeProperty('--board-content-height');
    navigation();
  }
  function schedule() {
    if (!closed && !frame) frame = requestAnimationFrame(measure);
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  function refresh() {
    observer?.disconnect();
    [
      content,
      content.querySelector('.sp-desktop-canvas'),
      content.querySelector('.sp-heading'),
      content.querySelector('.sp-toolbar')
    ]
      .filter(Boolean)
      .forEach(node => observer?.observe(node));
    render();
    measure();
  }
  function resetTouch() {
    touch = null;
  }
  function touchStart(event) {
    resetTouch();
    if (
      layout !== 'swipe' ||
      event.touches.length !== 1 ||
      !event.target.closest('.sp-columns') ||
      event.target.closest('button,input,select,textarea,summary,.agreement-badges')
    )
      return;
    const point = event.touches[0],
      viewport = window.visualViewport;
    // Leave browser back/forward edge gestures alone.
    if (point.clientX < 24 || point.clientX > (viewport?.width || innerWidth) - 24) return;
    touch = { x: point.clientX, y: point.clientY, dx: 0, axis: '' };
  }
  function touchMove(event) {
    if (!touch || event.touches.length !== 1) return false;
    const point = event.touches[0],
      dx = point.clientX - touch.x,
      dy = point.clientY - touch.y;
    if (!touch.axis && Math.hypot(dx, dy) > 8) touch.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
    touch.dx = dx;
    if (touch.axis !== 'x') return false;
    if (!event.cancelable) {
      resetTouch();
      return false;
    }
    event.preventDefault();
    return true;
  }
  function touchEnd() {
    const previous = touch;
    resetTouch();
    if (previous?.axis !== 'x') return false;
    if (Math.abs(previous.dx) >= 48) step(previous.dx < 0 ? 1 : -1);
    return true;
  }
  function beginDrag() {
    resetTouch();
    edge = null;
    lifted = true;
    // A short/empty destination must not collapse out from under the held finger.
    gestureHeight = board().getBoundingClientRect().height;
    root.style.setProperty('--board-drag-height', `${gestureHeight}px`);
  }
  function finishDrag() {
    lifted = false;
    edge = null;
    root.style.removeProperty('--board-drag-height');
    schedule();
  }
  function dragTarget(x, y, states) {
    if (layout !== 'swipe') return undefined;
    const tab = [...content.querySelectorAll('[data-shared-status]')].find(button => {
      const rect = button.getBoundingClientRect();
      const strip = button.parentElement.getBoundingClientRect();
      return !button.hidden && x >= Math.max(rect.left, strip.left) && x <= Math.min(rect.right, strip.right) && y >= rect.top && y <= rect.bottom;
    });
    if (tab && states.includes(tab.dataset.sharedStatus)) return {target: tab, state: tab.dataset.sharedStatus};
    const bounds = board().getBoundingClientRect(),
      column = active();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom || !states.includes(selected))
      return null;
    return { target: column, state: selected };
  }
  function dragTick(x, y, now) {
    const surface = board(),
      bounds = surface.getBoundingClientRect();
    const inside = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    const direction = inside && layout !== 'stacked' ? (x < bounds.left + 40 ? -1 : x > bounds.right - 40 ? 1 : 0) : 0;
    if (!direction) edge = null;
    else if (edge?.direction !== direction) edge = { direction, at: now + 600 };
    else if (now >= edge.at) {
      step(direction);
      edge.at = now + 800;
    }
    const column = layout === 'swipe' ? active() : document.elementFromPoint(x, y)?.closest('.sp-column');
    const stack = column && root.contains(column) ? column.querySelector('.sp-stack') : null;
    if (!stack || !inside) {
      if (layout === 'stacked') {
        const outer = content.getBoundingClientRect();
        const delta = y < outer.top + 48 ? -10 : y > outer.bottom - 48 ? 10 : 0;
        if (delta) content.scrollBy(0, delta);
      }
      return;
    }
    const area = stack.getBoundingClientRect();
    const delta = y < area.top + 48 ? -10 : y > area.bottom - 48 ? 10 : 0;
    if (delta) {
      const before = stack.scrollTop;
      stack.scrollTop += delta;
      if (layout === 'stacked' && before === stack.scrollTop) content.scrollBy(0, delta);
    }
  }
  lifecycle.listen(root, 'click', event => {
    const choice = event.target.closest('[data-board-layout-choice]');
    if (choice) {
      actions.cancel();
      capture();
      preference = choice.dataset.boardLayoutChoice;
      write('localStorage', preferenceKey, preference);
      measure();
      render();
      const menu = choice.closest('.sp-mobile-overflow');
      if (menu) { menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }); }
    }
    const button = event.target.closest('[data-board-step]');
    if (button) step(Number(button.dataset.boardStep));
  });
  lifecycle.listen(root, 'keydown', event => {
    if (
      layout !== 'swipe' ||
      !event.target.matches('[data-shared-status]') ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End')
      select(columns()[event.key === 'Home' ? 0 : columns().length - 1].dataset.spState);
    else step(event.key === 'ArrowRight' ? 1 : -1);
    content.querySelector(`[data-shared-status="${selected}"]`)?.focus({ preventScroll: true });
  });
  lifecycle.listen(
    content,
    'scroll',
    event => {
      if (event.target.matches('.sp-stack')) {
        if (event.target.closest('[data-sp-state]').hidden) return;
        positions.set(event.target.closest('[data-sp-state]').dataset.spState, event.target.scrollTop);
        persist();
      }
      if (event.target.matches('.sp-columns')) navigation();
    },
    { capture: true, passive: true }
  );
  lifecycle.listen(window, 'resize', () => {
    actions.cancel();
    schedule();
  });
  if (window.visualViewport) {
    lifecycle.listen(window.visualViewport, 'resize', schedule);
    lifecycle.listen(window.visualViewport, 'scroll', schedule);
  }
  lifecycle.listen(document, 'visibilitychange', () => {
    if (document.hidden) actions.cancel();
  });
  lifecycle.onClose(() => {
    capture();
    closed = true;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    animation?.cancel();
    resetTouch();
  });
  refresh();
  return {
    refresh,
    capture,
    select,
    schedule,
    touchStart,
    touchMove,
    touchEnd,
    resetTouch,
    beginDrag,
    finishDrag,
    dragTarget,
    dragTick,
    busy: () => Boolean(touch),
    isSwipe: () => layout === 'swipe'
  };
};
