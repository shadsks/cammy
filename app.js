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
  sound: true, luma: .5,
};
let busy = false, exposureActive = false, trayCard = null, stream = null;
let zTop = 10, uid = 0;
const cardData = new Map();
const hinted = new Set();

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
  frames.forEach((f, i) => {
    if (i > 0) { x.globalCompositeOperation = 'screen'; x.globalAlpha = alphas[i] || .4; }
    x.drawImage(f, 0, 0, S, S);
  });
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
  applyVignette(x, S, Math.min(100, fx.vignette + (opts.vigBoost || 0)) / 100);
  applyGrain(x, S, fx.grain / 100);
  applyLeak(x, S, fx.leak / 100, R);
  applyDust(x, S, fx.dust / 100, R);
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

/* ---------------- cards ---------------- */
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `'${String(d.getFullYear()).slice(2)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}

function createCard({ canvases, type = 'single', frame = state.frame, caption = '', audio: audioBlob = null, negative = false }) {
  const data = {
    id: ++uid, type, frame, canvases, caption, negative,
    date: fmtDate(new Date()), rot: rnd(-2.5, 2.5),
    audioURL: audioBlob ? URL.createObjectURL(audioBlob) : null,
  };
  cardData.set(data.id, data);

  const el = document.createElement('div');
  el.className = `card f-${frame} t-${type}`;
  el.dataset.id = data.id;
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
    el.append(f);
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
    el.append(cap);
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
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', fn);
    tools.append(b);
  };
  mkBtn('png', () => exportCard(data));
  if (singleLayout) mkBtn('gif', () => exportGifCard(data));
  mkBtn('toss', () => removeCard(el, data));
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

function removeCard(el, data) {
  if (trayCard === el) trayCard = null;
  if (data._timer) clearInterval(data._timer);
  if (data.audioURL) URL.revokeObjectURL(data.audioURL);
  cardData.delete(data.id);
  el.remove();
  updateLightbox();
}

function bringTop(el) { el.style.zIndex = ++zTop; }

/* drag + shake-to-develop + lightbox drop */
function bindDrag(el, data) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.caption, .tools')) return;
    e.preventDefault();
    pullToWall(el);
    bringTop(el);
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left - (r.width - el.offsetWidth) / 2;
    const oy = e.clientY - r.top - (r.height - el.offsetHeight) / 2;
    const pid = e.pointerId;
    el.classList.add('dragging');
    let lastX = e.clientX, lastDir = 0, shakes = 0, lastShakeT = 0, boosted = false, moved = false;
    const holdPlay = data.audioURL ? setTimeout(() => { if (!moved) playCardAudio(data); }, 450) : null;
    const setBoost = on => {
      if (on === boosted) return;
      boosted = on;
      el.getAnimations({ subtree: true }).forEach(a => { a.playbackRate = on ? 3.2 : 1; });
    };
    const mv = ev => {
      if (ev.pointerId !== pid) return;
      moved = true;
      if (holdPlay) clearTimeout(holdPlay);
      el.style.left = (ev.clientX - ox) + 'px';
      el.style.top = (ev.clientY - oy) + 'px';
      const dx = ev.clientX - lastX;
      if (Math.abs(dx) > 5) {
        const dir = Math.sign(dx);
        if (lastDir !== 0 && dir !== lastDir) {
          shakes++; lastShakeT = performance.now();
          if (shakes >= 3 && el.classList.contains('developing')) setBoost(true);
        }
        lastDir = dir; lastX = ev.clientX;
      }
      if (boosted && performance.now() - lastShakeT > 800) { shakes = 0; setBoost(false); }
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      if (holdPlay) clearTimeout(holdPlay);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      setBoost(false);
      if (data.negative && overlapsLightbox(el)) revealNegative(el, data);
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

function scatter(el) {
  const data = cardData.get(+el.dataset.id);
  pullToWall(el);
  bringTop(el);
  requestAnimationFrame(() => {
    el.classList.add('scatter');
    el.style.left = Math.round(rnd(innerWidth * .34, Math.max(innerWidth * .38, innerWidth - 270))) + 'px';
    el.style.top = Math.round(rnd(80, Math.max(120, innerHeight - 320))) + 'px';
    const rot = rnd(-9, 9);
    if (data) data.rot = rot;
    el.style.setProperty('--rot', rot.toFixed(2) + 'deg');
    el.addEventListener('transitionend', () => el.classList.remove('scatter'), { once: true });
  });
}

function eject(el) {
  if (trayCard) scatter(trayCard);
  trayCard = el;
  ejector.append(el);
  const h = el.offsetHeight;
  ejector.style.height = Math.round(h * .9) + 'px';
  const tall = h > 300;
  el.style.setProperty('--ejdur', tall ? '3.4s' : '2.6s');
  el.style.setProperty('--dev', '7.6s');
  el.classList.add('ejecting', 'developing');
  sndMotor(tall ? 3.2 : 2.4);
  $('.cam-shell').classList.add('kick');
  setTimeout(() => $('.cam-shell').classList.remove('kick'), 500);
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
function setBusy(on) { busy = on; document.body.classList.toggle('busy', on); }

function makeAndEject(canvases, type, opts = {}) {
  const stock = STOCKS[state.stock];
  const el = createCard({
    canvases, type,
    audio: opts.audio || null,
    negative: !!(stock.negative && (type === 'single')),
  });
  eject(el);
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
    $('#meterNeedle').style.setProperty('--ang', (-40 + state.luma * 80).toFixed(1) + 'deg');
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

  const stampFont = s => `${s}px VT323, monospace`;
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
      x.fillStyle = '#ffa133'; x.globalAlpha = sa;
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
    x.fillStyle = d.frame === 'ink' ? '#9a917e' : '#8a7f6c';
    x.fillText('S H O E B O X', pad + 1 * k, footY);
    x.font = stampFont(13 * k); x.textAlign = 'right';
    x.fillStyle = '#ffa133'; x.globalAlpha = .9;
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

/* classic one-sheet 8-panel zine imposition (cut the middle, fold) */
async function exportZine() {
  const picks = latestCards(8);
  if (picks.length < 8) { toast(`A zine needs 8 photos. ${8 - picks.length} more to go.`); return; }
  await document.fonts.ready;
  toast('Folding the zine...');
  await sleep(30);
  const W = 2480, H = 1754, pw = W / 4, phh = H / 2;
  const c = mkCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);

  const drawPanel = (page, col, row, flip) => {
    x.save();
    x.translate(col * pw + pw / 2, row * phh + phh / 2);
    if (flip) x.rotate(Math.PI);
    x.fillStyle = '#f6f2ea';
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
      x.fillStyle = '#3f372c';
      x.font = '600 44px "Space Grotesk", sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('S H O E B O X', 0, -phh / 2 + 76);
      x.font = '500 22px "Space Grotesk", sans-serif';
      x.fillStyle = '#8a7f6c';
      x.fillText('a tiny zine', 0, -phh / 2 + 112);
    }
    x.fillStyle = '#b9b09e';
    x.font = '500 20px "Space Grotesk", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillText(String(page), 0, phh / 2 - 28);
    x.restore();
  };
  [[5, 0], [4, 1], [3, 2], [2, 3]].forEach(([p, col]) => drawPanel(p, col, 0, true));
  [[6, 0], [7, 1], [8, 2], [1, 3]].forEach(([p, col]) => drawPanel(p, col, 1, false));

  // guides: dashed center cut, dotted fold lines
  x.strokeStyle = '#b9b09e'; x.lineWidth = 2;
  x.setLineDash([18, 12]);
  x.beginPath(); x.moveTo(pw, H / 2); x.lineTo(3 * pw, H / 2); x.stroke();
  x.setLineDash([3, 9]);
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * pw, 0); x.lineTo(i * pw, H); x.stroke(); }
  x.setLineDash([]);
  x.fillStyle = '#8a7f6c'; x.font = '500 19px "Space Grotesk", sans-serif';
  x.textAlign = 'left';
  x.fillText('print, cut the dashed slit, fold along the dotted lines', 24, H - 20);

  const jpeg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', .9))).arrayBuffer());
  downloadBlob(buildPDF(jpeg, W, H), 'shoebox-zine.pdf');
  toast('Zine PDF saved. Print it single-sided.');
}

async function exportPoster() {
  const picks = latestCards(12);
  if (picks.length < 12) { toast(`A poster needs 12 photos. ${12 - picks.length} more to go.`); return; }
  await document.fonts.ready;
  toast('Composing the poster...');
  await sleep(30);
  const W = 1800, H = 2400;
  const c = mkCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#f1ead9'; x.fillRect(0, 0, W, H);
  x.globalAlpha = .06; applyGrain(x, H, 1); x.globalAlpha = 1;
  x.fillStyle = '#3f372c';
  x.font = '700 92px "Space Grotesk", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillText('S H O E B O X', W / 2, 150);
  x.font = '500 34px "Space Grotesk", sans-serif';
  x.fillStyle = '#8a7f6c';
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
      applyPreviewFilters();
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
  const b = $('#stocks button[data-stock="goldenhour"]');
  if (b) b.classList.toggle('golden-now', goldenFactor() > .25);
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
    b.innerHTML = `${def.name || def.label}<em>${def.hint}</em>`;
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
  if (key === 'motion') hint('motionMode', 'Stop motion: every shutter press adds a frame.');
}
function setLens(key) {
  state.lens = key;
  $('#camera').dataset.lens = key;
  $('#ctlLens b').textContent = LENSES[key].label;
  $('#ctlLens').classList.toggle('on', key !== 'normal');
  $('#lensTag').textContent = LENSES[key].tag;
}

function bindControls() {
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

  $('#ctlExpo').addEventListener('click', () => {
    state.expo = state.expo === 3 ? 1 : state.expo + 1;
    clearPending();
    $('#ctlExpo').classList.toggle('on', state.expo > 1);
  });
  $('#ctlTimer').addEventListener('click', () => {
    state.timer = state.timer === 0 ? 3 : state.timer === 3 ? 10 : 0;
    $('#ctlTimer b').textContent = state.timer ? state.timer + 'S' : 'OFF';
    $('#ctlTimer').classList.toggle('on', !!state.timer);
  });
  $('#ctlZoom').addEventListener('click', () => {
    state.zoom = state.zoom === 1 ? 1.4 : state.zoom === 1.4 ? 2 : 1;
    $('#ctlZoom b').textContent = state.zoom + 'x';
    $('#ctlZoom').classList.toggle('on', state.zoom !== 1);
    const sc = `scale(${state.zoom})`;
    vfDemo.style.transform = sc;
    vfVideo.style.transform = state.mirror ? `scaleX(-1) scale(${state.zoom})` : sc;
  });
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
    if (!st.hidden) {
      const n = cardData.size;
      $('#stZine span').textContent = n >= 8 ? 'foldable PDF, latest 8 photos' : `need ${8 - n} more photos`;
      $('#stPoster span').textContent = n >= 12 ? 'print-size PNG, latest 12 photos' : `need ${12 - n} more photos`;
    }
  });
  $('#stWall').addEventListener('click', exportWall);
  $('#stZine').addEventListener('click', exportZine);
  $('#stPoster').addEventListener('click', exportPoster);

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
setupTilt();
setupPWA();
requestAnimationFrame(masterLoop);
SCENES[state.scene].draw(dctx, performance.now(), vfDemo.width);
applyPreviewFilters();
document.fonts.ready.then(() => sampleCards());
setTimeout(() => toast('Demo feed running. Press FEED on the camera to go live with your webcam.'), 900);
