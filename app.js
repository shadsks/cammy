/* SHOEBOX - instant camera. 100% client-side.
   Sections: state / film + lenses / audio / scenes / capture pipeline /
   cards + drag / flows / webcam / meter / exports (png, gif, zine, poster) /
   ui / pwa + tilt / boot */
'use strict';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BAKE = 1000;  // baked photo resolution
const FXS = 240;    // lens preview resolution

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------- state ---------------- */
const state = {
  live: false, facing: 'user', mirror: true, scene: 0,
  stock: 'goldenhour',
  fx: { grain: 28, vignette: 34, leak: 22, dust: 12 },
  frame: 'paper', surface: 'cork',
  mode: 'single',      // single | strip | wiggle | motion | paint | slit | pinhole
  lens: 'normal',      // normal | fisheye | prism | soft | split
  expo: 1,             // exposures layered per shot (1-3)
  pending: [],         // locked exposures awaiting the last one
  motion: [],          // stop-motion frames (baked)
  timer: 0, zoom: 1,
  stripLayout: 'strip',
  lab: { shader: true, lens: true, sound: true },
  sound: true, haptics: true, luma: .5,
};
let busy = false, exposureActive = false, trayCard = null, stream = null;
let zTop = 10, uid = 0;
const cardData = new Map();
const hinted = new Set();

function labEvent(type, detail = {}) {
  window.dispatchEvent(new CustomEvent('shoebox:' + type, { detail }));
}

/* ---------------- camera transport (explicit state machine) ----------------
   Replaces a tangle of implicit booleans with one named state. Capture flows
   ask transport.enter('exposing') and impossible transitions are refused, so
   "shoot while a frame is still ejecting" simply cannot happen. */
const transport = {
  state: 'ready',                          // ready | exposing | ejecting
  allowed: {
    ready: ['exposing', 'ejecting'],
    exposing: ['ejecting', 'ready'],
    ejecting: ['ready'],
  },
  can(next) { return this.allowed[this.state].includes(next); },
  enter(next) {
    if (this.state === next) return true;
    if (!this.can(next)) return false;
    this.state = next;
    document.body.dataset.transport = next;
    labEvent('transport', { state: next });
    return true;
  },
};

/* gentle mechanical haptics; rides the same "mechanics" identity as sound */
function haptic(pattern) {
  if (!state.haptics || !state.lab.sound) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate?.(pattern);
}

/* ---------------- film stocks ---------------- */
const STOCKS = {
  goldenhour: { name: 'Goldenhour 400', iso: 400, golden: true,
    base: 'contrast(1.05) saturate(1.08) sepia(.16) hue-rotate(-8deg) brightness(1.03)',
    fx: { grain: 28, vignette: 34, leak: 22, dust: 12 }, chip: 'linear-gradient(135deg,#f5b06a,#d96f4b)' },
  poolside: { name: 'Poolside 100', iso: 100,
    base: 'contrast(1.05) saturate(.8) brightness(1.06)', tint: { color: '#3aa5b4', alpha: .55 },
    fx: { grain: 22, vignette: 26, leak: 14, dust: 8 }, chip: 'linear-gradient(135deg,#8fd0c6,#4f93a8)' },
  tungsten: { name: 'Motel Tungsten', iso: 64,
    base: 'contrast(1.12) saturate(1.12) sepia(.32) hue-rotate(-14deg) brightness(.97)',
    fx: { grain: 34, vignette: 46, leak: 30, dust: 18 }, chip: 'linear-gradient(135deg,#e0883e,#7a3b22)' },
  staticbw: { name: 'Static 3000', iso: 3000,
    base: 'grayscale(1) contrast(1.2) brightness(1.04)',
    fx: { grain: 62, vignette: 44, leak: 0, dust: 30 }, chip: 'linear-gradient(135deg,#cfcfcf,#5a5a5a)' },
  disco: { name: 'Disco Nite', iso: 800,
    base: 'contrast(1.16) saturate(1.5) hue-rotate(-6deg) brightness(1.02)',
    fx: { grain: 30, vignette: 38, leak: 55, dust: 20 }, chip: 'linear-gradient(135deg,#e85d9e,#7a3bd1)' },
  expired86: { name: 'Expired 86', iso: 200, expired: true,
    base: 'contrast(.96) saturate(.88) sepia(.12) brightness(1.02)',
    fx: { grain: 40, vignette: 38, leak: 34, dust: 34 }, chip: 'linear-gradient(135deg,#c9c389,#6f7a4a)' },
  negative99: { name: 'Negative 99', iso: 160, negative: true,
    base: 'contrast(1.06) saturate(1.05) brightness(1.02)',
    fx: { grain: 30, vignette: 30, leak: 18, dust: 16 }, chip: 'linear-gradient(135deg,#54392a,#ff8a3c)' },
};
const FRAMES = {
  paper: { name: 'Paper', bg: '#f6f2ea', ink: '#3f372c' },
  bone: { name: 'Bone', bg: '#eee4cd', ink: '#4a3d2a' },
  ink: { name: 'Ink', bg: '#26231e', ink: '#e9e2d2' },
  bubblegum: { name: 'Bubblegum', bg: '#f3cfd8', ink: '#5e3340' },
  sky: { name: 'Sky', bg: '#cfdfe8', ink: '#2d4250' },
  stripe: { name: 'Stripe', bg: '#f6f2ea', ink: '#3f372c' },
};
const SURFACES = {
  cork: { name: 'Cork', swatch: 'radial-gradient(circle at 35% 30%,#b5814f,#94613a)' },
  walnut: { name: 'Walnut', swatch: 'repeating-linear-gradient(93deg,#4c3322 0 5px,#5a3e2a 5px 9px)' },
  linen: { name: 'Linen', swatch: '#d8d1bf' },
  concrete: { name: 'Concrete', swatch: 'linear-gradient(160deg,#93908a,#76736d)' },
  felt: { name: 'Felt', swatch: 'radial-gradient(circle at 50% 35%,#346049,#24463a)' },
};
const LEAK_COLORS = ['255,90,40', '255,150,60', '255,60,90', '255,40,40'];

const STOCK_THEME = {
  goldenhour: ['#f5b06a', '#d96f4b', '#fff1cf'],
  poolside: ['#8fd0c6', '#4f93a8', '#d8fbff'],
  tungsten: ['#e0883e', '#7a3b22', '#ffd7a8'],
  staticbw: ['#d8d8d8', '#5a5a5a', '#f8f8f8'],
  disco: ['#e85d9e', '#7a3bd1', '#ffd2ed'],
  expired86: ['#c9c389', '#6f7a4a', '#f1e9b8'],
  negative99: ['#ff8a3c', '#54392a', '#ffcf9d'],
};

const PRINT = {
  paper: '#f6f2ea',
  ink: '#3f372c',
  guide: '#b9b09e',
  muted: '#8a7f6c',
  stamp: '#ffa133',
  font: '"Space Grotesk", sans-serif',
  mono: 'VT323, monospace',
};

const MODES = {
  single: { label: 'SINGLE', hint: 'one shot' },
  strip: { label: 'STRIP', hint: '4 in a row' },
  wiggle: { label: 'WIGGLE', hint: '3D wobble gif' },
  motion: { label: 'MOTION', hint: 'stop motion' },
  paint: { label: 'PAINT', hint: 'light trails, 4s' },
  slit: { label: 'SLIT', hint: 'time smear, 4s' },
  pinhole: { label: 'PINHOLE', hint: 'hold still, 5s' },
};
const LENSES = {
  normal: { label: 'STD', tag: 'STD 40', name: 'STANDARD 40', hint: 'clean and honest' },
  fisheye: { label: 'FISH', tag: 'FISH 8', name: 'FISH 8', hint: 'bulging wide' },
  prism: { label: 'PRISM', tag: 'PRISM 6', name: 'PRISM 6', hint: 'kaleidoscope' },
  soft: { label: 'SOFT', tag: 'VELVET 85', name: 'VELVET 85', hint: 'dreamy glow' },
  split: { label: 'TWIN', tag: 'TWIN 2', name: 'TWIN 2', hint: 'double vision' },
};

/* ---------------- dom refs ---------------- */
const wall = $('#wall'), ejector = $('#ejector');
const vfVideo = $('#vfVideo'), vfDemo = $('#vfDemo'), vfFx = $('#vfFx'), vfGhost = $('#vfGhost');
const vfCount = $('#vfCount'), vfRail = $('#vfRail'), vfProg = $('#vfProg'), vfRec = $('#vfRec');
const vfMotion = $('#vfMotion');
const dctx = vfDemo.getContext('2d');
const vfFxCtx = vfFx.getContext('2d');
const fxTmp = mkCanvas(FXS, FXS), fxTmpCtx = fxTmp.getContext('2d');
const meterTmp = mkCanvas(8, 8), meterCtx = meterTmp.getContext('2d', { willReadFrequently: true });

/* ---------------- synthesized audio ---------------- */
let AC = null, master = null;
function audio() {
  if (!state.sound) return null;
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = .5; master.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function noiseBuf(ac, dur) {
  const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function sndShutter() {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), og = ac.createGain();
  o.type = 'square'; o.frequency.value = 2400;
  og.gain.setValueAtTime(.15, t); og.gain.exponentialRampToValueAtTime(.001, t + .03);
  o.connect(og).connect(master); o.start(t); o.stop(t + .04);
  const n = ac.createBufferSource(); n.buffer = noiseBuf(ac, .09);
  const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(.45, t); ng.gain.exponentialRampToValueAtTime(.001, t + .09);
  n.connect(f).connect(ng).connect(master); n.start(t);
  const o2 = ac.createOscillator(), g2 = ac.createGain();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(170, t + .01); o2.frequency.exponentialRampToValueAtTime(70, t + .09);
  g2.gain.setValueAtTime(.35, t + .01); g2.gain.exponentialRampToValueAtTime(.001, t + .12);
  o2.connect(g2).connect(master); o2.start(t + .01); o2.stop(t + .14);
}
function sndMotor(dur = 2.4) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime;
  const n = ac.createBufferSource(); n.buffer = noiseBuf(ac, dur);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 2.2;
  const lfo = ac.createOscillator(), lg = ac.createGain();
  lfo.frequency.value = 26; lg.gain.value = 340;
  lfo.connect(lg).connect(bp.frequency); lfo.start(t); lfo.stop(t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.14, t + .08);
  g.gain.setValueAtTime(.14, t + dur - .25); g.gain.linearRampToValueAtTime(0, t + dur);
  n.connect(bp).connect(g).connect(master); n.start(t);
}
function sndBeep(final) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.value = final ? 1320 : 880;
  g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + .09);
  o.connect(g).connect(master); o.start(t); o.stop(t + .1);
}
function sndLab(kind = 'tap') {
  if (!state.lab.sound) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime;
  const note = {
    tap: [620, .028, .045],
    toggle: [420, .035, .06],
    lens: [760, .045, .07],
    tool: [540, .026, .04],
    fold: [330, .06, .08],
  }[kind] || [560, .03, .05];
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = kind === 'fold' ? 'triangle' : 'square';
  o.frequency.setValueAtTime(note[0], t);
  o.frequency.exponentialRampToValueAtTime(note[0] * .72, t + note[1]);
  g.gain.setValueAtTime(note[2], t);
  g.gain.exponentialRampToValueAtTime(.001, t + note[1] + .03);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + note[1] + .04);
}

