// Room and floor views, and the zoom that moves between them and the camera.
//
// Zoom is one number. Below 1 shows the floor plan, 1–2 shows one room, and
// 2 and up shows the camera (the table view). Within the floor and room views
// the drawing magnifies up to 2× before switching to the next level.

// Each chair has its own colour and marker shape, keyed by the number in its QR text.
export const CHAIR_STYLES = {
  1: { color: '#e3271b', shape: 'triangle' },
  2: { color: '#1fa34a', shape: 'circle' },
  3: { color: '#1f5fe0', shape: 'square' },
  4: { color: '#e07b00', shape: 'diamond' },
  5: { color: '#9b2fc9', shape: 'down' },
  6: { color: '#0e9aa7', shape: 'circle' },
};

// SVG path data for a marker centred on (x, y). Also used on the canvas via Path2D.
export function markerPath(shape, x, y, r) {
  switch (shape) {
    case 'triangle':
      return `M${x} ${y - r}L${x + r * 0.95} ${y + r * 0.65}L${x - r * 0.95} ${y + r * 0.65}Z`;
    case 'down':
      return `M${x} ${y + r}L${x + r * 0.95} ${y - r * 0.65}L${x - r * 0.95} ${y - r * 0.65}Z`;
    case 'square':
      return `M${x - r * 0.8} ${y - r * 0.8}h${r * 1.6}v${r * 1.6}h${-r * 1.6}Z`;
    case 'diamond':
      return `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`;
    default: {
      const c = r * 0.85;
      return `M${x - c} ${y}a${c} ${c} 0 1 0 ${2 * c} 0a${c} ${c} 0 1 0 ${-2 * c} 0Z`;
    }
  }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Zoom is measured in levels, as in gesture-lab.html: 0–1 is the floor plan,
// 1–2 a room, 2–3 the table (camera). One level = one doubling of magnification.
const ORDER = ['floor', 'room', 'table'];
const LEVELS = { floor: 0, room: 1, table: 2 };
const MIN_Z = 0, MAX_Z = 2.999;
const levelOf = z => ORDER[Math.min(2, Math.max(0, Math.floor(z)))];
// The level showing only changes once the zoom is this far (in levels) past
// an edge, so hand jitter at an edge doesn't flip views. Tuned in the lab.
const DEAD = 0.15;
function nextLevel(z, current) {
  const raw = levelOf(z);
  const step = ORDER.indexOf(raw) - ORDER.indexOf(current);
  if (Math.abs(step) !== 1) return raw;
  const edge = LEVELS[step > 0 ? raw : current];
  return Math.abs(z - edge) < DEAD ? current : raw;
}

// ── Drawing, shared by the reader's views and gesture-lab.html's map.

// Every spot in a room, with the chair designated to it (if any) and its owner.
// liveSeat(spotId) answers for the live room; other rooms use their "demo" seats.
function seats(r, liveSeat) {
  const out = [];
  for (const t of r.tables) {
    for (let n = 1; n <= t.spots; n++) {
      const spot = t.id + n;
      let seat = { chair: null, owner: null, inView: true, style: null };
      if (r.live) seat = liveSeat(spot);
      else if (r.demo && spot in r.demo) seat = { chair: true, owner: r.demo[spot] || null, inView: true, style: null };
      out.push({ spot, table: t, n, ...seat });
    }
  }
  return out;
}

// A seat is a spot with a chair; it is taken while someone's stuff is on it.
function tally(list) {
  const total = list.filter(s => s.chair).length;
  const taken = list.filter(s => s.chair && s.owner).length;
  return { total, taken, empty: total - taken };
}

function hatch(id) {
  return `<defs><pattern id="${id}" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="1.2" style="stroke:var(--ink);stroke-width:0.35"/></pattern></defs>`;
}

// One room drawn into the box (X, Y, W, H). `detail` adds names and labels
// for the room view; the floor plan shows only marks.
function drawRoom(r, X, Y, W, H, detail, hatchId, liveSeat) {
  const list = seats(r, liveSeat);
  let s = '';
  for (const t of r.tables) {
    const [tx, ty, tw, th] = t.rect;
    const x = X + tx * W, y = Y + ty * H, w = tw * W, h = th * H, sw = w / t.spots;
    for (const seat of list.filter(q => q.table === t)) {
      const cx = x + (seat.n - 0.5) * sw;
      // Out-of-view chairs are faded. Only a class name: elements that already
      // have a class add it to theirs (a second class attribute would be ignored).
      const out = seat.inView ? '' : ' out';
      if (seat.owner) {
        s += `<rect x="${x + (seat.n - 1) * sw}" y="${y}" width="${sw}" height="${h}" style="fill:url(#${hatchId});stroke:none"/>`;
        if (detail) s += `<text class="v-owner" x="${cx}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central"><tspan class="v-chip">${esc(seat.owner)}</tspan></text>`;
      }
      if (!seat.chair) {
        if (detail) s += `<text class="v-label dim" x="${cx}" y="${y + h + 3}" text-anchor="middle">no chair</text>`;
        continue;
      }
      const r0 = detail ? Math.min(sw * 0.2, 2.6) : Math.min(sw * 0.25, 1.1);
      const cy = y + h + r0 * 1.9;
      const color = seat.style?.color ?? 'var(--ink)';
      const fill = seat.owner ? color : 'var(--bg)';
      s += `<path class="${out.trim()}" d="${markerPath(seat.style?.shape ?? 'square', cx, cy, r0)}" style="fill:${fill};stroke:${color};stroke-width:${detail ? 0.45 : 0.25}"/>`;
      if (detail) {
        // "Kathy's / chair" on two lines, so long names don't run into the next spot.
        const label = seat.owner
          ? `<tspan x="${cx}">${esc(seat.owner)}'s</tspan><tspan x="${cx}" dy="1.15em">chair</tspan>`
          : 'Empty';
        s += `<text class="v-label${out}" x="${cx}" y="${cy + r0 + 2.6}" text-anchor="middle">${label}</text>`;
      }
    }
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" style="fill:none;stroke:var(--ink);stroke-width:${detail ? 0.6 : 0.3}"/>`;
    for (let n = 1; n < t.spots; n++) {
      const dx = x + n * sw;
      s += `<line x1="${dx}" y1="${y}" x2="${dx}" y2="${y + h}" style="stroke:var(--ink);stroke-width:${detail ? 0.3 : 0.15};stroke-dasharray:${detail ? '0.3 0.4' : '0.15 0.25'}"/>`;
    }
    if (detail) s += `<text class="v-label" x="${x}" y="${y - 1}">TABLE ${esc(t.id)}</text>`;
  }
  return { svg: s, ...tally(list) };
}

const countText = (c, x, y, anchor, cls) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">` +
  (c.total ? `<tspan class="v-count">${c.empty}</tspan><tspan class="v-of"> / ${c.total} empty</tspan>`
           : `<tspan class="v-of">no chairs</tspan>`) + '</text>';

// The whole floor in one drawing, every room in detail, for a map that zooms
// continuously from the floor down to a table (gesture-lab.html).
export function planMarkup(floor, liveSeat = () => ({ chair: null, owner: null, inView: true, style: null })) {
  let s = hatch('hatch-plan');
  for (const r of floor.rooms) {
    const [x, y, w, h] = r.rect;
    const D = drawRoom(r, x, y, w, h, true, 'hatch-plan', liveSeat);
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" style="fill:var(--bg);stroke:var(--ink);stroke-width:0.5"/>` +
      `<text class="v-room" x="${x + 1.2}" y="${y + 2.6}">${esc(r.name)}</text>` +
      `<text class="v-tag" x="${x + 1.2}" y="${y + 4.4}">${r.live ? 'LIVE' : 'DEMO'}</text>` +
      countText(D, x + w - 1.2, y + 3.4, 'end', '') + D.svg;
  }
  return s;
}

// floor: the parsed floor.json. liveSeat(spotId) → { chair, owner, inView, style }
// for the room the camera is watching; other rooms use their "demo" seats.
export function createViews({ floor, stage, liveSeat }) {
  const roomSvg = stage.querySelector('#roomView');
  const floorSvg = stage.querySelector('#floorView');
  const buttons = document.querySelectorAll('.levels button');
  const live = floor.rooms.find(r => r.live) ?? floor.rooms[0];

  let z = LEVELS.table + 0.5;
  let current = 'table';    // the level showing; can lag levelOf(z) near a boundary
  let room = live;
  let origin = null;        // zoom focus in stage pixels; null = centre
  let gestureStart = null;  // zoom value when the current pinch began

  function render() {
    // Room view: the selected room filling the stage.
    const [, , rw, rh] = room.rect;
    const vh = (100 * rh) / rw;
    roomSvg.setAttribute('viewBox', `-4 -14 108 ${vh + 20}`);
    const R = drawRoom(room, 0, 0, 100, vh, true, 'hatch-room', liveSeat);
    roomSvg.innerHTML = hatch('hatch-room') +
      `<text class="v-name" x="0" y="-5">${esc(room.name)}</text>` +
      `<text class="v-tag" x="0" y="-1.5">${room.live ? 'LIVE — CAMERA' : 'DEMO DATA'}</text>` +
      countText(R, 100, -5, 'end', '') +
      `<rect x="0" y="0" width="100" height="${vh}" style="fill:none;stroke:var(--ink);stroke-width:0.8"/>` + R.svg;

    // Floor plan: every room, each marked with how many seats are empty.
    const [fw, fh] = floor.size;
    floorSvg.setAttribute('viewBox', `-2 -8 ${fw + 4} ${fh + 10}`);
    let f = hatch('hatch-floor') +
      `<text class="v-name" x="0" y="-3">${esc(floor.name)}</text>` +
      `<text class="v-tag" x="${fw}" y="-3" text-anchor="end">■ TAKEN  □ EMPTY  ▨ STUFF ON SPOT</text>`;
    for (const r of floor.rooms) {
      const [x, y, w, h] = r.rect;
      const D = drawRoom(r, x, y, w, h, false, 'hatch-floor', liveSeat);
      f += `<g class="room${r === room ? ' current' : ''}" data-room="${esc(r.id)}">` +
        `<rect class="hit" x="${x}" y="${y}" width="${w}" height="${h}" style="stroke:var(--ink);stroke-width:0.5"/>` +
        `<text class="v-room" x="${x + 1.2}" y="${y + 2.6}">${esc(r.name)}</text>` +
        `<text class="v-tag" x="${x + 1.2}" y="${y + 4.4}">${r.live ? 'LIVE' : 'DEMO'}</text>` +
        countText(D, x + w - 1.2, y + 3.4, 'end', '') + D.svg + '</g>';
    }
    floorSvg.innerHTML = f;
  }

  // The floor room under a stage point, if the floor plan is showing.
  function roomAt(focus) {
    if (!focus) return null;
    const b = stage.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + focus.x, b.top + focus.y);
    const id = hit?.closest?.('[data-room]')?.dataset.room;
    return floor.rooms.find(r => r.id === id) ?? null;
  }

  function setZoom(next, focus) {
    next = Math.min(MAX_Z, Math.max(MIN_Z, next));
    const before = current;
    // Zooming in from the floor plan opens the room under the focus point.
    if (before === 'floor' && nextLevel(next, before) !== 'floor') room = roomAt(focus) ?? room;
    // Only the live room has a camera view.
    if (!room.live) next = Math.min(next, LEVELS.table - 0.001);
    z = next;
    const level = nextLevel(z, before);
    // The drawing is at 1× when a level opens, so the focus can move without a jump.
    if (level !== before || gestureStart == null) origin = focus ?? origin;
    apply(level, before);
  }

  function apply(level, before) {
    current = level;
    stage.dataset.level = level;
    const o = origin ? `${origin.x}px ${origin.y}px` : '50% 50%';
    floorSvg.style.transformOrigin = roomSvg.style.transformOrigin = o;
    // Within the floor and room levels the drawing magnifies 1×–2× (one doubling per level).
    const mag = n => 2 ** Math.max(-0.5, Math.min(1.25, z - n));
    floorSvg.style.transform = `scale(${level === 'floor' ? mag(LEVELS.floor) : 1})`;
    roomSvg.style.transform = `scale(${level === 'room' ? mag(LEVELS.room) : 1})`;
    if (level !== before) render();
    buttons.forEach(b => b.setAttribute('aria-pressed', b.dataset.level === level));
  }

  function goTo(level, roomId) {
    if (roomId) room = floor.rooms.find(r => r.id === roomId) ?? room;
    if (level === 'table') room = live;
    origin = null;
    const before = current;
    // Floor and room open at 1×; the table (which doesn't magnify) opens mid-level.
    z = LEVELS[level] + (level === 'table' ? 0.5 : 0);
    apply(level, before);
    render();
  }

  // Inputs give magnification factors; in levels that is log2 of the factor.
  const zoomBy = (factor, focus) => setZoom(z + Math.log2(factor), focus);
  const beginGesture = focus => { gestureStart = z; origin = focus ?? origin; };
  const gesture = (factor, focus) => { if (gestureStart != null) setZoom(gestureStart + Math.log2(factor), focus); };
  const endGesture = () => { gestureStart = null; };
  // Sets the zoom outright during a gesture (two-hand distance: distance = zoom).
  const zoomTo = (target, focus) => { if (gestureStart != null) setZoom(target, focus); };

  // ── Inputs other than hands: nav buttons, room clicks, keys, trackpad, touch.

  buttons.forEach(b => b.addEventListener('click', () => goTo(b.dataset.level)));

  floorSvg.addEventListener('click', e => {
    const id = e.target.closest('[data-room]')?.dataset.room;
    if (id) goTo('room', id);
  });

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') zoomBy(0.8);
  });

  const local = e => {
    const b = stage.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const outside = e => e.target.closest?.('.drawer');

  // Trackpad pinch arrives as ctrl + wheel in Chrome and Firefox.
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey || outside(e)) return;
    e.preventDefault();
    const d = Math.max(-25, Math.min(25, e.deltaY));
    zoomBy(Math.exp(-d * 0.01), local(e));
  }, { passive: false });

  // Safari reports trackpad pinch as gesture events instead.
  stage.addEventListener('gesturestart', e => { e.preventDefault(); beginGesture(local(e)); });
  stage.addEventListener('gesturechange', e => { e.preventDefault(); gesture(e.scale, local(e)); });
  stage.addEventListener('gestureend', e => { e.preventDefault(); endGesture(); });

  // Two-finger pinch on a touch screen.
  const touches = new Map();
  let touchSpan = null;
  const span = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const mid = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || outside(e)) return;
    touches.set(e.pointerId, local(e));
    if (touches.size === 2) { touchSpan = span(); beginGesture(mid()); }
  });
  stage.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, local(e));
    if (touches.size === 2 && touchSpan) gesture(span() / touchSpan, mid());
  });
  const lift = e => {
    if (!touches.delete(e.pointerId)) return;
    if (touchSpan && touches.size < 2) { touchSpan = null; endGesture(); }
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);

  apply(current, null);

  return {
    render,
    beginGesture,
    gesture,
    zoomTo,
    endGesture,
    get level() { return current; },
  };
}
