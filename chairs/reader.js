import { CHAIR_STYLES, markerPath, createViews } from './views.js';
import { loadHandTracker, createPinchZoom } from './hands.js';

// How long a code stays "present" after its last detection (rides out dropped frames).
const HOLD_MS = 700;
// How long a new arrangement must stay unchanged before it counts as a state change.
const STABLE_MS = 600;

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const stageEl = document.getElementById('stage');

// The floor plan, its rooms and their tables. Needs the page served over HTTP.
let floor;
try {
  floor = await fetch('floor.json').then(r => r.json());
} catch (err) {
  statusEl.textContent = 'Could not load floor.json — serve this folder over HTTP';
  throw err;
}
// The room the camera is watching. Its tables are placed as fractions of the
// camera image as displayed: [left, top, width, height].
const liveRoom = floor.rooms.find(r => r.live) ?? floor.rooms[0];
const TABLES = liveRoom.tables.map(t => {
  const [x, y, w, h] = t.rect;
  return { id: t.id, spots: t.spots, x, y, w, h };
});

let detector = null;
let busy = false;

// rawValue -> { center:{x,y}, size, pts, seen }
const tracked = new Map();

let pendingSig = null, pendingSince = 0, committedSig = null;
let currentState = { timestamp: null, room: liveRoom.id, inView: [], spots: {}, owners: {} };

// track id -> the QR text it was read from (they differ for repeated codes, "chair 1 #2").
const instanceValue = new Map();
const valueOf = id => instanceValue.get(id) ?? id;