/* ---------------- voice notes (mic) ---------------- */
let micStream = null, recorder = null, recChunks = [], recTimer = null;
async function startRec() {
  try {
    micStream = micStream || await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch { toast('Mic blocked. Shooting without sound.'); return false; }
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
  recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
  recChunks = [];
  recorder.ondataavailable = e => recChunks.push(e.data);
  recorder.start();
  vfRec.hidden = false;
  recTimer = setTimeout(stopRecAndShoot, 5000);
  return true;
}
function stopRec() {
  return new Promise(res => {
    recorder.onstop = () => res(new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' }));
    recorder.stop();
  });
}
async function stopRecAndShoot() {
  if (!recorder) return;
  clearTimeout(recTimer); vfRec.hidden = true;
  const blob = await stopRec(); recorder = null;
  takePhoto({ audio: blob });
}
let currentVoice = null;
function playCardAudio(d) {
  if (!d.audioURL) return;
  if (currentVoice) currentVoice.pause();
  currentVoice = new Audio(d.audioURL);
  currentVoice.play().catch(() => {});
}

/* ---------------- demo scenes ---------------- */
function sceneDusk(x, t, S) {
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#241036'); g.addColorStop(.45, '#7c2d3e');
  g.addColorStop(.72, '#d8693c'); g.addColorStop(1, '#f3b35f');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const sy = S * .46 + Math.sin(t * .00012) * S * .04, sxp = S * .62;
  const sg = x.createRadialGradient(sxp, sy, S * .02, sxp, sy, S * .3);
  sg.addColorStop(0, 'rgba(255,224,160,.95)'); sg.addColorStop(.35, 'rgba(255,180,110,.4)');
  sg.addColorStop(1, 'rgba(255,160,90,0)');
  x.fillStyle = sg; x.fillRect(0, 0, S, S);
  x.fillStyle = '#ffdfae'; x.beginPath(); x.arc(sxp, sy, S * .085, 0, 7); x.fill();
  x.fillStyle = '#33122a';
  x.beginPath(); x.moveTo(0, S * .66);
  x.quadraticCurveTo(S * .2, S * .55, S * .42, S * .64);
  x.quadraticCurveTo(S * .66, S * .73, S, S * .6);
  x.lineTo(S, S); x.lineTo(0, S); x.fill();
  x.fillStyle = '#1d0a1c';
  x.beginPath(); x.moveTo(0, S * .76);
  x.quadraticCurveTo(S * .35, S * .68, S * .6, S * .76);
  x.quadraticCurveTo(S * .82, S * .82, S, S * .74);
  x.lineTo(S, S); x.lineTo(0, S); x.fill();
  const wg = x.createLinearGradient(0, S * .78, 0, S);
  wg.addColorStop(0, '#46172e'); wg.addColorStop(1, '#180a14');
  x.fillStyle = wg; x.fillRect(0, S * .8, S, S * .2);
  for (let i = 0; i < 22; i++) {
    const y = S * .81 + i * S * .008;
    const w = S * (.05 + (Math.sin(t * .001 + i * 1.3) + 1) * .07);
    x.fillStyle = `rgba(255,170,90,${.14 + .1 * Math.abs(Math.sin(t * .002 + i * 1.7))})`;
    x.fillRect(sxp - w / 2, y, w, 2);
  }
}
function scenePool(x, t, S) {
  x.fillStyle = '#e6d3b3'; x.fillRect(0, 0, S, S * .22);
  x.fillStyle = 'rgba(120,90,50,.35)'; x.fillRect(0, S * .215, S, 4);
  const g = x.createLinearGradient(0, S * .22, 0, S);
  g.addColorStop(0, '#6cc6d4'); g.addColorStop(1, '#1e7f9e');
  x.fillStyle = g; x.fillRect(0, S * .22, S, S * .78);
  x.lineWidth = 2.5;
  for (let r = 0; r < 9; r++) {
    const rowY = S * (.3 + r * .078);
    x.strokeStyle = `rgba(255,255,255,${.18 + .14 * Math.abs(Math.sin(t * .0012 + r))})`;
    x.beginPath();
    for (let px = 0; px <= S; px += 12) {
      const y = rowY + Math.sin(px * .02 + t * .0015 + r * 2) * 7 + Math.cos(px * .045 - t * .001 + r) * 4;
      px === 0 ? x.moveTo(px, y) : x.lineTo(px, y);
    }
    x.stroke();
  }
  const bx = S * .5 + Math.sin(t * .0004) * S * .28;
  const by = S * .44 + Math.cos(t * .0006) * S * .05;
  x.save(); x.translate(bx, by); x.rotate(t * .0003);
  x.fillStyle = '#f3ede2'; x.beginPath(); x.arc(0, 0, S * .07, 0, 7); x.fill();
  x.fillStyle = '#e0492f';
  x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, S * .07, -.5, .9); x.fill();
  x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, S * .07, 2.2, 3.6); x.fill();
  x.fillStyle = 'rgba(255,255,255,.55)';
  x.beginPath(); x.arc(-S * .02, -S * .025, S * .018, 0, 7); x.fill();
  x.restore();
}
function sceneLamp(x, t, S) {
  x.fillStyle = '#160d24'; x.fillRect(0, 0, S, S);
  const base = x.createRadialGradient(S / 2, S * 1.05, S * .05, S / 2, S * 1.05, S * .7);
  base.addColorStop(0, 'rgba(255,120,50,.5)'); base.addColorStop(1, 'rgba(255,120,50,0)');
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  x.save(); x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const ph = i * 2.1;
    const cx = S * (.5 + .3 * Math.sin(t * .00022 * (1 + i * .13) + ph));
    const cy = S * (.5 + .36 * Math.cos(t * .00017 * (1 + i * .21) + ph * 1.7));
    const r = S * (.13 + .05 * Math.sin(t * .0003 + ph));
    const bg = x.createRadialGradient(cx, cy, r * .1, cx, cy, r);
    bg.addColorStop(0, i % 2 === 0 ? 'rgba(255,130,60,.8)' : 'rgba(255,70,120,.7)');
    bg.addColorStop(1, 'rgba(255,90,60,0)');
    x.fillStyle = bg; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  x.restore();
}
const SCENES = [
  { key: 'dusk', label: 'DUSK', draw: sceneDusk },
  { key: 'pool', label: 'POOL', draw: scenePool },
  { key: 'lamp', label: 'LAMP', draw: sceneLamp },
];

/* ---------------- master loop: scene, meter, lens preview ---------------- */
let lastScene = 0, lastMeter = 0;
function masterLoop(ts) {
  if (!document.hidden) {
    if (!state.live && ts - lastScene > 33) {
      lastScene = ts;
      SCENES[state.scene].draw(dctx, performance.now(), vfDemo.width);
    }
    if (ts - lastMeter > 280) { lastMeter = ts; sampleMeter(); }
    if (!exposureActive) {
      if (state.lens !== 'normal') { renderLensPreview(); vfFx.hidden = false; }
      else vfFx.hidden = true;
    }
  }
  requestAnimationFrame(masterLoop);
}

/* ---------------- capture pipeline ---------------- */
function drawSourceCrop(x, S, shift = 0) {
  const src = state.live ? vfVideo : vfDemo;
  let sw = state.live ? vfVideo.videoWidth : vfDemo.width;
  let sh = state.live ? vfVideo.videoHeight : vfDemo.height;
  if (!sw || !sh) { sw = sh = vfDemo.width; }
  const side = Math.min(sw, sh) / state.zoom;
  let sx = (sw - side) / 2 + shift * side;
  sx = clamp(sx, 0, sw - side);
  const sy = (sh - side) / 2;
  x.save();
  if (state.live && state.mirror) { x.translate(S, 0); x.scale(-1, 1); }
  x.drawImage(src, sx, sy, side, side, 0, 0, S, S);
  x.restore();
}

/* lens geometry as dest->src lookup tables */
const lutCache = new Map();
function lensLUT(key, S) {
  const id = key + S;
  if (lutCache.has(id)) return lutCache.get(id);
  const m = new Int32Array(S * S);
  for (let y = 0; y < S; y++) {
    const ny = (y + .5) / S * 2 - 1;
    for (let x = 0; x < S; x++) {
      const nx = (x + .5) / S * 2 - 1;
      let sx = nx, sy = ny;
      if (key === 'fisheye') {
        const rn = Math.hypot(nx, ny) / Math.SQRT2;
        const s = rn > 0 ? Math.pow(rn, .65) : 0;
        sx = nx * s; sy = ny * s;
      } else if (key === 'prism') {
        const a = Math.atan2(ny, nx), r0 = Math.hypot(nx, ny);
        const seg = Math.PI / 3;
        let am = ((a % seg) + seg) % seg;
        if (am > seg / 2) am = seg - am;
        am += .35;
        sx = r0 * Math.cos(am); sy = r0 * Math.sin(am);
      } else if (key === 'split') {
        sx = (nx < 0 ? nx + .5 : nx - .5) * 1.18; sy = ny;
      }
      sx = clamp(sx, -1, 1); sy = clamp(sy, -1, 1);
      const X = clamp(Math.round((sx + 1) / 2 * S - .5), 0, S - 1);
      const Y = clamp(Math.round((sy + 1) / 2 * S - .5), 0, S - 1);
      m[y * S + x] = Y * S + X;
    }
  }
  lutCache.set(id, m);
  return m;
}
function remapInto(srcCtx, dstCtx, S, key) {
  const map = lensLUT(key, S);
  const sd = srcCtx.getImageData(0, 0, S, S).data;
  const od = dstCtx.createImageData(S, S), dd = od.data;
  for (let i = 0; i < map.length; i++) {
    const si = map[i] * 4, di = i * 4;
    dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = 255;
  }
  dstCtx.putImageData(od, 0, 0);
}
function softBloom(c) {
  const S = c.width, o = mkCanvas(S, S), x = o.getContext('2d');
  x.drawImage(c, 0, 0);
  x.globalCompositeOperation = 'screen';
  x.globalAlpha = .55;
  x.filter = `blur(${(S * .012).toFixed(1)}px)`;
  x.drawImage(c, 0, 0);
  return o;
}
function applyLensCanvas(c) {
  if (state.lens === 'normal') return c;
  if (state.lens === 'soft') return softBloom(c);
  const o = mkCanvas(c.width, c.height);
  remapInto(c.getContext('2d', { willReadFrequently: true }), o.getContext('2d'), c.width, state.lens);
  return o;
}
function renderLensPreview() {
  drawSourceCrop(fxTmpCtx, FXS);
  if (state.lens === 'soft') {
    vfFxCtx.globalCompositeOperation = 'source-over';
    vfFxCtx.filter = 'none';
    vfFxCtx.drawImage(fxTmp, 0, 0);
    vfFxCtx.globalCompositeOperation = 'screen';
    vfFxCtx.globalAlpha = .55;
    vfFxCtx.filter = 'blur(3px)';
    vfFxCtx.drawImage(fxTmp, 0, 0);
    vfFxCtx.globalAlpha = 1; vfFxCtx.filter = 'none';
    vfFxCtx.globalCompositeOperation = 'source-over';
  } else {
    remapInto(fxTmpCtx, vfFxCtx, FXS, state.lens);
  }
}

function grabRaw(opts = {}) {
  const c = mkCanvas(BAKE, BAKE);
  drawSourceCrop(c.getContext('2d'), BAKE, opts.shift || 0);
  return opts.noLens ? c : applyLensCanvas(c);
}

