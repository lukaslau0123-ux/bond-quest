/* ============================================================
   Bond Quest — world engine (Three.js r128, UMD global THREE)
   ============================================================ */

const WORLD = (function () {
  let renderer, scene, camera, sun, hemi, ambient;
  let terrain, water;
  let player, playerBody;
  let limbs = { arms: [], legs: [], torso: null, cape: null };
  let vy = 0, onGround = true, walkPhase = 0, everLocked = false;
  let clock;
  let keys = Object.create(null);
  let locked = false;
  let yaw = 0, pitch = 0.40, camDist = 13;
  let velocity = new THREE.Vector3();
  let pointerDown = false, lastPX = 0, lastPY = 0;
  // 觸控：搖桿向量、指標追蹤、跳躍佇列、互動回呼
  let touchMode = false;
  let stickX = 0, stickY = 0, stickId = null, stickCX = 0, stickCY = 0, stickRadius = 42;
  let touchJump = false, lookId = null, interactHandler = null;
  let nodes = [];
  let zoneNow = 'A';
  let elapsed = 0;
  const colliders = [];
  const nodeMeshes = new Map();
  let sky = null, rim = null, fireflies = null, ffBase = null;

  function toonGradient(steps) {
    const data = new Uint8Array(steps * 4);
    for (let i = 0; i < steps; i++) {
      const v = Math.round(255 * (i + 1) / steps);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  const TOON = toonGradient(4);
  function toonMat(color, emissive) {
    const m = new THREE.MeshToonMaterial({ color: color, gradientMap: TOON });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0.55; }
    return m;
  }
  function softDot(size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d').createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    const ctx = c.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
    const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }

  const tmpV = new THREE.Vector3();
  const targetCam = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  const WORLD_MIN = -200, WORLD_MAX = 200, WALK_LIMIT = 190;
  const MAP_C = document.getElementById('minimap');

  /* ---------- deterministic noise ---------- */
  function hash2(ix, iz) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function noise2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a * (1 - ux) * (1 - uz) + b * ux * (1 - uz) + c * (1 - ux) * uz + d * ux * uz;
  }
  function fbm(x, z) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { v += noise2(x * f, z * f) * amp; amp *= 0.5; f *= 2; }
    return v;
  }
  function smoothstep(a, b, x) {
    x = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }
  function zoneWeight(x, z, key) {
    const Z = ZONES[key];
    const d = Math.hypot(x - Z.cx, z - Z.cz);
    return 1 - smoothstep(54, 100, d);
  }

  function heightAt(x, z) {
    const wA = zoneWeight(x, z, 'A');
    const wC = zoneWeight(x, z, 'C');
    const wD = zoneWeight(x, z, 'D');
    let h = (fbm(x * 0.011 + 11.3, z * 0.011 + 7.7) - 0.5) * 9;
    h += wC * Math.pow(Math.max(0, fbm(x * 0.019, z * 0.019) - 0.40), 1.5) * 95;
    h -= wD * 1.6;
    h = h * (1 - 0.72 * wA) + wA * 0.55;
    const hub = 1 - smoothstep(16, 46, Math.hypot(x, z));
    h = h * (1 - hub) + hub * 0.6;
    const edge = Math.max(
      smoothstep(150, 196, Math.abs(x)),
      smoothstep(150, 196, Math.abs(z))
    );
    h += edge * 26;
    return h;
  }

  function zoneKeyAt(x, z) {
    let best = 'A', bestD = Infinity;
    for (const k in ZONES) {
      const Z = ZONES[k], d = Math.hypot(x - Z.cx, z - Z.cz);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  /* ---------- builders ---------- */
  /* ---------- procedural surface textures ---------- */
  function makeGrainTexture(size, base, amp, cells) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const gs = cells || 8;
    const grid = [];
    for (let i = 0; i < (gs + 1) * (gs + 1); i++) grid.push(Math.random());
    const lerp = (a, b, t) => a + (b - a) * t;
    const sm = t => t * t * (3 - 2 * t);
    function noise(x, y) {
      const gx = x / size * gs, gy = y / size * gs;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = sm(gx - x0), fy = sm(gy - y0);
      const i0 = y0 * (gs + 1) + x0;
      return lerp(
        lerp(grid[i0], grid[i0 + 1], fx),
        lerp(grid[i0 + gs + 1], grid[i0 + gs + 2], fx), fy);
    }
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = noise(x, y) * 0.62 + Math.random() * 0.38;
        const speck = Math.random() < 0.012 ? (Math.random() - 0.5) * amp * 2.6 : 0;
        const g = Math.max(0, Math.min(255, base + (v - 0.5) * amp * 2 + speck));
        const i4 = (y * size + x) * 4;
        img.data[i4] = img.data[i4 + 1] = img.data[i4 + 2] = g;
        img.data[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  function makeRockGeometry(seed) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const d = 1
        + 0.27 * Math.sin(n.x * 3.1 + seed) * Math.cos(n.y * 2.3 + seed * 1.7)
        + 0.17 * Math.sin(n.z * 4.2 - seed * 0.6)
        + 0.09 * Math.cos(n.x * 6.5 + n.z * 5.1 + seed);
      v.multiplyScalar(Math.max(0.55, d));
      v.y *= 0.94;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  function buildSky() {
    const geo = new THREE.SphereGeometry(360, 32, 18);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(ZONES.A.skyTop) },
        bot: { value: new THREE.Color(ZONES.A.skyBot) },
        offset: { value: 60.0 },
        power: { value: 0.75 }
      },
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; uniform float offset; uniform float power; varying vec3 vW; void main(){ float h = normalize(vW + vec3(0.0, offset, 0.0)).y; float k = pow(max(h, 0.0), power); gl_FragColor = vec4(mix(bot, top, k), 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    scene.add(sky);
  }

  /* ---------- objective beacon ---------- */
  const BEACON_CFG = {
    enabled: true,
    size: 1.2,
    height: 38,
    radius: 2.4,
    ringRadius: 5.5,
    minDist: 10,
    fadeStart: 80,
    fadeEnd: 190,
    maxDist: 240,
    through: true,
    condition: 'all',
    duration: 0,
    offsetY: 0
  };
  let beacon = null, beam = null, core = null, ringMesh = null, icon = null, iconGhost = null;
  let beaconTarget = null, beaconUntil = 0;

  function makeBeamTexture() {
    const c = document.createElement('canvas'); c.width = 8; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.25, 'rgba(255,255,255,.55)');
    g.addColorStop(0.75, 'rgba(255,255,255,.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 128);
    const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }

  function makeIconTexture() {
    const S = 128;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');

    const glow = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
    glow.addColorStop(0, 'rgba(255,255,255,.55)');
    glow.addColorStop(0.55, 'rgba(255,255,255,.16)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, S, S);

    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.PI / 4);
    const r = 42;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-r, -r, r * 2, r * 2, 12);
    else ctx.rect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(28,64,54,.9)';
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#1c4036';
    ctx.fill();

    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }

  function buildBeacon() {
    beacon = new THREE.Group();
    const col = 0x8ff0c8;

    const beamMat = new THREE.MeshBasicMaterial({
      map: makeBeamTexture(), color: col, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), beamMat);
    beam.position.y = 0.5;
    beacon.add(beam);

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), coreMat);
    beacon.add(core);

    const ringMat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.08;
    beacon.add(ringMesh);

    const tex = makeIconTexture();
    icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    iconGhost = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, fog: false
    }));
    beacon.add(icon); beacon.add(iconGhost);

    beacon.visible = false;
    scene.add(beacon);
  }

  function setBeacon(node) {
    beaconTarget = node || null;
    beaconUntil = (node && BEACON_CFG.duration > 0) ? performance.now() + BEACON_CFG.duration * 1000 : 0;
    if (beacon && node) {
      const c = node.type === 'npc' ? 0x8ff0c8
        : node.type === 'chest' ? 0xffd27a
          : node.type === 'crystal' ? 0xbfa8ff
            : node.type === 'guild' ? 0x8fc8ff : 0xffa874;
      beam.material.color.setHex(c);
      ringMesh.material.color.setHex(c);
      icon.material.color.setHex(0xffffff);
      iconGhost.material.color.setHex(c);
    }
  }

  function updateBeacon(t) {
    if (!beacon) return;
    const cfg = BEACON_CFG;
    if (!beaconTarget || !cfg.enabled) { beacon.visible = false; return; }
    if (beaconUntil && performance.now() > beaconUntil) { beacon.visible = false; return; }
    if (cfg.condition === 'main' && !beaconTarget.main) { beacon.visible = false; return; }

    const px = player.position.x, pz = player.position.z;
    const dx = beaconTarget.x - px, dz = beaconTarget.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > cfg.maxDist) { beacon.visible = false; return; }

    beacon.visible = true;
    beacon.position.set(beaconTarget.x, heightAt(beaconTarget.x, beaconTarget.z) + cfg.offsetY, beaconTarget.z);

    let a = 1;
    if (dist > cfg.fadeStart) a = 1 - (dist - cfg.fadeStart) / Math.max(1, cfg.fadeEnd - cfg.fadeStart);
    if (dist < cfg.minDist) a *= Math.max(0.22, dist / cfg.minDist);
    a = Math.max(0, Math.min(1, a));

    const pulse = 0.72 + Math.sin(t * 2.4) * 0.28;
    const H = cfg.height, R = cfg.radius;

    beam.visible = true;
    beam.scale.set(R, H, R);
    beam.position.y = H / 2;
    beam.material.opacity = 0.36 * a * pulse;
    core.scale.set(R * 0.22, H * 0.94, R * 0.22);
    core.position.y = H * 0.47;
    core.material.opacity = 0.55 * a;

    const rs = cfg.ringRadius * (1 + Math.sin(t * 2.0) * 0.05);
    ringMesh.scale.set(rs, rs, rs);
    ringMesh.material.opacity = 0.8 * a * (0.85 + Math.sin(t * 3.1) * 0.15);

    const iconY = Math.min(H * 0.20, 5.2) + Math.sin(t * 1.5) * 0.5;
    const sc = Math.max(3.0, Math.min(8.5, dist * 0.085)) * cfg.size;
    icon.position.set(0, iconY, 0);
    icon.scale.set(sc, sc, 1);
    icon.material.opacity = a;
    iconGhost.position.set(0, iconY, 0);
    iconGhost.scale.set(sc * 1.08, sc * 1.08, 1);
    iconGhost.visible = !!cfg.through;
    iconGhost.material.opacity = 0.30 * a;
  }

  function buildTerrain() {
    const SEG = 150, SIZE = 420;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const tmp = new THREE.Color();
    const HUB = new THREE.Color(0.15, 0.285, 0.17);
    const SAND = new THREE.Color(0.58, 0.53, 0.40);
    const SNOW = new THREE.Color(0.93, 0.96, 0.99);
    const zoneCols = {};
    for (const k in ZONES) zoneCols[k] = new THREE.Color(ZONES[k].ground[0], ZONES[k].ground[1], ZONES[k].ground[2]);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);

      let wsum = 0;
      const ws = {};
      for (const k in ZONES) { ws[k] = zoneWeight(x, z, k) + 0.001; wsum += ws[k]; }
      col.setRGB(0, 0, 0);
      for (const k in ZONES) {
        tmp.copy(zoneCols[k]);
        col.r += tmp.r * ws[k] / wsum;
        col.g += tmp.g * ws[k] / wsum;
        col.b += tmp.b * ws[k] / wsum;
      }
      const hubW = (1 - smoothstep(34, 96, Math.hypot(x, z))) * Math.max(0, 1 - ws.D * 1.7);
      if (hubW > 0.01) col.lerp(HUB, hubW * 0.85);
      const grain = (fbm(x * 0.09 + 3.1, z * 0.09 + 8.4) - 0.5) * 0.26;
      col.addScalar(grain);
      const shade = 0.86 + Math.max(-0.16, Math.min(0.22, h * 0.010));
      col.multiplyScalar(shade);
      const sand = (1 - smoothstep(-1.8, 1.2, h)) * Math.max(0, 1 - ws.D * 1.8);
      if (sand > 0.01) col.lerp(SAND, sand * 0.62);
      const snow = smoothstep(24, 44, h);
      if (snow > 0.01) col.lerp(SNOW, snow * 0.92);
      colors[i * 3] = Math.max(0, Math.min(1, col.r));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, col.g));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, col.b));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const groundTex = makeGrainTexture(256, 228, 30, 9);
    groundTex.repeat.set(78, 78);
    const groundBump = makeGrainTexture(256, 198, 34, 30);
    groundBump.repeat.set(150, 150);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.97, metalness: 0.02,
      map: groundTex, bumpMap: groundBump, bumpScale: 0.34
    });
    terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    scene.add(terrain);

    const wgeo = new THREE.PlaneGeometry(420, 420, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshStandardMaterial({ color: 0x2f7291, transparent: true, opacity: 0.55, roughness: 0.25, metalness: 0.1 });
    water = new THREE.Mesh(wgeo, wmat);
    water.position.y = -3.0;
    scene.add(water);
  }

  function scatter() {
    const rand = (function (seed) {
      let s = seed;
      return function () { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    })(20261120);

    const nearNode = (x, z, r) => nodes.some(n => Math.hypot(n.x - x, n.z - z) < r)
      || WAYPOINTS.some(w => Math.hypot(w.x - x, w.z - z) < Math.max(r, 8.5));

    /* trees */
    const treeN = 210;
    const trunkGeo = new THREE.CylinderGeometry(0.55, 0.75, 5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(2.6, 6.4, 7);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a46, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeN);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeN);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < treeN && guard++ < 6000) {
      const x = (rand() * 2 - 1) * 185, z = (rand() * 2 - 1) * 185;
      if (zoneWeight(x, z, 'B') < 0.68) continue;
      if (Math.hypot(x, z) < 26) continue;
      if (nearNode(x, z, 7)) continue;
      const y = heightAt(x, z);
      const sc = 0.7 + rand() * 0.9;
      p.set(x, y + 2.5 * sc, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(placed, m);
      p.set(x, y + 6.2 * sc, z);
      m.compose(p, q, s);
      leaves.setMatrixAt(placed, m);
      c.setHSL(0.30 + rand() * 0.06, 0.38 + rand() * 0.18, 0.26 + rand() * 0.12);
      leaves.setColorAt(placed, c);
      placed++;
    }
    trunks.count = placed; leaves.count = placed;
    trunks.castShadow = true; leaves.castShadow = true;
    scene.add(trunks); scene.add(leaves);

    /* rocks — three deformed variants + small stones */
    const rockN = 210;
    const rockTex = makeGrainTexture(160, 212, 40, 6);
    rockTex.repeat.set(1.8, 1.8);
    const rockMat = new THREE.MeshStandardMaterial({
      map: rockTex, roughness: 1, metalness: 0.04, flatShading: true
    });
    const variants = [0, 1, 2].map(function (vi) {
      const geo = makeRockGeometry(vi * 2.37 + 1.13);
      const im = new THREE.InstancedMesh(geo, rockMat, Math.ceil(rockN / 3) + 6);
      im.castShadow = true; im.receiveShadow = true;
      return { mesh: im, n: 0 };
    });
    let rIdx = 0; guard = 0;
    while (rIdx < rockN && guard++ < 9000) {
      const x = (rand() * 2 - 1) * 188, z = (rand() * 2 - 1) * 188;
      if (Math.hypot(x, z) < 16) continue;
      if (nearNode(x, z, 5)) continue;
      const y = heightAt(x, z);
      const sc = 0.55 + rand() * 2.3;
      p.set(x, y + sc * 0.42, z);
      q.setFromEuler(new THREE.Euler(rand() * 0.5, rand() * Math.PI, rand() * 0.4));
      s.set(sc * (0.85 + rand() * 0.4), sc * (0.55 + rand() * 0.6), sc * (0.85 + rand() * 0.4));
      m.compose(p, q, s);
      const V = variants[rIdx % 3];
      V.mesh.setMatrixAt(V.n, m);
      const wA = zoneWeight(x, z, 'A'), wC = zoneWeight(x, z, 'C'), wD = zoneWeight(x, z, 'D');
      if (wA > 0.5) c.setRGB(0.86 + rand() * 0.08, 0.88 + rand() * 0.07, 0.90 + rand() * 0.06);
      else if (wC > 0.5) c.setRGB(0.44 + rand() * 0.1, 0.42 + rand() * 0.09, 0.40 + rand() * 0.08);
      else if (wD > 0.5) c.setRGB(0.34 + rand() * 0.09, 0.30 + rand() * 0.08, 0.44 + rand() * 0.1);
      else c.setRGB(0.48 + rand() * 0.1, 0.50 + rand() * 0.09, 0.46 + rand() * 0.08);
      V.mesh.setColorAt(V.n, c);
      V.n++;
      rIdx++;
      if (sc > 1.6) colliders.push({ x, z, r: sc * 0.85 });
    }
    variants.forEach(function (V) { V.mesh.count = V.n; scene.add(V.mesh); });

    /* loose stones scattered near rocks */
    const stoneN = 160;
    const stoneMesh = new THREE.InstancedMesh(makeRockGeometry(9.31), rockMat, stoneN);
    let si = 0; guard = 0;
    while (si < stoneN && guard++ < 6000) {
      const x = (rand() * 2 - 1) * 185, z = (rand() * 2 - 1) * 185;
      if (Math.hypot(x, z) < 12) continue;
      if (nearNode(x, z, 4)) continue;
      const y = heightAt(x, z);
      const sc = 0.18 + rand() * 0.42;
      p.set(x, y + sc * 0.3, z);
      q.setFromEuler(new THREE.Euler(rand(), rand() * Math.PI, rand()));
      s.set(sc, sc * (0.6 + rand() * 0.5), sc);
      m.compose(p, q, s);
      stoneMesh.setMatrixAt(si, m);
      c.setRGB(0.42 + rand() * 0.22, 0.43 + rand() * 0.2, 0.41 + rand() * 0.18);
      stoneMesh.setColorAt(si, c);
      si++;
    }
    stoneMesh.count = si; stoneMesh.castShadow = true; stoneMesh.receiveShadow = true;
    scene.add(stoneMesh);

    /* rock spires in the metal mountains */
    const spireN = 48;
    const spireMesh = new THREE.InstancedMesh(makeRockGeometry(4.77), rockMat, spireN);
    let pi2 = 0; guard = 0;
    while (pi2 < spireN && guard++ < 4000) {
      const x = (rand() * 2 - 1) * 180, z = (rand() * 2 - 1) * 180;
      if (Math.hypot(x, z) < 30) continue;
      if (zoneWeight(x, z, 'C') < 0.55) continue;
      if (nearNode(x, z, 6)) continue;
      const y = heightAt(x, z);
      const sc = 1.0 + rand() * 1.6;
      const hh = 3.4 + rand() * 5.2;
      p.set(x, y + hh * 0.34, z);
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.18, rand() * Math.PI, (rand() - 0.5) * 0.18));
      s.set(sc, hh * 0.5, sc);
      m.compose(p, q, s);
      spireMesh.setMatrixAt(pi2, m);
      c.setRGB(0.40 + rand() * 0.1, 0.38 + rand() * 0.09, 0.36 + rand() * 0.08);
      spireMesh.setColorAt(pi2, c);
      pi2++;
      if (sc > 1.5) colliders.push({ x, z, r: sc * 0.8 });
    }
    spireMesh.count = pi2; spireMesh.castShadow = true; spireMesh.receiveShadow = true;
    scene.add(spireMesh);

    /* crystal shards (D zone) */
    const shardN = 150;
    const shGeo = new THREE.OctahedronGeometry(1.1, 0);
    const shMat = new THREE.MeshStandardMaterial({
      color: 0x5330c9, emissive: 0x2a1177, emissiveIntensity: 1.15,
      roughness: 0.14, metalness: 0.32, flatShading: true
    });
    const shards = new THREE.InstancedMesh(shGeo, shMat, shardN);
    placed = 0; guard = 0;
    while (placed < shardN && guard++ < 7000) {
      const x = (rand() * 2 - 1) * 185, z = (rand() * 2 - 1) * 185;
      if (Math.hypot(x, z) < 34) continue;
      if (zoneWeight(x, z, 'D') < 0.45) continue;
      if (nearNode(x, z, 5.5)) continue;
      const y = heightAt(x, z);
      const sc = 0.5 + rand() * 2.1;
      p.set(x, y + sc * 0.8, z);
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.7, rand() * Math.PI, (rand() - 0.5) * 0.7));
      s.set(sc * 0.62, sc * (1.2 + rand() * 0.9), sc * 0.62);
      m.compose(p, q, s);
      shards.setMatrixAt(placed, m);
      c.setHSL(0.71 + rand() * 0.05, 0.62 + rand() * 0.18, 0.50 + rand() * 0.12);
      shards.setColorAt(placed, c);
      placed++;
      if (sc > 2.0) colliders.push({ x, z, r: sc * 0.6 });
    }
    shards.count = placed;
    scene.add(shards);

    /* grass tufts */
    const grassN = 1800;
    const gGeo = new THREE.ConeGeometry(0.12, 0.62, 3);
    gGeo.translate(0, 0.5, 0);
    const gMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const grass = new THREE.InstancedMesh(gGeo, gMat, grassN);
    let gi = 0, gg = 0;
    while (gi < grassN && gg++ < 20000) {
      const x = (rand() * 2 - 1) * 186, z = (rand() * 2 - 1) * 186;
      const wB = zoneWeight(x, z, 'B'), wA = zoneWeight(x, z, 'A');
      if (wB < 0.45) continue;
      if (nearNode(x, z, 4)) continue;
      const y = heightAt(x, z);
      if (y < -0.9) continue;
      const sc = 0.6 + rand() * 0.9;
      p.set(x, y - 0.03, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      s.set(sc * (0.8 + rand() * 0.5), sc, sc * (0.8 + rand() * 0.5));
      m.compose(p, q, s);
      grass.setMatrixAt(gi, m);
      const g2 = rand();
      c.setRGB(0.20 + g2 * 0.16, 0.42 + g2 * 0.22, 0.20 + g2 * 0.10);
      grass.setColorAt(gi, c);
      gi++;
    }
    grass.count = gi;
    scene.add(grass);

    /* wildflowers */
    const flN = 240;
    const fGeo = new THREE.SphereGeometry(0.10, 6, 5);
    const fMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x222222, emissiveIntensity: 0.15 });
    const flowers = new THREE.InstancedMesh(fGeo, fMat, flN);
    let fi = 0, fg = 0;
    const petals = [0xfff4c2, 0xffc6dd, 0xd8f0ff, 0xffe08a];
    while (fi < flN && fg++ < 6000) {
      const x = (rand() * 2 - 1) * 180, z = (rand() * 2 - 1) * 180;
      if (zoneWeight(x, z, 'B') < 0.35) continue;
      if (nearNode(x, z, 4)) continue;
      const y = heightAt(x, z);
      if (y < -0.6) continue;
      p.set(x, y + 0.5 + rand() * 0.3, z);
      q.identity();
      const sc2 = 0.8 + rand() * 0.8;
      s.set(sc2, sc2, sc2);
      m.compose(p, q, s);
      flowers.setMatrixAt(fi, m);
      c.setHex(petals[Math.floor(rand() * petals.length)]);
      flowers.setColorAt(fi, c);
      fi++;
    }
    flowers.count = fi;
    scene.add(flowers);

    /* distant mountain ring */
    for (let mi = 0; mi < 18; mi++) {
      const ang = mi / 18 * Math.PI * 2 + 0.35;
      const rr = 300 + rand() * 50;
      const hh = 50 + rand() * 60;
      const mm = new THREE.Mesh(
        new THREE.ConeGeometry(38 + rand() * 26, hh, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x93a9c0).lerp(new THREE.Color(ZONES.A.fog), 0.45), fog: true })
      );
      mm.position.set(Math.cos(ang) * rr, hh / 2 - 14, Math.sin(ang) * rr);
      mm.rotation.y = rand() * Math.PI;
      scene.add(mm);
    }

    /* fireflies */
    const pcount = 170;
    ffBase = [];
    for (let pi = 0; pi < pcount; pi++) {
      const x = (rand() * 2 - 1) * 170, z = (rand() * 2 - 1) * 170;
      const y = heightAt(x, z) + 1.2 + rand() * 5.5;
      ffBase.push([x, y, z]);
    }
    const pgeo = new THREE.BufferGeometry();
    const parr = new Float32Array(pcount * 3);
    ffBase.forEach(function (b, i2) { parr[i2 * 3] = b[0]; parr[i2 * 3 + 1] = b[1]; parr[i2 * 3 + 2] = b[2]; });
    pgeo.setAttribute('position', new THREE.BufferAttribute(parr, 3));
    const pmat = new THREE.PointsMaterial({
      color: 0xcfffe4, size: 1.25, map: softDot(64), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    fireflies = new THREE.Points(pgeo, pmat);
    scene.add(fireflies);

    /* cave glow lights (max 6) */
    for (let i = 0; i < 6; i++) {
      const ang = i / 6 * Math.PI * 2 + 0.6;
      const x = 60 + Math.cos(ang) * (40 + (i % 2) * 16);
      const z = 60 + Math.sin(ang) * (40 + (i % 2) * 16);
      const pl = new THREE.PointLight(i % 2 ? 0x6f8bff : 0x8a6bff, 0.5, 48, 2);
      pl.position.set(x, heightAt(x, z) + 8, z);
      scene.add(pl);
    }
  }

  /* ---------- teleport waypoints ---------- */
  const wpMeshes = new Map();

  function buildWaypoints() {
    WAYPOINTS.forEach(function (w) {
      const g = new THREE.Group();
      const y = heightAt(w.x, w.z);

      const step = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.8, 0.24, 8), toonMat(0x3b4750));
      step.position.y = 0.11; step.receiveShadow = true; g.add(step);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.35, 0.52, 8), toonMat(0x596a76));
      base.position.y = 0.36; base.castShadow = true; base.receiveShadow = true; g.add(base);

      const runeMat = new THREE.MeshBasicMaterial({
        color: 0x5fd6c8, transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false
      });
      const rune = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.75, 36), runeMat);
      rune.rotation.x = -Math.PI / 2; rune.position.y = 0.63; g.add(rune);

      const shardMat = toonMat(0x76909c);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        const sh = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.7, 4), shardMat);
        sh.position.set(Math.cos(a) * 1.78, 1.22, Math.sin(a) * 1.78);
        sh.rotation.y = -a;
        sh.castShadow = true;
        g.add(sh);
      }

      const crysMat = new THREE.MeshStandardMaterial({
        color: 0x4c5c64, emissive: 0x0d2a2c, emissiveIntensity: 0.4,
        roughness: 0.24, metalness: 0.15, transparent: true, opacity: 0.9
      });
      const crys = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 0), crysMat);
      crys.position.y = 2.6; crys.scale.set(1, 1.55, 1);
      crys.castShadow = true;
      g.add(crys);

      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x9ff2ea, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.05, 6, 40), haloMat);
      halo.position.y = 2.6; halo.rotation.x = Math.PI / 2;
      g.add(halo);

      const beamMat = new THREE.MeshBasicMaterial({
        map: makeBeamTexture(), color: 0x8ff0e6, transparent: true, opacity: 0.05,
        blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, fog: true
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1, 16, 1, true), beamMat);
      beam.position.y = 6.2; beam.scale.y = 7.4;
      g.add(beam);

      g.position.set(w.x, y, w.z);
      scene.add(g);
      wpMeshes.set(w.id, {
        group: g, crys: crys, halo: halo, rune: rune, beam: beam,
        crysMat: crysMat, runeMat: runeMat, haloMat: haloMat, beamMat: beamMat,
        unlocked: false, flash: 0, phase: Math.random() * 6.28
      });
      colliders.push({ x: w.x, z: w.z, r: 1.2 });
    });
  }

  function setWaypointState(id, unlocked) {
    const o = wpMeshes.get(id);
    if (!o) return;
    if (o.unlocked === unlocked && o.ready) return;
    o.unlocked = !!unlocked;
    o.ready = true;
    if (unlocked) {
      o.crysMat.color.setHex(0x3fd8cc);
      o.crysMat.emissive.setHex(0x1a8f86);
      o.crysMat.emissiveIntensity = 0.95;
      o.crysMat.opacity = 1;
      o.runeMat.color.setHex(0x9ff8ee);
      o.haloMat.opacity = 0.8;
      o.beamMat.opacity = 0.16;
      o.flash = performance.now() / 1000 + 0.001;
    } else {
      o.crysMat.color.setHex(0x4c5c64);
      o.crysMat.emissive.setHex(0x0d2a2c);
      o.crysMat.emissiveIntensity = 0.4;
      o.crysMat.opacity = 0.9;
      o.runeMat.color.setHex(0x40605e);
      o.haloMat.opacity = 0.16;
      o.beamMat.opacity = 0.05;
      o.flash = 0;
      o.group.scale.setScalar(1);
    }
  }

  function updateWaypoints(t) {
    wpMeshes.forEach(function (o) {
      const bob = Math.sin(t * 1.5 + o.phase) * 0.13;
      o.crys.rotation.y = t * (o.unlocked ? 1.1 : 0.35);
      o.crys.position.y = 2.6 + bob;
      o.halo.position.y = 2.6 + bob;
      o.halo.rotation.z = t * (o.unlocked ? 1.4 : 0.35);
      o.halo.scale.setScalar(1 + Math.sin(t * 2.1 + o.phase) * 0.05);
      if (o.unlocked) {
        o.runeMat.opacity = 0.45 + Math.sin(t * 2.4 + o.phase) * 0.16;
      }
      if (o.flash) {
        const el = performance.now() / 1000 - o.flash;
        if (el > 1.0) {
          o.flash = 0;
          o.group.scale.setScalar(1);
          o.beamMat.opacity = o.unlocked ? 0.16 : 0.05;
        } else {
          const k = Math.max(0, el) / 1.0;
          o.group.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.13);
          o.beamMat.opacity = (o.unlocked ? 0.16 : 0.05) + 0.32 * (1 - k);
        }
      }
    });
  }

  function buildNodeMeshes() {
    nodes.forEach(n => {
      const g = new THREE.Group();
      const y = heightAt(n.x, n.z);
      let color;
      if (n.type === 'npc') color = 0x4fd6a4;
      else if (n.type === 'chest') color = 0xffc85f;
      else if (n.type === 'guild') color = 0x6fb8e8;
      else if (n.type === 'shop') color = 0xff9d5c;
      else color = 0xa99ff0;

      if (n.type === 'npc') {
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 1.15, 2.6, 10),
          toonMat(0x2e8e7a)
        );
        body.position.y = 1.5; body.castShadow = true; g.add(body);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(1.0, 14, 12),
          toonMat(0x9fe8d0, 0x145043)
        );
        head.position.y = 3.4; g.add(head);
      } else if (n.type === 'chest') {
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 1.5, 1.7),
          toonMat(0xb07f2c)
        );
        base.position.y = 0.85; base.castShadow = true; g.add(base);
        const lid = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 0.55, 1.8),
          toonMat(0xe8c26a, 0x3a2a08)
        );
        lid.position.y = 1.85; g.add(lid);
      } else if (n.type === 'guild') {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(6.4, 3.2, 5.2),
          new THREE.MeshStandardMaterial({ color: 0x3b4a63, roughness: 0.85 })
        );
        wall.position.y = 1.6; wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(5.2, 2.6, 4),
          new THREE.MeshStandardMaterial({ color: 0x27405c, roughness: 0.8 })
        );
        roof.position.y = 4.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 2.2, 0.25),
          new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 })
        );
        door.position.set(0, 1.1, 2.62); g.add(door);
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(2.8, 1.15, 0.2),
          new THREE.MeshStandardMaterial({ color: 0x5aa8e0, emissive: 0x1b5c85, emissiveIntensity: 0.45, roughness: 0.5 })
        );
        sign.position.set(0, 3.55, 2.7); g.add(sign);
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.18, 0.1),
          new THREE.MeshStandardMaterial({ color: 0xe8f4ff, emissive: 0x9fd8ff, emissiveIntensity: 0.5, roughness: 0.4 })
        );
        stripe.position.set(0, 3.55, 2.82); g.add(stripe);
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 3.2, 6),
          new THREE.MeshStandardMaterial({ color: 0x9aa8b8, roughness: 0.5, metalness: 0.4 })
        );
        pole.position.set(3.1, 3.2, 2.2); g.add(pole);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x6fb8e8, side: THREE.DoubleSide, roughness: 0.8 })
        );
        flag.position.set(3.85, 4.2, 2.2); g.add(flag);
      } else if (n.type === 'shop') {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(4.2, 1.2, 2.4),
          new THREE.MeshStandardMaterial({ color: 0x7a5433, roughness: 0.9 })
        );
        counter.position.y = 0.6; counter.castShadow = true; g.add(counter);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(4.8, 0.22, 3.0),
          new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.85 })
        );
        roof.position.set(0, 3.0, 0); roof.rotation.x = 0.12; roof.castShadow = true; g.add(roof);
        [[-1.9, -1.3], [1.9, -1.3], [-1.9, 1.3], [1.9, 1.3]].forEach(function (p) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 3.0, 6),
            new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })
          );
          post.position.set(p[0], 1.5, p[1]); g.add(post);
        });
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, 1.0, 1.0),
          new THREE.MeshStandardMaterial({ color: 0x9a7040, roughness: 0.95 })
        );
        crate.position.set(1.5, 0.5, 1.9); crate.rotation.y = 0.4; g.add(crate);
        const crate2 = crate.clone(); crate2.position.set(0.55, 0.5, 2.1); crate2.scale.setScalar(0.8); g.add(crate2);
        const lamp = new THREE.PointLight(0xffb36b, 0.9, 14, 2);
        lamp.position.set(0, 2.4, 0); g.add(lamp);
      } else {
        const cr = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.35, 0),
          new THREE.MeshStandardMaterial({ color: 0xb0a2ff, emissive: 0x6344d8, emissiveIntensity: 1.1, roughness: 0.2 })
        );
        cr.position.y = 1.9; cr.scale.y = 1.5; g.add(cr);
        const pl = new THREE.PointLight(0x8b6dff, 0.8, 16, 2);
        pl.position.y = 2.2; g.add(pl);
      }

      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.62, 0),
        new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 1.3, transparent: true, opacity: 0.95 })
      );
      marker.position.y = n.type === 'npc' ? 5.0 : (n.type === 'guild' ? 7.2 : n.type === 'shop' ? 4.6 : 3.6);
      g.add(marker);

      g.position.set(n.x, y, n.z);
      scene.add(g);
      nodeMeshes.set(n.id, { group: g, marker, baseColor: color });
      colliders.push({ x: n.x, z: n.z, r: n.colliderR || 1.9 });
    });
  }

  /* ============================================================
     玩家角色重製 — 依 docs/角色规格-v1.md
     · 純程序化幾何，所有顏色經 plS() 轉線性（規格 §0 問題 1、§6）
     · 角色專用 toon ramp G2/G3/G4（§7），不動世界的 TOON
     · 每個 Group 內按「材質」合併幾何 → 1 mesh = 1 draw call（§2.0、§11）
     ============================================================ */

  /* sRGB → 線性：寫進材質前先轉，否則上屏被 renderer 二次編碼抬亮。
     回傳 Color 物件而不是 hex —— 暗色（鞋底／褲襪）轉線性後數值只有 0.005 級，
     用 getHex() 量化到 8 bit 會把暗階全部壓到 1~4，明度階梯就沒了。 */
  function plS(hex) {
    const c = new THREE.Color(hex);
    if (c.convertSRGBToLinear) c.convertSRGBToLinear();
    return c;
  }

  /* 自訂 toon ramp（世界用 4 階太黑，角色另建） */
  function plGradTex(vals) {
    const n = vals.length, d = new Uint8Array(n * 4);
    vals.forEach(function (v, i) {
      const b = Math.round(v * 255);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    });
    const t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  let _plRamps = null;
  function plRamps() {
    if (!_plRamps) _plRamps = {
      G2: plGradTex([0.62, 1.00]),                  // 硬面：皮、金屬、鞋底
      G3: plGradTex([0.52, 0.78, 1.00]),            // 布：外套、裙、領巾
      G4: plGradTex([0.46, 0.66, 0.84, 1.00])       // 有機：膚、髮、臉
    };
    return _plRamps;
  }

  /* 角色材質：hex 是「上屏目標色」，內部先轉線性 */
  function plMat(hex, ramp, opt) {
    const m = new THREE.MeshToonMaterial({ color: plS(hex), gradientMap: ramp });
    if (opt) {
      if (opt.double) m.side = THREE.DoubleSide;
      if (opt.back) m.side = THREE.BackSide;
      if (opt.flat) m.flatShading = true;
    }
    return m;
  }

  /* 幾何合併：烘矩陣 → 合成一個 BufferGeometry（r128 沒有 BufferGeometryUtils） */
  function plMerge(items) {
    const gs = items.map(function (it) {
      let g = it.g.clone();
      if (it.m) g.applyMatrix4(it.m);
      if (g.index) g = g.toNonIndexed();
      return g;
    });
    let n = 0;
    gs.forEach(function (g) { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    gs.forEach(function (g) {
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  /* 位置／旋轉／縮放 → Matrix4 */
  function plM(x, y, z, rx, ry, rz, sx, sy, sz) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    const s = (sx == null) ? 1 : sx;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x || 0, y || 0, z || 0), q,
      new THREE.Vector3(s, (sy == null) ? s : sy, (sz == null) ? s : sz));
  }

  /* Lathe 捷徑：[ [r,y], ... ] */
  function plLathe(pts, seg) {
    return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg);
  }

  /* 刀片髮：4 面錐壓扁成刀狀，原點在髮根、尖端朝 +y */
  function plLock(len, w, thick, segs) {
    const g = new THREE.ConeGeometry(w, len, 4, segs || 2);
    g.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, thick == null ? 0.42 : thick));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, len / 2, 0));
    return g;
  }

  /* 臉部貼圖（規格 §3.2）：canvas 512×768，phi/theta 逐一換算成像素 */
  function makeFaceTexture() {
    const W = 512, H = 768;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');

    /* 底：膚色 */
    g.fillStyle = '#F0C8A6'; g.fillRect(0, 0, W, H);

    /* 下顎暗面：兩端透明、中段最深，消除 y=470 的硬邊 */
    const jg = g.createLinearGradient(0, 452, 0, 572);
    jg.addColorStop(0, 'rgba(217,169,133,0)');
    jg.addColorStop(0.35, 'rgba(217,169,133,0.22)');
    jg.addColorStop(1, 'rgba(217,169,133,0)');
    g.fillStyle = jg; g.fillRect(0, 452, W, 120);

    /* 腮紅（橢圓徑向漸層 rx36 ry22） */
    [[351, 432], [161, 432]].forEach(function (p) {
      g.save();
      g.translate(p[0], p[1]); g.scale(1, 22 / 36);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 36);
      rg.addColorStop(0, 'rgba(240,144,144,0.45)');
      rg.addColorStop(1, 'rgba(240,144,144,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 36, 0, Math.PI * 2); g.fill();
      g.restore();
    });

    /* 單眼 93×93，local (0,0) = 內眼角上方；mirror 用於左眼 */
    function eye(ox, oy, mirror) {
      g.save();
      g.translate(ox, oy);
      if (mirror) { g.translate(93, 0); g.scale(-1, 1); }

      /* 眼白：杏仁形，內眼角低、外眼角高 */
      g.beginPath();
      g.moveTo(6, 44);
      g.bezierCurveTo(18, 8, 74, 4, 88, 32);
      g.bezierCurveTo(90, 60, 62, 88, 30, 86);
      g.bezierCurveTo(14, 84, 6, 66, 6, 44);
      g.closePath();
      g.fillStyle = '#F7F1E8'; g.fill();

      /* 虹膜：上緣被上眼線吃掉（只畫 y ≥ 26） */
      g.save();
      g.beginPath(); g.rect(0, 26, 93, 70); g.clip();
      const ig = g.createLinearGradient(0, 26, 0, 82);
      ig.addColorStop(0, '#2E7FA8'); ig.addColorStop(1, '#7FD4CE');
      g.beginPath(); g.arc(52, 52, 30, 0, Math.PI * 2); g.fillStyle = ig; g.fill();
      g.restore();

      /* 瞳孔 */
      g.beginPath(); g.arc(52, 56, 15, 0, Math.PI * 2); g.fillStyle = '#16283A'; g.fill();
      /* 高光 */
      g.beginPath(); g.arc(42, 40, 9, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill();
      g.beginPath(); g.arc(64, 70, 5, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();

      /* 上眼線：內端細、外端粗且上挑 */
      g.strokeStyle = '#1A1420'; g.lineCap = 'round';
      g.lineWidth = 9;
      g.beginPath(); g.moveTo(5, 43); g.quadraticCurveTo(46, 8, 92, 23); g.stroke();
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(84, 27); g.lineTo(100, 15); g.stroke();

      /* 下眼線：只畫外側 65% */
      g.strokeStyle = 'rgba(201,138,134,0.6)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(30, 85); g.quadraticCurveTo(66, 86, 87, 73); g.stroke();

      /* 睫毛 3 根 */
      g.strokeStyle = '#1A1420'; g.lineCap = 'round';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(86, 32); g.lineTo(96, 20); g.stroke();
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(90, 42); g.lineTo(102, 34); g.stroke();
      g.beginPath(); g.moveTo(90, 52); g.lineTo(100, 48); g.stroke();

      g.restore();
    }
    eye(290, 315, false);   // 畫布右側
    eye(128, 315, true);    // 畫布左側（水平鏡像）

    /* 眉：3px 圓頭線，平緩微彎（收細、減斜，避免兇相） */
    g.strokeStyle = '#7A4A34'; g.lineWidth = 3.0; g.lineCap = 'round';
    g.beginPath(); g.moveTo(304, 293); g.quadraticCurveTo(338, 290, 372, 290); g.stroke();
    g.beginPath(); g.moveTo(208, 290); g.quadraticCurveTo(174, 290, 140, 293); g.stroke();

    /* 鼻影 */
    g.strokeStyle = 'rgba(201,138,134,0.35)'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(256, 400); g.quadraticCurveTo(249, 408, 255, 414); g.stroke();

    /* 嘴：淺微笑 ∪ 形（嘴角微上揚），加深加粗讓遠距離可讀 */
    g.strokeStyle = '#9C4A44'; g.lineWidth = 4.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(240, 450); g.quadraticCurveTo(256, 461, 272, 448); g.stroke();
    /* 嘴角的小上揚鉤 */
    g.lineWidth = 3.0;
    g.beginPath(); g.moveTo(272, 448); g.quadraticCurveTo(276, 446, 277, 443); g.stroke();
    g.beginPath(); g.moveTo(240, 450); g.quadraticCurveTo(236, 448, 235, 445); g.stroke();
    /* 下唇淡影 */
    g.strokeStyle = 'rgba(200,120,110,0.4)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(248, 459); g.quadraticCurveTo(256, 463, 264, 459); g.stroke();

    const t = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  function buildPlayer() {
    const CR = plRamps(), G2 = CR.G2, G3 = CR.G3, G4 = CR.G4;

    /* ---- 比例常數（規格 §1，腳底 y=0、頭頂 3.26） ---- */
    const P = {
      ySoleBot: 0.000, yHip: 1.500, ySkirtHem: 1.120, yBelt: 1.580,
      yTorsoPiv: 1.700, yChest: 2.120, yShoulder: 2.260, yNeck: 2.300,
      yChin: 2.400, yHeadC: 2.730, ySkullTop: 3.060, yAhoge: 3.260
    };
    const R = {
      headX: 0.315, headY: 0.330, headZ: 0.310,
      shoulderPivX: 0.245, hipPivX: 0.145,
      ZS_TORSO: 0.74, ZS_SKIRT: 0.88
    };
    /* 臉貼圖方位補償：r128 SphereGeometry 的 u=0.25 對應 +z，故為 0。
       若實拍臉不在正前方，只調這一個數（單位：貼圖寬度的比例）。 */
    const FACE_OFFSET = 0;

    /* ---- 配色（§6，全部是上屏目標色，寫進材質由 plMat 轉線性） ---- */
    const C = {
      coat: 0x2E5C8A, coatDark: 0x1E4470, tights: 0x1B3A46,
      skirt: 0x6FC3BC, skirtIn: 0x3A6E6C,
      cream: 0xF2EBDD, creamDim: 0xCBC0A8,
      skin: 0xF0C8A6, skinDim: 0xD9A985,
      hair: 0x7A4E32, hairDark: 0x563620,
      leather: 0x22303E, sole: 0x12171D,
      gold: 0xD9A94E, goldLight: 0xF0D08A,
      scarf: 0x3FBFAE
    };
    const MAT = {
      coat: plMat(C.coat, G3, { double: true }),
      coatDark: plMat(C.coatDark, G3),
      tights: plMat(C.tights, G3),
      skirt: plMat(C.skirt, G3, { flat: true }),
      skirtIn: plMat(C.skirtIn, G3, { back: true }),
      cream: plMat(C.cream, G3, { double: true }),
      creamDim: plMat(C.creamDim, G3, { double: true }),
      skin: plMat(C.skin, G4),
      skinDim: plMat(C.skinDim, G4),
      hair: plMat(C.hair, G4, { flat: true }),
      hairDark: plMat(C.hairDark, G4, { flat: true }),
      leather: plMat(C.leather, G2),
      sole: plMat(C.sole, G2),
      gold: plMat(C.gold, G2),
      goldLight: plMat(C.goldLight, G2),
      scarf: plMat(C.scarf, G3, { double: true })
    };

    function put(parent, geo, material, cast) {
      const m = new THREE.Mesh(geo, material);
      m.castShadow = (cast !== false);
      parent.add(m);
      return m;
    }

    player = new THREE.Group();

    /* ================= 腿 + 靴（pivot 在髖，§2.10） ================= */
    limbs.legs = [];
    [-1, 1].forEach(function (sd) {
      const pivot = new THREE.Group();
      pivot.position.set(R.hipPivX * sd, P.yHip, 0);

      put(pivot, plMerge([
        { g: new THREE.SphereGeometry(0.122, 12, 10) },                                    // 髖球
        { g: new THREE.CylinderGeometry(0.118, 0.100, 0.56, 12), m: plM(0, -0.29, 0) },    // 大腿
        { g: new THREE.SphereGeometry(0.098, 10, 8), m: plM(0, -0.56, 0) }                 // 膝球
      ]), MAT.tights);

      put(pivot, plMerge([
        { g: new THREE.CylinderGeometry(0.095, 0.082, 0.48, 12), m: plM(0, -0.80, 0) }     // 小腿（膚）
      ]), MAT.skin);

      put(pivot, plMerge([
        { g: new THREE.CylinderGeometry(0.122, 0.114, 0.10, 14), m: plM(0, -1.02, 0) },    // 靴口翻邊
        { g: new THREE.CylinderGeometry(0.114, 0.100, 0.31, 14), m: plM(0, -1.215, 0) },   // 靴筒
        { g: new THREE.SphereGeometry(0.10, 12, 10),
          m: plM(0, -1.345, 0.055, 0, 0, 0, 0.98, 0.85, 1.50) },                           // 圓鞋頭
        { g: new THREE.CylinderGeometry(0.108, 0.104, 0.022, 14),
          m: plM(0, -1.415, 0.020, 0, 0, 0, 1, 1, 1.68) }                                  // 鞋底沿
      ]), MAT.leather);

      put(pivot, plMerge([
        { g: new THREE.CylinderGeometry(0.104, 0.098, 0.075, 14),
          m: plM(0, -1.4625, 0.020, 0, 0, 0, 1, 1, 1.72) }                                 // 鞋底
      ]), MAT.sole);

      put(pivot, plMerge([
        { g: new THREE.TorusGeometry(0.122, 0.013, 8, 36), m: plM(0, -0.975, 0, Math.PI / 2) }
      ]), MAT.cream);

      put(pivot, plMerge([
        { g: new THREE.TorusGeometry(0.117, 0.009, 8, 30, 2.2),
          m: plM(0, -1.06, 0, Math.PI / 2, 0, 0.9) }                                       // 金扣帶
      ]), MAT.gold);

      player.add(pivot);
      limbs.legs.push(pivot);
    });

    /* ================= 裙（12 褶，§2.7）================= */
    const skirtGrp = new THREE.Group();
    player.add(skirtGrp);
    const FOLDS = 12, SEG = FOLDS * 2;

    function skirtFold(geo, ampAt) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const ang = Math.atan2(x, z);                 // 0 = 正前
        const t = Math.min(1, Math.max(0, (0.22 - y) / 0.44));
        const amp = ampAt(t);
        const f = 1 + amp * Math.cos(FOLDS * ang);
        pos.setXYZ(i, x * f, y + (t > 0.9 ? 0.014 * Math.cos(FOLDS * ang) : 0), z * f);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, R.ZS_SKIRT));
      return geo;
    }

    const skirtGeo = skirtFold(new THREE.CylinderGeometry(0.215, 0.400, 0.44, SEG, 3, true),
      function (t) { return 0.018 + 0.062 * t; });
    /* 腰頭（同材質，併進裙 mesh） */
    const waistGeo = new THREE.CylinderGeometry(0.220, 0.222, 0.045, SEG, 1, true);
    waistGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.205, 0));
    const skirtOuter = put(skirtGrp, plMerge([{ g: skirtGeo }, { g: waistGeo }]), MAT.skirt);
    skirtOuter.position.y = 1.34;

    /* 裙內殼：同幾何 scale 0.985、BackSide、色 ×0.55 → 仰角不透空 */
    const skirtInGeo = skirtGeo.clone();
    skirtInGeo.applyMatrix4(new THREE.Matrix4().makeScale(0.985, 1, 0.985));
    const skirtInner = put(skirtGrp, skirtInGeo, MAT.skirtIn, false);
    skirtInner.position.y = 1.34;

    /* 裙擺 trim：同一套褶位移（amp 固定 0.080） */
    const trimGeo = skirtFold(new THREE.CylinderGeometry(0.404, 0.408, 0.035, SEG * 2, 1, true),
      function () { return 0.018; });
    const skirtTrim = put(skirtGrp, trimGeo, MAT.cream);
    skirtTrim.position.y = 1.1375;

    /* ================= 外套（軀幹，pivot y=1.70，§2.5）================= */
    const torsoGrp = new THREE.Group();
    torsoGrp.position.set(0, P.yTorsoPiv, 0);
    limbs.torso = torsoGrp;
    player.add(torsoGrp);

    const jacketProfile = [
      [0.212, -0.160], [0.206, -0.100], [0.200, 0.000], [0.216, 0.100],
      [0.246, 0.220], [0.262, 0.340], [0.262, 0.440], [0.240, 0.520],
      [0.190, 0.600], [0.128, 0.640]
    ];
    const jacketGeo = plLathe(jacketProfile, 20);
    jacketGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, R.ZS_TORSO));

    const HEM_T0 = THREE.MathUtils.degToRad(35);
    const HEM_TL = Math.PI * 2 - THREE.MathUtils.degToRad(70);
    const hemGeo = new THREE.CylinderGeometry(0.216, 0.318, 0.34, 40, 1, true, HEM_T0, HEM_TL);
    hemGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.76));
    hemGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.33, 0));

    const coatMesh = put(torsoGrp, plMerge([{ g: jacketGeo }, { g: hemGeo }]), MAT.coat);
    playerBody = torsoGrp;

    /* 奶油件：立領 + 衣擺底緣 + 翻領 3 段 ×2 */
    const trimItems = [];
    trimItems.push({ g: new THREE.CylinderGeometry(0.100, 0.118, 0.13, 16, 1, true), m: plM(0, 0.615, -0.005) });
    const hemTrim = new THREE.CylinderGeometry(0.320, 0.322, 0.035, 40, 1, true, HEM_T0, HEM_TL);
    hemTrim.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.76));
    trimItems.push({ g: hemTrim, m: plM(0, -0.4825, 0) });

    /* 翻領：貼著外套曲面的弧片（半徑 = 外套該高度 r + 0.006），V 型收窄 */
    [[0.268, 0.196, 0.16, 0.60, 22, 26],
     [0.268, 0.259, 0.16, 0.44, 20, 20],
     [0.259, 0.233, 0.14, 0.28, 17, 14]].forEach(function (s) {
      [-1, 1].forEach(function (sd) {
        const h = s[2], yTop = s[3];
        const tc = THREE.MathUtils.degToRad(s[4]), tw = THREE.MathUtils.degToRad(s[5]);
        /* r128 的 Cylinder theta=0 在 +z（正前），不需要 +PI/2 偏移 */
        const g = new THREE.CylinderGeometry(s[1], s[0], h, 8, 1, true, sd * tc - tw / 2, tw);
        g.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, R.ZS_TORSO));
        trimItems.push({ g: g, m: plM(0, yTop - h / 2, 0) });
      });
    });
    put(torsoGrp, plMerge(trimItems), MAT.cream);

    /* 內襯（襯衫）：填住 V 領開口，theta 以 +z 為中心 */
    const liningGeo = new THREE.CylinderGeometry(0.256, 0.262, 0.36, 12, 1, true, -0.42, 0.84);
    liningGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, R.ZS_TORSO));
    put(torsoGrp, liningGeo, MAT.creamDim);

    /* 皮件：腰帶 + 側袋 + 袋蓋（腰帶半徑要大於外套，否則整條被外套吃掉） */
    const beltGeo = new THREE.CylinderGeometry(0.234, 0.234, 0.10, 20);
    beltGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.78));
    put(torsoGrp, plMerge([
      { g: beltGeo, m: plM(0, -0.12, 0) }
      /* 側袋本輪刪除：半個盒子浮在髖部輪廓外，像一塊石頭；腰帶＋金扣已足夠讀出腰線 */
    ]), MAT.leather);

    /* 金屬件：腰帶六角扣 + 扣芯 + 左胸臂章（臂章貼在橢圓胸面上） */
    put(torsoGrp, plMerge([
      { g: new THREE.CylinderGeometry(0.058, 0.058, 0.022, 6), m: plM(0, -0.12, 0.182, Math.PI / 2) },
      { g: new THREE.CylinderGeometry(0.026, 0.026, 0.026, 8), m: plM(0, -0.12, 0.189, Math.PI / 2) },
      { g: new THREE.CylinderGeometry(0.058, 0.058, 0.016, 8), m: plM(-0.148, 0.32, 0.166, Math.PI / 2) }
    ]), MAT.gold);

    /* ================= 手臂（pivot 在肩，§2.8）================= */
    limbs.arms = [];
    [-1, 1].forEach(function (sd) {
      const pivot = new THREE.Group();
      pivot.position.set(R.shoulderPivX * sd, P.yShoulder, 0);
      pivot.rotation.z = -0.17 * sd;   // 外張角與 movePlayer 的 ±0.17 一致

      put(pivot, plMerge([
        { g: new THREE.SphereGeometry(0.135, 14, 12), m: plM(0, 0, 0, 0, 0, 0, 1, 0.94, 0.96) }, // 肩球
        { g: new THREE.CylinderGeometry(0.112, 0.100, 0.34, 12), m: plM(0, -0.19, 0) },           // 上臂袖
        { g: new THREE.SphereGeometry(0.102, 10, 8), m: plM(0, -0.36, 0) }                        // 肘球
      ]), MAT.coat);

      put(pivot, plMerge([
        { g: new THREE.CylinderGeometry(0.100, 0.088, 0.28, 12), m: plM(0, -0.50, 0) }            // 前臂袖（暗）
      ]), MAT.coatDark);

      put(pivot, plMerge([
        { g: new THREE.TorusGeometry(0.134, 0.011, 8, 36), m: plM(0, 0.012, 0, Math.PI / 2) },    // 袖口滾邊
        { g: new THREE.CylinderGeometry(0.090, 0.104, 0.075, 12), m: plM(0, -0.645, 0) }          // 袖口
      ]), MAT.cream);

      put(pivot, plMerge([
        { g: new THREE.SphereGeometry(0.072, 12, 10),
          m: plM(0, -0.735, 0.006, 0, 0, 0, 0.86, 1.12, 0.80) },                                  // 手
        { g: new THREE.SphereGeometry(0.028, 8, 6),
          m: plM(0.030 * sd, -0.700, 0.042, 0, 0, -0.5 * sd, 0.85, 1.35, 0.85) }                   // 拇指
      ]), MAT.skin);

      player.add(pivot);
      limbs.arms.push(pivot);
    });

    /* ================= 頭（§3、§4）================= */
    const headGrp = new THREE.Group();
    headGrp.position.set(0, P.yHeadC, 0);
    player.add(headGrp);

    /* 頭骨：UV 重映射，把正前方 ±57° 攤到整張貼圖寬度 */
    const FACE_HALF = THREE.MathUtils.degToRad(57);
    const skullGeo = new THREE.SphereGeometry(0.330, 28, 22);
    (function () {
      const uv = skullGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const phi = uv.getX(i) * Math.PI * 2;          // phi = π/2 → 正前 (+z)
        uv.setX(i, (phi - (Math.PI / 2 - FACE_HALF)) / (FACE_HALF * 2) + FACE_OFFSET);
      }
      uv.needsUpdate = true;
      skullGeo.scale(0.955, 1.0, 0.94);                // → rx .315 / ry .330 / rz .310
    })();
    put(headGrp, skullGeo, new THREE.MeshToonMaterial({
      color: 0xffffff, map: makeFaceTexture(), gradientMap: G4
    }));

    /* 膚色小件：頸 + 鼻 + 耳（鼻只凸 0.012） */
    put(headGrp, plMerge([
      { g: new THREE.CylinderGeometry(0.078, 0.072, 0.20, 12), m: plM(0, -0.26, -0.01) },
      { g: new THREE.SphereGeometry(0.022, 8, 6),
        m: plM(0, -0.025, 0.303, 0, 0, 0, 1, 0.85, 0.70) },
      { g: new THREE.SphereGeometry(0.036, 8, 6),
        m: plM(-0.300, 0.020, -0.020, 0, -0.35, 0, 0.35, 1.0, 0.72) },
      { g: new THREE.SphereGeometry(0.036, 8, 6),
        m: plM(0.300, 0.020, -0.020, 0, 0.35, 0, 0.35, 1.0, 0.72) }
    ]), MAT.skin, false);

    /* 髮：髮冠 + 7 束瀏海 + 2 側髮 + 馬尾 3 段 + 呆毛（全部一個 mesh） */
    const hairItems = [];

    /* 髮量主體：一整顆「閉合」橢球，往後下偏。
       不切方位角、不留缺口 → 不會看到碗內壁／水平硬邊／方板切邊；
       前方因 z 後偏而沉進頭骨，只在頭頂、兩側、後腦露出，瀏海再蓋住前緣接縫。 */
    const HAIR = { cy: 0.045, cz: -0.090, rx: 0.367, ry: 0.330, rz: 0.360 };
    hairItems.push({
      g: new THREE.SphereGeometry(0.34, 22, 16),
      m: plM(0, HAIR.cy, HAIR.cz, 0, 0, 0, 1.08, 0.97, 1.06)
    });
    /* 髮暗層整層移除：那兩束就是背面「深色橫帶」的來源，
       現在髮量是一整顆閉合橢球，層次由 flatShading + G4 四階 ramp 提供。 */

    /* 瀏海 7 束：髮根落在髮冠前緣（球面解 z），rx 讓髮束貼著額頭往前下方垂 */
    const BANGS = [
      [-0.245, 2.815, -0.30, 0.062],
      [-0.170, 2.855, -0.20, 0.090],
      [-0.095, 2.895, -0.10, 0.080],
      [-0.020, 2.865, -0.04, 0.095],
      [ 0.062, 2.900,  0.10, 0.085],
      [ 0.145, 2.850,  0.19, 0.092],
      [ 0.228, 2.820,  0.32, 0.064]
    ];
    const BANG_RX = Math.PI - 0.80;
    BANGS.forEach(function (b) {
      const x = b[0], yTip = b[1], rz = b[2], w = b[3];
      const by = 0.300 - 1.05 * x * x;                        // 髮根高度：越外側越低
      const k = 1 - (x / HAIR.rx) * (x / HAIR.rx)
        - ((by - HAIR.cy) / HAIR.ry) * ((by - HAIR.cy) / HAIR.ry);
      const bz = Math.max(0.02, HAIR.cz + Math.sqrt(Math.max(0, k)) * HAIR.rz);
      const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(BANG_RX, 0, rz));
      const L = Math.max(0.10, (by + P.yHeadC - yTip) / Math.max(0.2, -dir.y));
      const g = plLock(L, w, 0.45, 2);
      hairItems.push({
        g: g,
        m: plM(x + dir.x * L / 2, by + dir.y * L / 2, bz + dir.z * L / 2, BANG_RX, 0, rz)
      });
    });

    /* 側髮 4 束：臉的畫框，從鬢角垂到顎下（內外兩層，避免看成一隻角） */
    [-1, 1].forEach(function (sd) {
      [[0.288, 0.082, 0.070, 0.40, -0.05],
       [0.320, -0.075, 0.050, 0.34, -0.02]].forEach(function (s) {
        const bx = s[0] * sd, len = s[3], rz = s[4] * sd;
        const rx = Math.PI - 0.05;
        const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, 0, rz));
        hairItems.push({
          g: plLock(len, s[1], 0.45, 2),
          m: plM(bx + dir.x * len / 2, 0.175 + dir.y * len / 2, s[2] + dir.z * len / 2, rx, 0, rz)
        });
      });
    });

    /* 馬尾 3 段（每段各自旋轉 → 側面是折線不是錐）；rx > π 才是往後垂 */
    /* 馬尾：由髮圈往後垂的「三節辮」。四個節點直接給世界座標，
       每節的方向由相鄰節點反推（rx = atan2(dz,dy)），節間各重疊 0.02。
       末端 z −0.558 比外套背面 −0.19 再往後 0.37 → 離開背脊，不貼成一支三角。 */
    const PONYP = [
      [2.615, -0.400],
      [2.355, -0.432],
      [2.115, -0.487],
      [1.905, -0.558]
    ];
    const PONYW = [[0.074, 0.66], [0.066, 0.72], [0.056, 0.80]];   // 半徑遞減、thick ≥0.6
    const PONYX = [0.000, 0.026, -0.020];                          // 左右錯位 → 辮子感
    const PONYR = [0.30, -0.26, 0.20];                             // 每節 Y 軸扭轉，避免平面對鏡頭
    for (let pi = 0; pi < 3; pi++) {
      const ay = PONYP[pi][0] - P.yHeadC, az = PONYP[pi][1];
      const by = PONYP[pi + 1][0] - P.yHeadC, bzN = PONYP[pi + 1][1];
      let dy = by - ay, dz = bzN - az;
      const segL = Math.sqrt(dy * dy + dz * dz);
      dy /= segL; dz /= segL;
      const rx = Math.atan2(dz, dy);
      hairItems.push({
        g: plLock(segL + 0.04, PONYW[pi][0], PONYW[pi][1], 3),
        m: plM(PONYX[pi], ay - dy * 0.02, az - dz * 0.02, rx, PONYR[pi], 0)  // 根端退 0.02 → 重疊
      });
    }

    /* 呆毛：全角色最高點 y = 3.26 */
    hairItems.push({
      g: plLock(0.21, 0.024, 0.35, 2),
      m: plM(0.030, 3.095 - P.yHeadC, -0.045, 0.42, 0, -0.55)
    });

    put(headGrp, plMerge(hairItems), MAT.hair);
    /* 髮圈：放在後腦髮量表面（z −0.392，髮量背面就在 −0.395）＝馬尾第一節的根部，
       rx 0.55；內圈用一顆髮束填住，不會透空看到頭皮。 */
    hairItems.push({
      g: new THREE.SphereGeometry(0.055, 10, 8),
      m: plM(0, 2.600 - P.yHeadC, -0.392, 0, 0, 0, 1.0, 1.25, 0.9)
    });
    put(headGrp, plMerge([
      { g: new THREE.TorusGeometry(0.058, 0.019, 4, 14), m: plM(0, 2.600 - P.yHeadC, -0.392, 0.55) }
    ]), MAT.gold, false);

    /* ================= 領巾（limbs.cape，pivot 在領口，§2.11）================= */
    const cape = new THREE.Group();
    cape.position.set(0, 2.34, -0.16);
    limbs.cape = cape;
    player.add(cape);

    /* 圍頸兩圈：半徑要大於立領，否則整條領巾被領子吃掉 */
    const band1 = new THREE.CylinderGeometry(0.126, 0.134, 0.085, 16, 1, true);
    band1.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.020, 0.15));
    const band2 = new THREE.CylinderGeometry(0.126, 0.140, 0.080, 16, 1, true);
    band2.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.040, 0.15));
    /* 尾巾：頂端貼著 pivot，往下往後飄 */
    /* 尾巾：0.053 厚的閉口扁帶（不是無厚度平面），長度收到腰帶上緣 1.61，
       並沿 y 往後飄到 z 0.38 → 不會穿過裙面 */
    const tailGeo = new THREE.CylinderGeometry(0.052, 0.038, 0.66, 7, 8, false);
    tailGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.30));
    (function () {
      const pos = tailGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = (0.33 - y) / 0.66;
        pos.setZ(i, pos.getZ(i) - 0.24 * t * t);
        pos.setX(i, pos.getX(i) * (1 + 0.30 * t));
      }
      pos.needsUpdate = true;
      tailGeo.computeVertexNormals();
      tailGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.40, 0.02));
    })();
    put(cape, plMerge([{ g: band1 }, { g: band2 }, { g: tailGeo }]), MAT.scarf);

    /* ================= 右手寶珠（玩法道具，§2.9 / §10.3）================= */
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 14, 12),
      new THREE.MeshStandardMaterial({
        color: 0xc8fff0, emissive: 0x35e0b0, emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.1
      })
    );
    orb.position.set(0.02, -0.845, 0.085);
    limbs.arms[1].add(orb);
    const orbLight = new THREE.PointLight(0x54e3b0, 0.8, 7, 2);
    orbLight.position.copy(orb.position);
    limbs.arms[1].add(orbLight);

    /* ================= 地面接觸陰影 + 地面光環（原樣保留，§2.12）================= */
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 2.0),
      new THREE.MeshBasicMaterial({ map: softDot(64), color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    player.add(shadow);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.24, 32),
      new THREE.MeshBasicMaterial({ color: 0x9ff5d0, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    player.add(ring);

    player.position.set(0, heightAt(0, 0), 0);
    player.rotation.y = Math.PI;
    scene.add(player);
  }

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(ZONES.A.sky);
    scene.fog = new THREE.FogExp2(ZONES.A.fog, 0.0048);

    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 420);

    hemi = new THREE.HemisphereLight(0x9dbfe8, 0x2a3324, 0.18);
    scene.add(hemi);
    ambient = new THREE.AmbientLight(0xffffff, 0.035);
    scene.add(ambient);

    sun = new THREE.DirectionalLight(0xffd9a0, 1.13);
    sun.position.set(70, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    const d = 46;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    scene.add(sun);
    scene.add(sun.target);

    rim = new THREE.DirectionalLight(0x9fd4ff, 0.18);
    rim.position.set(-80, 55, -90);
    scene.add(rim);

    clock = new THREE.Clock();
    nodes = NODES.slice();

    buildSky();
    buildTerrain();
    scatter();
    buildNodeMeshes();
    buildWaypoints();
    buildPlayer();
    buildBeacon();
    bindInput();
    window.addEventListener('resize', onResize);
    updateCamera(1);
    return { scene, camera, renderer };
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ---------------- touch controls ---------------- */
  function detectTouch() {
    // 手動覆寫：?touch=1 強制觸控模式（方便在電腦上測試版面）、?touch=0 強制關閉
    if (/[?&]touch=1\b/.test(location.search)) return true;
    if (/[?&]touch=0\b/.test(location.search)) return false;
    // 以「主指標」判斷：手機/平板 = coarse 且無 fine；有滑鼠或觸控板 = fine → 桌面模式
    // 注意：不可用 navigator.maxTouchPoints，Windows 即使無觸控螢幕也可能回報 >0
    try {
      const coarse = window.matchMedia('(pointer: coarse)');
      const fine = window.matchMedia('(pointer: fine)');
      if (coarse.matches && !fine.matches) return true;
      if (fine.matches) return false;
    } catch (e) { }
    return (navigator.maxTouchPoints || 0) > 1;
  }

  function resetStick() {
    stickX = 0; stickY = 0; stickId = null;
    const base = document.getElementById('stickBase');
    const knob = document.getElementById('stickKnob');
    if (base) base.classList.remove('active');
    if (knob) knob.style.transform = 'translate(0px,0px)';
  }

  function bindTouch() {
    touchMode = detectTouch();
    if (!touchMode) return;
    document.body.classList.add('is-touch');

    const base = document.getElementById('stickBase');
    const knob = document.getElementById('stickKnob');
    const jumpBtn = document.getElementById('jumpBtn');
    const actBtn = document.getElementById('actBtn');
    const lh = document.getElementById('lockHint');

    // 觸控裝置不會有 pointer lock，改用可自動消失的操作提示
    if (lh) {
      lh.textContent = '左搖桿移動 · 右側拖曳轉視角';
      setTimeout(function () { lh.classList.add('hide'); }, 6000);
    }

    if (base && knob) {
      const radius = function () { return Math.max(28, base.clientWidth * 0.32); };

      const move = function (e) {
        if (e.pointerId !== stickId) return;
        let dx = e.clientX - stickCX, dy = e.clientY - stickCY;
        const d = Math.hypot(dx, dy);
        if (d > stickRadius) { dx = dx / d * stickRadius; dy = dy / d * stickRadius; }
        knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
        const dead = 7; // 死區，防止手指輕觸就走
        stickX = Math.abs(dx) < dead ? 0 : dx / stickRadius;
        stickY = Math.abs(dy) < dead ? 0 : dy / stickRadius;
        const m = Math.hypot(stickX, stickY);
        if (m > 1) { stickX /= m; stickY /= m; }
        e.preventDefault();
      };

      const start = function (e) {
        if (stickId !== null) return;
        stickId = e.pointerId;
        const r = base.getBoundingClientRect();
        stickCX = r.left + r.width / 2;
        stickCY = r.top + r.height / 2;
        stickRadius = radius();
        base.classList.add('active');
        try { base.setPointerCapture(e.pointerId); } catch (err) { }
        move(e);
      };

      const end = function (e) {
        if (e.pointerId !== stickId) return;
        resetStick();
      };

      base.addEventListener('pointerdown', start);
      base.addEventListener('pointermove', move);
      base.addEventListener('pointerup', end);
      base.addEventListener('pointercancel', end);
      base.addEventListener('lostpointercapture', end);
      base.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    }

    if (jumpBtn) {
      jumpBtn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        touchJump = true;
        jumpBtn.classList.add('on');
      });
      const off = function () { jumpBtn.classList.remove('on'); };
      jumpBtn.addEventListener('pointerup', off);
      jumpBtn.addEventListener('pointercancel', off);
      jumpBtn.addEventListener('pointerleave', off);
    }

    if (actBtn) {
      actBtn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        actBtn.classList.add('on');
        if (interactHandler) interactHandler();
      });
      const off = function () { actBtn.classList.remove('on'); };
      actBtn.addEventListener('pointerup', off);
      actBtn.addEventListener('pointercancel', off);
      actBtn.addEventListener('pointerleave', off);
    }

    // 互動提示氣泡本身也可點，等於按 E
    const prompt = document.getElementById('prompt');
    if (prompt) {
      prompt.addEventListener('click', function () { if (interactHandler) interactHandler(); });
    }
  }

  function setInteractHandler(fn) { interactHandler = fn; }

  function bindInput() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', clearKeys);

    const cv = renderer.domElement;

    cv.addEventListener('click', function () {
      if (locked) return;
      if (document.pointerLockElement !== cv && cv.requestPointerLock) {
        try { cv.requestPointerLock(); } catch (e) { }
      }
    });

    document.addEventListener('pointerlockchange', function () {
      const on = document.pointerLockElement === cv;
      if (on) everLocked = true;
      const lh = document.getElementById('lockHint');
      if (lh) lh.classList.toggle('hide', on);
    });

    document.addEventListener('mousemove', function (e) {
      if (locked) return;
      if (document.pointerLockElement !== cv) return;
      yaw -= e.movementX * 0.0023;
      pitch = Math.max(-0.32, Math.min(0.9, pitch + e.movementY * 0.0017));
    });

    // fallback: drag to look (only when pointer lock is unavailable) — 觸控也走這條
    cv.addEventListener('pointerdown', e => {
      if (locked || document.pointerLockElement === cv) return;
      if (lookId !== null) return;              // 一次只追蹤一根手指，避免與搖桿打架
      lookId = e.pointerId;
      pointerDown = true; lastPX = e.clientX; lastPY = e.clientY;
      if (e.pointerType === 'touch') e.preventDefault();
    });
    window.addEventListener('pointerup', e => {
      if (lookId === null || e.pointerId === lookId) { pointerDown = false; lookId = null; }
    });
    window.addEventListener('pointercancel', e => {
      if (lookId === null || e.pointerId === lookId) { pointerDown = false; lookId = null; }
    });
    window.addEventListener('pointermove', e => {
      if (!pointerDown || lookId !== e.pointerId) return;
      if (locked || document.pointerLockElement === cv) return;
      const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
      lastPX = e.clientX; lastPY = e.clientY;
      yaw -= dx * 0.0042;
      pitch = Math.max(-0.32, Math.min(0.9, pitch + dy * 0.0026));
    });

    cv.addEventListener('wheel', e => {
      if (locked) return;
      camDist = Math.max(5, Math.min(20, camDist + e.deltaY * 0.012));
      e.preventDefault();
    }, { passive: false });

    bindTouch();
  }

  function clearKeys() { keys = Object.create(null); }

  function setLocked(v) {
    locked = v;
    if (v) {
      clearKeys(); pointerDown = false; lookId = null; resetStick(); touchJump = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
  function isLocked() { return locked; }

  function requestLock() {
    const cv = renderer.domElement;
    if (locked || document.pointerLockElement === cv) return;
    if (cv.requestPointerLock) { try { cv.requestPointerLock(); } catch (e) { } }
  }
  function relock() { if (everLocked && !locked) requestLock(); }

  function nearestNode(maxDist) {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - player.position.x, n.z - player.position.z);
      const r = n.ir || maxDist;
      if (d < r && d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function movePlayer(dt) {
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dir = new THREE.Vector3();

    // 鍵盤與虛擬搖桿合併成一個方向向量（搖桿保留類比力度）
    let ix = 0, iy = 0;
    if (keys['w'] || keys['arrowup']) iy -= 1;
    if (keys['s'] || keys['arrowdown']) iy += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += stickX; iy += stickY;

    const inLen = Math.hypot(ix, iy);
    const speed = 16;
    if (inLen > 0.02) {
      const mag = Math.min(1, inLen);
      dir.copy(fwd).multiplyScalar(-iy / inLen).addScaledVector(right, ix / inLen).multiplyScalar(mag);
    }
    const targetVel = dir.clone().multiplyScalar(speed);
    velocity.lerp(targetVel, 1 - Math.exp(-10 * dt));

    const nx = player.position.x + velocity.x * dt;
    const nz = player.position.z + velocity.z * dt;

    let px = Math.max(-WALK_LIMIT, Math.min(WALK_LIMIT, nx));
    let pz = Math.max(-WALK_LIMIT, Math.min(WALK_LIMIT, nz));

    for (const c of colliders) {
      const dx = px - c.x, dz = pz - c.z;
      const dist = Math.hypot(dx, dz);
      const minD = c.r + 1.0;
      if (dist < minD && dist > 0.0001) {
        px = c.x + dx / dist * minD;
        pz = c.z + dz / dist * minD;
      }
    }
    player.position.x = px;
    player.position.z = pz;

    // jump + gravity
    const gy = heightAt(px, pz);
    if ((keys[' '] || touchJump) && onGround) { vy = 9.6; onGround = false; touchJump = false; }
    vy -= 26 * dt;
    player.position.y += vy * dt;
    if (player.position.y <= gy) {
      player.position.y = gy; vy = 0; onGround = true;
    } else if (player.position.y > gy + 0.03) {
      onGround = false;
    }

    if (dir.lengthSq() > 0.01) {
      const targetRot = Math.atan2(dir.x, dir.z);
      let diff = targetRot - player.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.rotation.y += diff * (1 - Math.exp(-12 * dt));
    }

    // walk animation
    const spd = velocity.length();
    walkPhase += dt * (3.2 + spd * 0.95);
    const amp = Math.min(1, spd / 7) * 0.7;
    if (limbs.legs.length === 2) {
      if (onGround) {
        limbs.legs[0].rotation.x = Math.sin(walkPhase) * amp;
        limbs.legs[1].rotation.x = -Math.sin(walkPhase) * amp;
        limbs.arms[0].rotation.x = -Math.sin(walkPhase) * amp * 0.75;
        limbs.arms[1].rotation.x = Math.sin(walkPhase) * amp * 0.75;
        if (limbs.torso) limbs.torso.position.y = 1.7 + Math.abs(Math.sin(walkPhase)) * 0.035 * amp;
        if (limbs.torso) limbs.torso.rotation.z = Math.sin(walkPhase) * 0.02 * amp;
      } else {
        limbs.legs[0].rotation.x = 0.55;
        limbs.legs[1].rotation.x = -0.25;
        limbs.arms[0].rotation.x = -0.7;
        limbs.arms[1].rotation.x = -0.35;
        if (limbs.torso) limbs.torso.position.y = 1.7;
      }
      if (limbs.cape) {
        limbs.cape.rotation.x = 0.08 + amp * 0.22 + Math.sin(walkPhase * 1.6) * 0.04;
        limbs.cape.rotation.z = Math.sin(walkPhase * 0.8) * 0.03;
      }
      if (limbs.torso) {
        const idle = Math.max(0, 1 - spd / 5);
        limbs.torso.scale.y = 1 + Math.sin(elapsed * 1.7) * 0.013 * idle;
        limbs.arms[0].rotation.z = -0.17 - Math.sin(elapsed * 1.1) * 0.02 * idle;
        limbs.arms[1].rotation.z = 0.17 + Math.sin(elapsed * 1.1) * 0.02 * idle;
      }
    }
  }

  function updateCamera(dtOrInit) {
    const dist = camDist;
    const h = 3.6;
    targetCam.set(
      player.position.x + Math.sin(yaw) * dist * Math.cos(pitch),
      player.position.y + h + Math.sin(pitch) * dist,
      player.position.z + Math.cos(yaw) * dist * Math.cos(pitch)
    );
    if (dtOrInit === 1) camera.position.copy(targetCam);
    else camera.position.lerp(targetCam, 1 - Math.exp(-9 * dtOrInit));

    const gmin = heightAt(camera.position.x, camera.position.z) + 1.4;
    if (camera.position.y < gmin) camera.position.y = gmin;

    tmpV.set(player.position.x, player.position.y + 2.2, player.position.z);
    camera.lookAt(tmpV);
  }

  function updateZoneAndFog(dt) {
    const k = zoneKeyAt(player.position.x, player.position.z);
    if (k !== zoneNow) { zoneNow = k; if (typeof onZoneChange === 'function') onZoneChange(k); }
    const Z = ZONES[zoneNow];
    const lerp = 1 - Math.exp(-2.2 * dt);
    scene.fog.color.lerp(new THREE.Color(Z.fog), lerp);
    scene.background.lerp(new THREE.Color(Z.skyBot), lerp);
    if (sky) {
      sky.material.uniforms.top.value.lerp(new THREE.Color(Z.skyTop), lerp);
      sky.material.uniforms.bot.value.lerp(new THREE.Color(Z.skyBot), lerp);
    }
    sun.target.position.set(player.position.x, player.position.y, player.position.z);
    sun.position.set(player.position.x + 70, player.position.y + 120, player.position.z + 40);
  }

  let onZoneChange = null;

  function animateMarkers(t) {
    nodeMeshes.forEach((o, id) => {
      o.marker.rotation.y = t * 1.4;
      o.marker.position.y = (o.marker.userData.baseY || (o.marker.userData.baseY = o.marker.position.y)) + Math.sin(t * 2 + id.length) * 0.28;
    });
  }

  function setNodeState(id, state) {
    const o = nodeMeshes.get(id);
    if (!o) return;
    if (state === 'done') {
      o.marker.material.color.setHex(0x4a6a60);
      o.marker.material.emissive.setHex(0x1e3a33);
      o.marker.material.opacity = 0.35;
      o.group.scale.setScalar(0.82);
    } else if (state === 'locked') {
      o.marker.material.color.setHex(0x555a5c);
      o.marker.material.emissive.setHex(0x222426);
      o.marker.material.opacity = 0.55;
    } else {
      o.marker.material.color.setHex(o.baseColor);
      o.marker.material.emissive.setHex(o.baseColor);
      o.marker.material.opacity = 0.95;
    }
  }

  function teleportTo(x, z) {
    clearKeys();
    velocity.set(0, 0, 0);
    vy = 0; onGround = true;
    const ax = x, az = z + 5.8;
    player.position.set(ax, heightAt(ax, az) + 0.05, az);
    player.rotation.y = Math.PI;
    updateCamera(1);
    if (sky) sky.position.copy(camera.position);
  }

  /* ---------- minimap ---------- */
  const MMW = 360;
  function drawMinimap(playerPos, camYaw, allNodes, doneSet, target, wpUnlocked) {
    const ctx = MAP_C.getContext('2d');
    ctx.clearRect(0, 0, MMW, MMW);
    const toMap = (x, z) => [(x + 200) / 400 * MMW, (z + 200) / 400 * MMW];

    const zc = { A: 'rgba(120,170,210,.26)', B: 'rgba(90,160,105,.28)', C: 'rgba(130,132,140,.28)', D: 'rgba(120,95,180,.30)' };
    for (const k in ZONES) {
      const Z = ZONES[k];
      const [mx, my] = toMap(Z.cx, Z.cz);
      ctx.fillStyle = zc[k];
      ctx.beginPath(); ctx.arc(mx, my, 70, 0, Math.PI * 2); ctx.fill();
    }

    allNodes.forEach(n => {
      const [mx, my] = toMap(n.x, n.z);
      const isDone = doneSet.has(n.id);
      ctx.beginPath();
      ctx.arc(mx, my, n.main ? 4.8 : 3.2, 0, Math.PI * 2);
      if (isDone) ctx.fillStyle = 'rgba(110,140,130,.55)';
      else if (n.type === 'npc') ctx.fillStyle = '#4fd6a4';
      else if (n.type === 'chest') ctx.fillStyle = '#ffc85f';
      else if (n.type === 'guild') ctx.fillStyle = '#6fb8e8';
      else if (n.type === 'shop') ctx.fillStyle = '#ff9d5c';
      else ctx.fillStyle = '#a99ff0';
      ctx.fill();
      if (n.main && !isDone) {
        ctx.strokeStyle = 'rgba(255,255,255,.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    });

    const [px, py] = toMap(playerPos.x, playerPos.z);

    if (target) {
      const [tx, ty] = toMap(target.x, target.z);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(143,240,200,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.restore();

      const pulse = 8 + Math.sin(performance.now() / 320) * 2.4;
      ctx.strokeStyle = 'rgba(143,240,200,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx, ty, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, ty, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#eafff7'; ctx.fill();
    }

    if (typeof WAYPOINTS !== 'undefined') {
      WAYPOINTS.forEach(function (w) {
        const m = toMap(w.x, w.z);
        const on = wpUnlocked && wpUnlocked.has(w.id);
        ctx.save();
        ctx.translate(m[0], m[1]);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-3.6, -3.6, 7.2, 7.2);
        ctx.fillStyle = on ? '#7fe8e0' : 'rgba(120,142,152,.6)';
        ctx.fill();
        ctx.strokeStyle = on ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.25)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.restore();
      });
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-camYaw);
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 6.5); ctx.lineTo(0, 3.4); ctx.lineTo(-6, 6.5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(200,225,215,.55)';
    ctx.font = '600 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', MMW / 2, 18);
    ctx.textAlign = 'left';
  }

  let lastT = 0;
  function update(dt, totalTime) {
    elapsed = totalTime;
    if (!locked) movePlayer(dt);
    updateCamera(dt);
    updateBeacon(totalTime);
    updateWaypoints(totalTime);
    if (sky) sky.position.copy(camera.position);
    if (fireflies) {
      const pos = fireflies.geometry.attributes.position;
      for (let i = 0; i < ffBase.length; i += 3) {
        const b = ffBase[i], t2 = totalTime * 0.7 + i * 0.37;
        pos.array[i] = b[0] + Math.sin(t2) * 1.6;
        pos.array[i + 1] = b[1] + Math.sin(t2 * 1.3) * 0.8;
        pos.array[i + 2] = b[2] + Math.cos(t2 * 0.9) * 1.6;
      }
      pos.needsUpdate = true;
    }
    updateZoneAndFog(dt);
    animateMarkers(totalTime);
    renderer.render(scene, camera);
  }

  return {
    init, update, drawMinimap, heightAt, zoneKeyAt, nearestNode,
    setLocked, isLocked, setNodeState, clearKeys, requestLock, relock, setBeacon, BEACON_CFG,
    setInteractHandler, isTouchMode: function () { return touchMode; },
    setWaypointState, teleportTo,
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get player() { return player; },
    get nodes() { return nodes; },
    get zoneNow() { return zoneNow; },
    get yaw() { return yaw; },
    set onZoneChange(fn) { onZoneChange = fn; },
    get keys() { return keys; }
  };
})();
