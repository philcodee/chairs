# Session log

## 2026-10-07 — Spots, stuff and UI overhaul

Files changed: `reader.html`, `reader.css`, `CLAUDE.md`. New: `screenshots/sequence.gif`.
Nothing was tested in a browser by Claude; changes were checked in Live Server by Phil.

### Model: from proximity tags to spots

- **Table.** Added a 3:1 table outline drawn over the camera view, sized as a share of the camera image's width. It was resized several times (90% → 95% → 80% → 75% → 70%) and raised 120px above centre to leave room for chairs in front. It has a heavy black border, no fill, and dotted dividers between the spots.
- **Spots.** The table is invisibly split into three spots (1–3, left to right as displayed). A code's spot is the third its centre falls in. For chairs only the left–right position counts, since they sit in front of the table; stuff must be on the table.
- **Chair designation.** A chair in front of a spot is designated to it. This is sticky, and each spot has one chair: the latest chair placed there takes it over.
- **Stuff.** New role, recognised from QR text ending in "stuff" / "things" / "belongings" (e.g. `Kathy's stuff`). The owner name comes from the text ("Kathy"). While stuff is on a spot, that spot's chair shows as **"Kathy's chair"** and counts as taken. Not sticky: removing the stuff empties the chair.
- **Removed.** Proximity grouping, the "Near within" slider, distance lines, the `taken` / `not taken` tags, the Objects list (renaming and role overrides) and their localStorage keys. Roles now come only from QR text.
- **State hook** is now `{ timestamp, inView, spots, owners }`.

### Overlay

- Chair outlines are coloured by number: chair 1 red, chair 2 green, chair 3 blue. Stuff takes the colour of the chair it claims, and is white otherwise.
- There is a dotted line from each chair to the stuff claiming it, clipped at both QR outlines so it doesn't overlap them.
- Each chair also gets a dotted pointer to the centre of its designated spot. The pointer is capped with a marker (red triangle, green circle, blue square) and hides once stuff occupies the spot.

### UI

- **Top nav** (inverted: light on black, no bottom border) holds:
  - the status text;
  - **Start / Stop camera**, a split button whose ▾ dropdown holds the flip checkboxes;
  - **Show states / Hide states**.
- **Stop camera** releases the webcam, clears the overlay and immediately commits "nothing in view". A session counter stops stale detection loops.
- **Camera view** fills everything below the nav (letterboxed 16:9).
- **States drawer.** One 300px element that slides in from the right (inverted colours). It holds the Taken/Empty meter, the State list, the change log and Copy state JSON. The meter and State list have fixed sizes; the log fills the rest and scrolls. Meter seats are 72px wide so names like "Yuxuan's chair" wrap only between words.

### Bug fixes

- A card moved quickly became `Yuxuan's stuff #2`. Unmatched detections now reuse leftover tracks, so `#n` appears only when more copies are in view than are tracked. Smoothing is skipped after big jumps.
- The `.empty` message couldn't be re-shown after stopping, because `display: grid` overrode `hidden`. Fixed with a `[hidden]` rule.

### Screenshots GIF

- `screenshots/sequence.gif` was built from `01`–`05` PNGs, scaled to 1200×750.
- It uses a shared palette with the chair colours pinned, so the green wasn't lost.
- Each frame holds 1.13 s, with the last the same as the others, and it loops.

### Open / next

- Old `taken` / `not taken` cards now count as chairs if they come into view, so keep them off the table.
- Table sizing assumes a 16:9 camera, and the 120px raise could clip on very short windows.
- Show states doesn't persist across reloads.
- Steps 2–5 in `CLAUDE.md` are still open: QR generation in the UI, per-object info and history, and querying.

## 2026-10-14 — Multiple tables, room and floor views, hand-tracked zoom

Files changed: `reader.html` (script moved out), `reader.css`, `CLAUDE.md`. New: `reader.js`, `views.js`, `hands.js`, `floor.json`, `gesture-lab.html`.
Nothing was tested in a browser by Claude. Logic was checked with syntax checks and Node simulations, and Phil checked changes in Live Server.
This repo copy (`Documents/GitHub/chairs/chairs`, deployed by Netlify) is the live one. Edits first went into an older copy on the Desktop by mistake and were copied over. Nothing is committed yet.

### Structure

- The single-file script was split into ES modules:
  - `reader.js`: detection, spots, claiming, the drawer and the camera overlay.
  - `views.js`: the room and floor views, chair styles and zoom levels.
  - `hands.js`: hand tracking and the pinch gesture.