/* film effects baked into the photo */
function applyVignette(x, S, amt) {
  if (amt <= 0) return;
  const g = x.createRadialGradient(S / 2, S / 2, S * .38, S / 2, S / 2, S * .74);
  g.addColorStop(0, 'rgba(15,8,4,0)'); g.addColorStop(1, `rgba(15,8,4,${(amt * .78).toFixed(3)})`);
  x.fillStyle = g; x.fillRect(0, 0, S, S);
}
function applyGrain(x, S, amt) {
  if (amt <= 0) return;
  const n = mkCanvas(256, 256), nx = n.getContext('2d');
  const d = nx.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
  }
  nx.putImageData(d, 0, 0);
  x.save();
  x.globalCompositeOperation = 'overlay';
  x.globalAlpha = Math.min(.55, amt * .5);
  x.fillStyle = x.createPattern(n, 'repeat');
  x.fillRect(0, 0, S, S);
  x.restore();
}
function applyLeak(x, S, amt, R) {
  if (amt <= 0) return;
  const rr = (a, b) => a + R() * (b - a);
  x.save(); x.globalCompositeOperation = 'screen';
  const blobs = R() < .6 ? 1 : 2;
  for (let i = 0; i < blobs; i++) {
    const edge = (R() * 4) | 0;
    const cx = edge === 1 ? S : edge === 3 ? 0 : rr(0, S);
    const cy = edge === 0 ? 0 : edge === 2 ? S : rr(0, S);
    const r = S * rr(.45, .95);
    const col = LEAK_COLORS[(R() * LEAK_COLORS.length) | 0];
    const g = x.createRadialGradient(cx, cy, r * .05, cx, cy, r);
    g.addColorStop(0, `rgba(${col},${(amt * rr(.5, .9)).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  if (R() < .5) {
    const bx = rr(0, S * .8);
    const g = x.createLinearGradient(bx, 0, bx + S * .25, 0);
    const col = LEAK_COLORS[(R() * LEAK_COLORS.length) | 0];
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(.5, `rgba(${col},${(amt * .35).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  x.restore();
}
function applyDust(x, S, amt, R) {
  if (amt <= 0) return;
  const rr = (a, b) => a + R() * (b - a);
  x.save();
  const count = Math.round(amt * 140);
  for (let i = 0; i < count; i++) {
    const light = R() > .22;
    x.fillStyle = light
      ? `rgba(255,250,235,${rr(.2, .65).toFixed(2)})`
      : `rgba(30,20,12,${rr(.2, .5).toFixed(2)})`;
    x.beginPath();
    x.arc(rr(0, S), rr(0, S), rr(.6, 2) * S / 900, 0, 7);
    x.fill();
  }
  if (amt > .25) {
    const n = 1 + (R() < .4 ? 1 : 0);
    x.strokeStyle = 'rgba(250,245,230,.16)'; x.lineWidth = 1.2 * S / 900;
    for (let i = 0; i < n; i++) {
      const sx0 = rr(S * .1, S * .9);
      x.beginPath(); x.moveTo(sx0, rr(0, S * .2));
      x.quadraticCurveTo(sx0 + rr(-40, 40), S * .5, sx0 + rr(-60, 60), rr(S * .8, S));
      x.stroke();
    }
  }
  x.restore();
}
function applyHalation(c, x, S, amt) {
  if (amt <= 0) return;
  const glow = mkCanvas(S, S), gx = glow.getContext('2d');
  gx.filter = `brightness(${(1.16 + amt * .2).toFixed(2)}) saturate(${(1.12 + amt * .28).toFixed(2)}) blur(${(S * (.008 + amt * .01)).toFixed(1)}px)`;
  gx.drawImage(c, 0, 0);
  x.save();
  x.globalCompositeOperation = 'screen';
  x.globalAlpha = .08 + amt * .12;
  x.drawImage(glow, 0, 0);
  x.restore();
}
function applyChromaticSmear(c, x, S, amt, R) {
  if (amt <= 0) return;
  const src = mkCanvas(S, S);
  src.getContext('2d').drawImage(c, 0, 0);
  const drift = (1.5 + amt * 5) * (R() < .5 ? -1 : 1);
  x.save();
  x.globalCompositeOperation = 'screen';
  x.globalAlpha = .045 + amt * .055;
  x.filter = 'hue-rotate(155deg) saturate(1.35)';
  x.drawImage(src, drift, 0);
  x.filter = 'hue-rotate(-30deg) saturate(1.18)';
  x.drawImage(src, -drift * .65, drift * .18);
  x.restore();
}
function applyGateWeave(x, S, amt, R) {
  if (amt <= 0) return;
  const lines = Math.round(2 + amt * 7);
  x.save();
  x.globalAlpha = .05 + amt * .08;
  x.fillStyle = '#fff5df';
  for (let i = 0; i < lines; i++) {
    const y = (i / lines) * S + (R() - .5) * S * .01;
    x.fillRect(0, y, S, Math.max(1, S * .0015));
  }
  x.globalAlpha = .08 + amt * .12;
  x.fillStyle = '#1c1208';
  x.fillRect(0, 0, Math.max(1, S * .0025), S);
  x.fillRect(S - Math.max(1, S * .002), 0, Math.max(1, S * .002), S);
  x.restore();
}
function applyExpired(x, S, R) {
  const rr = (a, b) => a + R() * (b - a);
  x.save();
  // unpredictable color cast
  const casts = ['#9fb867', '#c98a4e', '#7e9c9d', '#b86a8e'];
  x.globalCompositeOperation = 'soft-light';
  x.globalAlpha = rr(.2, .45);
  x.fillStyle = casts[(R() * casts.length) | 0];
  x.fillRect(0, 0, S, S);
  // chemical fog
  x.globalCompositeOperation = 'screen';
  const fogs = 1 + (R() < .5 ? 1 : 0);
  for (let i = 0; i < fogs; i++) {
    const cx = rr(0, S), cy = rr(0, S), r = S * rr(.3, .7);
    const g = x.createRadialGradient(cx, cy, r * .1, cx, cy, r);
    g.addColorStop(0, `rgba(214,228,196,${rr(.15, .35).toFixed(2)})`);
    g.addColorStop(1, 'rgba(214,228,196,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  // edge bleed
  if (R() < .3) {
    const g = x.createLinearGradient(0, 0, S * .45, 0);
    g.addColorStop(0, 'rgba(255,120,30,.55)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  x.restore();
}

function goldenFactor() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  const g = Math.exp(-Math.pow((h - 18.5) / 1.1, 2));
  return g < .08 ? 0 : g;
}

function bake(frames, opts = {}) {
  const stock = STOCKS[opts.stock || state.stock];
  const fx = { ...(opts.fx || state.fx) };
  const R = rng32(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
  const S = BAKE;
  const c = mkCanvas(S, S), x = c.getContext('2d');

  // iso lore: slow film struggles in the dark, fast film washes out in the sun
  let extra = '';
  const dark = Math.max(0, .42 - state.luma), bright = Math.max(0, state.luma - .78);
  if (stock.iso) {
    const slow = Math.sqrt(100 / stock.iso);
    if (dark > 0) {
      fx.grain = Math.min(100, fx.grain + dark * 160 * slow);
      if (stock.iso <= 200) extra += ` brightness(${(1 - dark * .45).toFixed(3)})`;
    }
    if (bright > 0 && stock.iso >= 1600) extra += ' contrast(.93) brightness(1.05)';
  }
  if (stock.golden) {
    const g = goldenFactor();
    if (g > 0) { extra += ` saturate(${(1 + g * .15).toFixed(3)})`; fx.leak = Math.min(100, fx.leak * (1 + g * .8)); }
  }
  if (opts.extraFilter) extra += ' ' + opts.extraFilter;

  x.filter = stock.base + extra;
  const alphas = [1, .55, .45];
  const shaderOn = state.lab.shader && !opts.noShader;
  const weaveX = shaderOn ? (R() - .5) * (1.8 + fx.grain / 32) : 0;
  const weaveY = shaderOn ? (R() - .5) * (1.1 + fx.grain / 70) : 0;
  x.save();
  x.translate(weaveX, weaveY);
  frames.forEach((f, i) => {
    if (i > 0) { x.globalCompositeOperation = 'screen'; x.globalAlpha = alphas[i] || .4; }
    x.drawImage(f, 0, 0, S, S);
  });
  x.restore();
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none';

  if (stock.tint) {
    x.save();
    x.globalCompositeOperation = 'soft-light';
    x.globalAlpha = stock.tint.alpha;
    x.fillStyle = stock.tint.color;
    x.fillRect(0, 0, S, S);
    x.restore();
  }
  if (stock.expired) applyExpired(x, S, R);
  if (shaderOn) {
    const amt = Math.min(1, .18 + fx.grain / 220 + fx.leak / 260);
    applyHalation(c, x, S, amt);
    applyChromaticSmear(c, x, S, Math.min(1, fx.leak / 160 + fx.vignette / 360), R);
  }
  applyVignette(x, S, Math.min(100, fx.vignette + (opts.vigBoost || 0)) / 100);
  applyGrain(x, S, fx.grain / 100);
  applyLeak(x, S, fx.leak / 100, R);
  applyDust(x, S, fx.dust / 100, R);
  if (shaderOn) applyGateWeave(x, S, Math.min(1, fx.grain / 160 + fx.dust / 220), R);
  return c;
}

/* negative display: inverted with the classic orange mask */
function negativeDisplay(c) {
  const o = mkCanvas(c.width, c.height), x = o.getContext('2d');
  x.filter = 'invert(1)';
  x.drawImage(c, 0, 0);
  x.filter = 'none';
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = .5; x.fillStyle = '#ff8a3c'; x.fillRect(0, 0, o.width, o.height);
  x.globalCompositeOperation = 'screen';
  x.globalAlpha = .12; x.fillStyle = '#ff6a20'; x.fillRect(0, 0, o.width, o.height);
  return o;
}
function negCanvas(d) {
  if (!d._neg) d._neg = negativeDisplay(d.canvases[0]);
  return d._neg;
}
function labPreviewURL(d, size = 420) {
  const c = mkCanvas(size, size), x = c.getContext('2d');
  x.drawImage(d.negative ? negCanvas(d) : d.canvases[0], 0, 0, size, size);
  return c.toDataURL('image/jpeg', .78);
}

/* ---------------- cards ---------------- */
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `'${String(d.getFullYear()).slice(2)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}

function createCard({ canvases, type = 'single', frame = state.frame, caption = '', audio: audioBlob = null, negative = false }) {
  const now = new Date();
  const data = {
    id: ++uid, type, frame, canvases, caption, negative,
    stock: state.stock,
    date: fmtDate(now), born: now, note: '', place: '',
    rot: rnd(-2.5, 2.5),
    audioURL: audioBlob ? URL.createObjectURL(audioBlob) : null,
  };
  cardData.set(data.id, data);

  const el = document.createElement('div');
  el.className = `card lab-paper f-${frame} t-${type}` + (type === 'wiggle' ? ' lenticular' : '');
  el.dataset.id = data.id;
  el.dataset.stock = data.stock;
  el.style.setProperty('--rot', data.rot.toFixed(2) + 'deg');
  el.style.setProperty('--tf', (0.5 + (data.id % 5) * 0.18).toFixed(2));

  const singleLayout = type === 'single' || type === 'wiggle' || type === 'motion';

  const fig = c => {
    const f = document.createElement('figure');
    f.className = 'ph';
    const img = new Image();
    img.src = c.toDataURL('image/jpeg', .92);
    img.alt = 'Instant photo';
    img.draggable = false;
    f.append(img);
    return f;
  };

  if (singleLayout) {
    const f = fig(data.negative ? negCanvas(data) : canvases[0]);
    if (type !== 'single') canvases.slice(1).forEach(c => {
      const img = new Image();
      img.src = c.toDataURL('image/jpeg', .9);
      img.alt = ''; img.draggable = false;
      f.append(img);
    });
    const haze = document.createElement('i'); haze.className = 'haze'; f.append(haze);
    const stamp = document.createElement('span');
    stamp.className = 'stamp'; stamp.textContent = data.date;
    f.append(stamp);
    if (data.audioURL) {
      const v = document.createElement('span');
      v.className = 'voice-chip'; v.textContent = 'VOICE';
      f.append(v);
    }
    const face = document.createElement('div');
    face.className = 'card-face';
    face.append(f);
    const cap = document.createElement('div');
    cap.className = 'caption';
    cap.contentEditable = 'plaintext-only';
    cap.dataset.ph = 'write something';
    cap.spellcheck = false;
    cap.textContent = caption;
    cap.addEventListener('pointerdown', e => e.stopPropagation());
    cap.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cap.blur(); } });
    cap.addEventListener('input', () => {
      if (cap.textContent.length > 32) cap.textContent = cap.textContent.slice(0, 32);
      data.caption = cap.textContent.trim();
    });
    face.append(cap);
    const inner = document.createElement('div');
    inner.className = 'card-inner';
    inner.append(face, buildCardBack(el, data));
    el.append(inner);
    el.classList.add('flippable');
  } else {
    const holder = type === 'grid' ? document.createElement('div') : el;
    if (type === 'grid') { holder.className = 'phs'; el.append(holder); }
    canvases.forEach(c => {
      const f = fig(c);
      const haze = document.createElement('i'); haze.className = 'haze'; f.append(haze);
      holder.append(f);
    });
    const foot = document.createElement('footer');
    const brand = document.createElement('span'); brand.textContent = 'SHOEBOX';
    const time = document.createElement('time'); time.textContent = data.date;
    foot.append(brand, time);
    el.append(foot);
  }

  // frame cycling for wiggle and stop-motion cards
  if ((type === 'wiggle' || type === 'motion') && canvases.length > 1) {
    const first = el.querySelector('.ph img');
    let started = false;
    const go = () => { if (!started) { started = true; startLively(el, data); } };
    first.addEventListener('animationend', e => { if (e.animationName === 'develop') go(); }, { once: true });
    setTimeout(() => { if (!el.classList.contains('developing')) go(); }, 200);
  }

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.addEventListener('pointerdown', e => e.stopPropagation());

  // one "Save" control that opens a format menu (PNG / GIF / MP4)
  const saveWrap = document.createElement('div');
  saveWrap.className = 'save-wrap';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'save-btn'; saveBtn.textContent = 'save ▾';
  const menu = document.createElement('div');
  menu.className = 'save-menu'; menu.hidden = true;
  let closeListener = null;
  const closeMenu = () => {
    menu.hidden = true; el.classList.remove('saving');
    if (closeListener) { document.removeEventListener('pointerdown', closeListener, true); closeListener = null; }
  };
  const addFmt = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => { closeMenu(); sndLab('tool'); fn(); });
    menu.append(b);
  };
  addFmt('PNG', () => exportCard(data));
  if (singleLayout) {
    addFmt('GIF', () => exportGifCard(data));
    addFmt('MP4', () => exportVideoCard(data));
  }
  saveBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.hidden) {
      menu.hidden = false; el.classList.add('saving'); sndLab('tap');
      closeListener = ev => { if (!saveWrap.contains(ev.target)) closeMenu(); };
      setTimeout(() => document.addEventListener('pointerdown', closeListener, true), 0);
    } else closeMenu();
  });
  saveWrap.append(saveBtn, menu);
  tools.append(saveWrap);

  const tossBtn = document.createElement('button');
  tossBtn.type = 'button'; tossBtn.textContent = 'toss';
  tossBtn.addEventListener('click', () => { sndLab('tool'); removeCard(el, data); });
  tools.append(tossBtn);
  el.append(tools);

  // voice playback: hover on desktop, press-and-hold on touch
  if (data.audioURL) {
    let hoverT = null;
    el.addEventListener('mouseenter', () => { hoverT = setTimeout(() => playCardAudio(data), 350); });
    el.addEventListener('mouseleave', () => { clearTimeout(hoverT); if (currentVoice) currentVoice.pause(); });
  }

  bindDrag(el, data);
  return el;
}

function startLively(el, d) {
  const imgs = [...el.querySelectorAll('.ph img')];
  if (imgs.length < 2) return;
  let i = 0, dir = 1;
  d._timer = setInterval(() => {
    if (document.hidden) return;
    if (d.type === 'wiggle') {
      i += dir;
      if (i === imgs.length - 1 || i === 0) dir *= -1;
    } else i = (i + 1) % imgs.length;
    imgs.forEach((im, j) => { im.style.opacity = j === i ? 1 : 0; });
  }, d.type === 'wiggle' ? 95 : 115);
}

/* ---- the back of the photo: ruled note, develop stamp, place scrawl ---- */
function fmtBack(d) {
  const p = n => String(n).padStart(2, '0');
  return `${fmtDate(d)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function buildCardBack(el, data) {
  const back = document.createElement('div');
  back.className = 'card-back';
  const stop = e => e.stopPropagation();

  const head = document.createElement('div');
  head.className = 'cb-head';
  head.innerHTML = `<span>SHOEBOX</span><span class="cb-no">No.${String(data.id).padStart(3, '0')}</span>`;
  back.append(head);

  const dev = document.createElement('div');
  dev.className = 'cb-dev lab-stamp';
  dev.textContent = 'DEVELOPED ON ' + fmtBack(data.born);
  back.append(dev);

  const note = document.createElement('div');
  note.className = 'cb-note cb-edit handwritten';
  note.contentEditable = 'plaintext-only';
  note.spellcheck = false;
  note.dataset.ph = 'a longer note on the back…';
  note.textContent = data.note || '';
  note.addEventListener('pointerdown', stop);
  note.addEventListener('input', () => {
    if (note.textContent.length > 220) note.textContent = note.textContent.slice(0, 220);
    data.note = note.textContent;
  });
  back.append(note);

  // place: a tidy single line — map thumbnail + coordinates, shown only once tagged
  const place = document.createElement('div');
  place.className = 'cb-place';
  place.hidden = !data.place;
  const map = document.createElement('canvas');
  map.className = 'cb-map'; map.width = 44; map.height = 44; map.hidden = !data.coords;
  if (data.coords) drawMapDoodle(map, data.coords);
  const placeText = document.createElement('span');
  placeText.className = 'cb-place-text handwritten';
  placeText.textContent = data.place || '';
  place.append(map, placeText);
  back.append(place);

  // footer: two evenly sized actions
  const foot = document.createElement('div');
  foot.className = 'cb-foot';
  const tag = document.createElement('button');
  tag.type = 'button'; tag.className = 'cb-btn';
  tag.textContent = data.place ? 'place ✓' : 'tag place';
  tag.addEventListener('pointerdown', stop);
  tag.addEventListener('click', () => tagPlace(data, placeText, map, tag, place));
  const flip = document.createElement('button');
  flip.type = 'button'; flip.className = 'cb-btn'; flip.textContent = 'flip ↩';
  flip.addEventListener('pointerdown', stop);
  flip.addEventListener('click', () => toggleFlip(el, data, false));
  foot.append(tag, flip);
  back.append(foot);
  return back;
}
function toggleFlip(el, data, force) {
  const next = force != null ? force : !el.classList.contains('flipped');
  el.classList.toggle('flipped', next);
  sndLab('toggle'); haptic(8);
}

/* location is opt-in and never leaves the device: coordinates become an
   offline procedural "map doodle", not a request to any tile server. */
function tagPlace(data, textEl, mapEl, btn, rowEl) {
  if (!navigator.geolocation) { toast('No location available on this device.'); return; }
  btn.textContent = 'locating…';
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: la, longitude: lo } = pos.coords;
    data.coords = [la, lo];
    data.place = `${la.toFixed(3)}°, ${lo.toFixed(3)}°`;
    textEl.textContent = data.place;
    mapEl.hidden = false;
    if (rowEl) rowEl.hidden = false;
    drawMapDoodle(mapEl, data.coords);
    btn.textContent = 'place ✓';
  }, () => { btn.textContent = 'tag place'; toast('Location permission denied.'); },
    { enableHighAccuracy: false, timeout: 8000 });
}
function drawMapDoodle(cv, [la, lo]) {
  const x = cv.getContext('2d'), S = cv.width;
  const R = rng32((Math.abs((la * 1000) | 0) ^ Math.abs((lo * 1000) | 0)) >>> 0);
  x.fillStyle = '#efe7d2'; x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(90,70,40,.45)'; x.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const y = R() * S; x.beginPath(); x.moveTo(0, y); x.lineTo(S, y + (R() - .5) * 12); x.stroke(); }
  for (let i = 0; i < 4; i++) { const px = R() * S; x.beginPath(); x.moveTo(px, 0); x.lineTo(px + (R() - .5) * 12, S); x.stroke(); }
  x.strokeStyle = 'rgba(150,95,40,.85)'; x.lineWidth = 1.7;
  x.beginPath(); x.moveTo(0, R() * S);
  for (let px = 0; px <= S; px += 7) x.lineTo(px, S * .2 + R() * S * .6);
  x.stroke();
  const pinX = S * .5, pinY = S * .44;
  x.fillStyle = '#e23b2a';
  x.beginPath(); x.arc(pinX, pinY, S * .12, Math.PI, 0); x.lineTo(pinX, pinY + S * .26); x.closePath(); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(pinX, pinY - S * .02, S * .045, 0, 7); x.fill();
}

/* drop one photo onto another -> sandwich them into a new double exposure */
function srcOf(d) { return d.negative ? negCanvas(d) : d.canvases[0]; }
function sandwichTargetAt(el, data, cx, cy) {
  if (!el.classList.contains('flippable') || data.negative) return null;
  for (const node of document.elementsFromPoint(cx, cy)) {
    const card = node.closest && node.closest('.card');
    if (card && card !== el && card.classList.contains('flippable')) {
      const d = cardData.get(+card.dataset.id);
      if (d && !d.negative) return card;
    }
  }
  return null;
}
function makeSandwich(a, b) {
  if (!a || !b) return;
  const S = BAKE;
  const c = mkCanvas(S, S), x = c.getContext('2d');
  x.drawImage(srcOf(a), 0, 0, S, S);
  x.globalCompositeOperation = 'screen'; x.globalAlpha = .92;
  x.drawImage(srcOf(b), 0, 0, S, S);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  applyGrain(x, S, .12);
  flash(); sndShutter(); haptic(14);
  const el = createCard({ canvases: [c], type: 'single' });
  const d = cardData.get(+el.dataset.id);
  d.caption = 'double exposure';
  el.querySelector('.caption').textContent = d.caption;
  eject(el);
  updateStudioCounts();
  toast('Double exposure: two photos sandwiched into one.');
}

/* "toss" bursts the print into a cloud of its own pixels before it leaves */
function disintegrate(el, done) {
  const data = cardData.get(+el.dataset.id);
  const r = el.getBoundingClientRect();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !data || r.width < 4) { sndLab('tool'); done(); return; }
  let src;
  try { src = renderCardCanvas(data, 2); } catch { done(); return; }
  const cv = document.createElement('canvas');
  cv.className = 'disintegrate';
  cv.style.left = r.left + 'px'; cv.style.top = r.top + 'px';
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  const DPR = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * DPR); cv.height = Math.round(r.height * DPR);
  document.body.append(cv);
  const x = cv.getContext('2d');
  const cols = 22, rows = Math.max(4, Math.round(cols * r.height / r.width));
  const bw = cv.width / cols, bh = cv.height / rows;
  const sw = src.width / cols, sh = src.height / rows;
  const cells = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push({
    sx: i * sw, sy: j * sh, x: i * bw, y: j * bh,
    vx: (i / cols - .5) * rnd(180, 360) * DPR + rnd(-60, 60),
    vy: (rnd(-260, -60) + (j / rows) * 120) * DPR,
    vr: rnd(-8, 8), delay: (j / rows) * 130 + rnd(0, 60),
  });
  el.style.visibility = 'hidden';
  haptic([6, 18, 10]);
  const t0 = performance.now();
  (function step(now) {
    const t = now - t0;
    x.clearRect(0, 0, cv.width, cv.height);
    let alive = 0;
    for (const c of cells) {
      const lt = t - c.delay;
      if (lt < 0) { x.drawImage(src, c.sx, c.sy, sw, sh, c.x, c.y, bw + 1, bh + 1); alive++; continue; }
      const dt = lt / 1000;
      const a = 1 - lt / 720;
      if (a <= 0) continue;
      alive++;
      x.save();
      x.globalAlpha = a;
      x.translate(c.x + c.vx * dt + bw / 2, c.y + c.vy * dt + 1100 * DPR * dt * dt + bh / 2);
      x.rotate(c.vr * dt);
      x.drawImage(src, c.sx, c.sy, sw, sh, -bw / 2, -bh / 2, bw + 1, bh + 1);
      x.restore();
    }
    if (alive) requestAnimationFrame(step);
    else { cv.remove(); done(); }
  })(t0);
  sndLab('tool');
}

function removeCard(el, data) {
  disintegrate(el, () => {
    if (trayCard === el) trayCard = null;
    if (data._timer) clearInterval(data._timer);
    if (data.audioURL) URL.revokeObjectURL(data.audioURL);
    cardData.delete(data.id);
    el.remove();
    updateStudioCounts();
    updateLightbox();
  });
}

/* throw momentum after a flick */
function momentum(el, vx, vy) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (Math.hypot(vx, vy) < 8) return;
  let x = parseFloat(el.style.left) || 0, y = parseFloat(el.style.top) || 0;
  let last = performance.now();
  (function step(now) {
    const dt = Math.min(40, now - last) / 16; last = now;
    x += vx * dt; y += vy * dt;
    vx *= 0.9; vy *= 0.9;
    const w = el.offsetWidth;
    if (x < -w + 80) { x = -w + 80; vx *= -.4; }
    if (x > innerWidth - 80) { x = innerWidth - 80; vx *= -.4; }
    if (y < 0) { y = 0; vy *= -.4; }
    if (y > innerHeight - 60) { y = innerHeight - 60; vy *= -.4; }
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (Math.hypot(vx, vy) > 4) requestAnimationFrame(step);
  })(last);
}

function bringTop(el) { el.style.zIndex = ++zTop; }

/* drag + throw momentum + shake-to-develop + sandwich + flip + lightbox drop */
function bindDrag(el, data) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.caption, .tools, .cb-edit, .cb-btn')) return;
    e.preventDefault();
    pullToWall(el);
    bringTop(el);
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left - (r.width - el.offsetWidth) / 2;
    const oy = e.clientY - r.top - (r.height - el.offsetHeight) / 2;
    const pid = e.pointerId, startX = e.clientX, startY = e.clientY;
    el.classList.add('dragging');
    let lastX = e.clientX, lastY = e.clientY, lastT = performance.now();
    let vx = 0, vy = 0, lastDir = 0, shakes = 0, lastShakeT = 0, boosted = false, moved = false;
    let target = null;
    const holdPlay = data.audioURL ? setTimeout(() => { if (!moved) playCardAudio(data); }, 450) : null;
    const setBoost = on => {
      if (on === boosted) return;
      boosted = on;
      el.getAnimations({ subtree: true }).forEach(a => { a.playbackRate = on ? 3.2 : 1; });
    };
    const clearTarget = () => { if (target) { target.classList.remove('sandwich-target'); target = null; } };
    const mv = ev => {
      if (ev.pointerId !== pid) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      if (holdPlay) clearTimeout(holdPlay);
      el.style.left = (ev.clientX - ox) + 'px';
      el.style.top = (ev.clientY - oy) + 'px';
      const now = performance.now(), dt = Math.max(8, now - lastT);
      vx = (ev.clientX - lastX) / dt * 16;
      vy = (ev.clientY - lastY) / dt * 16;
      const dx = ev.clientX - lastX;
      if (Math.abs(dx) > 5) {
        const dir = Math.sign(dx);
        if (lastDir !== 0 && dir !== lastDir) {
          shakes++; lastShakeT = now;
          if (shakes >= 3 && el.classList.contains('developing')) setBoost(true);
        }
        lastDir = dir;
      }
      lastX = ev.clientX; lastY = ev.clientY; lastT = now;
      if (boosted && now - lastShakeT > 800) { shakes = 0; setBoost(false); }
      const t = sandwichTargetAt(el, data, ev.clientX, ev.clientY);
      if (t !== target) { clearTarget(); target = t; if (target) target.classList.add('sandwich-target'); }
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      if (holdPlay) clearTimeout(holdPlay);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      setBoost(false);
      if (!moved) {
        const now = performance.now();
        if (el.classList.contains('flippable') && now - (el._tapT || 0) < 320) { el._tapT = 0; toggleFlip(el, data); }
        else el._tapT = now;
        return;
      }
      if (target) { const tgt = target; clearTarget(); makeSandwich(data, cardData.get(+tgt.dataset.id)); return; }
      if (data.negative && overlapsLightbox(el)) { revealNegative(el, data); return; }
      momentum(el, vx, vy);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

function pullToWall(el) {
  if (el.parentElement !== ejector) return;
  const r = el.getBoundingClientRect();
  el.classList.remove('ejecting');
  if (trayCard === el) trayCard = null;
  wall.append(el);
  el.style.left = (r.left + (r.width - el.offsetWidth) / 2) + 'px';
  el.style.top = (r.top + (r.height - el.offsetHeight) / 2) + 'px';
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));
  const y = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  return x * y;
}
function deskTarget(el) {
  const w = el.offsetWidth || 210, h = el.offsetHeight || 252;
  const minX = innerWidth < 700 ? 18 : innerWidth * .34;
  const maxX = Math.max(minX + 12, innerWidth - w - 28);
  const minY = 74, maxY = Math.max(100, innerHeight - h - 46);
  const existing = [...wall.querySelectorAll('.card')]
    .filter(card => card !== el)
    .map(card => {
      const l = parseFloat(card.style.left) || 0, t = parseFloat(card.style.top) || 0;
      return { l, t, r: l + card.offsetWidth, b: t + card.offsetHeight };
    });
  let best = null;
  for (let i = 0; i < 18; i++) {
    const x = Math.round(rnd(minX, maxX));
    const y = Math.round(rnd(minY, maxY));
    const rect = { l: x, t: y, r: x + w, b: y + h };
    const overlap = existing.reduce((sum, r) => sum + overlapArea(rect, r), 0);
    const cameraPenalty = x < 430 && y > innerHeight - 420 ? 50000 : 0;
    const score = overlap + cameraPenalty + Math.abs(x - innerWidth * .62) * .08;
    if (!best || score < best.score) best = { x, y, score };
  }
  return best || { x: minX, y: minY };
}
function scatter(el) {
  const data = cardData.get(+el.dataset.id);
  pullToWall(el);
  bringTop(el);
  requestAnimationFrame(() => {
    const target = deskTarget(el);
    el.classList.add('scatter', 'settling');
    el.style.left = target.x + 'px';
    el.style.top = target.y + 'px';
    const rot = rnd(-9, 9);
    if (data) data.rot = rot;
    el.style.setProperty('--rot', rot.toFixed(2) + 'deg');
    el.addEventListener('transitionend', () => {
      el.classList.remove('scatter', 'settling');
      if (data) {
        const r = el.getBoundingClientRect();
        labEvent('card-settled', {
          id: data.id, type: data.type, frame: data.frame, stock: data.stock,
          x: r.left, y: r.top, w: r.width, h: r.height, rot: data.rot,
          image: labPreviewURL(data, 280),
        });
      }
    }, { once: true });
  });
}

function eject(el) {
  if (trayCard) scatter(trayCard);
  trayCard = el;
  const data = cardData.get(+el.dataset.id);
  ejector.append(el);
  const h = el.offsetHeight;
  ejector.style.height = Math.round(h * .9) + 'px';
  const tall = h > 300;
  el.style.setProperty('--ejdur', tall ? '3.4s' : '2.6s');
  el.style.setProperty('--dev', '7.6s');
  el.classList.add('ejecting', 'developing');
  transport.enter('ejecting');
  haptic([10, 40, 16]);
  sndMotor(tall ? 3.2 : 2.4);
  $('.cam-shell').classList.add('kick');
  setTimeout(() => $('.cam-shell').classList.remove('kick'), 500);
  if (data) labEvent('photo-eject', {
    id: data.id, type: data.type, frame: data.frame, stock: data.stock,
    image: labPreviewURL(data), tall,
  });
  pulseFlashBeam();
  hint('shake', 'Tip: give the photo a little shake while it develops.');
  updateLightbox();
}

/* lightbox: appears when a negative is on the desk */
function anyNegatives() {
  for (const d of cardData.values()) if (d.negative) return true;
  return false;
}
function updateLightbox() { $('#lightbox').hidden = !anyNegatives(); }
function overlapsLightbox(el) {
  const lb = $('#lightbox');
  if (lb.hidden) return false;
  const a = el.getBoundingClientRect(), b = lb.getBoundingClientRect();
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function revealNegative(el, d) {
  d.negative = false;
  el.classList.add('fixing');
  sndBeep(true);
  setTimeout(() => {
    el.querySelector('.ph img').src = d.canvases[0].toDataURL('image/jpeg', .92);
    el.classList.remove('fixing');
    updateLightbox();
  }, 420);
}

/* ---------------- shooting flows ---------------- */
function flash() {
  const f = $('#flash');
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  pulseFlashBeam();
}
function pulseFlashBeam() {
  const beam = $('#flashBeam');
  if (!beam) return;
  beam.innerHTML = '';
  const count = matchMedia('(prefers-reduced-motion: reduce)').matches ? 10 : 26;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', rnd(8, 92).toFixed(1) + '%');
    p.style.setProperty('--y', rnd(5, 85).toFixed(1) + '%');
    p.style.setProperty('--d', rnd(.08, .46).toFixed(2) + 's');
    p.style.setProperty('--s', rnd(.8, 2.6).toFixed(2));
    beam.append(p);
  }
  beam.classList.remove('on'); void beam.offsetWidth; beam.classList.add('on');
  labEvent('flash', { intensity: matchMedia('(prefers-reduced-motion: reduce)').matches ? .5 : 1 });
}
async function countdown(n) {
  vfCount.classList.remove('small');
  vfCount.hidden = false;
  for (let i = n; i > 0; i--) {
    vfCount.textContent = i;
    sndBeep(i === 1);
    await sleep(1000);
  }
  vfCount.hidden = true;
}
function showLabel(text) {
  vfCount.classList.add('small');
  vfCount.textContent = text;
  vfCount.hidden = false;
}
function hideLabel() { vfCount.hidden = true; vfCount.classList.remove('small'); }
function feedReady() {
  if (state.live && !vfVideo.videoWidth) { toast('Camera is warming up, try again in a second.'); return false; }
  return true;
}
function setBusy(on) { busy = on; document.body.classList.toggle('busy', on); transport.enter(on ? 'exposing' : 'ready'); }

function makeAndEject(canvases, type, opts = {}) {
  const stock = STOCKS[state.stock];
  const el = createCard({
    canvases, type,
    audio: opts.audio || null,
    negative: !!(stock.negative && (type === 'single')),
  });
  eject(el);
  updateStudioCounts();
  if (cardData.get(+el.dataset.id).negative)
    hint('lightbox', 'A negative. Drag it onto the lightbox to develop it.');
  return el;
}

function updateGhost() {
  if (state.pending.length) {
    const g = mkCanvas(FXS, FXS), x = g.getContext('2d');
    state.pending.forEach((f, i) => {
      if (i > 0) { x.globalCompositeOperation = 'screen'; x.globalAlpha = .6; }
      x.drawImage(f, 0, 0, FXS, FXS);
    });
    vfGhost.src = g.toDataURL('image/jpeg', .7);
    vfGhost.hidden = false;
  } else if (state.mode === 'motion' && state.motion.length) {
    vfGhost.src = state.motion[state.motion.length - 1].toDataURL('image/jpeg', .6);
    vfGhost.hidden = false;
  } else vfGhost.hidden = true;
}
function clearPending() {
  state.pending = [];
  $('#ctlExpo b').textContent = state.expo + 'X';
  updateGhost();
}

async function takePhoto(opts = {}) {
  if (busy) return;
  if (!feedReady()) return;
  setBusy(true);
  try {
    if (state.timer && !state.pending.length) await countdown(state.timer);
    const raw = grabRaw();
    if (state.expo > 1 && state.pending.length < state.expo - 1) {
      state.pending.push(raw);
      flash(); sndShutter();
      updateGhost();
      $('#ctlExpo b').textContent = `${state.pending.length + 1}/${state.expo}`;
      hint('expo', 'Exposure locked. Keep shooting to layer the rest.');
      return;
    }
    const frames = [...state.pending, raw];
    clearPending();
    flash(); sndShutter();
    makeAndEject([bake(frames)], 'single', opts);
  } finally { setBusy(false); }
}

async function stripFlow() {
  if (busy) return;
  if (!feedReady()) return;
  setBusy(true);
  try {
    vfRail.hidden = false;
    vfRail.innerHTML = '<i></i><i></i><i></i><i></i>';
    const shots = [];
    for (let i = 0; i < 4; i++) {
      await countdown(i === 0 ? (state.timer || 3) : 3);
      flash(); sndShutter();
      const baked = bake([grabRaw()]);
      shots.push(baked);
      const im = new Image();
      im.src = baked.toDataURL('image/jpeg', .6);
      vfRail.children[i].append(im);
      await sleep(350);
    }
    await sleep(450);
    vfRail.hidden = true;
    makeAndEject(shots, state.stripLayout === 'grid' ? 'grid' : 'strip');
  } finally { setBusy(false); }
}

async function wiggleFlow() {
  if (busy) return;
  if (!feedReady()) return;
  setBusy(true);
  try {
    if (state.timer) await countdown(state.timer);
    const seed = (Math.random() * 1e9) | 0;
    const shots = [];
    flash();
    for (let i = 0; i < 3; i++) {
      sndShutter();
      shots.push(bake([grabRaw({ shift: (i - 1) * .05 })], { seed }));
      if (i < 2) await sleep(150);
    }
    makeAndEject(shots, 'wiggle');
  } finally { setBusy(false); }
}

/* long exposures share one skeleton: tick(acc) for DUR ms, then finish(acc) */
async function longExposure(DUR, label, tick, finish) {
  if (busy) return;
  if (!feedReady()) return;
  setBusy(true);
  exposureActive = true;
  try {
    if (state.timer) await countdown(state.timer);
    showLabel(label);
    sndShutter();
    const acc = mkCanvas(BAKE, BAKE), ax = acc.getContext('2d');
    ax.fillStyle = '#000'; ax.fillRect(0, 0, BAKE, BAKE);
    vfFx.hidden = false; vfProg.hidden = false;
    const t0 = performance.now();
    let n = 0;
    await new Promise(done => {
      const step = () => {
        const t = performance.now() - t0;
        n++;
        tick(ax, acc, n, t / DUR);
        vfFxCtx.clearRect(0, 0, FXS, FXS);
        vfFxCtx.drawImage(acc, 0, 0, FXS, FXS);
        vfProg.style.setProperty('--p', Math.min(100, t / DUR * 100).toFixed(1));
        if (t < DUR) requestAnimationFrame(step); else done();
      };
      step();
    });
    vfProg.hidden = true; hideLabel();
    flash();
    finish(applyLensCanvas(acc));
  } finally {
    exposureActive = false;
    setBusy(false);
  }
}

const expTmp = mkCanvas(BAKE, BAKE), expTmpCtx = expTmp.getContext('2d');

function paintFlow() {
  return longExposure(4000, 'PAINT WITH LIGHT', (ax) => {
    drawSourceCrop(expTmpCtx, BAKE);
    ax.globalCompositeOperation = 'lighten';
    ax.drawImage(expTmp, 0, 0);
  }, acc => makeAndEject([bake([acc])], 'single'));
}

function slitFlow() {
  let lastX = 0;
  return longExposure(4200, 'TIME SMEAR', (ax, acc, n, frac) => {
    drawSourceCrop(expTmpCtx, BAKE);
    const dx = Math.min(BAKE, Math.ceil(frac * BAKE));
    if (dx > lastX) {
      const colW = Math.max(8, BAKE * .012);
      ax.globalCompositeOperation = 'source-over';
      ax.drawImage(expTmp, (BAKE - colW) / 2, 0, colW, BAKE, lastX, 0, dx - lastX, BAKE);
      lastX = dx;
    }
  }, acc => makeAndEject([bake([acc])], 'single'));
}

function pinholeFlow() {
  return longExposure(5000, 'HOLD STILL', (ax, acc, n) => {
    drawSourceCrop(expTmpCtx, BAKE);
    ax.globalCompositeOperation = 'source-over';
    ax.globalAlpha = 1 / n;
    ax.drawImage(expTmp, 0, 0);
    ax.globalAlpha = 1;
  }, acc => makeAndEject([bake([acc], { extraFilter: 'blur(4px) brightness(1.06)', vigBoost: 30 })], 'single'));
}

/* stop-motion */
function takeMotionFrame() {
  if (busy) return;
  if (!feedReady()) return;
  flash(); sndShutter();
  state.motion.push(bake([grabRaw()]));
  $('#motionN').textContent = state.motion.length;
  vfMotion.hidden = false;
  updateGhost();
  hint('motion', 'Every press adds a frame. Press DEVELOP when the scene is done.');
}
function finishMotion() {
  if (state.motion.length < 2) { toast('A flipbook needs at least 2 frames.'); return; }
  const frames = state.motion.slice(0, 24);
  state.motion = [];
  vfMotion.hidden = true;
  updateGhost();
  makeAndEject(frames, 'motion');
}
function cancelMotion(silent) {
  if (state.motion.length && !silent) toast('Stop-motion frames cleared.');
  state.motion = [];
  vfMotion.hidden = true;
  $('#motionN').textContent = '0';
  updateGhost();
}

function shutterPress() {
  haptic(8);
  switch (state.mode) {
    case 'strip': stripFlow(); break;
    case 'wiggle': wiggleFlow(); break;
    case 'paint': paintFlow(); break;
    case 'slit': slitFlow(); break;
    case 'pinhole': pinholeFlow(); break;
    case 'motion': takeMotionFrame(); break;
    default: takePhoto();
  }
}

/* ---------------- webcam ---------------- */
async function goLive() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    vfVideo.srcObject = stream;
    state.live = true;
    state.mirror = state.facing === 'user';
    vfVideo.classList.toggle('mirror', state.mirror);
    vfVideo.hidden = false; vfDemo.style.display = 'none';
    document.body.classList.add('live'); document.body.classList.remove('demo');
    $('#ctlSrc b').textContent = 'LIVE';
    applyPreviewFilters();
  } catch {
    toast('Webcam blocked or unavailable. Staying on the demo feed.');
    goDemo();
  }
}
function goDemo() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  vfVideo.srcObject = null;
  state.live = false;
  vfVideo.hidden = true; vfDemo.style.display = '';
  document.body.classList.remove('live'); document.body.classList.add('demo');
  $('#ctlSrc b').textContent = 'DEMO';
  applyPreviewFilters();
}

