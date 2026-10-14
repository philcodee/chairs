// Hand tracking for pinch-to-zoom: MediaPipe HandLandmarker running on the
// same camera frames as the QR reader.

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Loads the model (a few MB, once). detect() returns [{ lm, world }] per hand,
// where lm is 21 landmarks normalised to the unflipped frame (0–1).
export async function loadHandTracker() {
  const { FilesetResolver, HandLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  const make = delegate => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
  });
  let landmarker;
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }

  let last = 0;
  return {
    detect(video, now) {
      // Timestamps must strictly increase.
      last = Math.max(now, last + 1);
      const res = landmarker.detectForVideo(video, last);
      // world: the same landmarks in metres, in 3D. Unlike the image
      // landmarks, these don't shrink when fingers point at the camera.
      // (MediaPipe's Left/Right labels aren't used: seen from above they flip
      // between frames, so hands are matched by position instead.)
      return res.landmarks.map((lm, i) => ({ lm, world: res.worldLandmarks?.[i] }));
    },
  };
}

// Landmarks: 0 wrist, 4 thumb tip, 8 index tip, 9 middle knuckle.
//
// Two-hand distance, chosen and tuned in gesture-lab.html: pinch with both
// hands, and the distance between them sets the zoom directly: close together
// = floor, wide apart = table. Letting go of either hand ends it, and the zoom
// stays where it was.

// Values from the lab (Phil's settings, 2026-10-14).
// Pinch: thumb and index tips within 3.5 cm in 3D; lets go past 5.5 cm.
const PINCH_ON = 0.035, PINCH_OFF = 0.055;
// Smoothing: each frame keeps this share of the previous value (0 = raw).
const SMOOTH = 0.5;
// Hands this far apart (fraction of the camera frame's width) = zoom 0, the
// floor plan; this far = zoom 3, the table. Linear in between, so the room
// opens a third of the way and the table two thirds.
const NEAR = 0.15, FAR = 0.55;
// A hand missing for a moment (a dropped frame) keeps its state this long.
const LOST_MS = 200;
// A hand counts as the same hand as last frame if its wrist moved less than this (stage pixels).
const MATCH_PX = 250;
// Each hand's colour in the overlay. Not red/green/blue, which mark chairs 1–3.
export const HAND_COLORS = ['#ff2bd6', '#ffb000', '#00c2d1', '#8a5cff'];
// Landmark pairs joined in the hand skeleton.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

