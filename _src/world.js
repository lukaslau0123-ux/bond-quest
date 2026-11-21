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

  function buildPlayer() {
    player = new THREE.Group();

    const skin = toonMat(0xcf9a72);
    const hairM = toonMat(0x6d4527);
    const coat = toonMat(0x2f5f96);
    const coatDark = toonMat(0x1d3f63);
    const trim = toonMat(0xf2f7fb);
    const gold = toonMat(0xe0b866, 0x5c4514);
    const leather = toonMat(0x2b3442);
    const eyeMat = toonMat(0x232b36);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xc8fff0, emissive: 0x35e0b0, emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.1 });

    // ---- legs (pivot at hip) ----
    limbs.legs = [];
    [-1, 1].forEach(function (sd) {
      const pivot = new THREE.Group();
      pivot.position.set(0.19 * sd, 1.12, 0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.55, 8), coatDark);
      thigh.position.y = -0.3; thigh.castShadow = true;
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.10, 0.42, 8), leather);
      shin.position.y = -0.78;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.4), leather);
      boot.position.set(0, -1.0, 0.06); boot.castShadow = true;
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.42), toonMat(0x161c24));
      sole.position.set(0, -1.11, 0.07);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.27), trim);
      strap.position.set(0, -0.885, 0.02);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.32), trim);
      cuff.position.set(0, -0.84, 0.03);
      pivot.add(thigh); pivot.add(shin); pivot.add(boot); pivot.add(cuff);
      pivot.add(sole); pivot.add(strap);
      player.add(pivot);
      limbs.legs.push(pivot);
    });

    // ---- skirt / coat flare ----
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.52, 0.52, 12, 1, true), coat);
    skirt.position.y = 1.34; skirt.castShadow = true; player.add(skirt);
    const skirtTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.515, 0.525, 0.06, 12, 1, true), trim);
    skirtTrim.position.y = 1.10; player.add(skirtTrim);

    // ---- torso ----
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.92, 12), coat);
    torso.position.y = 2.03; torso.castShadow = true;
    limbs.torso = torso; playerBody = torso; player.add(torso);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.24, 0.16, 12, 1, true), trim);
    collar.position.y = 2.44; player.add(collar);
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.42, 0.06), trim);
    lapel.position.set(-0.10, 2.22, 0.29); lapel.rotation.z = 0.16; player.add(lapel);
    const lapel2 = lapel.clone(); lapel2.position.x = 0.10; lapel2.rotation.z = -0.16; player.add(lapel2);
    const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.035, 12), gold);
    emblem.position.set(0, 2.06, 0.30); emblem.rotation.x = Math.PI / 2; player.add(emblem);

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.13, 12), leather);
    belt.position.y = 1.62; player.add(belt);
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.19, 0.13), leather);
    pouch.position.set(-0.31, 1.50, 0.12); pouch.rotation.y = 0.22;
    player.add(pouch);
    const pouchFlap = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.05, 0.14), toonMat(0x3a4956));
    pouchFlap.position.set(-0.31, 1.585, 0.12); pouchFlap.rotation.y = 0.22;
    player.add(pouchFlap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.06), gold);
    buckle.position.set(0, 1.62, 0.33); player.add(buckle);

    // ---- shoulders ----
    [-1, 1].forEach(function (sd) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), coatDark);
      pad.position.set(0.38 * sd, 2.42, 0);
      pad.scale.set(1, 0.8, 1);
      pad.castShadow = true;
      player.add(pad);
    });

    // ---- arms ----
    limbs.arms = [];
    [-1, 1].forEach(function (sd) {
      const pivot = new THREE.Group();
      pivot.position.set(0.42 * sd, 2.36, 0);
      pivot.rotation.z = -0.12 * sd;
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.09, 0.44, 8), coat);
      upper.position.y = -0.22; upper.castShadow = true;
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.40, 8), coatDark);
      fore.position.y = -0.62;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), skin);
      hand.position.y = -0.84;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.104, 0.08, 8), leather);
      cuff.position.y = -0.76;
      pivot.add(upper); pivot.add(fore); pivot.add(hand); pivot.add(cuff);
      player.add(pivot);
      limbs.arms.push(pivot);
    });

    // ---- neck + head ----
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 0.14, 8), skin);
    neck.position.y = 2.53; player.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.40, 20, 18), skin);
    head.position.y = 2.86; head.scale.set(1, 1.07, 0.97); head.castShadow = true;
    player.add(head);

    // hair: cap + back mass + side locks + ponytail
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.418, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.48), hairM);
    cap.position.y = 2.878; player.add(cap);
    const fringeShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.414, 20, 10, -0.95, 1.9, Math.PI * 0.40, Math.PI * 0.14), hairM);
    fringeShell.position.y = 2.878; player.add(fringeShell);
    [[-0.19, 0.20, -0.14], [-0.02, 0.24, 0.05], [0.16, 0.19, 0.16], [0.28, 0.15, 0.26]].forEach(function (t) {
      const strand = new THREE.Mesh(new THREE.ConeGeometry(0.062, t[1], 5), hairM);
      strand.position.set(t[0], 2.99 - t[1] * 0.42, 0.30);
      strand.rotation.x = Math.PI - 0.18;
      strand.rotation.z = t[2];
      player.add(strand);
    });
    [-1, 1].forEach(function (sd) {
      const side = new THREE.Mesh(new THREE.SphereGeometry(0.175, 10, 10), hairM);
      side.position.set(0.315 * sd, 2.775, -0.02);
      side.scale.set(0.75, 1.15, 0.95);
      player.add(side);
    });
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.401, 18, 10, 0, Math.PI * 2, Math.PI * 0.30, Math.PI * 0.10), hairM);
    fringe.position.set(0, 2.915, 0.01); fringe.rotation.x = -0.06; player.add(fringe);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), hairM);
    back.position.set(0, 2.70, -0.22); back.scale.set(1.1, 1.15, 0.85); player.add(back);
    [-1, 1].forEach(function (sd) {
      const lock = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), hairM);
      lock.position.set(0.31 * sd, 2.60, -0.02);
      lock.scale.set(0.65, 1.5, 0.65);
      player.add(lock);
    });
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8), hairM);
    tail.position.set(0, 2.36, -0.34);
    tail.rotation.x = 2.5;
    player.add(tail);

    // eyes
    [-1, 1].forEach(function (sd) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.043, 10, 8), eyeMat);
      eye.position.set(0.125 * sd, 2.80, 0.376);
      eye.scale.set(1, 1.25, 0.5);
      player.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), toonMat(0xffffff));
      glint.position.set(0.112 * sd, 2.815, 0.404);
      player.add(glint);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.026, 0.028), toonMat(0xa8865a));
      brow.position.set(0.127 * sd, 2.876, 0.372);
      brow.rotation.z = -0.13 * sd;
      player.add(brow);
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.085, 6), skin);
    nose.position.set(0, 2.775, 0.392); nose.rotation.x = Math.PI / 2;
    player.add(nose);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.018, 0.02), toonMat(0xb06a62));
    mouth.position.set(0, 2.702, 0.386);
    player.add(mouth);

    // temple locks
    [-1, 1].forEach(function (sd) {
      const lock = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.30, 5), hairM);
      lock.position.set(0.315 * sd, 2.70, 0.10);
      lock.rotation.x = Math.PI; lock.rotation.z = 0.12 * sd;
      player.add(lock);
    });

    // scarf
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.075, 8, 18), toonMat(0x4fd6c0));
    scarf.position.y = 2.5; scarf.rotation.x = Math.PI / 2; player.add(scarf);
    const scarfTail = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.9, 2, 4), new THREE.MeshStandardMaterial({ color: 0x4fd6c0, side: THREE.DoubleSide, roughness: 0.9 }));
    scarfTail.position.set(0.16, 2.05, -0.36); scarfTail.rotation.y = 0.3;
    limbs.cape = scarfTail; player.add(scarfTail);

    // sword on back
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.025), toonMat(0xdbe6f2));
    blade.position.set(0.22, 2.05, -0.33); blade.rotation.z = 0.38; blade.rotation.x = 0.05;
    player.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.07), gold);
    guard.position.set(0.42, 1.46, -0.33); guard.rotation.z = 0.38;
    player.add(guard);
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8), leather);
    hilt.position.set(0.53, 1.32, -0.33); hilt.rotation.z = 0.38; player.add(hilt);

    // bond orb in right hand
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), orbMat);
    orb.position.y = -0.9;
    limbs.arms[1].add(orb);
    const orbLight = new THREE.PointLight(0x54e3b0, 0.8, 7, 2);
    orbLight.position.y = -0.9; limbs.arms[1].add(orbLight);

    // soft contact shadow
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 2.0),
      new THREE.MeshBasicMaterial({ map: softDot(64), color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    player.add(shadow);

    // ground ring
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

    // fallback: drag to look (only when pointer lock is unavailable)
    cv.addEventListener('pointerdown', e => {
      if (locked || document.pointerLockElement === cv) return;
      pointerDown = true; lastPX = e.clientX; lastPY = e.clientY;
    });
    window.addEventListener('pointerup', () => { pointerDown = false; });
    window.addEventListener('pointermove', e => {
      if (!pointerDown || locked || document.pointerLockElement === cv) return;
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
  }

  function clearKeys() { keys = Object.create(null); }

  function setLocked(v) {
    locked = v;
    if (v) {
      clearKeys(); pointerDown = false;
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
    if (keys['w'] || keys['arrowup']) dir.add(fwd);
    if (keys['s'] || keys['arrowdown']) dir.sub(fwd);
    if (keys['d'] || keys['arrowright']) dir.add(right);
    if (keys['a'] || keys['arrowleft']) dir.sub(right);

    const speed = 16;
    if (dir.lengthSq() > 0) dir.normalize();
    const targetVel = dir.multiplyScalar(speed);
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
    if (keys[' '] && onGround) { vy = 9.6; onGround = false; }
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
        limbs.arms[0].rotation.z = -0.12 - Math.sin(elapsed * 1.1) * 0.02 * idle;
        limbs.arms[1].rotation.z = 0.12 + Math.sin(elapsed * 1.1) * 0.02 * idle;
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