/* ---------------- preview filters + meter ---------------- */
function applyPreviewFilters() {
  const stock = STOCKS[state.stock];
  vfVideo.style.filter = stock.base;
  vfDemo.style.filter = stock.base;
  vfFx.style.filter = stock.base;
  const tint = $('.vf-tint');
  tint.style.background = stock.tint ? stock.tint.color : 'transparent';
  tint.style.opacity = stock.tint ? stock.tint.alpha : 0;
  $('.vf-vignette').style.opacity = (state.fx.vignette / 100) * .9;
  $('.vf-grain').style.opacity = (state.fx.grain / 100) * .6;
  $('.vf-leak').style.opacity = (state.fx.leak / 100) * .65;
}
function sampleMeter() {
  try {
    drawSourceCrop(meterCtx, 8);
    const d = meterCtx.getImageData(0, 0, 8, 8).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    const luma = sum / (64 * 255);
    state.luma = state.luma * .6 + luma * .4;
  } catch { /* canvas not ready */ }
}

/* ---------------- exports ---------------- */
function roundRect(x, x0, y0, w, h, r) {
  x.beginPath();
  x.moveTo(x0 + r, y0);
  x.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
  x.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  x.arcTo(x0, y0 + h, x0, y0, r);
  x.arcTo(x0, y0, x0 + w, y0, r);
  x.closePath();
}

