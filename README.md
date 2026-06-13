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
- **TIMER / ZOOM / FLIP / FEED / SCENE** as labeled.
- The little needle on the top cap is a real light meter reading the feed.

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

- Hover a photo: **png** (HD card), **gif** (wigglegrams and flipbooks animate;
  singles export their develop-in as a looping GIF), **mp4** (H.264 via WebCodecs,
  with a WebM fallback), **toss** (the print bursts into a cloud of its own pixels).
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

## Lab (optional, all off-by-default friendly)

- **Spatial** adds a Three.js desk: the ejected photo develops through a real
  GLSL shader as it flies, the flash throws a volumetric god-ray cone through
  drifting dust, and "see in 3D" (on a photo's back) lifts it into a tiltable
  luminance relief. **Shader** adds a film post-processing pass (grain + vignette,
  coverage-weighted so the page behind stays clean). All of it fails silently to
  the plain app if WebGL or the CDN modules are unavailable.
- **Haptics**: shutter and eject give a short buzz on supported devices (shares
  the Soundboard's "mechanics" switch and respects reduced-motion).
- **Room light** (Darkroom, where the ambient-light sensor exists): the real
  light in your room drives the live light-leak intensity.
- The EXPO / TIMER / ZOOM controls are also dials - drag them up or down.

## Notes

- Sounds (shutter, motor, beeps) are synthesized with the Web Audio API.
- GIF encoder and PDF builder are hand-rolled and dependency-free.
- Honors `prefers-reduced-motion`.