// Each code is a chair or someone's stuff. Stuff is recognised from QR text ending
// in "stuff"/"things"/"belongings" ("kathy's stuff"); anything else is a chair.
const STUFF_RE = /(?:['’]s?)?\s*\b(stuff|things|belongings)\s*$/i;
const isChair = id => !STUFF_RE.test(valueOf(id));
const isStuff = id => !isChair(id);
// Whose stuff it is: the QR text minus "'s stuff" ("kathy's stuff" → "Kathy").
const ownerOf = id => {
  const v = valueOf(id);
  const name = v.replace(STUFF_RE, '').trim() || v;
  return name[0].toUpperCase() + name.slice(1);
};

// Detection always runs on the unflipped frame; mirroring is display-only,
// so the overlay flips its coordinates to match the flipped video.
let flipV = true, flipH = true;
document.getElementById('flipV').addEventListener('change', e => {
  flipV = e.target.checked;
  stageEl.classList.toggle('flip-v', flipV);
});
document.getElementById('flipH').addEventListener('change', e => {
  flipH = e.target.checked;
  stageEl.classList.toggle('flip-h', flipH);
});

// Camera options dropdown, opened from the arrow beside Start camera.
const menu = document.getElementById('menu');
const menuToggle = document.getElementById('menuToggle');
const setMenu = open => {
  menu.hidden = !open;
  menuToggle.setAttribute('aria-expanded', open);
};
menuToggle.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('click', e => {
  if (!document.getElementById('split').contains(e.target)) setMenu(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuToggle.focus(); }
});

// "Show states" slides the states drawer in from the right.
const showStates = document.getElementById('showStates');
showStates.addEventListener('click', () => {
  const on = document.body.classList.toggle('show-states');
  showStates.setAttribute('aria-pressed', on);
  showStates.textContent = on ? 'Hide states' : 'Show states';
});

document.getElementById('copy').addEventListener('click', () => {
  navigator.clipboard?.writeText(JSON.stringify(currentState, null, 2));
});

// One button turns the camera on and off.
const startBtn = document.getElementById('start');
const emptyEl = document.getElementById('empty');
let stream = null;
// Bumped on every start and stop, so a loop from an earlier session ends itself.
let session = 0;

startBtn.addEventListener('click', () => (stream ? stopCamera() : startCamera()));

async function startCamera() {
  startBtn.disabled = true;
  try {
    statusEl.textContent = 'Loading detector…';
    detector ??= await getDetector();
    statusEl.textContent = 'Requesting camera…';
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    emptyEl.hidden = true;
    startBtn.textContent = 'Stop camera';
    statusEl.textContent = 'Scanning';
    const run = ++session;
    requestAnimationFrame(() => tick(run));
    if (handsOn) ensureHands();
  } catch (err) {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    statusEl.textContent = 'Error: ' + err.message;
    console.error(err);
  }
  startBtn.disabled = false;
}

// Stopping releases the camera and commits "nothing in view" right away.
// Chairs keep their spots and last state, as when they leave the frame.
function stopCamera() {
  session++;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  tracked.clear();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  clearHands();
  commit([], {});
  emptyEl.hidden = false;
  startBtn.textContent = 'Start camera';
  statusEl.textContent = 'Camera off';
}

// Native BarcodeDetector (Chrome/Edge/Android) can return many codes per frame.
// Other browsers fall back to a ZXing-based polyfill with the same API.
async function getDetector() {
  if ('BarcodeDetector' in window) {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (formats.includes('qr_code')) return new BarcodeDetector({ formats: ['qr_code'] });
  }
  const mod = await import('https://cdn.jsdelivr.net/npm/barcode-detector@2/pure/+esm');
  return new mod.BarcodeDetector({ formats: ['qr_code'] });
}

// QR detection is slow on a full camera frame, so it runs in the background at
// most this often. The frame loop never waits for it, which keeps hand tracking
// and zooming at the full frame rate.
const QR_EVERY_MS = 66;
let lastQr = 0;

function tick(run) {
  if (run !== session) return;
  const now = performance.now();
  if (!busy && video.readyState >= 2 && now - lastQr >= QR_EVERY_MS) {
    busy = true;
    lastQr = now;
    detector.detect(video)
      // Ignore a detection that finishes after the camera was stopped.
      .then(codes => { if (run === session) ingest(codes, performance.now()); })
      .catch(err => console.warn(err))
      .finally(() => { busy = false; });
  }
  for (const [id, t] of tracked) if (now - t.seen > HOLD_MS) tracked.delete(id);

  const spots = locateSpots();
  // The camera overlay is hidden under the room and floor views; skip drawing it there.
  if (views.level === 'table') draw();
  else if (canvas.width) ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateState(spots, now);
  trackHands(now);
  requestAnimationFrame(() => tick(run));
}


// Several printed codes can share the same QR text (e.g. two "kathy's stuff" cards).
// Each physical copy gets its own track id: the text itself for the first,
// then "text #2", "text #3"…, matched frame to frame by position.
function ingest(codes, now) {
  const byValue = new Map();
  for (const c of codes) {
    const pts = c.cornerPoints;
    if (!pts || pts.length < 4) continue;
    const center = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    let size = 0;
    for (let i = 0; i < 4; i++) size += Math.hypot(pts[(i + 1) % 4].x - pts[i].x, pts[(i + 1) % 4].y - pts[i].y);
    size /= 4;
    if (!byValue.has(c.rawValue)) byValue.set(c.rawValue, []);
    byValue.get(c.rawValue).push({ center, size, pts });
  }

  for (const [value, dets] of byValue) {
    // Greedy nearest match between this frame's detections and existing tracks.
    const tracks = [...tracked].filter(([, t]) => t.value === value);
    const options = [];
    dets.forEach((d, di) => tracks.forEach(([id, t]) => {
      const dist = Math.hypot(d.center.x - t.center.x, d.center.y - t.center.y) / d.size;
      if (dist < 3) options.push({ di, id, dist });
    }));
    options.sort((a, b) => a.dist - b.dist);
    const matched = new Map(), usedIds = new Set();
    for (const o of options) {
      if (matched.has(o.di) || usedIds.has(o.id)) continue;
      matched.set(o.di, o.id); usedIds.add(o.id);
    }
    // A detection with no close track is most likely a copy that moved fast or
    // skipped frames, so hand it a leftover track (nearest first) rather than
    // inventing "#2". New ids only appear when more copies are seen than tracked.
    const leftovers = [];
    dets.forEach((d, di) => tracks.forEach(([id, t]) => {
      if (matched.has(di) || usedIds.has(id)) return;
      leftovers.push({ di, id, dist: Math.hypot(d.center.x - t.center.x, d.center.y - t.center.y) });
    }));
    leftovers.sort((a, b) => a.dist - b.dist);
    for (const o of leftovers) {
      if (matched.has(o.di) || usedIds.has(o.id)) continue;
      matched.set(o.di, o.id); usedIds.add(o.id);
    }

    dets.forEach((d, di) => {
      let id = matched.get(di);
      const prev = id && tracked.get(id);
      if (prev) {
        // Light smoothing to stop jitter flipping a code between spots at a boundary.
        // Skipped after a big jump so the code doesn't lag behind where it now is.
        const jumped = Math.hypot(d.center.x - prev.center.x, d.center.y - prev.center.y) / d.size >= 3;
        if (!jumped) {
          d.center.x = prev.center.x * 0.4 + d.center.x * 0.6;
          d.center.y = prev.center.y * 0.4 + d.center.y * 0.6;
          d.size = prev.size * 0.4 + d.size * 0.6;
        }
      } else {
        let n = 1;
        do { id = n === 1 ? value : `${value} #${n}`; n++; } while (tracked.has(id) || usedIds.has(id));
        usedIds.add(id);
        instanceValue.set(id, value);
      }
      tracked.set(id, { value, center: d.center, size: d.size, pts: d.pts, seen: now });
    });
  }
}

// Where a point in video pixels appears, as a fraction (0–1) of the image as displayed.
function shown(p) {
  const vw = video.videoWidth, vh = video.videoHeight;
  return { x: (flipH ? vw - p.x : p.x) / vw, y: (flipV ? vh - p.y : p.y) / vh };
}

const onTable = (T, x, y) => x >= T.x && x < T.x + T.w && y >= T.y && y < T.y + T.h;

// Chairs sit in front of a table: of the tables spanning the chair's
// left–right position, the one whose front edge is nearest.
function tableInFront(x, y) {
  let best = null, bestD = Infinity;
  for (const T of TABLES) {
    if (x < T.x || x >= T.x + T.w) continue;
    const d = Math.abs(y - (T.y + T.h));
    if (d < bestD) { best = T; bestD = d; }
  }
  return best;
}

// Each table is invisibly split into equal "spots", numbered left to right as
// displayed and named by table: A1, A2, A3, B1… A code's spot is the one its
// centre is in. Stuff must be on a table; a chair takes the spot it is in front of.
function locateSpots() {
  const spots = {};
  if (!video.videoWidth) return spots;
  for (const [id, t] of tracked) {
    const { x, y } = shown(t.center);
    const T = isChair(id) ? tableInFront(x, y) : TABLES.find(T => onTable(T, x, y));
    if (!T) continue;
    spots[id] = T.id + (1 + Math.floor((x - T.x) / (T.w / T.spots)));
  }
  return spots;
}

// spot id ("B2") -> its table and number.
const SPOT_INFO = new Map();
for (const T of TABLES) for (let n = 1; n <= T.spots; n++) SPOT_INFO.set(T.id + n, { T, n });

// Each chair has its own colour and marker shape, keyed by the number in its
// QR text. Stuff takes the colour of the chair it claims, and is white otherwise.
const styleOf = id => CHAIR_STYLES[isChair(id) && valueOf(id).match(/chair\s*(\d+)/i)?.[1]];
const colorOf = id => {
  if (stuffChair.has(id)) return colorOf(stuffChair.get(id));
  return styleOf(id)?.color || '#fff';
};

// A small filled marker centred on (x, y), in canvas pixels.
function marker(shape, x, y, r) {
  ctx.fill(new Path2D(markerPath(shape, x, y, r)));
}

// How far along the segment a→b (0–1) it leaves the outline `pts`, where a is
// inside the outline. Flipping is display-only, so this works in video pixels.
function exitT(a, b, pts) {
  let best = 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (!den) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return best;
}

function draw() {
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const scale = W / 960;
  const mx = x => (flipH ? W - x : x);
  const my = y => (flipV ? H - y : y);

  ctx.font = `${16 * scale}px w95fa, ui-monospace, monospace`;

  // Tables: a heavy black outline with dotted lines between spots, and the
  // table's letter. Table positions are already as displayed, so no flip.
  for (const T of TABLES) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6 * scale;
    ctx.setLineDash([]);
    ctx.strokeRect(T.x * W, T.y * H, T.w * W, T.h * H);
    ctx.lineWidth = 3 * scale;
    ctx.setLineDash([3 * scale, 3 * scale]);
    for (let n = 1; n < T.spots; n++) {
      const x = (T.x + (n * T.w) / T.spots) * W;
      ctx.beginPath(); ctx.moveTo(x, T.y * H); ctx.lineTo(x, (T.y + T.h) * H); ctx.stroke();
    }
    const text = `Table ${T.id}`;
    const x = T.x * W, y = T.y * H - 10 * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 3 * scale, y - 16 * scale, ctx.measureText(text).width + 8 * scale, 20 * scale);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + scale, y);
  }

  ctx.lineWidth = 3 * scale;

  // Dotted line from each chair to the stuff claiming it, in the chair's
  // colour, while both are in view. Drawn first so labels sit on top.
  ctx.setLineDash([2 * scale, 6 * scale]);
  ctx.lineCap = 'round';
  for (const [stuff, chair] of stuffChair) {
    const ca = tracked.get(chair), cb = tracked.get(stuff);
    if (!ca || !cb) continue;
    // Run centre to centre, but only draw the part between the two outlines.
    const a = ca.center, b = cb.center;
    const t0 = exitT(a, b, ca.pts), t1 = 1 - exitT(b, a, cb.pts);
    if (t0 >= t1) continue; // outlines touch or overlap
    const at = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const p = at(t0), q = at(t1);
    ctx.strokeStyle = colorOf(chair);
    ctx.beginPath(); ctx.moveTo(mx(p.x), my(p.y)); ctx.lineTo(mx(q.x), my(q.y)); ctx.stroke();
  }

  // Dotted line from each chair in view to the centre of the spot it is
  // designated to, starting at the chair's outline and capped at the spot
  // centre with the chair's marker. Once stuff occupies the spot, the
  // chair-to-stuff line takes over and this pointer hides.
  const caps = [];
  for (const [spot, chair] of spotChair) {
    const t = tracked.get(chair);
    const info = SPOT_INFO.get(spot);
    if (!t || !info || chairOwner.has(chair)) continue;
    const { T, n } = info;
    // Spot centre in canvas pixels as displayed, then in video pixels (undo the flip).
    const cx = (T.x + ((n - 0.5) * T.w) / T.spots) * W, cy = (T.y + T.h / 2) * H;
    const b = { x: mx(cx), y: my(cy) };
    const a = t.center;
    const t0 = exitT(a, b, t.pts);
    const p = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
    ctx.strokeStyle = colorOf(chair);
    ctx.beginPath(); ctx.moveTo(mx(p.x), my(p.y)); ctx.lineTo(cx, cy); ctx.stroke();
    caps.push({ chair, x: cx, y: cy });
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  for (const c of caps) {
    ctx.fillStyle = colorOf(c.chair);
    marker(styleOf(c.chair)?.shape, c.x, c.y, 9 * scale);
  }

  for (const [id, t] of tracked) {
    ctx.strokeStyle = colorOf(id);
    ctx.beginPath();
    t.pts.forEach((p, i) => (i ? ctx.lineTo(mx(p.x), my(p.y)) : ctx.moveTo(mx(p.x), my(p.y))));
    ctx.closePath(); ctx.stroke();
    const text = displayName(id);
    const w = ctx.measureText(text).width;
    // Anchor the label above the code's top-left corner as displayed.
    const x = Math.min(...t.pts.map(p => mx(p.x)));
    const y = Math.min(...t.pts.map(p => my(p.y))) - 8 * scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 4 * scale, y - 16 * scale, w + 8 * scale, 20 * scale);
    ctx.fillStyle = '#000';
    ctx.fillText(text, x, y);
  }
}