/* re-render a card at k px per CSS px; o.photo/o.filter/o.hazeAlpha/o.stampAlpha for GIF frames */
function renderCardCanvas(d, k, o = {}) {
  const fr = FRAMES[d.frame];
  const singleLayout = d.type === 'single' || d.type === 'wiggle' || d.type === 'motion';
  let W, H;
  if (singleLayout) { W = 210 * k; H = 252 * k; }
  else if (d.type === 'strip') { W = 130 * k; H = 511 * k; }
  else { W = 210 * k; H = 230 * k; }
  const c = mkCanvas(Math.round(W), Math.round(H)), x = c.getContext('2d');
  roundRect(x, 0, 0, W, H, 4 * k);
  x.fillStyle = fr.bg; x.fill();
  x.save(); x.clip();
  x.globalAlpha = .05; applyGrain(x, Math.max(W, H), 1); x.globalAlpha = 1;

  const stampFont = s => `${s}px ${PRINT.mono}`;
  if (singleLayout) {
    const pad = 10 * k, ph = 190 * k;
    const photo = o.photo || (d.negative ? negCanvas(d) : d.canvases[0]);
    x.save();
    if (o.filter) x.filter = o.filter;
    x.drawImage(photo, pad, pad, ph, ph);
    x.restore();
    if (o.hazeAlpha) {
      x.globalAlpha = o.hazeAlpha;
      x.fillStyle = '#d6cdb8'; x.fillRect(pad, pad, ph, ph);
      x.globalAlpha = 1;
    }
    const sa = o.stampAlpha != null ? o.stampAlpha : .92;
    if (sa > 0) {
      x.font = stampFont(17 * k); x.textAlign = 'right'; x.textBaseline = 'alphabetic';
      x.shadowColor = 'rgba(255,140,40,.8)'; x.shadowBlur = 7 * k;
      x.fillStyle = PRINT.stamp; x.globalAlpha = sa;
      x.fillText(d.date, pad + ph - 8 * k, pad + ph - 7 * k);
      x.shadowBlur = 0; x.globalAlpha = 1;
    }
    if (d.caption) {
      x.font = `600 ${21 * k}px Caveat, cursive`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = fr.ink;
      x.fillText(d.caption, W / 2, pad + ph + 25 * k, W - 16 * k);
    }
  } else {
    const pad = (d.type === 'strip' ? 8 : 10) * k;
    let footY;
    if (d.type === 'strip') {
      const ph = 114 * k, gap = 7 * k;
      d.canvases.forEach((cv, i) => x.drawImage(cv, pad, pad + i * (ph + gap), ph, ph));
      footY = pad + 4 * ph + 3 * gap + 13 * k;
    } else {
      const ph = 92 * k, gap = 6 * k;
      d.canvases.forEach((cv, i) =>
        x.drawImage(cv, pad + (i % 2) * (ph + gap), pad + ((i / 2) | 0) * (ph + gap), ph, ph));
      footY = pad + 2 * ph + gap + 15 * k;
    }
    x.font = `600 ${8.5 * k}px "Space Grotesk", sans-serif`;
    x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillStyle = d.frame === 'ink' ? '#9a917e' : PRINT.muted;
    x.fillText('S H O E B O X', pad + 1 * k, footY);
    x.font = stampFont(13 * k); x.textAlign = 'right';
    x.fillStyle = PRINT.stamp; x.globalAlpha = .9;
    x.fillText(d.date, W - pad - 1 * k, footY);
    x.globalAlpha = 1;
  }
  if (d.frame === 'stripe') {
    const cols = ['#d94025', '#e87f24', '#e9b820', '#3f8a43', '#2b5fa3'];
    const bh = 7 * k, bw = W / 5;
    cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(i * bw, H - bh, bw + 1, bh); });
  }
  x.restore();
  return c;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function downloadCanvas(c, name) { c.toBlob(b => downloadBlob(b, name), 'image/png'); }

