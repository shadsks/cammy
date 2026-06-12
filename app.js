/* SHOEBOX - instant camera. 100% client-side:
   getUserMedia (or a procedural demo feed) -> canvas bake -> CSS develop -> draggable wall. */
'use strict';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const BAKE = 1000; // baked photo resolution (px, square)

/* ---------------- state ---------------- */
const state = {
  live: false,          // demo feed vs webcam
  facing: 'user',
  mirror: true,
  scene: 0,
  stock: 'goldenhour',
  fx: { grain: 28, vignette: 34, leak: 22, dust: 12 },
  frame: 'paper',
  surface: 'cork',
  timer: 0,             // 0 | 3 | 10
  strip: false,
  stripLayout: 'strip', // 'strip' | '2x2 grid'
  dx: false,
  zoom: 1,
  sound: true,
};
let busy = false, trayCard = null, dxFirst = null, stream = null;
let zTop = 10, uid = 0, shotNo = 0;
const cardData = new Map();

/* ---------------- film stocks ---------------- */
const STOCKS = {
  goldenhour: { name: 'Goldenhour 400', base: 'contrast(1.05) saturate(1.08) sepia(.16) hue-rotate(-8deg) brightness(1.03)',
    fx: { grain: 28, vignette: 34, leak: 22, dust: 12 }, chip: 'linear-gradient(135deg,#f5b06a,#d96f4b)' },
  poolside:   { name: 'Poolside 100', base: 'contrast(1.05) saturate(.8) brightness(1.06)',
    tint: { color: '#3aa5b4', alpha: .55 },
    fx: { grain: 22, vignette: 26, leak: 14, dust: 8 }, chip: 'linear-gradient(135deg,#8fd0c6,#4f93a8)' },
  tungsten:   { name: 'Motel Tungsten', base: 'contrast(1.12) saturate(1.12) sepia(.32) hue-rotate(-14deg) brightness(.97)',
    fx: { grain: 34, vignette: 46, leak: 30, dust: 18 }, chip: 'linear-gradient(135deg,#e0883e,#7a3b22)' },
  staticbw:   { name: 'Static 3000', base: 'grayscale(1) contrast(1.2) brightness(1.04)',
    fx: { grain: 62, vignette: 44, leak: 0, dust: 30 }, chip: 'linear-gradient(135deg,#cfcfcf,#5a5a5a)' },
  disco:      { name: 'Disco Nite', base: 'contrast(1.16) saturate(1.5) hue-rotate(-6deg) brightness(1.02)',
    fx: { grain: 30, vignette: 38, leak: 55, dust: 20 }, chip: 'linear-gradient(135deg,#e85d9e,#7a3bd1)' },
};
const FRAMES = {
  paper:     { name: 'Paper', bg: '#f6f2ea', ink: '#3f372c' },
  bone:      { name: 'Bone', bg: '#eee4cd', ink: '#4a3d2a' },
  ink:       { name: 'Ink', bg: '#26231e', ink: '#e9e2d2' },
  bubblegum: { name: 'Bubblegum', bg: '#f3cfd8', ink: '#5e3340' },
  sky:       { name: 'Sky', bg: '#cfdfe8', ink: '#2d4250' },
  stripe:    { name: 'Stripe', bg: '#f6f2ea', ink: '#3f372c' },
};
const SURFACES = {
  cork:     { name: 'Cork', swatch: 'radial-gradient(circle at 35% 30%,#b5814f,#94613a)' },
  walnut:   { name: 'Walnut', swatch: 'repeating-linear-gradient(93deg,#4c3322 0 5px,#5a3e2a 5px 9px)' },
  linen:    { name: 'Linen', swatch: '#d8d1bf' },
  concrete: { name: 'Concrete', swatch: 'linear-gradient(160deg,#93908a,#76736d)' },
  felt:     { name: 'Felt', swatch: 'radial-gradient(circle at 50% 35%,#346049,#24463a)' },
};
const LEAK_COLORS = ['255,90,40', '255,150,60', '255,60,90', '255,40,40'];

/* ---------------- dom refs ---------------- */
const wall = $('#wall'), ejector = $('#ejector');
const vfVideo = $('#vfVideo'), vfDemo = $('#vfDemo'), vfGhost = $('#vfGhost');
const vfCount = $('#vfCount'), vfRail = $('#vfRail');
const dctx = vfDemo.getContext('2d');