function updateState(spots, now) {
  const inView = [...tracked.keys()].sort();
  const sig = inView.map(id => `${id}@${spots[id] ?? '-'}`).join(',');
  if (sig !== pendingSig) { pendingSig = sig; pendingSince = now; return; }
  if (sig === committedSig || now - pendingSince < STABLE_MS) return;
  commit(inView, spots, sig);
}

function commit(inView, spots, sig = '') {
  pendingSig = committedSig = sig;
  currentState = { timestamp: new Date().toISOString(), room: liveRoom.id, inView, spots, owners: {} };
  inView.forEach(id => seatIds.add(id));
  designate();
  refresh();
  logChange();
  // Hook for later steps (adding info, querying): listen for this event.
  window.chairState = currentState;
  window.dispatchEvent(new CustomEvent('chairstate', { detail: currentState }));
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, attrs);
  n.append(...children);
  return n;
}

// One line per object: "chair 2 — spot A2 — Kathy's chair", "kathy's stuff — spot A2".
function describeObject(id) {
  const parts = [id];
  if (currentState.spots[id]) parts.push(`spot ${currentState.spots[id]}`);
  if (isChair(id)) parts.push(chairOwner.has(id) ? displayName(id) : 'empty');
  return parts.join(' — ');
}

function renderState() {
  const box = document.getElementById('state');
  box.replaceChildren();
  if (!currentState.inView.length) {
    box.append(el('span', { className: 'muted', textContent: 'No objects in view' }));
    return;
  }
  for (const id of currentState.inView) {
    // Filled swatch: a claimed chair.
    const sw = el('span', { className: 'swatch' });
    sw.style.background = chairOwner.has(id) ? 'var(--ink)' : 'transparent';
    box.append(el('div', { className: 'group' }, sw, el('span', { textContent: describeObject(id) })));
  }
}