// onStart(focus), onZoomTo(zoom, focus), onEnd(). Focus is in stage pixels;
// zoom is in levels (0–3: floor, room, table), as in views.js and the lab.
export function createPinchZoom({ onStart, onZoomTo, onEnd }) {
  const hands = new Map(); // key → { pinched, gap, at, n, wrist, thumb, index, seen }
  let active = false;      // while both hands pinch
  let aspect = 16 / 9;
  let nextKey = 1;

  // Each hand found this frame takes the key of the nearest hand from recent
  // frames (by wrist position), nearest pairs first; leftovers get new keys.
  function match(found, toStage) {
    const pairs = [];
    found.forEach((f, i) => {
      f.wrist = toStage(f.lm[0]);
      for (const [key, h] of hands) {
        pairs.push({ i, key, d: Math.hypot(f.wrist.x - h.wrist.x, f.wrist.y - h.wrist.y) });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedKeys = new Set();
    for (const p of pairs) {
      if (found[p.i].key != null || usedKeys.has(p.key) || p.d > MATCH_PX) continue;
      found[p.i].key = p.key;
      usedKeys.add(p.key);
    }
    for (const f of found) f.key ??= nextKey++;
  }

  // found: from detect(). frameAspect: frame width / height. toStage: landmark → stage pixels.
  function update(found, frameAspect, toStage, now) {
    aspect = frameAspect;
    match(found, toStage);
    for (const { key, lm, world, wrist } of found) {
      // Thumb–index gap in metres from the 3D world landmarks, which hold up
      // when fingers point at the overhead camera. Without them, estimate from
      // the image, taking wrist to middle knuckle as 9 cm.
      const flat = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
      let gap = world
        ? Math.hypot(world[4].x - world[8].x, world[4].y - world[8].y, world[4].z - world[8].z)
        : (0.09 * flat(4, 8)) / (flat(0, 9) || 1);

      const prev = hands.get(key);
      const thumb = toStage(lm[4]), index = toStage(lm[8]);
      let at = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
      // The pinch point again, as a fraction (0–1) of the camera frame.
      let n = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
      if (prev) {
        const keep = (p, q) => p * SMOOTH + q * (1 - SMOOTH);
        at = { x: keep(prev.at.x, at.x), y: keep(prev.at.y, at.y) };
        n = { x: keep(prev.n.x, n.x), y: keep(prev.n.y, n.y) };
        gap = keep(prev.gap, gap);
      }
      const pinched = prev?.pinched ? gap < PINCH_OFF : gap < PINCH_ON;
      const pts = lm.map(toStage);
      const color = HAND_COLORS[(key - 1) % HAND_COLORS.length];
      hands.set(key, { pinched, gap, at, n, wrist, thumb, index, pts, color, seen: now });
    }
    for (const [key, h] of hands) if (now - h.seen > LOST_MS) hands.delete(key);

    const p = pinchedHands();
    if (p.length === 2) {
      if (!active) { active = true; onStart(mid(p)); }
      onZoomTo((3 * (span(p) - NEAR)) / (FAR - NEAR), mid(p));
    } else if (active) end();
  }

  const pinchedHands = () => [...hands.values()].filter(h => h.pinched);
  // Distance between the two pinch points as a fraction of the frame's width.
  const span = ([a, b]) => Math.hypot(a.n.x - b.n.x, (a.n.y - b.n.y) / aspect);
  const mid = ([a, b]) => ({ x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 });

  function end() {
    active = false;
    onEnd();
  }

  function reset() {
    hands.clear();
    if (active) end();
  }

  // Hand overlay, in stage pixels, as in gesture-lab.html: each hand's skeleton
  // in its colour with a black edge (so it reads on both the camera image and
  // the light room/floor views), and a pinch dot between thumb and index,
  // hollow when open and filled when pinching.
  // level: the zoom level showing, named on the line between the hands.
  function draw(ctx, level) {
    const stroke = (w, color) => { ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); };
    const both = w => { stroke(w + 3, '#000'); stroke(w, '#fff'); };
    const p = pinchedHands();
    const zooming = active && p.length === 2;
    if (zooming) {
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(p[0].at.x, p[0].at.y); ctx.lineTo(p[1].at.x, p[1].at.y); both(2);
      ctx.setLineDash([]);
    }
    for (const h of hands.values()) {
      ctx.beginPath();
      for (const [a, b] of BONES) { ctx.moveTo(h.pts[a].x, h.pts[a].y); ctx.lineTo(h.pts[b].x, h.pts[b].y); }
      ctx.lineCap = 'round';
      stroke(5, '#000'); stroke(2.5, h.color);
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#fff';
      for (const q of h.pts) { ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.arc(h.at.x, h.at.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = h.pinched ? h.color : 'rgba(255,255,255,0.6)';
      ctx.fill(); stroke(3, '#000');
      label(ctx, `${(h.gap * 100).toFixed(1)} cm${h.pinched ? ' · PINCH' : ''}`, h.at.x + 16, h.at.y - 12);
    }
    if (zooming && level) {
      const m = mid(p);
      const text = level.toUpperCase();
      ctx.font = '700 12px ui-monospace, Menlo, monospace';
      label(ctx, text, m.x - ctx.measureText(text).width / 2, m.y + 4);
    }
    // What to do next, in the top-left corner, while any hand is in view.
    if (hands.size) {
      const hint = zooming ? 'Hands close = floor · apart = room · wide = table · let go to stop'
        : hands.size < 2 ? 'Two hands needed: bring your other hand into view'
        : p.length === 1 ? 'Now pinch the other hand'
        : 'Pinch both hands to zoom';
      label(ctx, hint, 16, 28);
    }
  }

  function label(ctx, text, x, y) {
    ctx.font = '700 12px ui-monospace, Menlo, monospace';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 6, y - 14, w + 12, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }

  return { update, reset, draw };
}
