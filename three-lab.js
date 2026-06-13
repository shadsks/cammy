/* Optional Three.js spatial layer for Shoebox. The app remains fully usable if this fails to load. */
(async () => {
  const host = document.getElementById('spatialLab');
  const canvas = document.getElementById('spatialCanvas');
  if (!host || !canvas) return;

  let THREE;
  try {
    THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
  } catch (err) {
    host.style.display = 'none';
    console.warn('Shoebox spatial lab unavailable:', err);
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  camera.position.set(0, 0, 900);
  camera.lookAt(0, 0, 0);

  const light = new THREE.DirectionalLight(0xfff0d8, 1.8);
  light.position.set(-220, 260, 520);
  scene.add(light, new THREE.AmbientLight(0xffddbb, .9));

  let enabled = true;
  let stockA = '#f5b06a';
  let stockB = '#d96f4b';
  const flying = [];
  const stack = [];
  const loader = new THREE.TextureLoader();
  const tmpColor = new THREE.Color();

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    positionCameraModel();
  }
  function scenePoint(x, y, z = 0) {
    return new THREE.Vector3(x - innerWidth / 2, innerHeight / 2 - y, z);
  }

  const cameraGroup = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xefe0c7, roughness: .68, metalness: .02 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: .76, metalness: .12 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc08a5e, roughness: .32, metalness: .45 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x29333b,
    roughness: .08,
    metalness: .02,
    transmission: .35,
    thickness: 1.2,
    transparent: true,
    opacity: .68,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(330, 182, 48), shellMat);
  body.position.set(0, 0, 0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(330, 32, 50), darkMat);
  grip.position.set(0, -92, 4);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(210, 7, 6), darkMat);
  slot.position.set(0, 83, 29);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(58, 9, 18, 72), brassMat);
  lensRing.position.set(-58, 24, 35);
  const lensGlass = new THREE.Mesh(new THREE.SphereGeometry(47, 32, 18), glassMat);
  lensGlass.position.set(-58, 24, 37);
  lensGlass.scale.z = .18;
  const shutter = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 14, 48), new THREE.MeshStandardMaterial({
    color: 0xd45c48,
    roughness: .38,
    metalness: .05,
  }));
  shutter.rotation.x = Math.PI / 2;
  shutter.position.set(105, -16, 38);
  cameraGroup.add(body, grip, slot, lensRing, lensGlass, shutter);
  scene.add(cameraGroup);

  function positionCameraModel() {
    const mobile = innerWidth < 640;
    const x = mobile ? 0 : -innerWidth / 2 + 220;
    const y = -innerHeight / 2 + (mobile ? 150 : 166);
    cameraGroup.position.set(x, y, -38);
    cameraGroup.scale.setScalar(mobile ? .7 : .78);
  }

  const dustGeo = new THREE.BufferGeometry();
  const dustCount = 90;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = [];
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - .5) * innerWidth;
    dustPos[i * 3 + 1] = (Math.random() - .5) * innerHeight;
    dustPos[i * 3 + 2] = Math.random() * 160 - 80;
    dustSeed.push(Math.random() * 1000);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffedc7,
    size: 2.2,
    transparent: true,
    opacity: .26,
    depthWrite: false,
  }));
  scene.add(dust);

  function bendPlane(mesh, phase) {
    const pos = mesh.geometry.attributes.position;
    const width = mesh.userData.width || 150;
    const curl = mesh.userData.curl * Math.sin(Math.min(1, phase) * Math.PI);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = (x / width) + .5;
      const lift = Math.sin(u * Math.PI) * curl + Math.sin((y / width + phase) * Math.PI) * curl * .24;
      pos.setZ(i, lift);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function addFlyingPhoto(detail) {
    if (!enabled || reduced.matches || !detail?.image) return;
    loader.load(detail.image, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const width = detail.type === 'strip' ? 94 : 150;
      const height = detail.type === 'strip' ? 310 : detail.type === 'grid' ? 164 : 190;
      const geo = new THREE.PlaneGeometry(width, height, 16, 18);
      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: .62,
        metalness: .01,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: .96,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.width = width;
      mesh.userData.curl = detail.tall ? 34 : 24;
      const mobile = innerWidth < 640;
      const start = scenePoint(mobile ? innerWidth / 2 : 222, innerHeight - (mobile ? 270 : 322), 88);
      const end = scenePoint(mobile ? innerWidth / 2 + 18 : 224, innerHeight - (mobile ? 492 : 558), 140);
      mesh.position.copy(start);
      mesh.rotation.set(.18, -.2, (Math.random() - .5) * .22);
      scene.add(mesh);
      flying.push({ mesh, start, end, born: performance.now(), dur: detail.tall ? 3400 : 2600 });
    });
  }

  function addStackGhost(detail) {
    if (!enabled || reduced.matches || !detail?.image) return;
    loader.load(detail.image, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const w = Math.min(170, detail.w * .72);
      const h = Math.min(210, detail.h * .72);
      const geo = new THREE.PlaneGeometry(w, h, 2, 2);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: .11,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const center = scenePoint(detail.x + detail.w / 2, detail.y + detail.h / 2, -18 - stack.length * .2);
      mesh.position.copy(center);
      mesh.rotation.z = -(detail.rot || 0) * Math.PI / 180;
      mesh.userData.life = performance.now();
      scene.add(mesh);
      stack.push(mesh);
      while (stack.length > 10) {
        const old = stack.shift();
        old.geometry.dispose();
        old.material.map?.dispose();
        old.material.dispose();
        scene.remove(old);
      }
    });
  }

  function updateLens(kind) {
    const colors = {
      normal: 0x2b3438,
      fisheye: 0x1f3c44,
      prism: 0x4b3e62,
      soft: 0x6c5140,
      split: 0x263549,
    };
    glassMat.color.setHex(colors[kind] || colors.normal);
    lensGlass.scale.set(kind === 'fisheye' ? 1.08 : 1, kind === 'fisheye' ? 1.08 : 1, kind === 'split' ? .12 : .18);
    lensRing.rotation.z = kind === 'prism' ? Math.PI / 6 : 0;
  }

  function updateStock(theme) {
    if (!theme) return;
    stockA = theme[0] || stockA;
    stockB = theme[1] || stockB;
    tmpColor.set(stockA);
    dust.material.color.copy(tmpColor);
  }

  function setEnabled(next) {
    enabled = !!next;
    host.style.display = enabled ? '' : 'none';
  }

  addEventListener('shoebox:photo-eject', e => addFlyingPhoto(e.detail));
  addEventListener('shoebox:card-settled', e => addStackGhost(e.detail));
  addEventListener('shoebox:lens', e => updateLens(e.detail.lens));
  addEventListener('shoebox:stock', e => updateStock(e.detail.theme));
  addEventListener('shoebox:settings', e => {
    setEnabled(e.detail.lab?.spatial !== false);
    updateLens(e.detail.lens || 'normal');
  });
  addEventListener('resize', resize);

  function animate(now) {
    requestAnimationFrame(animate);
    if (!enabled) return;
    const t = now * .001;
    cameraGroup.rotation.x = Math.sin(t * .55) * .012;
    cameraGroup.rotation.y = Math.sin(t * .38) * .018;
    lensGlass.rotation.z += .003;

    const pos = dust.geometry.attributes.position;
    for (let i = 0; i < dustCount; i++) {
      const ix = i * 3;
      pos.array[ix] += Math.sin(t + dustSeed[i]) * .045;
      pos.array[ix + 1] += Math.cos(t * .8 + dustSeed[i]) * .035;
      if (Math.abs(pos.array[ix]) > innerWidth * .55) pos.array[ix] *= -.92;
      if (Math.abs(pos.array[ix + 1]) > innerHeight * .55) pos.array[ix + 1] *= -.92;
    }
    pos.needsUpdate = true;

    for (let i = flying.length - 1; i >= 0; i--) {
      const item = flying[i];
      const p = Math.min(1, (now - item.born) / item.dur);
      const ease = 1 - Math.pow(1 - p, 3);
      item.mesh.position.lerpVectors(item.start, item.end, ease);
      item.mesh.position.x += Math.sin(p * Math.PI) * 22;
      item.mesh.rotation.x = .18 + Math.sin(p * Math.PI) * .48;
      item.mesh.rotation.y = -.2 + Math.sin(p * Math.PI * .9) * .22;
      item.mesh.rotation.z += .0025;
      item.mesh.material.opacity = p > .82 ? (1 - p) / .18 * .96 : .96;
      bendPlane(item.mesh, p);
      if (p >= 1) {
        item.mesh.geometry.dispose();
        item.mesh.material.map?.dispose();
        item.mesh.material.dispose();
        scene.remove(item.mesh);
        flying.splice(i, 1);
      }
    }

    for (const mesh of stack) {
      const age = Math.min(1, (now - mesh.userData.life) / 1200);
      mesh.material.opacity = .11 * age;
    }
    renderer.render(scene, camera);
  }

  resize();
  setEnabled(document.body.classList.contains('lab-spatial'));
  requestAnimationFrame(animate);
})();
