# Chairs — QR Object Project

## Overview

A small system for tagging physical objects (1–5 to start) with QR codes, attaching information to each object, and querying both the objects and their information through a UI.

Current setup: chairs (`chair 1`, `chair 2`, …) in front of the tables of a room, each table split into **spots**, plus people's **stuff** (e.g. `kathy's stuff`). A chair in front of a spot belongs to that spot; someone's stuff on a spot makes that spot's chair theirs. `reader.html` reads the QR codes from a webcam. The page zooms between three levels (**table** = the camera, **room**, **floor plan**) with a two-hand pinch tracked by the camera (the distance between the hands sets the zoom). (The earlier `taken` / `not taken` tags and the proximity rules that drove them have been removed.)

## Reader (`reader.html`)

No build step. Files:
- `reader.html` — markup only; loads `reader.js` as a module.
- `reader.js` — detection, tracking, spots, chair designation, claiming, the drawer, the camera overlay, and wiring for hand tracking.
- `views.js` — the room and floor views (SVG), chair colours/markers, the zoom level logic plus non-hand zoom inputs, and `planMarkup()` (the whole floor in detail, used by the lab's map). The drawing helpers are module-level so both pages share them.
- `hands.js` — MediaPipe hand tracking and the two-hand distance gesture.
- `floor.json` — the floor plan: rooms, their tables and spots, and demo seats for rooms without a camera.
- `reader.css` — all styles.
- `gesture-lab.html` — a standalone test bench for zoom gestures (camera, hand skeleton, a zoomable map, live readouts, Floor/Room/Table level track, tuning sliders, event log). The **map** is the floor plan from `floor.json`, drawn with `planMarkup()` from `views.js` (every room in detail). The camera view stands for the map pane: each hand shows as a dot on the map at the point it is over (filled when pinching), and zooming keeps the point where the gesture started fixed, so you zoom into what you pinched over (a dashed crosshair marks it while zooming). Two-hand gestures anchor at the midpoint of the hands when both pinched; drag at the drag's start point; step at the pinch. View width per level comes from four frames (whole floor, live room, its first table with chairs, that table close up), changing geometrically between them. Four candidate gestures: one-hand pinch-and-drag, one-hand pinch-to-step (right half in, left half out), two-hand distance, two-hand spread. Settings persist in localStorage and "Copy settings" exports them as JSON. Independent of the reader. Phil first chose two-hand spread, then **two-hand distance** here on 2026-10-14; its settings were ported into `hands.js`/`views.js`; use the lab to try or tune gestures before changing the reader. The lab and reader use the same zoom units (levels).

- **Run:** `python3 -m http.server` in this folder, then open `http://localhost:8000/reader.html`. The camera only works on localhost or HTTPS, and `floor.json` won't load from `file://`.
- **Deploy:** Netlify, configured by `netlify.toml` at the repo root. It publishes the `chairs/` folder with no build step and serves `reader.html` at `/`.
- **Detection:** the browser's native `BarcodeDetector` API, falling back to the `barcode-detector` npm polyfill (ZXing/WASM) from jsDelivr. Both return every code in a frame. (`jsQR` was ruled out because it reads only one code per frame.)
- **Repeated codes:** several printed copies can share the same QR text. Each copy gets its own track id (`kathy's stuff`, `kathy's stuff #2`, …) and is matched frame to frame by position. A card that jumps far between frames keeps its existing track rather than becoming `#2`; a new `#n` id is created only when more copies are in view than are already tracked.
- **Roles:** every code is a **Chair** or **Stuff**, decided only by its QR text: text ending in "stuff"/"things"/"belongings" → Stuff; anything else → Chair. Names and roles can't be edited in the UI (the Objects list was removed).
- **Tables:** the live room's tables come from `floor.json` (the room with `"live": true`). Each table has an id (`A`, `B`, …), a number of spots, and a `rect` of `[left, top, width, height]` as fractions of the camera image as displayed (after flipping). Currently two 3-spot tables side by side, raised to leave room for chairs below. They are drawn on the overlay canvas: a heavy black outline with no fill, dotted lines between spots, and a "Table A" label.
- **Spots:** each table is invisibly split into equal spots, numbered left to right as displayed and named by table: `A1`, `A2`, `A3`, `B1`… Each code's spot is the one its centre falls in. Stuff must be on a table to have a spot. A chair takes the spot it is in front of: of the tables spanning its left–right position, the one whose front (bottom) edge is nearest. Moving a code to another spot counts as a state change.
- **Chair designation:** a chair placed in front of a spot is designated to that spot. This is sticky (it lasts while the chair is out of view), and each spot has one chair: the latest chair placed there takes it over.
- **Chair colours and markers:** codes are outlined by the number in their QR text: `chair 1` red (triangle), `chair 2` green (circle), `chair 3` blue (square), `chair 4` orange (diamond), `chair 5` purple (down triangle), `chair 6` teal (circle). Higher numbers are white with no marker colour. A dotted line in the chair's colour runs from each chair in view (starting at its outline) to the centre of its designated spot, capped there with the chair's marker shape. The pointer hides once stuff occupies the spot; the chair-to-stuff line shows instead. Stuff that is claiming a chair takes that chair's colour, and a dotted line in that colour joins the chair to the stuff while both are in view. Unclaimed stuff is outlined white.
- **Claiming:** the owner of some stuff is the QR text without "'s stuff", capitalised (`kathy's stuff` → "Kathy"). While someone's stuff is on a spot, that spot's chair is **"Kathy's chair"** and counts as taken. This is not sticky: when the stuff leaves, the chair is empty again.
- **Layout:**
  - The top nav holds the title, the status, the **Floor / Room / Table** zoom level buttons (the current level is filled), **Start camera** with a dropdown arrow (▾), then a **Show states** button. The dropdown has the flip checkboxes and **Pinch to zoom with hand tracking** (on by default). Once the camera is running the button reads **Stop camera**; stopping releases the camera, clears the overlay and immediately commits "nothing in view" (chairs keep their spots and last state). Show states toggles to "Hide states" while on.
  - The nav and the states drawer are inverted (light ink on black); the rest of the page uses the normal light ground.
  - The camera view fills everything below the nav. The video is letterboxed (`object-fit: contain`) so the whole frame stays visible.
  - **Show states** slides a 300px drawer in from the right edge of the camera view (toggling to "Hide states"). The drawer is one element holding the seating meter (Taken above Empty, each with room for all three chairs), the State list, the change log and "Copy state JSON". The meter and State list have fixed heights; the change log fills the rest and scrolls. Nothing is shown over the camera view while the drawer is closed.