async function exportCard(d) {
  await document.fonts.ready;
  downloadCanvas(renderCardCanvas(d, 5), `shoebox-${String(d.id).padStart(3, '0')}.png`);
  toast('Photo saved.');
}

/* gif exports: wigglegram + flipbook + develop timelapse */
function developFilter(t) {
  const e = 1 - Math.pow(1 - t, 2);
  return `blur(${(10 * (1 - e)).toFixed(1)}px) brightness(${(.16 + .84 * e).toFixed(2)}) ` +
    `saturate(${(.05 + .95 * Math.pow(t, 1.2)).toFixed(2)}) sepia(${(.6 * (1 - t)).toFixed(2)})`;
}
async function exportGifCard(d) {
  await document.fonts.ready;
  toast('Building the GIF...');
  await sleep(30);
  const k = 2;
  let frames = [], delays = [];
  if ((d.type === 'wiggle' || d.type === 'motion') && d.canvases.length > 1) {
    const seq = d.type === 'wiggle' ? [0, 1, 2, 1] : d.canvases.map((_, i) => i);
    seq.forEach(i => {
      frames.push(renderCardCanvas(d, k, { photo: d.canvases[i] }));
      delays.push(d.type === 'wiggle' ? 10 : 12);
    });
  } else {
    const steps = 13;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      frames.push(renderCardCanvas(d, k, {
        filter: developFilter(t),
        hazeAlpha: (1 - t) * .55,
        stampAlpha: t < .72 ? 0 : .92,
      }));
      delays.push(s === steps ? 160 : 16);
    }
  }
  downloadBlob(encodeGIF(frames, delays), `shoebox-${String(d.id).padStart(3, '0')}.gif`);
  toast('GIF saved.');
}

/* shareable H.264: wigglegrams + flipbooks loop, singles play their develop-in */
async function exportVideoCard(d) {
  if (typeof window.exportFramesToVideo !== 'function') { toast('Video export unavailable here.'); return; }
  await document.fonts.ready;
  toast('Encoding video...');
  await sleep(30);
  const k = 2;
  const frames = [], delaysCs = [];
  if ((d.type === 'wiggle' || d.type === 'motion') && d.canvases.length > 1) {
    const seq = d.type === 'wiggle' ? [0, 1, 2, 1] : d.canvases.map((_, i) => i);
    const loops = d.type === 'wiggle' ? 8 : 3;
    for (let l = 0; l < loops; l++) seq.forEach(i => {
      frames.push(renderCardCanvas(d, k, { photo: d.canvases[i] }));
      delaysCs.push(d.type === 'wiggle' ? 9 : 12);
    });
  } else {
    const steps = 26;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      frames.push(renderCardCanvas(d, k, {
        filter: developFilter(t), hazeAlpha: (1 - t) * .55, stampAlpha: t < .72 ? 0 : .92,
      }));
      delaysCs.push(s === steps ? 90 : 8);
    }
  }
  try {
    const { blob, ext } = await window.exportFramesToVideo(frames, { fps: 12, delaysCs });
    downloadBlob(blob, `shoebox-${String(d.id).padStart(3, '0')}.${ext}`);
    toast(ext === 'mp4' ? 'MP4 saved.' : 'Video saved.');
  } catch (err) { console.warn(err); toast('Video export failed.'); }
}