// Every code that has been part of a committed state. Using committed (stable)
// state rather than raw detections keeps the panel from flickering.
const seatIds = new Set();
// spot id -> the chair designated to it. Sticky: a chair keeps its spot
// while out of view, until another chair is placed in front of that spot.
const spotChair = new Map();
// chair id -> owner name, while that owner's stuff sits on the chair's spot.
const chairOwner = new Map();
// stuff id -> the chair it claims.
const stuffChair = new Map();

// A claimed chair is "Kathy's chair"; any other chair is just "Empty".
const displayName = id => {
  if (!isChair(id)) return id;
  return chairOwner.has(id) ? `${chairOwner.get(id)}'s chair` : 'Empty';
};

// A chair placed in front of a spot is designated to it. One chair per spot:
// the latest chair there takes it over.
function designate() {
  for (const [id, spot] of Object.entries(currentState.spots)) {
    if (!isChair(id)) continue;
    for (const [s, c] of spotChair) if (c === id) spotChair.delete(s);
    spotChair.set(spot, id);
  }
}

// Someone's stuff on a spot claims that spot's chair for as long as it stays.
function claim() {
  chairOwner.clear();
  stuffChair.clear();
  for (const [id, spot] of Object.entries(currentState.spots)) {
    const chair = spotChair.get(spot);
    if (!isStuff(id) || !chair) continue;
    chairOwner.set(chair, ownerOf(id));
    stuffChair.set(id, chair);
  }
  currentState.owners = Object.fromEntries(chairOwner);
}

