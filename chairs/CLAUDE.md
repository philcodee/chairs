# Chairs — QR Object Project

## Overview

A small system for tagging physical objects (1–5 to start) with QR codes, attaching information to each object, and querying both the objects and their information through a UI.

Current setup: three chairs (`chair 1`, `chair 2`, `chair 3`) in front of a table that is split into three **spots**, plus people's **stuff** (e.g. `kathy's stuff`). A chair in front of a spot belongs to that spot; someone's stuff on a spot makes that spot's chair theirs. `reader.html` reads the QR codes from a webcam. (The earlier `taken` / `not taken` tags and the proximity rules that drove them have been removed.)

## Reader (`reader.html`)

Single HTML file, no build step.

- **Run:** `python3 -m http.server` in this folder, then open `http://localhost:8000/reader.html`. The camera only works on localhost or HTTPS.
- **Deploy:** Netlify, configured by `netlify.toml` at the repo root. It publishes the `chairs/` folder with no build step and serves `reader.html` at `/`.
- **Detection:** the browser's native `BarcodeDetector` API, falling back to the `barcode-detector` npm polyfill (ZXing/WASM) from jsDelivr. Both return every code in a frame. (`jsQR` was ruled out because it reads only one code per frame.)
- **Repeated codes:** several printed copies can share the same QR text. Each copy gets its own track id (`kathy's stuff`, `kathy's stuff #2`, …) and is matched frame to frame by position. A card that jumps far between frames keeps its existing track rather than becoming `#2`; a new `#n` id is created only when more copies are in view than are already tracked.
- **Roles:** every code is a **Chair** or **Stuff**, decided only by its QR text: text ending in "stuff"/"things"/"belongings" → Stuff; anything else → Chair. Names and roles can't be edited in the UI (the Objects list was removed).
- **Table:** a 3:1 rectangle centred horizontally on the camera view and raised 120px above vertical centre, 70% of the camera image's width (assuming a 16:9 camera), with no pixel cap. Drawn as a heavy black outline with no fill, and dotted lines marking the boundaries between spots 1|2 and 2|3.
- **Spots:** the table is invisibly split into three equal spots, numbered 1–3 from left to right as displayed. Each code's spot is the third of the table its centre falls in. Chairs sit in front of the table, so for a chair only its left–right position counts; stuff must be on the table to have a spot. Moving a code to another spot counts as a state change.
- **Chair designation:** a chair placed in front of a spot is designated to that spot. This is sticky (it lasts while the chair is out of view), and each spot has one chair: the latest chair placed there takes it over.
- **Chair colours and markers:** codes are outlined by the number in their QR text: `chair 1` red (triangle), `chair 2` green (circle), `chair 3` blue (square). A dotted line in the chair's colour runs from each chair in view (starting at its outline) to the centre of its designated spot, capped there with the chair's marker shape. The pointer hides once stuff occupies the spot; the chair-to-stuff line shows instead. Stuff that is claiming a chair takes that chair's colour, and a dotted line in that colour joins the chair to the stuff while both are in view. Unclaimed stuff is outlined white.
- **Claiming:** the owner of some stuff is the QR text without "'s stuff", capitalised (`kathy's stuff` → "Kathy"). While someone's stuff is on a spot, that spot's chair is **"Kathy's chair"** and counts as taken. This is not sticky: when the stuff leaves, the chair is empty again.
- **Layout:**
  - The top nav holds the title, the status and **Start camera** with a dropdown arrow (▾), then a **Show states** button. The dropdown has the flip checkboxes. Once the camera is running the button reads **Stop camera**; stopping releases the camera, clears the overlay and immediately commits "nothing in view" (chairs keep their spots and last state). Show states toggles to "Hide states" while on.
  - The nav and the states drawer are inverted (light ink on black); the rest of the page uses the normal light ground.
  - The camera view fills everything below the nav. The video is letterboxed (`object-fit: contain`) so the whole frame stays visible.
  - **Show states** slides a 300px drawer in from the right edge of the camera view (toggling to "Hide states"). The drawer is one element holding the seating meter (Taken above Empty, each with room for all three chairs), the State list, the change log and "Copy state JSON". The meter and State list have fixed heights; the change log fills the rest and scrolls. Nothing is shown over the camera view while the drawer is closed.
- **Display:**
  - A claimed chair is shown as "Kathy's chair". Any other chair is shown as **"Empty"**, in both the camera overlay and the seating meter.
  - The State list and change log show each object in view by its QR text, e.g. `chair 2 — spot 2 — Kathy's chair`.
  - Chairs out of view are faded in the seating meter and keep their last state.
- **Stability:** an arrangement (which codes are in view, and their spots) must hold for 600 ms before it is committed. Detections are kept for 700 ms after they are last seen, which rides out dropped frames.
- **Camera view:** vertical and horizontal flip checkboxes in the Start camera dropdown (both on by default). These only change the display; detection always runs on the unflipped frame and the overlay coordinates are flipped to match.
- **Hook for steps 3–5:** the committed state is exposed as `window.chairState` and a `chairstate` event, with `{ timestamp, inView, spots, owners }`. `spots` maps id → spot number; `owners` maps chair id → owner name.

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