- `floor.json` holds the floor plan. It has four rooms: Studio (live, from the camera) plus Lab, Lounge and Seminar, which use demo seat data.

### Multiple tables

- Tables come from `floor.json` instead of a fixed DOM rectangle. The live room has two 3-spot tables, A and B, placed as fractions of the camera image and drawn on the overlay canvas with "Table A" / "Table B" labels.
- Spots are now named by table: `A1`–`A3`, `B1`–`B3`. A chair takes the spot of the table whose front edge is nearest, among the tables spanning its left–right position.
- Chair styles now cover chairs 4–6: orange diamond, purple down-triangle, teal circle.
- The state hook adds `room`, and `spots` values are now spot ids such as `"A2"`.

### Room and floor views

- There are three zoom levels: **Table** (the camera), **Room** (an SVG of the selected room) and **Floor** (an SVG floor plan).
- Each room shows its seats and an "N / M empty" count. A seat is taken when someone's stuff is on its spot; taken spots are hatched and show the owner's name.
- The nav has Floor / Room / Table buttons, and clicking a room on the floor plan opens it.
- Other ways to zoom: the `+` / `-` keys, trackpad pinch (ctrl + wheel, or Safari's gesture events) and two-finger touch pinch.
- Zoom is measured in levels (0–3), the same units as the gesture lab. A dead zone at each level edge stops jitter from flipping views.

### Hand tracking (iterated many times)

- Uses MediaPipe HandLandmarker (`@mediapipe/tasks-vision@0.10.14`) on the same camera feed as the QR reader.
- Gestures tried in order:
  1. Two-hand pinch, relative to where the hands started.
  2. One-hand phone-style pinch, needing three curled fingers to start. Phil wanted closing thumb and index to zoom in. Dropped because finger reach varies between people.
  3. Two-hand again.
  4. Two-hand absolute, where the distance between the hands sets the zoom.
- The gesture problems were hard to diagnose inside the reader, so Phil chose to build a separate test bench.
- Fixes along the way:
  - Pinch is measured in 3D centimetres from world landmarks, which survives the overhead camera's foreshortening.
  - Hands are matched frame to frame by position instead of MediaPipe's Left/Right label, which flips when hands are seen from above.
  - On-screen readouts show each hand's gap in cm, its pinch state and a hint about what to do next.
- **Final choice: two-hand distance**, tuned in the lab:

  | Setting | Value |
  |---|---|
  | Pinch on / off | 3.5 / 5.5 cm |
  | Smoothing | 0.5 |
  | Dead zone | 0.15 levels |
  | Hands 15% of frame width apart | Floor |
  | Hands 55% of frame width apart | Table |

- The overlay draws each hand's full skeleton, as in the lab. Hands are magenta, amber, cyan and violet, avoiding the chair colours. The pinch dot is filled while pinching, and the line between the hands is labelled with the current level.

### Gesture lab (`gesture-lab.html`)

- A standalone page with the camera, hand skeletons, live readouts, a level track, tuning sliders, an event log and Copy settings. Settings are saved in localStorage.
- Four gestures to compare: one-hand drag, one-hand step (right half of the view zooms in, left half out), two-hand distance and two-hand spread.
- **Map:** the real floor plan, drawn with `planMarkup()` from `views.js`. Each hand shows as a dot over the map, and zooming anchors on the point where the gesture started, so you zoom into what you pinched over.

### Responsiveness

- The reader felt sluggish because its frame loop waited for QR detection on full 1080p frames, and hand tracking only ran on every other frame.
- QR detection now runs in the background at most every 66 ms, hand tracking runs every frame, and the camera overlay isn't drawn while a room or floor view covers it.

### Bug fixes

- Out-of-view chair labels showed as a giant faded "Empty". They had two `class` attributes and the browser ignored the second, so they lost their font size. The classes are now merged.
- Owner labels split onto two lines ("Kathy's" / "chair") so long names don't run into the next spot.
- SVG text uses `text-rendering: geometricPrecision` so it scales smoothly while zooming.
- The zoom is capped near the Table level so spreading the hands there doesn't build up slack that has to be undone before zooming out.

### Open / next

- Port the lab map's "zoom into what you pinch over" behaviour into the reader. The reader only picks the room under the hands when going from Floor to Room.
- Hands over the table can hide QR cards; claims drop after 0.7 s until the hands move.
- The demo rooms' data is static, and only the live room has a camera.
- The States drawer's seating meter isn't grouped by table yet.
- Commit and push to GitHub (Netlify deploys from it), once Phil is happy.