function refresh() {
  claim();
  renderState();
  renderSeats();
  views.render();
}

const CHAIR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M7 2h10v10H7z M5 12h14v3H5z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  '<path d="M6.5 15v7 M17.5 15v7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

function renderSeats() {
  const visible = new Set(currentState.inView);

  // Any chair that isn't claimed is empty.
  const taken = [], free = [];
  for (const id of [...seatIds].sort()) {
    if (!isChair(id)) continue;
    (chairOwner.has(id) ? taken : free).push(id);
  }

  const box = document.getElementById('seats');
  box.replaceChildren();

  const column = (title, ids, cls) => {
    const chairs = el('div', { className: 'chairs' });
    for (const id of ids) {
      const seat = el('div', { className: 'seat ' + cls + (visible.has(id) ? '' : ' out') });
      seat.title = visible.has(id) ? '' : 'Out of view — showing last known state';
      seat.innerHTML = CHAIR_SVG;
      seat.append(el('span', { textContent: displayName(id) }));
      chairs.append(seat);
    }
    if (!ids.length) chairs.append(el('span', { className: 'muted', textContent: '—' }));
    return el('div', {}, el('h3', {}, title, el('b', { textContent: ids.length })), chairs);
  };

  box.append(column('Taken', taken, 'taken'), column('Empty', free, 'free'));
}