/* wall, zine, poster */
function paintSurface(x, W, H) {
  if (state.surface === 'cork') {
    const g = x.createRadialGradient(W * .3, H * .18, W * .05, W * .3, H * .18, W * .9);
    g.addColorStop(0, '#b5814f'); g.addColorStop(.55, '#9a6a3e'); g.addColorStop(1, '#84582f');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  } else if (state.surface === 'walnut') {
    x.fillStyle = '#4c3322'; x.fillRect(0, 0, W, H);
    x.save(); x.rotate(.052);
    const cols = ['#4c3322', '#5a3e2a', '#443021'];
    for (let i = 0, px = -H * .2; px < W + H; i++) {
      const w = [52, 52, 72][i % 3];
      x.fillStyle = cols[i % 3];
      x.fillRect(px, -H * .2, w, H * 1.6);
      px += w;
    }
    x.restore();
  } else if (state.surface === 'linen') {
    x.fillStyle = '#d8d1bf'; x.fillRect(0, 0, W, H);
  } else if (state.surface === 'concrete') {
    const g = x.createLinearGradient(0, 0, W * .4, H);
    g.addColorStop(0, '#93908a'); g.addColorStop(1, '#76736d');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  } else {
    const g = x.createRadialGradient(W / 2, H * .32, W * .05, W / 2, H * .32, W * .8);
    g.addColorStop(0, '#346049'); g.addColorStop(.7, '#24463a'); g.addColorStop(1, '#1c382e');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  x.save(); x.globalAlpha = .12; applyGrain(x, Math.max(W, H), 1); x.restore();
  const v = x.createRadialGradient(W / 2, H * .42, Math.min(W, H) * .4, W / 2, H * .42, Math.max(W, H) * .85);
  v.addColorStop(0, 'rgba(10,5,2,0)'); v.addColorStop(1, 'rgba(10,5,2,.38)');
  x.fillStyle = v; x.fillRect(0, 0, W, H);
}

async function exportWall() {
  const cards = [...wall.querySelectorAll('.card')];
  if (!cards.length && !trayCard) { toast('Nothing on the wall yet.'); return; }
  await document.fonts.ready;
  const k = 2;
  const c = mkCanvas(innerWidth * k, innerHeight * k), x = c.getContext('2d');
  paintSurface(x, c.width, c.height);
  cards.sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
  for (const el of cards) {
    const d = cardData.get(+el.dataset.id);
    if (!d) continue;
    const r = el.getBoundingClientRect();
    const cw = el.offsetWidth, ch = el.offsetHeight;
    const cardC = renderCardCanvas(d, 4);
    x.save();
    x.translate((r.left + r.width / 2) * k, (r.top + r.height / 2) * k);
    x.rotate(d.rot * Math.PI / 180);
    x.shadowColor = 'rgba(12,7,3,.45)'; x.shadowBlur = 26 * k; x.shadowOffsetY = 10 * k;
    x.drawImage(cardC, -cw * k / 2, -ch * k / 2, cw * k, ch * k);
    x.restore();
  }
  downloadCanvas(c, 'shoebox-wall.png');
  toast('Wall saved as one image.');
}

function latestCards(n) {
  return [...cardData.values()].sort((a, b) => b.id - a.id).slice(0, n).reverse();
}

/* minimal one-page PDF wrapping a JPEG (A4 landscape) */
function buildPDF(jpegU8, pw, ph) {
  const enc = s => new TextEncoder().encode(s);
  const chunks = []; let off = 0; const offs = [];
  const add = u8 => { chunks.push(u8); off += u8.length; };
  const obj = s => { offs.push(off); add(enc(s)); };
  add(enc('%PDF-1.4\n'));
  obj('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  obj('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n');
  obj('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]/Resources<</XObject<</Im1 4 0 R>>/ProcSet[/PDF/ImageC]>>/Contents 5 0 R>>endobj\n');
  offs.push(off);
  add(enc(`4 0 obj<</Type/XObject/Subtype/Image/Width ${pw}/Height ${ph}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpegU8.length}>>stream\n`));
  add(jpegU8);
  add(enc('\nendstream endobj\n'));
  const content = 'q 842 0 0 595 0 0 cm /Im1 Do Q';
  obj(`5 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n`);
  const xref = off;
  let xr = 'xref\n0 6\n0000000000 65535 f \n';
  for (const o of offs) xr += String(o).padStart(10, '0') + ' 00000 n \n';
  xr += `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  add(enc(xr));
  return new Blob(chunks, { type: 'application/pdf' });
}

function playZineFold(customPicks) {
  const picks = (customPicks && customPicks.length >= 8) ? customPicks.slice(0, 8) : latestCards(8);
  if (picks.length < 8) { toast(`Fold preview needs 8 photos. ${8 - picks.length} more to go.`); return; }
  const wrap = $('#zineFold'), book = $('#zineBook');
  book.querySelectorAll('i').forEach((page, i) => {
    page.style.backgroundImage = `linear-gradient(rgba(246,242,234,.26), rgba(246,242,234,.26)), url("${labPreviewURL(picks[i], 260)}")`;
    page.dataset.page = String(i + 1);
  });
  wrap.hidden = false;
  wrap.style.display = 'grid';
  wrap.classList.remove('play');
  void wrap.offsetWidth;
  wrap.classList.add('play');
  sndLab('fold');
  setTimeout(() => {
    wrap.hidden = true;
    wrap.style.display = 'none';
    wrap.classList.remove('play');
  }, 3600);
}

/* classic one-sheet 8-panel zine imposition (cut the middle, fold) */
async function exportZine(customPicks) {
  const picks = (customPicks && customPicks.length >= 8) ? customPicks.slice(0, 8) : latestCards(8);
  if (picks.length < 8) { toast(`A zine needs 8 photos. ${8 - picks.length} more to go.`); return; }
  await document.fonts.ready;
  playZineFold(picks);
  toast('Folding the zine...');
  await sleep(30);
  const W = 2480, H = 1754, pw = W / 4, phh = H / 2;
  const c = mkCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);

  const drawPanel = (page, col, row, flip) => {
    x.save();
    x.translate(col * pw + pw / 2, row * phh + phh / 2);
    if (flip) x.rotate(Math.PI);
    x.fillStyle = PRINT.paper;
    x.fillRect(-pw / 2 + 14, -phh / 2 + 14, pw - 28, phh - 28);
    const d = picks[page - 1];
    const mini = renderCardCanvas(d, 2);
    const mw = pw * .62, mh = mw * (mini.height / mini.width);
    x.save();
    x.rotate((page % 2 ? -1 : 1) * .03);
    x.shadowColor = 'rgba(12,7,3,.3)'; x.shadowBlur = 16; x.shadowOffsetY = 7;
    x.drawImage(mini, -mw / 2, -mh / 2 + (page === 1 ? 26 : 0), mw, mh);
    x.restore();
    if (page === 1) {
      x.fillStyle = PRINT.ink;
      x.font = `600 44px ${PRINT.font}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('S H O E B O X', 0, -phh / 2 + 76);
      x.font = `500 22px ${PRINT.font}`;
      x.fillStyle = PRINT.muted;
      x.fillText('a tiny zine', 0, -phh / 2 + 112);
    }
    x.fillStyle = PRINT.guide;
    x.font = `500 20px ${PRINT.font}`;
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillText(String(page), 0, phh / 2 - 28);
    x.restore();
  };
  [[5, 0], [4, 1], [3, 2], [2, 3]].forEach(([p, col]) => drawPanel(p, col, 0, true));
  [[6, 0], [7, 1], [8, 2], [1, 3]].forEach(([p, col]) => drawPanel(p, col, 1, false));

  // guides: dashed center cut, dotted fold lines
  x.strokeStyle = PRINT.guide; x.lineWidth = 2;
  x.setLineDash([18, 12]);
  x.beginPath(); x.moveTo(pw, H / 2); x.lineTo(3 * pw, H / 2); x.stroke();
  x.setLineDash([3, 9]);
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * pw, 0); x.lineTo(i * pw, H); x.stroke(); }
  x.setLineDash([]);
  x.fillStyle = PRINT.muted; x.font = `500 19px ${PRINT.font}`;
  x.textAlign = 'left';
  x.fillText('print, cut the dashed slit, fold along the dotted lines', 24, H - 20);

  const jpeg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', .9))).arrayBuffer());
  downloadBlob(buildPDF(jpeg, W, H), 'shoebox-zine.pdf');
  toast('Zine PDF saved. Print it single-sided.');
}

async function exportPoster(customPicks) {
  const picks = (customPicks && customPicks.length >= 12) ? customPicks.slice(0, 12) : latestCards(12);
  if (picks.length < 12) { toast(`A poster needs 12 photos. ${12 - picks.length} more to go.`); return; }
  await document.fonts.ready;
  toast('Composing the poster...');
  await sleep(30);
  const W = 1800, H = 2400;
  const c = mkCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = PRINT.paper; x.fillRect(0, 0, W, H);
  x.globalAlpha = .06; applyGrain(x, H, 1); x.globalAlpha = 1;
  x.fillStyle = PRINT.ink;
  x.font = `700 92px ${PRINT.font}`;
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillText('S H O E B O X', W / 2, 150);
  x.font = `500 34px ${PRINT.font}`;
  x.fillStyle = PRINT.muted;
  x.fillText(`the wall, ${fmtDate(new Date()).slice(0, 3)}`, W / 2, 206);
  const cols = 3, rows = 4, cw = 470, top = 280;
  picks.forEach((d, i) => {
    const mini = renderCardCanvas(d, 2.1);
    const mw = cw, mh = mw * (mini.height / mini.width);
    const cx = W / 2 + (i % cols - 1) * 560;
    const cy = top + Math.floor(i / cols) * 520 + mh / 2;
    x.save();
    x.translate(cx, cy);
    x.rotate(((i % 3) - 1) * .035 + ((i % 2) ? .015 : -.015));
    x.shadowColor = 'rgba(12,7,3,.35)'; x.shadowBlur = 30; x.shadowOffsetY = 12;
    x.drawImage(mini, -mw / 2, -mh / 2, mw, mh);
    x.restore();
  });
  downloadCanvas(c, 'shoebox-poster.png');
  toast('Poster saved.');
}

/* ---------------- ui ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function hint(key, msg) {
  if (hinted.has(key)) return;
  hinted.add(key);
  toast(msg);
}

function buildPanel() {
  const stocks = $('#stocks');
  for (const [key, s] of Object.entries(STOCKS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="chip" style="background:${s.chip}"></span>${s.name}` +
      (s.golden ? '<em class="gh">golden hour</em>' : '');
    b.dataset.stock = key;
    b.classList.toggle('on', key === state.stock);
    b.addEventListener('click', () => {
      state.stock = key;
      state.fx = { ...s.fx };
      stocks.querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
      syncSliders();
      syncStockTheme();
      applyPreviewFilters();
      labEvent('stock', { stock: key, theme: STOCK_THEME[key] });
    });
    stocks.append(b);
  }
  updateGolden();
  setInterval(updateGolden, 60000);

  const fr = $('#frames');
  for (const [key, f] of Object.entries(FRAMES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = f.name;
    b.style.background = key === 'stripe'
      ? `linear-gradient(180deg, ${f.bg} 70%, #d94025 70% 76%, #e87f24 76% 82%, #e9b820 82% 88%, #3f8a43 88% 94%, #2b5fa3 94%)`
      : f.bg;
    b.classList.toggle('on', key === state.frame);
    b.addEventListener('click', () => {
      state.frame = key;
      fr.querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
      toast(`Next photo gets the ${f.name} frame.`);
    });
    fr.append(b);
  }
  const su = $('#surfaces');
  for (const [key, s] of Object.entries(SURFACES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = s.name;
    b.style.background = s.swatch;
    b.classList.toggle('on', key === state.surface);
    b.addEventListener('click', () => {
      state.surface = key;
      document.body.className = document.body.className.replace(/bg-\w+/, 'bg-' + key);
      su.querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
    });
    su.append(b);
  }
  $('#stripSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.stripLayout = b.dataset.layout;
    $('#stripSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
  });
  for (const [id, key] of [['#fxGrain', 'grain'], ['#fxVignette', 'vignette'], ['#fxLeak', 'leak'], ['#fxDust', 'dust']]) {
    const input = $(id);
    input.addEventListener('input', () => {
      state.fx[key] = +input.value;
      input.nextElementSibling.value = input.value;
      applyPreviewFilters();
    });
  }
}
function syncSliders() {
  for (const [id, key] of [['#fxGrain', 'grain'], ['#fxVignette', 'vignette'], ['#fxLeak', 'leak'], ['#fxDust', 'dust']]) {
    const input = $(id);
    input.value = state.fx[key];
    input.nextElementSibling.value = state.fx[key];
  }
}
function updateGolden() {
  const on = goldenFactor() > .25;
  const b = $('#stocks button[data-stock="goldenhour"]');
  if (b) b.classList.toggle('golden-now', on);
  document.body.classList.toggle('golden-now', on);
}
function syncStockTheme() {
  const theme = STOCK_THEME[state.stock] || STOCK_THEME.goldenhour;
  document.body.dataset.stock = state.stock;
  document.body.style.setProperty('--stock-a', theme[0]);
  document.body.style.setProperty('--stock-b', theme[1]);
  document.body.style.setProperty('--stock-c', theme[2]);
}
function syncLab() {
  // shader, glass (lens), and soundboard stay on in full; spatial is gone
  document.body.classList.toggle('lab-shader', state.lab.shader);
  document.body.classList.toggle('lab-lens', state.lab.lens);
  document.body.classList.toggle('lab-soundboard', state.lab.sound);
}
function updateStudioCounts() {
  const n = cardData.size;
  const fold = $('#stFold span'), zine = $('#stZine span'), poster = $('#stPoster span');
  if (fold) fold.textContent = n >= 8 ? 'latest 8 photos as a booklet' : `need ${8 - n} more photos`;
  if (zine) zine.textContent = n >= 8 ? 'foldable PDF, latest 8 photos' : `need ${8 - n} more photos`;
  if (poster) poster.textContent = n >= 12 ? 'print-size PNG, latest 12 photos' : `need ${12 - n} more photos`;
}

/* shared setters so a tap (cycle) and a drag (dial) share one code path */
function setExpo(v) {
  state.expo = v; clearPending();
  $('#ctlExpo').classList.toggle('on', v > 1);
}
function setTimer(v) {
  state.timer = v;
  $('#ctlTimer b').textContent = v ? v + 'S' : 'OFF';
  $('#ctlTimer').classList.toggle('on', !!v);
}
function setZoom(v) {
  state.zoom = v;
  $('#ctlZoom b').textContent = v + 'x';
  $('#ctlZoom').classList.toggle('on', v !== 1);
  const sc = `scale(${v})`;
  vfDemo.style.transform = sc;
  vfVideo.style.transform = state.mirror ? `scaleX(-1) scale(${v})` : sc;
}
/* drag a control up/down to step through its detents, like a physical dial */
function attachDial(id, cfg) {
  const el = $('#' + id);
  let pid = null, downY = 0, used = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    pid = e.pointerId; downY = e.clientY; used = false;
    el.setPointerCapture?.(pid);
  });
  el.addEventListener('pointermove', e => {
    if (pid == null || e.pointerId !== pid) return;
    if (Math.abs(downY - e.clientY) >= 22) {
      const dir = Math.sign(downY - e.clientY);
      const cur = cfg.cur();
      const i = clamp(cfg.list.indexOf(cur) + dir, 0, cfg.list.length - 1);
      if (cfg.list[i] !== cur) { cfg.set(cfg.list[i]); haptic(6); used = true; }
      downY = e.clientY;
    }
  });
  const end = e => {
    if (pid == null) return;
    pid = null;
    el.releasePointerCapture?.(e.pointerId);
    if (used && e.type === 'pointerup') {
      const block = ev => { ev.stopImmediatePropagation(); el.removeEventListener('click', block, true); };
      el.addEventListener('click', block, true);
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ---------------- contact sheet (find, filter, curate) ---------------- */
const sheetSel = new Set();
function selectedPicks() {
  return [...cardData.values()].filter(d => sheetSel.has(d.id)).sort((a, b) => a.id - b.id);
}
function updateSheetFoot() {
  const n = sheetSel.size;
  $('#sheetCount').textContent = n ? `${n} selected` : 'tap photos to select';
}
function buildSheet(filter = 'all') {
  const grid = $('#sheetGrid'); grid.innerHTML = '';
  const cards = [...cardData.values()].sort((a, b) => b.id - a.id);
  const present = [...new Set(cards.map(d => d.stock))];
  const chips = $('#sheetFilters'); chips.innerHTML = '';
  const mkChip = (key, label) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.classList.toggle('on', filter === key);
    b.addEventListener('click', () => buildSheet(key));
    chips.append(b);
  };
  mkChip('all', `All (${cards.length})`);
  present.forEach(s => mkChip(s, (STOCKS[s]?.name || s)));
  const shown = cards.filter(d => filter === 'all' || d.stock === filter);
  if (!shown.length) { grid.innerHTML = '<p class="sheet-empty">No photos yet — shoot a few.</p>'; updateSheetFoot(); return; }
  for (const d of shown) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sheet-cell' + (sheetSel.has(d.id) ? ' sel' : '');
    const img = new Image();
    img.src = labPreviewURL(d, 240); img.alt = d.caption || 'photo';
    const meta = document.createElement('span');
    meta.className = 'sheet-meta';
    meta.textContent = `${(STOCKS[d.stock]?.name || '').split(' ')[0]} · ${d.date}`;
    cell.append(img, meta);
    cell.addEventListener('click', () => {
      sheetSel.has(d.id) ? sheetSel.delete(d.id) : sheetSel.add(d.id);
      cell.classList.toggle('sel', sheetSel.has(d.id));
      updateSheetFoot();
    });
    grid.append(cell);
  }
  updateSheetFoot();
}
function openSheet() {
  if (!cardData.size) { toast('Nothing to show yet.'); return; }
  $('#darkroom').hidden = $('#studio').hidden = true;
  sheetSel.clear();
  buildSheet('all');
  const s = $('#sheet'); s.hidden = false;
  requestAnimationFrame(() => s.classList.add('open'));
}
function closeSheet() {
  const s = $('#sheet'); s.classList.remove('open');
  setTimeout(() => { s.hidden = true; }, 240);
}

