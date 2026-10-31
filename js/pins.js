/**
 * Station pins: one HTML marker per mapped station record, never aggregated.
 *
 * Pins are the keyboard and screen-reader way into the map (the three.js plates
 * in js/scene.js are the visual 3D marks). Each pin is projected every frame —
 * elevated stations at their display altitude when 3D is on (camera.projectPoint),
 * so the dot sits on its plate. Co-located points get a bounded screen-space slot
 * near their own anchor (separatePins) with a leader line for the hovered or
 * selected pin; source coordinates never change.
 *
 * Colour: the pin fill is the identity colour of the station's first line (the
 * colour in the line's own name, with its source in data/transit.json); a station
 * served by two or more lines gets a ring cue; a station under construction is
 * hollow and dashed. Context pins (outside the focus) are small grey dots without
 * labels and outside the tab order. Station name labels appear only at zoom ≥
 * LABEL_MIN_ZOOM, only for focused stations, collision-managed (≤ MAX_LABELS).
 */
import {projectPoint} from './camera.js';

export const MAX_LABELS = 160;
export const LABEL_MIN_ZOOM = 13.5;
const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
const inside = (p, b) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
const pointBox = (x, y, size) => ({left: x - size / 2, right: x + size / 2, top: y - size / 2, bottom: y + size / 2});

export const isSourceVisible = (point, bounds) => Number.isFinite(point.x) && Number.isFinite(point.y) && inside(point, bounds) && !(bounds.exclusions || []).some(b => inside(point, b));

/**
 * Compact display-only slots. A strict source-distance cap replaces any
 * viewport-wide fan. The caller supplies only unobscured source anchors.
 */
export function separatePins(points, bounds, spacing = 8, {minSpacing = 0.5, maxOffset = 36} = {}) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.id.localeCompare(b.id));
  for (let pitch = spacing; pitch >= minSpacing; pitch = pitch > 2 ? pitch - 1 : pitch / 2) {
    const offsets = [], used = new Map(), placed = [];
    const ring = Math.ceil(maxOffset / pitch);
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      const x = dx * pitch, y = dy * pitch, d = x * x + y * y;
      if (d <= maxOffset * maxOffset + 0.001) offsets.push({x, y, d});
    }
    offsets.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    const collision = (x, y) => {
      const cx = Math.floor(x / pitch), cy = Math.floor(y / pitch);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
        for (const q of used.get(`${a},${b}`) || []) if (Math.abs(x - q.x) < pitch - 0.001 && Math.abs(y - q.y) < pitch - 0.001) return true;
      }
      return false;
    };
    for (const p of sorted) {
      let found = null;
      for (const o of offsets) {
        const x = p.x + o.x, y = p.y + o.y, box = pointBox(x, y, pitch);
        if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom ||
            (bounds.exclusions || []).some(b => intersects(box, b)) || collision(x, y)) continue;
        found = {...p, x, y, anchorX: p.x, anchorY: p.y, spacing: pitch};
        break;
      }
      if (!found) break;
      placed.push(found);
      const key = `${Math.floor(found.x / pitch)},${Math.floor(found.y / pitch)}`;
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(found);
    }
    if (placed.length === sorted.length) return placed;
  }
  throw new Error('Local viewport is too small for individual pins');
}

/**
 * Station name labels. Interchanges and the selected station get a turn first,
 * then the rest by distance to the view centre; a label is accepted only when it
 * clears every other pin, UI obstacle and accepted label.
 * Returns Map<id, {x, y, box}>; `measure(p)` returns {width, height} of p's label.
 */
export function placeLabels(points, bounds, {limit = MAX_LABELS, measure, selectedId = '', gap = 6} = {}) {
  const result = new Map(), labels = [];
  const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
  const candidates = [...points].sort((a, b) =>
    Number(b.id === selectedId) - Number(a.id === selectedId) ||
    Number(b.priority || 0) - Number(a.priority || 0) ||
    ((a.anchorX - cx) ** 2 + (a.anchorY - cy) ** 2) - ((b.anchorX - cx) ** 2 + (b.anchorY - cy) ** 2) ||
    a.id.localeCompare(b.id));
  for (const p of candidates) {
    if (result.size >= limit) break;
    const {width, height} = measure(p);
    if (!(width > 0 && height > 0)) continue;
    const offsets = [[width / 2 + gap, 0], [-width / 2 - gap, 0], [0, -height / 2 - gap], [0, height / 2 + gap]];
    for (const [dx, dy] of offsets) {
      const x = p.x + dx, y = p.y + dy;
      const box = {left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2};
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom ||
          (bounds.exclusions || []).some(b => intersects(box, b, 4)) || labels.some(b => intersects(box, b, 3)) ||
          points.some(q => q.id !== p.id && intersects(box, pointBox(q.x, q.y, Math.max(3, q.spacing || 3)), 2))) continue;
      labels.push(box);
      result.set(p.id, {x, y, box});
      break;
    }
  }
  return result;
}