function logChange() {
  const log = document.getElementById('log');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const text = currentState.inView.length ? currentState.inView.map(describeObject).join('; ') : 'No objects in view';
  log.prepend(el('li', {}, el('time', { textContent: time }), text));
}

// ── Room and floor views, zoomed between with pinch.

const views = createViews({
  floor,
  stage: stageEl,
  liveSeat: spot => {
    const chair = spotChair.get(spot) ?? null;
    return {
      chair,
      owner: (chair && chairOwner.get(chair)) || null,
      inView: !chair || currentState.inView.includes(chair),
      style: chair && styleOf(chair),
    };
  },
});

// ── Hand tracking: two-hand distance zooms between table, room and floor
// (chosen and tuned in gesture-lab.html).

const handsCanvas = document.getElementById('hands');
const hctx = handsCanvas.getContext('2d');
let handsOn = document.getElementById('handsOn').checked;
let handTracker = null, handsLoading = false;

const pinch = createPinchZoom({
  onStart: focus => views.beginGesture(focus),
  onZoomTo: (zoom, focus) => views.zoomTo(zoom, focus),
  onEnd: () => views.endGesture(),
});

document.getElementById('handsOn').addEventListener('change', e => {
  handsOn = e.target.checked;
  if (handsOn && stream) ensureHands();
  if (!handsOn) clearHands();
});

// The model is loaded the first time it is needed, without holding up the camera.
async function ensureHands() {
  if (handTracker || handsLoading) return;
  handsLoading = true;
  try {
    handTracker = await loadHandTracker();
    if (stream) statusEl.textContent = 'Scanning · pinch to zoom';
  } catch (err) {
    console.error(err);
    if (stream) statusEl.textContent = 'Scanning · hand tracking unavailable';
  }
  handsLoading = false;
}

// A landmark (0–1 of the unflipped frame) → stage pixels, matching the
// letterboxed, flipped video.
function toStage(p) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
  const k = Math.min(sw / vw, sh / vh);
  const nx = flipH ? 1 - p.x : p.x, ny = flipV ? 1 - p.y : p.y;
  return { x: (sw - vw * k) / 2 + nx * vw * k, y: (sh - vh * k) / 2 + ny * vh * k };
}

// Runs on every frame, as in gesture-lab.html, so zooming keeps up with the hands.
function trackHands(now) {
  if (!handsOn || !handTracker || video.readyState < 2) return;
  try {
    pinch.update(handTracker.detect(video, now), video.videoWidth / video.videoHeight, toStage, now);
  } catch (err) {
    console.warn(err);
  }
  const dpr = window.devicePixelRatio || 1;
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (handsCanvas.width !== Math.round(w * dpr)) handsCanvas.width = Math.round(w * dpr);
  if (handsCanvas.height !== Math.round(h * dpr)) handsCanvas.height = Math.round(h * dpr);
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hctx.clearRect(0, 0, w, h);
  pinch.draw(hctx, views.level);
}

function clearHands() {
  pinch.reset();
  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, handsCanvas.width, handsCanvas.height);
}

// Draw the empty meter and the views up front so everything is laid out from the start.
renderSeats();
views.render();
