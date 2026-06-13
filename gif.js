/* Minimal GIF89a encoder for SHOEBOX. No dependencies.
   encodeGIF(canvases, delaysCs) -> Blob
   Fixed 6x7x6 RGB palette with ordered dithering; standard LZW. */
'use strict';

(function () {
  const BAYER = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];

  // global color table: 6*7*6 = 252 levels + 4 black pads
  function buildPalette() {
    const pal = new Uint8Array(256 * 3);
    let i = 0;
    for (let r = 0; r < 6; r++)
      for (let g = 0; g < 7; g++)
        for (let b = 0; b < 6; b++) {
          pal[i * 3] = Math.round(r * 255 / 5);
          pal[i * 3 + 1] = Math.round(g * 255 / 6);
          pal[i * 3 + 2] = Math.round(b * 255 / 5);
          i++;
        }
    return pal;
  }

  function indexFrame(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x), p = i * 4;
        const t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - .5);
        const r = Math.max(0, Math.min(5, Math.round((d[p] + t * 51) * 5 / 255)));
        const g = Math.max(0, Math.min(6, Math.round((d[p + 1] + t * 42) * 6 / 255)));
        const b = Math.max(0, Math.min(5, Math.round((d[p + 2] + t * 51) * 5 / 255)));
        out[i] = r * 42 + g * 6 + b;
      }
    }
    return out;
  }

  // standard GIF LZW, LSB-first bit packing, 255-byte sub-blocks
  function lzw(pixels) {
    const MIN = 8, CLEAR = 256, EOI = 257;
    const dict = new Int32Array(4096 * 256).fill(-1);
    const bytes = [];
    let cur = 0, curBits = 0, size = MIN + 1, next = EOI + 1;

    const emit = code => {
      cur |= code << curBits;
      curBits += size;
      while (curBits >= 8) { bytes.push(cur & 255); cur >>= 8; curBits -= 8; }
    };

    emit(CLEAR);
    let prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const k = pixels[i], key = prefix * 256 + k;
      if (dict[key] >= 0) { prefix = dict[key]; continue; }
      emit(prefix);
      dict[key] = next++;
      if (next === (1 << size) + 1 && size < 12) size++;
      if (next === 4096) {
        emit(CLEAR); dict.fill(-1); next = EOI + 1; size = MIN + 1;
      }
      prefix = k;
    }
    emit(prefix);
    emit(EOI);
    if (curBits > 0) bytes.push(cur & 255);

    const out = [MIN];
    for (let i = 0; i < bytes.length; i += 255) {
      const n = Math.min(255, bytes.length - i);
      out.push(n);
      for (let j = 0; j < n; j++) out.push(bytes[i + j]);
    }
    out.push(0);
    return out;
  }

  window.encodeGIF = function (canvases, delaysCs) {
    const w = canvases[0].width, h = canvases[0].height;
    const parts = [];
    const push = arr => parts.push(Uint8Array.from(arr));
    const word = n => [n & 255, (n >> 8) & 255];

    push([71, 73, 70, 56, 57, 97]);                    // GIF89a
    push([...word(w), ...word(h), 0xF7, 0, 0]);        // LSD: GCT, 256 colors
    parts.push(buildPalette());
    push([0x21, 0xFF, 11, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)),
      3, 1, 0, 0, 0]);                                 // loop forever

    canvases.forEach((c, i) => {
      const delay = delaysCs[i] ?? 12;
      push([0x21, 0xF9, 4, 0x04, ...word(delay), 0, 0]); // GCE, disposal=1
      push([0x2C, 0, 0, 0, 0, ...word(w), ...word(h), 0]); // image descriptor
      push(lzw(indexFrame(c)));
    });
    push([0x3B]);
    return new Blob(parts, { type: 'image/gif' });
  };
})();