/**
 * Mount the pin overlay on a MapLibre map container.
 * options.reservedBottom(): px at the bottom of the map that overlays cover.
 * options.altitude(row): display altitude (m) of a row's pin, 0 on the ground.
 * options.describe(row): {label, color, interchange, construction} for one row.
 * options.onSelect(row) / onHover(row|null) / onLayout(stats).
 */
export function installStationPins(map, container, {onSelect, onHover, onLayout, describe, altitude = () => 0, reservedBottom = () => 90} = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'station-pin-overlay';
  overlay.setAttribute('aria-label', 'หมุดสถานี ใช้ลูกศรเลือกหมุดถัดไป');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('pin-leaders');
  svg.setAttribute('aria-hidden', 'true');
  const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  anchor.setAttribute('r', '3');
  svg.append(leader, anchor);
  overlay.append(svg);
  container.append(overlay);

  let entries = [], frame = 0, activeId = '', selectedId = '', hoveredId = '';
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };

  function layout() {
    const width = container.clientWidth, height = container.clientHeight;
    const panel = container.closest('.map-panel'), rect = container.getBoundingClientRect();
    panel?.classList.toggle('is-tight', height < 480);
    const obstacle = e => { const b = e.getBoundingClientRect(); return {left: b.left - rect.left - 3, right: b.right - rect.left + 3, top: b.top - rect.top - 3, bottom: b.bottom - rect.top + 3}; };
    const blockers = panel ? [...panel.querySelectorAll('.map-toolbar button, .mode-chip, .mode-menu, .province-label, .map-legend, .map-status, .map-aha, .ray-status, .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left')]
      .filter(e => e.offsetWidth && e.offsetHeight).map(obstacle) : [];
    const bounds = {left: 5, right: width - 5, top: 5, bottom: Math.max(6, height - reservedBottom()), exclusions: blockers};
    const zoom = map.getZoom();
    overlay.classList.toggle('is-overview', zoom < 10.5);
    overlay.classList.toggle('is-midzoom', zoom >= 10.5 && zoom < 13);
    const projected = [];
    for (const e of entries) {
      const alt = altitude(e.row) || 0;
      const p = alt ? projectPoint(map, [e.row.lng, e.row.lat, alt]) : map.project([e.row.lng, e.row.lat]);
      const visible = isSourceVisible(p, bounds);
      e.button.hidden = !visible;
      e.label.hidden = true;
      if (visible) projected.push({id: e.row.id, x: p.x, y: p.y, entry: e, priority: e.priority});
    }
    const pitch = zoom >= 13 ? 9 : zoom >= 11 ? 6 : zoom >= 8 ? 3.5 : 2;
    const maxOffset = zoom >= 13 ? 30 : zoom >= 11 ? 18 : zoom >= 8 ? 10 : 6;
    let placed;
    try { placed = separatePins(projected, bounds, pitch, {minSpacing: 0.125, maxOffset}); }
    catch { placed = projected.map(p => ({...p, anchorX: p.x, anchorY: p.y, spacing: 1})); }
    const focusPlaced = placed.filter(p => !p.entry.context);
    const labelBounds = {...bounds, exclusions: blockers};
    const labels = zoom >= LABEL_MIN_ZOOM ? placeLabels(focusPlaced, labelBounds, {selectedId, measure: p => {
      const l = p.entry.label;
      if (!p.entry.size) { l.hidden = false; l.style.left = '-9999px'; p.entry.size = {width: l.offsetWidth, height: l.offsetHeight}; l.hidden = true; }
      return p.entry.size;
    }}) : new Map();
    const ids = focusPlaced.map(p => p.id);
    if (!ids.includes(activeId)) activeId = ids[0] || '';
    for (const p of placed) {
      const {button, label} = p.entry;
      button.style.left = `${p.x}px`;
      button.style.top = `${p.y}px`;
      button.style.setProperty('--pin-size', `${Math.max(0.5, Math.min(10, p.spacing - 0.5))}px`);
      button.tabIndex = !p.entry.context && p.id === activeId ? 0 : -1;
      button.dataset.displaced = String(Math.hypot(p.x - p.anchorX, p.y - p.anchorY) > 2);
      const l = labels.get(p.id);
      if (l) {
        label.hidden = false;
        label.style.left = `${l.x - p.x}px`;
        label.style.top = `${l.y - p.y}px`;
      }
    }
    const focus = placed.find(p => p.id === (hoveredId || selectedId));
    svg.style.display = focus ? '' : 'none';
    if (focus) {
      for (const [k, v] of Object.entries({x1: focus.anchorX, y1: focus.anchorY, x2: focus.x, y2: focus.y})) leader.setAttribute(k, v);
      anchor.setAttribute('cx', focus.anchorX);
      anchor.setAttribute('cy', focus.anchorY);
    }
    overlay.dataset.visiblePins = String(focusPlaced.length);
    overlay.dataset.contextPins = String(placed.length - focusPlaced.length);
    overlay.dataset.visibleLabels = String(labels.size);
    onLayout?.({visiblePins: focusPlaced.length, contextPins: placed.length - focusPlaced.length, visibleLabels: labels.size, zoom});
  }

  /**
   * rows = the focused selection (full detail: line colour, label, keyboard).
   * contextRows = the rest of the filtered scope, drawn as quiet context dots:
   * one per station, no label, not in the tab order, still clickable.
   */
  function update(rows, {contextRows = []} = {}) {
    for (const e of entries) e.button.remove();
    entries = [];
    const focusIds = new Set(rows.map(r => r.id));
    const valid = r => Number.isFinite(r.lat) && Number.isFinite(r.lng);
    const all = [...rows.filter(valid), ...contextRows.filter(r => valid(r) && !focusIds.has(r.id)).map(r => ({row: r, context: true}))];
    for (const item of all) {
      const row = item.row || item, context = Boolean(item.context);
      const d = describe ? describe(row) : {label: row.name, color: '', interchange: false, construction: false};
      const button = document.createElement('button'), label = document.createElement('span'), dot = document.createElement('span');
      button.type = 'button';
      button.className = `station-pin${d.construction ? ' is-construction' : ''}${d.interchange ? ' is-interchange' : ''}${context ? ' is-context' : ''}`;
      button.dataset.stationId = row.id;
      if (!context && d.color) button.style.setProperty('--pin-fill', d.color);
      button.setAttribute('aria-label', d.label);
      button.title = d.label;
      dot.className = 'pin-dot';
      dot.setAttribute('aria-hidden', 'true');
      label.className = 'pin-label';
      label.hidden = true;
      label.setAttribute('aria-hidden', 'true');
      label.textContent = context ? '' : (d.shortLabel || row.name || '');
      button.append(dot, label);
      overlay.append(button);
      button.classList.toggle('is-selected', selectedId === row.id);
      const entry = {row, button, label, context, priority: d.interchange ? 2 : d.construction ? 0 : 1};
      button.onclick = () => { select(row.id); onSelect?.(row); };
      if (context) {
        button.setAttribute('aria-hidden', 'true');
        entries.push(entry);
        continue;
      }
      button.onmouseenter = () => { hoveredId = row.id; onHover?.(row); schedule(); };
      button.onmouseleave = () => { hoveredId = ''; onHover?.(null); schedule(); };
      button.onfocus = () => { activeId = row.id; hoveredId = row.id; onHover?.(row); for (const e of entries) e.button.tabIndex = e.row.id === activeId ? 0 : -1; schedule(); };
      button.onblur = () => { hoveredId = ''; onHover?.(null); schedule(); };
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const visible = entries.filter(e => !e.button.hidden && !e.context), i = visible.findIndex(e => e.row.id === row.id);
        const j = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + visible.length) % visible.length;
        visible[j]?.button.focus();
      };
      entries.push(entry);
    }
    schedule();
  }

  function select(id) {
    selectedId = id;
    for (const e of entries) e.button.classList.toggle('is-selected', e.row.id === id);
    schedule();
  }
  function hover(id) {
    hoveredId = id || '';
    for (const e of entries) e.button.classList.toggle('is-hovered', e.row.id === hoveredId);
    schedule();
  }

  map.on('move', schedule);
  map.on('resize', schedule);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(container);
  return {
    update, select, hover, layout: schedule,
    dispose() { cancelAnimationFrame(frame); map.off('move', schedule); map.off('resize', schedule); resize?.disconnect(); overlay.remove(); },
  };
}