/* on-camera popovers */
let popKind = null;
function closePopover() { $('#popover').hidden = true; popKind = null; }
function openPopover(kind) {
  if (popKind === kind) { closePopover(); return; }
  popKind = kind;
  const pop = $('#popover');
  pop.innerHTML = '';
  const defs = kind === 'mode' ? MODES : LENSES;
  const current = kind === 'mode' ? state.mode : state.lens;
  for (const [key, def] of Object.entries(defs)) {
    const b = document.createElement('button');
    b.type = 'button';
    const glass = kind === 'lens' ? `<i class="lens-mini lens-${key}" aria-hidden="true"></i>` : '';
    b.innerHTML = `${glass}<span>${def.name || def.label}</span><em>${def.hint}</em>`;
    b.classList.toggle('on', key === current);
    b.addEventListener('click', () => {
      if (kind === 'mode') setMode(key); else setLens(key);
      closePopover();
    });
    pop.append(b);
  }
  pop.hidden = false;
}
function setMode(key) {
  if (state.mode === 'motion' && key !== 'motion') cancelMotion();
  state.mode = key;
  clearPending();
  $('#ctlMode b').textContent = MODES[key].label;
  $('#ctlMode').classList.toggle('on', key !== 'single');
  sndLab('toggle');
  labEvent('mode', { mode: key });
  if (key === 'motion') hint('motionMode', 'Stop motion: every shutter press adds a frame.');
}
function setLens(key) {
  state.lens = key;
  $('#camera').dataset.lens = key;
  $('#ctlLens b').textContent = LENSES[key].label;
  $('#ctlLens').classList.toggle('on', key !== 'normal');
  $('#lensTag').textContent = LENSES[key].tag;
  sndLab('lens');
  labEvent('lens', { lens: key });
}

function bindControls() {
  document.addEventListener('click', e => {
    const b = e.target.closest('button, input[type="checkbox"]');
    if (!b || b.id === 'shutter' || b.closest('.tools')) return;
    sndLab(b.type === 'checkbox' ? 'toggle' : 'tap');
  }, true);

  /* shutter: tap to shoot, hold to record a voice note */
  const shutter = $('#shutter');
  let holdT = null, recActive = false;
  shutter.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    recActive = false;
    if (state.mode === 'single' && !busy) {
      holdT = setTimeout(async () => { recActive = await startRec(); }, 550);
    }
  });
  shutter.addEventListener('pointerup', () => {
    clearTimeout(holdT);
    if (recActive) { recActive = false; stopRecAndShoot(); }
    else shutterPress();
  });
  shutter.addEventListener('pointerleave', () => {
    clearTimeout(holdT);
    if (recActive) { recActive = false; stopRecAndShoot(); }
  });

  $('#ctlMode').addEventListener('click', () => openPopover('mode'));
  $('#ctlLens').addEventListener('click', () => openPopover('lens'));
  document.addEventListener('pointerdown', e => {
    if (!popKind) return;
    if (!e.target.closest('#popover, #ctlMode, #ctlLens')) closePopover();
  });

  $('#ctlExpo').addEventListener('click', () => setExpo(state.expo === 3 ? 1 : state.expo + 1));
  $('#ctlTimer').addEventListener('click', () => setTimer(state.timer === 0 ? 3 : state.timer === 3 ? 10 : 0));
  $('#ctlZoom').addEventListener('click', () => setZoom(state.zoom === 1 ? 1.4 : state.zoom === 1.4 ? 2 : 1));
  attachDial('ctlExpo', { list: [1, 2, 3], cur: () => state.expo, set: setExpo });
  attachDial('ctlTimer', { list: [0, 3, 10], cur: () => state.timer, set: setTimer });
  attachDial('ctlZoom', { list: [1, 1.4, 2], cur: () => state.zoom, set: setZoom });
  $('#ctlFlip').addEventListener('click', () => {
    if (!state.live) { toast('Flip works on the live feed. Press FEED first.'); return; }
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    goLive();
  });
  $('#ctlSrc').addEventListener('click', () => {
    clearPending(); cancelMotion(true);
    state.live ? goDemo() : goLive();
  });
  $('#ctlScene').addEventListener('click', () => {
    state.scene = (state.scene + 1) % SCENES.length;
    $('#ctlScene b').textContent = SCENES[state.scene].label;
  });
  $('#motionDone').addEventListener('click', finishMotion);

  $('#btnDarkroom').addEventListener('click', () => {
    $('#studio').hidden = true;
    $('#darkroom').hidden = !$('#darkroom').hidden;
  });
  $('#btnStudio').addEventListener('click', () => {
    $('#darkroom').hidden = true;
    const st = $('#studio');
    st.hidden = !st.hidden;
    if (!st.hidden) updateStudioCounts();
  });
  $('#stWall').addEventListener('click', () => exportWall());
  $('#stFold').addEventListener('click', () => playZineFold());
  $('#stZine').addEventListener('click', () => exportZine());
  $('#stPoster').addEventListener('click', () => exportPoster());

  $('#btnSheet').addEventListener('click', openSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetZine').addEventListener('click', () => {
    const p = selectedPicks();
    if (p.length && p.length < 8) { toast(`Select 8 for a zine (${p.length} chosen).`); return; }
    closeSheet(); exportZine(p.length ? p : null);
  });
  $('#sheetPoster').addEventListener('click', () => {
    const p = selectedPicks();
    if (p.length && p.length < 12) { toast(`Select 12 for a poster (${p.length} chosen).`); return; }
    closeSheet(); exportPoster(p.length ? p : null);
  });

  $('#btnClear').addEventListener('click', () => {
    if (!wall.children.length && !trayCard) return;
    if (!confirm('Toss every photo on the wall?')) return;
    for (const [, d] of cardData) {
      if (d._timer) clearInterval(d._timer);
      if (d.audioURL) URL.revokeObjectURL(d.audioURL);
    }
    wall.innerHTML = '';
    if (trayCard) { trayCard.remove(); trayCard = null; }
    cardData.clear();
    updateStudioCounts();
    updateLightbox();
  });
  $('#btnSound').addEventListener('click', () => {
    state.sound = !state.sound;
    $('#btnSound').textContent = 'Sound: ' + (state.sound ? 'on' : 'off');
    $('#btnSound').setAttribute('aria-pressed', state.sound);
  });

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(input|textarea|button)$/i.test(a.tagName))) return;
    e.preventDefault();
    shutterPress();
  });

  addEventListener('resize', () => {
    for (const el of wall.querySelectorAll('.card')) {
      const left = Math.min(parseFloat(el.style.left) || 0, innerWidth - 80);
      const top = Math.min(parseFloat(el.style.top) || 0, innerHeight - 80);
      el.style.left = Math.max(left, -el.offsetWidth + 80) + 'px';
      el.style.top = Math.max(top, 0) + 'px';
    }
  });
}

/* ---------------- pwa + gyro tilt ---------------- */
function setupPWA() {
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
let tiltOn = false, tiltBase = null;
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  if (!tiltBase) tiltBase = { b: e.beta, g: e.gamma };
  const tx = clamp((e.gamma - tiltBase.g) / 14, -1, 1) * 7;
  const ty = clamp((e.beta - tiltBase.b) / 14, -1, 1) * 7;
  wall.style.setProperty('--tiltX', tx.toFixed(1) + 'px');
  wall.style.setProperty('--tiltY', ty.toFixed(1) + 'px');
}
function setupTilt() {
  if (typeof DeviceOrientationEvent === 'undefined') return;
  if (!matchMedia('(pointer:coarse)').matches) return;
  $('#deskSec').hidden = false;
  $('#tiltBtn').addEventListener('click', async () => {
    if (!tiltOn && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; }
      catch { return; }
    }
    tiltOn = !tiltOn;
    tiltBase = null;
    if (tiltOn) addEventListener('deviceorientation', onOrient);
    else {
      removeEventListener('deviceorientation', onOrient);
      wall.style.setProperty('--tiltX', '0px');
      wall.style.setProperty('--tiltY', '0px');
    }
    $('#tiltBtn').textContent = 'Tilt drift: ' + (tiltOn ? 'on' : 'off');
    $('#tiltBtn').classList.toggle('on', tiltOn);
  });
}

/* ambient light: real room light drives the live light-leak intensity */
let ambientSensor = null, ambientOn = false;
function setupAmbient() {
  const btn = $('#ambientBtn');
  if (!btn) return;
  if (!('AmbientLightSensor' in window)) { btn.hidden = true; return; }
  $('#deskSec').hidden = false; btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (ambientOn) {
      ambientOn = false;
      try { ambientSensor?.stop(); } catch {}
      document.documentElement.style.removeProperty('--ambient-leak');
      applyPreviewFilters();
      btn.textContent = 'Room light: off'; btn.classList.remove('on');
      return;
    }
    try {
      if (navigator.permissions) {
        const p = await navigator.permissions.query({ name: 'ambient-light-sensor' }).catch(() => null);
        if (p && p.state === 'denied') { toast('Room-light sensor is blocked.'); return; }
      }
      ambientSensor = new AmbientLightSensor({ frequency: 4 });
      ambientSensor.addEventListener('reading', () => {
        const lux = ambientSensor.illuminance || 0;
        const dark = clamp(1 - lux / 350, 0, 1);
        document.documentElement.style.setProperty('--ambient-leak', (0.2 + dark * 0.65).toFixed(2));
        const leak = $('.vf-leak');
        if (leak) leak.style.opacity = (0.18 + dark * 0.6).toFixed(2);
      });
      ambientSensor.addEventListener('error', () => { toast('Room-light sensor unavailable.'); ambientOn = false; btn.textContent = 'Room light: off'; btn.classList.remove('on'); });
      ambientSensor.start();
      ambientOn = true; btn.textContent = 'Room light: on'; btn.classList.add('on');
    } catch { toast('Room-light sensor unavailable.'); }
  });
}

/* ---------------- demo wall samples ---------------- */
function sampleCards() {
  const make = (sceneFn, t, stock, frame, caption, lx, ty, rot) => {
    const raw = mkCanvas(BAKE, BAKE);
    const tmp = mkCanvas(720, 720);
    sceneFn(tmp.getContext('2d'), t, 720);
    raw.getContext('2d').drawImage(tmp, 0, 0, BAKE, BAKE);
    const baked = bake([raw], { stock, fx: STOCKS[stock].fx });
    const el = createCard({ canvases: [baked], frame, caption });
    const d = cardData.get(+el.dataset.id);
    d.caption = caption; d.rot = rot;
    el.querySelector('.caption').textContent = caption;
    el.style.setProperty('--rot', rot + 'deg');
    el.style.left = lx + 'px';
    el.style.top = ty + 'px';
    bringTop(el);
    wall.append(el);
  };
  const W = innerWidth, H = innerHeight;
  make(sceneDusk, 1200, 'goldenhour', 'paper', 'dusk, room 6', W * .46, H * .14, -4);
  make(scenePool, 52000, 'poolside', 'sky', 'pool was cold', W * .66, H * .34, 3.5);
  make(sceneLamp, 9000, 'disco', 'bubblegum', 'lava lamp encore', W * .5, H * .52, -2);
}

/* ---------------- boot ---------------- */
buildPanel();
bindControls();
syncStockTheme();
syncLab();
$('#zineFold').style.display = 'none';
setupTilt();
setupAmbient();
setupPWA();
requestAnimationFrame(masterLoop);
SCENES[state.scene].draw(dctx, performance.now(), vfDemo.width);
applyPreviewFilters();
document.fonts.ready.then(() => sampleCards());
setTimeout(() => toast('Demo feed running. Press FEED on the camera to go live with your webcam.'), 900);
