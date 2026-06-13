# SHOEBOX - instant camera

A retro instant-camera toy that runs entirely in your browser. Photos never leave
your machine: webcam capture, film filters, GIFs, zines, and posters all happen
client-side on a canvas. Installable as an offline PWA.

## Run it

Browsers only allow webcam access on a secure origin, so serve the folder
instead of opening the file directly:

```
npx serve .          # or: python -m http.server 8000
```

The app starts on a procedural demo feed, so everything works before (or
without) granting webcam access.

## The camera

- **Shutter** (red button, or Space): a photo ejects from the slot and develops
  from dark and blurry to clear. Give it a shake while dragging to develop faster.
- **Hold the shutter** to record up to 5 seconds of voice into the next photo.
  Hover the photo (or press and hold on touch) to hear it.
- **MODE**: single, 4-shot strip, wigglegram (3-frame 3D wobble), stop motion
  (each press adds a frame, DEVELOP ejects a flipbook), light painting (4s trail
  exposure), slit scan (4s time smear), pinhole (5s hold-still average).
- **LENS**: Standard 40, Fish 8 (barrel bulge), Prism 6 (kaleidoscope),
  Velvet 85 (soft glow), Twin 2 (double vision). The lens preview is live.
- **EXPO**: layer 1, 2, or 3 exposures into one frame.
- **TIMER / ZOOM / FLIP / FEED / SCENE** as labeled. EXPO / TIMER / ZOOM are also
  dials - drag them up or down.

## The film

- Seven stocks in the Darkroom, with stackable grain / vignette / light leak /
  dust sliders on top.
- Stocks honor their ISO: slow film (Poolside 100, Motel Tungsten) gets grainy
  and underexposed in dim light; Static 3000 shrugs at darkness but washes out
  in bright sun.
- **Goldenhour 400** is at its best around real local sunset (the Darkroom tells
  you when).
- **Expired 86** fogs, color-shifts, and occasionally half-ruins a frame,
  beautifully.
- **Negative 99** ejects actual negatives. Drag one onto the lightbox that
  appears in the corner to develop it.

## Output

- Hover a photo: **Save** opens a small menu to download it as **PNG** (HD card),
  **GIF** (wigglegrams and flipbooks animate; singles export their develop-in), or
  **MP4** (H.264 via WebCodecs, WebM fallback). **toss** bursts the print into a
  cloud of its own pixels.
- **Studio** menu: save the whole wall as one PNG, build a foldable 8-photo
  mini-zine PDF with cut and fold guides, or compose a 12-photo poster PNG.
- **Sheet** (topbar): a contact sheet of every photo, filterable by film stock.
  Select photos and send the selection straight to a zine or poster.

## On the desk

- **Flip a photo** (double-click, or double-tap on touch) to see its back: a
  ruled note you can write on, a "developed on" stamp, and an optional place tag.
  Location is opt-in and never leaves the device - coordinates become an offline
  procedural map doodle, not a request to any tile server.
- **Drag one photo onto another** to sandwich them into a new double exposure.
- Photos throw with momentum when you flick them.

## Mobile

- Installable PWA, fully offline after the first visit.
- Thumb-shot layout: the camera docks bottom-center on phones.
- Tilt drift (Darkroom, on devices with a gyroscope): tilting the phone makes
  the photos drift subtly on the desk.

## Extras

- **Film shader**: halation, chromatic smear, grain, and gate weave are baked into
  every frame and previewed live in the finder.
- **Glass**: the lens lab styles the barrel and finder for each lens.
- **Soundboard**: synthesized mechanical clicks for every control and camera
  action, plus **haptics** - shutter and eject buzz on supported devices (respects
  reduced-motion).
- **Room light** (Darkroom, where the ambient-light sensor exists): the real light
  in your room drives the live light-leak intensity.

## Notes

- Sounds (shutter, motor, beeps) are synthesized with the Web Audio API.
- GIF encoder and PDF builder are hand-rolled and dependency-free.
- Honors `prefers-reduced-motion`.