- **Display:**
  - A claimed chair is shown as "Kathy's chair". Any other chair is shown as **"Empty"**, in both the camera overlay and the seating meter.
  - The State list and change log show each object in view by its QR text, e.g. `chair 2 — spot 2 — Kathy's chair`.
  - Chairs out of view are faded in the seating meter and keep their last state.
- **Stability:** an arrangement (which codes are in view, and their spots) must hold for 600 ms before it is committed. Detections are kept for 700 ms after they are last seen, which rides out dropped frames.
- **Camera view:** vertical and horizontal flip checkboxes in the Start camera dropdown (both on by default). These only change the display; detection always runs on the unflipped frame and the overlay coordinates are flipped to match.
- **Hook for steps 3–5:** the committed state is exposed as `window.chairState` and a `chairstate` event, with `{ timestamp, room, inView, spots, owners }`. `room` is the live room's id; `spots` maps id → spot id (`"A2"`); `owners` maps chair id → owner name.

## Zoom levels (`views.js`)

- **One zoom value, in levels** (0–3, same units as `gesture-lab.html`) decides the level: 0–1 is the **floor plan**, 1–2 one **room**, 2–3 the **table** (camera) view. One level = one doubling of magnification: inside the floor and room levels the drawing magnifies 1×–2× around the zoom focus (`2 ** (z − level)`). The buttons open floor and room at 1× (z = 0, 1) and the table mid-level (z = 2.5). Inputs give magnification factors, added as log2 of the factor. The camera and QR tracking keep running at every level; the room and floor views cover it on a light ground.
- **Room view:** the selected room's tables, with dotted spot dividers. Each spot with a chair has a marker in front of the table (the chair's colour and shape in the live room, ink squares in demo rooms): filled and labelled "Kathy's / chair" (two lines, so long names don't run into the next spot) when taken, outlined and "Empty" otherwise. Spots with stuff on them are hatched with the owner's name. Spots with no chair say "no chair". Out-of-view chairs (marker and label) are faded with the `out` class, added to the element's other classes. SVG text uses `text-rendering: geometricPrecision` so it scales smoothly while zooming. Header: room name, LIVE — CAMERA or DEMO DATA, and "N / M empty".
- **Floor plan:** every room from `floor.json` at its `rect` (floor units), with its tables, seat marks (filled = taken, outlined = empty), hatched spots, a LIVE/DEMO tag and "N / M empty". A seat is a spot with a chair; it is taken while stuff is on it.
- **Dead zone:** the level showing only changes once the zoom is 0.15 levels past an edge (1 or 2), in either direction, so jitter at an edge doesn't flip views (tuned in the lab).
- **Moving between levels:** zooming in from the floor opens the room under the zoom focus (or keeps the selected room). Only the live room can zoom on into the table view; demo rooms stop at the room level. Zooming out from the table view shows the live room.
- **Inputs:** hand pinch (below), the Floor/Room/Table buttons, clicking a room on the floor plan, `+`/`-` keys, trackpad pinch (ctrl + wheel in Chrome/Firefox, gesture events in Safari) and two-finger touch pinch. The drawer is excluded from pinch handling.
- **Data for other rooms:** rooms without `"live": true` read their seats from `demo` in `floor.json`: spot id → owner name, or `""` for an empty chair. Spots left out have no chair.

## Hand tracking (`hands.js`)

- MediaPipe `HandLandmarker` (`@mediapipe/tasks-vision@0.10.14` from jsDelivr, float16 model from Google storage), up to two hands, GPU with CPU fallback. Loaded in the background the first time the camera starts with the option on.
- Runs on every frame of the camera loop, as in the lab. QR detection runs in the background (at most every 66 ms, `QR_EVERY_MS` in `reader.js`) and the frame loop never waits for it, so slow QR reads on a full frame don't make zooming lag. The camera overlay isn't drawn while the room or floor view covers it.
- **Gesture: two-hand distance** (chosen and tuned in `gesture-lab.html`, 2026-10-14). Pinch with both hands; the distance between the pinch points, as a fraction of the camera frame's width, sets the zoom directly: 15% apart = zoom 0 (floor), 55% = zoom 3 (table), linear in between (`NEAR`/`FAR` in `hands.js`), so the room opens a third of the way and the table two thirds. The view goes to that zoom as soon as both hands pinch. Letting go of either hand ends it and the zoom stays. The zoom focus is the point between the hands.
- History: two-hand spread (relative) and a one-hand version (curl three fingers, close/open thumb + index) were tried in the reader and dropped; the lab still has one-hand drag, one-hand step, two-hand distance and two-hand spread to compare.
- **Measurements:** a pinch is thumb and index tips within 3.5 cm, released past 5.5 cm, using MediaPipe's 3D world landmarks (metres), so it holds up when fingers point at the overhead camera (without them it falls back to the flat image). Gap and pinch point are smoothed, keeping 0.5 of the previous value each frame. Hands are matched frame to frame by wrist position (nearest first, within 250 px), not by MediaPipe's Left/Right label, which flips when hands are seen from above; a hand missing for under 200 ms keeps its state.
- **Feedback:** a separate canvas above the views draws each hand's full skeleton (all 21 landmarks and the bones between them) in the hand's colour with a black edge, as in `gesture-lab.html`. Hand colours are magenta, amber, cyan, violet (`HAND_COLORS`), avoiding red/green/blue, which mark chairs 1–3; the lab uses the same colours. A pinch dot sits between thumb and index: hollow when open, filled in the hand's colour when pinching. While zooming, a dashed line joins the two pinch points, labelled with the level showing (FLOOR / ROOM / TABLE). Beside each hand is its thumb–index gap in cm (plus "PINCH"), and a hint in the top-left says what to do next.
- Hands over the table can hide QR codes; codes are held 700 ms, after which stuff's claims drop until the hands move away.

## Object → referent → information

How the system currently resolves each layer:

| (1) Object (physical) | (2) Referent (what the system tracks) | (3) Information it embodies |
|---|---|---|
| A chair with a printed QR code | The QR text, e.g. `chair 3`, as a track id. | **Its spot**, from where it sits in front of the table. **Claimed / Empty**: claimed chairs show as "Kathy's chair"; others show as "Empty". Also whether it is in view. |
| Someone's stuff with a printed QR code | The QR text, e.g. `kathy's stuff`. Role: Stuff. The owner name is taken from the text. | **Its spot** on the table. It has no state of its own; it **claims** the chair designated to its spot for its owner. |

In short:
- The **object** is the printed card on the table or chair.
- The **referent** is the string encoded in its QR code. That string is the only identity the system has; there is no database yet.
- The **information** is not stored on the object. It is **inferred from where the objects are**: a chair's position gives it a spot, and stuff on that spot writes an owner onto the chair. The state lives only in the reader page's memory.

Gaps for steps 3–5: information is not persisted per object, there is no history beyond the session's change log, and the only identity is the QR text. Steps 3–5 would add a store keyed by the referent (QR text) that holds the information and its history.

## Steps

### 1. Generate QR codes for 1–5 objects — done
- Codes are printed for `chair 1`–`chair 3`. (The `taken` ×2 and `not taken` tags are no longer used.) Stuff codes such as `kathy's stuff` still need printing.

### 2. Give our interfaces the ability to generate QR codes
- Build QR generation into the UI rather than as a one-off script.
- Creating a new object in the interface should produce its QR code automatically.
- Allow the QR code to be viewed, downloaded, and printed from the interface.

### 3. Develop a flow for adding info to objects
- Scanning an object's QR code (or selecting it in the UI) opens that object's page.
- From that page, a user can add information to the object (notes, descriptions, images, etc.).
- Added information is saved and associated with the object's ID.
- Partly started: stuff on a spot claims that spot's chair.

### 4. Give the UI the ability to query objects
- List all objects.
- Look up a single object by ID or by scanning its QR code.
- Filter/search objects by their attributes.
- Partly started: the State panel lists the codes in view, and the seating panel shows Taken vs Empty.

### 5. Give the UI the ability to query information
- Search across the information attached to objects (e.g. by keyword or field).
- Show which object(s) each result belongs to.
- Display an object's full information history.
