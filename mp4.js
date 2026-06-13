/* Minimal H.264/MP4 exporter for SHOEBOX. No dependencies.
   exportFramesToVideo(canvases, { fps, delaysCs }) -> Promise<{ blob, ext }>
   Primary path: WebCodecs VideoEncoder ('avc1') + a hand-rolled ISO-BMFF muxer.
   Fallback: MediaRecorder over a canvas captureStream (webm). */
'use strict';

(function () {
  /* ---------- tiny ISO base media file format writer ---------- */
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = n => [(n >>> 8) & 255, n & 255];
  const str = s => [...s].map(c => c.charCodeAt(0));

  function box(type, ...payload) {
    const body = [].concat(...payload);
    const size = 8 + body.length;
    return [...u32(size), ...str(type), ...body];
  }
  function fullBox(type, version, flags, ...payload) {
    return box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...payload);
  }

  /* build a non-fragmented MP4 with one AVC video track, all samples in one chunk */
  function muxMP4(samples, avcC, width, height, timescale) {
    const totalDur = samples.reduce((s, f) => s + f.duration, 0);

    const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));

    // sample tables
    const stts = fullBox('stts', 0, 0, u32(samples.length),
      ...samples.map(f => [...u32(1), ...u32(f.duration)]));
    const syncs = samples.map((f, i) => [f.key, i]).filter(p => p[0]).map(p => p[1] + 1);
    const stss = fullBox('stss', 0, 0, u32(syncs.length), ...syncs.map(i => u32(i)));
    const stsz = fullBox('stsz', 0, 0, u32(0), u32(samples.length),
      ...samples.map(f => u32(f.data.length)));
    const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1));

    const avcCBox = box('avcC', [...avcC]);       // AVCDecoderConfigurationRecord
    const avc1 = box('avc1',
      [0, 0, 0, 0, 0, 0], u16(1),                 // reserved + data ref index
      u16(0), u16(0), u32(0), u32(0), u32(0),     // pre-defined / reserved
      u16(width), u16(height),
      u32(0x00480000), u32(0x00480000),           // 72dpi h/v res
      u32(0), u16(1),                             // reserved + frame count
      new Array(32).fill(0),                      // compressor name
      u16(0x0018), u16(0xffff),                   // depth + pre-defined
      avcCBox);
    const stsd = fullBox('stsd', 0, 0, u32(1), avc1);

    // stco offset is filled after we know moov length (mdat data starts right after moov + its 8B header)
    const stcoPlaceholder = fullBox('stco', 0, 0, u32(1), u32(0));

    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stcoPlaceholder);
    const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
    const vmhd = fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0));
    const minf = box('minf', vmhd, dinf, stbl);
    const hdlr = fullBox('hdlr', 0, 0, u32(0), str('vide'), u32(0), u32(0), u32(0), str('VideoHandler\0'));
    const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(totalDur), u16(0x55c4), u16(0));
    const mdia = box('mdia', mdhd, hdlr, minf);

    const tkhd = fullBox('tkhd', 0, 7, u32(0), u32(0), u32(1), u32(0), u32(totalDur),
      u32(0), u32(0), u16(0), u16(0), u16(0), u16(0),
      ...[0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32), // unity matrix
      u32(width << 16), u32(height << 16));
    const trak = box('trak', tkhd, mdia);

    const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(totalDur),
      u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
      ...[0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32),
      ...new Array(6).fill(0).map(u32), u32(2));
    const moov = box('moov', mvhd, trak);

    const mdatHeaderLen = 8;
    const chunkOffset = ftyp.length + moov.length + mdatHeaderLen;
    // patch stco value in place (last 4 bytes of the stco box inside moov)
    const stcoVal = u32(chunkOffset);
    // locate stco box: rebuild moov with the real offset (cheap + bulletproof)
    const stco = fullBox('stco', 0, 0, u32(1), stcoVal);
    const stbl2 = box('stbl', stsd, stts, stss, stsc, stsz, stco);
    const minf2 = box('minf', vmhd, dinf, stbl2);
    const mdia2 = box('mdia', mdhd, hdlr, minf2);
    const trak2 = box('trak', tkhd, mdia2);
    const moov2 = box('moov', mvhd, trak2);

    const mdatBody = [];
    for (const f of samples) for (let i = 0; i < f.data.length; i++) mdatBody.push(f.data[i]);
    const mdat = box('mdat', mdatBody);

    return new Uint8Array([...ftyp, ...moov2, ...mdat]);
  }

  /* ---------- WebCodecs encode path ---------- */
  async function encodeWebCodecs(canvases, fps, delaysCs) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    const width = canvases[0].width, height = canvases[0].height;
    const support = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f', width, height, bitrate: 6_000_000, framerate: fps,
    }).catch(() => null);
    if (!support || !support.supported) return null;

    const timescale = 1_000_000; // microseconds
    const samples = [];
    let avcC = null;

    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcC) {
          avcC = new Uint8Array(meta.decoderConfig.description);
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data, key: chunk.type === 'key', duration: 0 });
      },
      error: e => console.warn('mp4 encoder error', e),
    });
    encoder.configure({
      codec: 'avc1.42001f', width, height, bitrate: 6_000_000, framerate: fps,
      avc: { format: 'avc' },
    });

    let tUs = 0;
    const durations = [];
    for (let i = 0; i < canvases.length; i++) {
      const durUs = Math.round((delaysCs ? delaysCs[i] * 10000 : 1e6 / fps));
      durations.push(durUs);
      const frame = new VideoFrame(canvases[i], { timestamp: tUs, duration: durUs });
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
      tUs += durUs;
    }
    await encoder.flush();
    encoder.close();
    if (!samples.length || !avcC) return null;
    // assign durations in decode order (output order matches submit order for baseline, no B-frames)
    samples.forEach((s, i) => { s.duration = durations[i] != null ? durations[i] : Math.round(1e6 / fps); });

    return { blob: new Blob([muxMP4(samples, avcC, width, height, timescale)], { type: 'video/mp4' }), ext: 'mp4' };
  }

  /* ---------- MediaRecorder fallback (webm) ---------- */
  async function recordCanvas(canvases, fps, delaysCs) {
    const width = canvases[0].width, height = canvases[0].height;
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const cx = cv.getContext('2d');
    const stream = cv.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const types = ['video/mp4;codecs=avc1.42001f', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    rec.start();
    for (let i = 0; i < canvases.length; i++) {
      cx.clearRect(0, 0, width, height);
      cx.drawImage(canvases[i], 0, 0);
      if (track.requestFrame) track.requestFrame();
      await new Promise(r => setTimeout(r, delaysCs ? delaysCs[i] * 10 : 1000 / fps));
    }
    await new Promise(r => setTimeout(r, 120));
    rec.stop();
    await done;
    track.stop();
    const ext = (mime.includes('mp4')) ? 'mp4' : 'webm';
    return { blob: new Blob(chunks, { type: mime || 'video/webm' }), ext };
  }

  window.exportFramesToVideo = async function (canvases, opts = {}) {
    const fps = opts.fps || 12;
    const delaysCs = opts.delaysCs || null;
    try {
      const webcodecs = await encodeWebCodecs(canvases, fps, delaysCs);
      if (webcodecs) return webcodecs;
    } catch (e) { console.warn('WebCodecs path failed, falling back:', e); }
    return recordCanvas(canvases, fps, delaysCs);
  };
})();
