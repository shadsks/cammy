# SHOEBOX - instant camera

A retro instant-camera toy that runs entirely in your browser. Photos never leave
your machine: webcam capture, film filters, and exports all happen client-side
on a canvas.

## Run it

Browsers only allow webcam access on a secure origin, so serve the folder
instead of opening the file directly:

```
npx serve .          # or: python -m http.server 8000
```

Then open the printed localhost URL. The app starts on a procedural demo feed,
so everything works before (or without) granting webcam access.

## How to use

- **Shutter** (red button, or Space): a photo ejects from the slot on top and
  develops from dark and blurry to clear over a few seconds.
- **Drag** any photo off the camera and pin it anywhere on the desk.
- **Caption**: click the white border under a photo and write on it. The
  orange date stamp is automatic.
- **TIMER**: off / 3s / 10s countdown with beeps.
- **STRIP**: shoots 4 frames in a row and ejects a photo strip
  (1x4 or 2x2, pick the layout in the Darkroom).
- **DOUBLE**: first press locks exposure one (shown as a ghost in the
  viewfinder), second press overlays exposure two.
- **ZOOM**: 1x / 1.4x / 2x digital zoom.
- **FLIP**: switch front/rear camera on the live feed.
- **FEED**: toggle between the demo feed and your webcam.
- **Darkroom panel**: five film stocks, plus stackable grain / vignette /
  light leak / dust sliders, frame colors, and desk surfaces.
- **Save**: hover a photo for per-photo save/toss, or use "Save wall" to
  export the whole desk as one image.

## Notes

- Audio (shutter click, motor whirr, countdown beeps) is synthesized with the
  Web Audio API; mute it with the Sound button.
- Honors `prefers-reduced-motion`.
- No build step, no dependencies, no backend.
