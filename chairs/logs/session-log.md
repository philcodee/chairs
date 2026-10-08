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