/* ---------------- audio (synthesized, no files) ---------------- */
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

/* ---------------- demo scenes (procedural feed) ---------------- */
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
    const warm = i % 2 === 0;
    bg.addColorStop(0, warm ? 'rgba(255,130,60,.8)' : 'rgba(255,70,120,.7)');
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
let lastDemo = 0;
function demoLoop(ts) {
  if (!state.live && !document.hidden && ts - lastDemo > 33) {
    lastDemo = ts;
    SCENES[state.scene].draw(dctx, performance.now(), vfDemo.width);
  }
  requestAnimationFrame(demoLoop);
}

/* ---------------- capture + bake ---------------- */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function grabRaw() { // unfiltered square crop of the current feed, BAKE px
  const src = state.live ? vfVideo : vfDemo;
  let sw = state.live ? vfVideo.videoWidth : vfDemo.width;
  let sh = state.live ? vfVideo.videoHeight : vfDemo.height;
  if (!sw || !sh) { sw = sh = vfDemo.width; }
  const side = Math.min(sw, sh) / state.zoom;
  const sx = (sw - side) / 2, sy = (sh - side) / 2;
  const c = mkCanvas(BAKE, BAKE), x = c.getContext('2d');
  if (state.live && state.mirror) { x.translate(BAKE, 0); x.scale(-1, 1); }
  x.drawImage(src, sx, sy, side, side, 0, 0, BAKE, BAKE);
  return c;
}

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
function applyLeak(x, S, amt) {
  if (amt <= 0) return;
  x.save(); x.globalCompositeOperation = 'screen';
  const blobs = Math.random() < .6 ? 1 : 2;
  for (let i = 0; i < blobs; i++) {
    const edge = (Math.random() * 4) | 0;
    const cx = edge === 1 ? S : edge === 3 ? 0 : rnd(0, S);
    const cy = edge === 0 ? 0 : edge === 2 ? S : rnd(0, S);
    const r = S * rnd(.45, .95);
    const col = LEAK_COLORS[(Math.random() * LEAK_COLORS.length) | 0];
    const g = x.createRadialGradient(cx, cy, r * .05, cx, cy, r);
    g.addColorStop(0, `rgba(${col},${(amt * rnd(.5, .9)).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  if (Math.random() < .5) { // soft streak band
    const bx = rnd(0, S * .8);
    const g = x.createLinearGradient(bx, 0, bx + S * .25, 0);
    const col = LEAK_COLORS[(Math.random() * LEAK_COLORS.length) | 0];
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(.5, `rgba(${col},${(amt * .35).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  x.restore();
}
function applyDust(x, S, amt) {
  if (amt <= 0) return;
  x.save();
  const count = Math.round(amt * 140);
  for (let i = 0; i < count; i++) {
    const light = Math.random() > .22;
    x.fillStyle = light
      ? `rgba(255,250,235,${rnd(.2, .65).toFixed(2)})`
      : `rgba(30,20,12,${rnd(.2, .5).toFixed(2)})`;
    x.beginPath();
    x.arc(rnd(0, S), rnd(0, S), rnd(.6, 2) * S / 900, 0, 7);
    x.fill();
  }
  if (amt > .25) { // hair scratches
    const n = 1 + (Math.random() < .4 ? 1 : 0);
    x.strokeStyle = 'rgba(250,245,230,.16)'; x.lineWidth = 1.2 * S / 900;
    for (let i = 0; i < n; i++) {
      const sx0 = rnd(S * .1, S * .9);
      x.beginPath(); x.moveTo(sx0, rnd(0, S * .2));
      x.quadraticCurveTo(sx0 + rnd(-40, 40), S * .5, sx0 + rnd(-60, 60), rnd(S * .8, S));
      x.stroke();
    }
  }
  x.restore();
}

function bake(frames, opts = {}) { // frames: 1 raw canvas, or 2 for double exposure
  const stock = STOCKS[opts.stock || state.stock];
  const fx = opts.fx || state.fx;
  const S = BAKE;
  const c = mkCanvas(S, S), x = c.getContext('2d');
  x.filter = stock.base;
  x.drawImage(frames[0], 0, 0, S, S);
  if (frames[1]) {
    x.globalCompositeOperation = 'screen'; x.globalAlpha = .58;
    x.drawImage(frames[1], 0, 0, S, S);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  }
  x.filter = 'none';
  if (stock.tint) {
    x.save();
    x.globalCompositeOperation = 'soft-light';
    x.globalAlpha = stock.tint.alpha;
    x.fillStyle = stock.tint.color;
    x.fillRect(0, 0, S, S);
    x.restore();
  }
  applyVignette(x, S, fx.vignette / 100);
  applyGrain(x, S, fx.grain / 100);
  applyLeak(x, S, fx.leak / 100);
  applyDust(x, S, fx.dust / 100);
  return c;
}

/* ---------------- cards ---------------- */
function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `'${String(d.getFullYear()).slice(2)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}

function createCard({ canvases, type = 'single', frame = state.frame, caption = '' }) {
  const data = {
    id: ++uid, type, frame, canvases, caption,
    date: fmtDate(new Date()), rot: rnd(-2.5, 2.5),
  };
  cardData.set(data.id, data);

  const el = document.createElement('div');
  el.className = `card f-${frame} t-${type}`;
  el.dataset.id = data.id;
  el.style.setProperty('--rot', data.rot.toFixed(2) + 'deg');

  const fig = c => {
    const f = document.createElement('figure');
    f.className = 'ph';
    const img = new Image();
    img.src = c.toDataURL('image/jpeg', .92);
    img.alt = 'Instant photo';
    img.draggable = false;
    f.append(img);
    const haze = document.createElement('i'); haze.className = 'haze'; f.append(haze);
    return f;
  };

  if (type === 'single') {
    const f = fig(canvases[0]);
    const stamp = document.createElement('span');
    stamp.className = 'stamp'; stamp.textContent = data.date;
    f.append(stamp);
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
    canvases.forEach(c => holder.append(fig(c)));
    const foot = document.createElement('footer');
    const brand = document.createElement('span'); brand.textContent = 'SHOEBOX';
    const time = document.createElement('time'); time.textContent = data.date;
    foot.append(brand, time);
    el.append(foot);
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
  mkBtn('save', () => exportCard(data));
  mkBtn('toss', () => {
    if (trayCard === el) trayCard = null;
    cardData.delete(data.id); el.remove();
  });
  el.append(tools);

  bindDrag(el, data);
  return el;
}

function bringTop(el) { el.style.zIndex = ++zTop; }

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
    const mv = ev => {
      if (ev.pointerId !== pid) return;
      el.style.left = (ev.clientX - ox) + 'px';
      el.style.top = (ev.clientY - oy) + 'px';
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// move a card from the ejector tray onto the wall, preserving its visual position
function pullToWall(el) {
  if (el.parentElement !== ejector) return;
  const r = el.getBoundingClientRect();
  el.classList.remove('ejecting');
  if (trayCard === el) trayCard = null;
  wall.append(el);
  // rotation preserves the center, so center-correct against the rotated bbox
  el.style.left = (r.left + (r.width - el.offsetWidth) / 2) + 'px';
  el.style.top = (r.top + (r.height - el.offsetHeight) / 2) + 'px';
}

function scatter(el) { // previous tray card slides off to a free spot
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
  shotNo++;
}

/* ---------------- shooting flows ---------------- */
function flash() {
  const f = $('#flash');
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}

async function countdown(n) {
  vfCount.hidden = false;
  for (let i = n; i > 0; i--) {
    vfCount.textContent = i;
    sndBeep(i === 1);
    await sleep(1000);
  }
  vfCount.hidden = true;
}

function feedReady() {
  if (state.live && !vfVideo.videoWidth) { toast('Camera is warming up, try again in a second.'); return false; }
  return true;
}

async function takePhoto() {
  if (busy) return;
  if (!feedReady()) return;
  busy = true; document.body.classList.add('busy');
  try {
    if (state.timer) await countdown(state.timer);

    if (state.dx && !dxFirst) {
      dxFirst = grabRaw();
      flash(); sndShutter();
      vfGhost.src = dxFirst.toDataURL('image/jpeg', .7);
      vfGhost.hidden = false;
      $('#ctlDx b').textContent = '1/2';
      toast('First exposure locked. Shoot again to overlay.');
      return;
    }
    const frames = dxFirst ? [dxFirst, grabRaw()] : [grabRaw()];
    if (dxFirst) { dxFirst = null; vfGhost.hidden = true; $('#ctlDx b').textContent = 'ON'; }
    flash(); sndShutter();
    const card = createCard({ canvases: [bake(frames)] });
    eject(card);
  } finally {
    busy = false; document.body.classList.remove('busy');
  }
}

async function stripFlow() {
  if (busy) return;
  if (!feedReady()) return;
  busy = true; document.body.classList.add('busy');
  try {
    vfRail.hidden = false;
    vfRail.innerHTML = '<i></i><i></i><i></i><i></i>';
    const shots = [];
    for (let i = 0; i < 4; i++) {
      await countdown(i === 0 ? (state.timer || 3) : 3);
      flash(); sndShutter();
      const baked = bake([grabRaw()]);
      shots.push(baked);
      const cell = vfRail.children[i], im = new Image();
      im.src = baked.toDataURL('image/jpeg', .6);
      cell.append(im);
      await sleep(350);
    }
    await sleep(450);
    vfRail.hidden = true;
    const card = createCard({ canvases: shots, type: state.stripLayout === 'grid' ? 'grid' : 'strip' });
    eject(card);
  } finally {
    busy = false; document.body.classList.remove('busy');
  }
}

function shutterPress() { state.strip ? stripFlow() : takePhoto(); }

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
  } catch (err) {
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

/* ---------------- live preview filters ---------------- */
function applyPreviewFilters() {
  const stock = STOCKS[state.stock];
  vfVideo.style.filter = stock.base;
  vfDemo.style.filter = stock.base;
  const tint = $('.vf-tint');
  tint.style.background = stock.tint ? stock.tint.color : 'transparent';
  tint.style.opacity = stock.tint ? stock.tint.alpha : 0;
  $('.vf-vignette').style.opacity = (state.fx.vignette / 100) * .9;
  $('.vf-grain').style.opacity = (state.fx.grain / 100) * .6;
  $('.vf-leak').style.opacity = (state.fx.leak / 100) * .65;
}

/* ---------------- export ---------------- */
function roundRect(x, x0, y0, w, h, r) {
  x.beginPath();
  x.moveTo(x0 + r, y0);
  x.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
  x.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  x.arcTo(x0, y0 + h, x0, y0, r);
  x.arcTo(x0, y0, x0 + w, y0, r);
  x.closePath();
}

// re-render a card at k px per CSS px (dimensions mirror the CSS card layout)
function renderCardCanvas(d, k) {
  const fr = FRAMES[d.frame];
  let W, H;
  if (d.type === 'single') { W = 210 * k; H = 252 * k; }
  else if (d.type === 'strip') { W = 130 * k; H = 511 * k; }
  else { W = 210 * k; H = 230 * k; }
  const c = mkCanvas(Math.round(W), Math.round(H)), x = c.getContext('2d');
  roundRect(x, 0, 0, W, H, 4 * k);
  x.fillStyle = fr.bg; x.fill();
  x.save(); x.clip();
  // faint paper grain
  x.globalAlpha = .05; applyGrain(x, Math.max(W, H), 1); x.globalAlpha = 1;

  const stampFont = s => `${s}px VT323, monospace`;
  if (d.type === 'single') {
    const pad = 10 * k, ph = 190 * k;
    x.drawImage(d.canvases[0], pad, pad, ph, ph);
    x.font = stampFont(17 * k); x.textAlign = 'right'; x.textBaseline = 'alphabetic';
    x.shadowColor = 'rgba(255,140,40,.8)'; x.shadowBlur = 7 * k;
    x.fillStyle = '#ffa133'; x.globalAlpha = .92;
    x.fillText(d.date, pad + ph - 8 * k, pad + ph - 7 * k);
    x.shadowBlur = 0; x.globalAlpha = 1;
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

function downloadCanvas(c, name) {
  c.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

async function exportCard(d) {
  await document.fonts.ready;
  downloadCanvas(renderCardCanvas(d, 5), `shoebox-${String(d.id).padStart(3, '0')}.png`);
  toast('Photo saved.');
}

function paintSurface(x, W, H) {
  if (state.surface === 'cork') {
    const g = x.createRadialGradient(W * .3, H * .18, W * .05, W * .3, H * .18, W * .9);
    g.addColorStop(0, '#b5814f'); g.addColorStop(.55, '#9a6a3e'); g.addColorStop(1, '#84582f');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  } else if (state.surface === 'walnut') {
    x.fillStyle = '#4c3322'; x.fillRect(0, 0, W, H);
    x.save(); x.rotate(.052);
    const cols = ['#4c3322', '#5a3e2a', '#443021'];
    for (let i = -2, px = -H * .2; px < W + H; i++) {
      const w = [26, 26, 36][((i % 3) + 3) % 3] * 2;
      x.fillStyle = cols[((i % 3) + 3) % 3];
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

/* ---------------- ui ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function buildPanel() {
  const stocks = $('#stocks');
  for (const [key, s] of Object.entries(STOCKS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="chip" style="background:${s.chip}"></span>${s.name}`;
    b.classList.toggle('on', key === state.stock);
    b.addEventListener('click', () => {
      state.stock = key;
      state.fx = { ...s.fx };
      stocks.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      syncSliders();
      applyPreviewFilters();
    });
    stocks.append(b);
  }
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
      fr.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
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
      su.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
    su.append(b);
  }
  $('#stripSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.stripLayout = b.dataset.layout;
    $('#stripSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
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

function bindControls() {
  $('#shutter').addEventListener('click', shutterPress);

  $('#ctlTimer').addEventListener('click', () => {
    state.timer = state.timer === 0 ? 3 : state.timer === 3 ? 10 : 0;
    $('#ctlTimer b').textContent = state.timer ? state.timer + 'S' : 'OFF';
    $('#ctlTimer').classList.toggle('on', !!state.timer);
  });
  $('#ctlStrip').addEventListener('click', () => {
    state.strip = !state.strip;
    if (state.strip && state.dx) toggleDx(false);
    $('#ctlStrip b').textContent = state.strip ? '4X' : 'OFF';
    $('#ctlStrip').classList.toggle('on', state.strip);
  });
  const toggleDx = on => {
    state.dx = on;
    if (!on) { dxFirst = null; vfGhost.hidden = true; }
    $('#ctlDx b').textContent = on ? 'ON' : 'OFF';
    $('#ctlDx').classList.toggle('on', on);
  };
  $('#ctlDx').addEventListener('click', () => {
    const on = !state.dx;
    if (on && state.strip) $('#ctlStrip').click();
    toggleDx(on);
  });
  $('#ctlZoom').addEventListener('click', () => {
    state.zoom = state.zoom === 1 ? 1.4 : state.zoom === 1.4 ? 2 : 1;
    $('#ctlZoom b').textContent = state.zoom + 'x';
    $('#ctlZoom').classList.toggle('on', state.zoom !== 1);
    // digital zoom preview via css scale on the feed
    const sc = `scale(${state.zoom})`;
    vfDemo.style.transform = sc;
    vfVideo.style.transform = state.mirror ? `scaleX(-1) scale(${state.zoom})` : sc;
  });
  $('#ctlFlip').addEventListener('click', () => {
    if (!state.live) { toast('Flip works on the live feed. Press FEED first.'); return; }
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    goLive();
  });
  $('#ctlSrc').addEventListener('click', () => state.live ? goDemo() : goLive());
  $('#ctlScene').addEventListener('click', () => {
    state.scene = (state.scene + 1) % SCENES.length;
    $('#ctlScene b').textContent = SCENES[state.scene].label;
  });

  $('#btnDarkroom').addEventListener('click', () => {
    $('#darkroom').hidden = !$('#darkroom').hidden;
  });
  $('#btnExport').addEventListener('click', exportWall);
  $('#btnClear').addEventListener('click', () => {
    if (!wall.children.length && !trayCard) return;
    if (!confirm('Toss every photo on the wall?')) return;
    wall.innerHTML = '';
    if (trayCard) { trayCard.remove(); trayCard = null; }
    cardData.clear();
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

  // keep cards inside the viewport on resize
  addEventListener('resize', () => {
    for (const el of wall.querySelectorAll('.card')) {
      const left = Math.min(parseFloat(el.style.left) || 0, innerWidth - 80);
      const top = Math.min(parseFloat(el.style.top) || 0, innerHeight - 80);
      el.style.left = Math.max(left, -el.offsetWidth + 80) + 'px';
      el.style.top = Math.max(top, 0) + 'px';
    }
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
requestAnimationFrame(demoLoop);
SCENES[state.scene].draw(dctx, performance.now(), vfDemo.width);
applyPreviewFilters();
document.fonts.ready.then(() => sampleCards());
setTimeout(() => toast('Demo feed running. Press FEED on the camera to go live with your webcam.'), 900);
