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
  let primaryHandler = null;   // left-mouse attack callback (set by game.js)
  let nodes = [];
  let zoneNow = 'A';
  let elapsed = 0;
  const colliders = [];
  const nodeMeshes = new Map();
  let sky = null, rim = null, fireflies = null, ffBase = null;

  /* ============ combat / reward loop state ============ */
  const enemies = [];                 // active enemy records
  const fx = [];                      // transient visual effects
  let shakeT = 0, shakeAmp = 0;       // camera shake on impacts
  let dustTimer = 0;                  // footstep dust cadence
  let attackTrail = null;             // weapon trail emitter {t,dur,color}
  let weaponGroup = null;             // current weapon model attached to hand
  let weaponId = 'sword';
  let charId = 'lyra';
  let skinId = 'default';
  let attackAnim = null;              // { t, dur, style } active attack pose
  let combatHooks = { onHit: null, onKill: null, onHurt: null };  // set by game.js
  let combatEnabled = false;
  let charMats = null;                // character material set for live re-skinning
  let skirtGrpRef = null;             // skirt group — hidden for male characters

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
  function animeToonMaterial(options) {
    const source = options || {};
    const params = Object.assign({}, source);
    const rimColor = new THREE.Color(params.rimColor == null ? 0xbfe8ff : params.rimColor);
    const rimStrength = params.rimStrength == null ? 0.24 : params.rimStrength;
    const fogBase = params.fogBase == null ? 7.0 : params.fogBase;
    const fogFalloff = params.fogFalloff == null ? 0.055 : params.fogFalloff;
    const wind = !!params.wind;
    const flatShading = !!params.flatShading;
    delete params.rimColor;
    delete params.rimStrength;
    delete params.fogBase;
    delete params.fogFalloff;
    delete params.wind;
    delete params.flatShading;
    if (!params.gradientMap) params.gradientMap = TOON;

    const material = new THREE.MeshToonMaterial(params);
    material.flatShading = flatShading;
    material.userData.windTime = wind ? { value: 0 } : null;
    material.onBeforeCompile = function (shader) {
      shader.uniforms.uAnimeRimColor = { value: rimColor };
      shader.uniforms.uAnimeRimStrength = { value: rimStrength };
      shader.uniforms.uAnimeFogBase = { value: fogBase };
      shader.uniforms.uAnimeFogFalloff = { value: fogFalloff };
      if (wind) shader.uniforms.uAnimeWindTime = material.userData.windTime;

      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'varying float vAnimeWorldY;\n' +
        (wind ? 'uniform float uAnimeWindTime;\n' : '') +
        'void main() {'
      );
      if (wind) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          [
            'vec3 transformed = vec3( position );',
            '#ifdef USE_INSTANCING',
            '  float animeBlade = smoothstep( 0.0, 0.78, position.y );',
            '  vec3 animeRoot = instanceMatrix[ 3 ].xyz;',
            '  float animeWave = sin( uAnimeWindTime * 1.85 + animeRoot.x * 0.19 + animeRoot.z * 0.13 );',
            '  float animeGust = sin( uAnimeWindTime * 0.73 + animeRoot.x * 0.047 - animeRoot.z * 0.061 );',
            '  transformed.x += ( animeWave * 0.12 + animeGust * 0.07 ) * animeBlade * animeBlade;',
            '  transformed.z += ( animeGust * 0.10 - animeWave * 0.04 ) * animeBlade * animeBlade;',
            '#endif'
          ].join('\n')
        );
      }
      shader.vertexShader = shader.vertexShader.replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\n' +
        'vec4 animeLocalPosition = vec4( transformed, 1.0 );\n' +
        '#ifdef USE_INSTANCING\n' +
        '  animeLocalPosition = instanceMatrix * animeLocalPosition;\n' +
        '#endif\n' +
        'vAnimeWorldY = ( modelMatrix * animeLocalPosition ).y;'
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'uniform vec3 uAnimeRimColor;\n' +
        'uniform float uAnimeRimStrength;\n' +
        'uniform float uAnimeFogBase;\n' +
        'uniform float uAnimeFogFalloff;\n' +
        'varying float vAnimeWorldY;\n' +
        'void main() {'
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        [
          'float animeRim = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), 2.4 );',
          'gl_FragColor.rgb += uAnimeRimColor * animeRim * uAnimeRimStrength;',
          '#include <tonemapping_fragment>'
        ].join('\n')
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        [
          '#ifdef USE_FOG',
          '  float animeHeightDensity = exp( clamp( ( uAnimeFogBase - vAnimeWorldY ) * uAnimeFogFalloff, -1.5, 2.2 ) );',
          '  float animeFogFactor = 1.0 - exp( -fogDensity * fogDensity * fogDepth * fogDepth * animeHeightDensity );',
          '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, saturate( animeFogFactor ) );',
          '#endif'
        ].join('\n')
      );
      material.userData.shader = shader;
    };
    material.customProgramCacheKey = function () { return 'anime-toon-height-fog-rim-' + (wind ? 'wind' : 'still'); };
    return material;
  }

  function toonMat(color, emissive, options) {
    const params = Object.assign({ color: color, gradientMap: TOON }, options || {});
    if (emissive) {
      params.emissive = emissive;
      params.emissiveIntensity = 0.55;
    }
    return animeToonMaterial(params);
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
        horizon: { value: new THREE.Color(ZONES.A.skyBot).lerp(new THREE.Color(ZONES.A.skyTop), 0.16) },
        bot: { value: new THREE.Color(ZONES.A.skyBot) },
        sunColor: { value: new THREE.Color(0xffe7b0) }
      },
      vertexShader: 'varying vec3 vSkyDir; void main(){ vSkyDir = position; vec4 wp = modelMatrix * vec4(position,1.0); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: [
        'uniform vec3 top;',
        'uniform vec3 horizon;',
        'uniform vec3 bot;',
        'uniform vec3 sunColor;',
        'varying vec3 vSkyDir;',
        'void main(){',
        '  vec3 d = normalize(vSkyDir);',
        '  float lower = smoothstep(-0.34, 0.06, d.y);',
        '  float upper = smoothstep(-0.04, 0.82, d.y);',
        '  vec3 col = mix(bot, horizon, lower);',
        '  col = mix(col, top, pow(upper, 0.72));',
        '  float haze = 1.0 - smoothstep(0.0, 0.22, abs(d.y));',
        '  col += horizon * haze * 0.12;',
        '  float sun = pow(max(dot(d, normalize(vec3(-0.42, 0.62, 0.34))), 0.0), 420.0);',
        '  float glow = pow(max(dot(d, normalize(vec3(-0.42, 0.62, 0.34))), 0.0), 18.0);',
        '  col += sunColor * (sun * 1.8 + glow * 0.16);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n'),
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
    const mat = animeToonMaterial({
      color: 0xffffff, vertexColors: true, map: groundTex,
      bumpMap: groundBump, bumpScale: 0.18, rimStrength: 0.08
    });
    terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    scene.add(terrain);

    const wgeo = new THREE.PlaneGeometry(420, 420, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = animeToonMaterial({
      color: 0x3d90aa, emissive: 0x123f58, emissiveIntensity: 0.18,
      transparent: true, opacity: 0.52, rimColor: 0xd6fbff, rimStrength: 0.38
    });
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
    const trunkMat = toonMat(0x5a4432, null, { rimStrength: 0.12 });
    const leafGeo = new THREE.ConeGeometry(2.6, 6.4, 7);
    const leafMat = toonMat(0x3f7a46, null, { rimColor: 0xb8e8b6, rimStrength: 0.2 });
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
    const rockMat = animeToonMaterial({
      color: 0xffffff, map: rockTex, flatShading: true, rimStrength: 0.13
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
    const shMat = animeToonMaterial({
      color: 0x5330c9, emissive: 0x2a1177, emissiveIntensity: 1.15,
      flatShading: true, rimColor: 0xc9bcff, rimStrength: 0.48
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
    const gGeo = new THREE.ConeGeometry(0.11, 0.78, 3, 4);
    gGeo.translate(0, 0.39, 0);
    const gMat = animeToonMaterial({
      color: 0xffffff, flatShading: true, side: THREE.DoubleSide,
      rimColor: 0xd8ffd0, rimStrength: 0.2, wind: true
    });
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
    grass.frustumCulled = false;
    scene.userData.grassWindTime = gMat.userData.windTime;
    scene.add(grass);

    /* wildflowers */
    const flN = 240;
    const fGeo = new THREE.SphereGeometry(0.10, 6, 5);
    const fMat = animeToonMaterial({ color: 0xffffff, emissive: 0x222222, emissiveIntensity: 0.15, rimStrength: 0.28 });
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

      const crysMat = animeToonMaterial({
        color: 0x4c5c64, emissive: 0x0d2a2c, emissiveIntensity: 0.4,
        transparent: true, opacity: 0.9, rimColor: 0x9ff2ea, rimStrength: 0.38
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
          toonMat(0x3b4a63)
        );
        wall.position.y = 1.6; wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(5.2, 2.6, 4),
          toonMat(0x27405c)
        );
        roof.position.y = 4.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 2.2, 0.25),
          toonMat(0x8a5a2b)
        );
        door.position.set(0, 1.1, 2.62); g.add(door);
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(2.8, 1.15, 0.2),
          animeToonMaterial({ color: 0x5aa8e0, emissive: 0x1b5c85, emissiveIntensity: 0.45 })
        );
        sign.position.set(0, 3.55, 2.7); g.add(sign);
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.18, 0.1),
          animeToonMaterial({ color: 0xe8f4ff, emissive: 0x9fd8ff, emissiveIntensity: 0.5 })
        );
        stripe.position.set(0, 3.55, 2.82); g.add(stripe);
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 3.2, 6),
          toonMat(0x9aa8b8)
        );
        pole.position.set(3.1, 3.2, 2.2); g.add(pole);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 0.9),
          toonMat(0x6fb8e8, null, { side: THREE.DoubleSide })
        );
        flag.position.set(3.85, 4.2, 2.2); g.add(flag);
      } else if (n.type === 'shop') {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(4.2, 1.2, 2.4),
          toonMat(0x7a5433)
        );
        counter.position.y = 0.6; counter.castShadow = true; g.add(counter);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(4.8, 0.22, 3.0),
          toonMat(0xd2691e)
        );
        roof.position.set(0, 3.0, 0); roof.rotation.x = 0.12; roof.castShadow = true; g.add(roof);
        [[-1.9, -1.3], [1.9, -1.3], [-1.9, 1.3], [1.9, 1.3]].forEach(function (p) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.1, 3.0, 6),
            toonMat(0x8a6a45)
          );
          post.position.set(p[0], 1.5, p[1]); g.add(post);
        });
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, 1.0, 1.0),
          toonMat(0x9a7040)
        );
        crate.position.set(1.5, 0.5, 1.9); crate.rotation.y = 0.4; g.add(crate);
        const crate2 = crate.clone(); crate2.position.set(0.55, 0.5, 2.1); crate2.scale.setScalar(0.8); g.add(crate2);
        const lamp = new THREE.PointLight(0xffb36b, 0.9, 14, 2);
        lamp.position.set(0, 2.4, 0); g.add(lamp);
      } else {
        const cr = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.35, 0),
          animeToonMaterial({ color: 0xb0a2ff, emissive: 0x6344d8, emissiveIntensity: 1.1, rimColor: 0xe1dbff, rimStrength: 0.5 })
        );
        cr.position.y = 1.9; cr.scale.y = 1.5; g.add(cr);
        const pl = new THREE.PointLight(0x8b6dff, 0.8, 16, 2);
        pl.position.y = 2.2; g.add(pl);
      }

      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.62, 0),
        animeToonMaterial({ color: color, emissive: color, emissiveIntensity: 1.3, transparent: true, opacity: 0.95, rimStrength: 0.46 })
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
    const m = animeToonMaterial({
      color: plS(hex), gradientMap: ramp,
      rimColor: opt && opt.rimColor ? opt.rimColor : 0xcdeaff,
      rimStrength: opt && opt.rimStrength != null ? opt.rimStrength : 0.32
    });
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
    g.fillStyle = '#E9BC98'; g.fillRect(0, 0, W, H);

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
      ig.addColorStop(0, '#4A2A1D'); ig.addColorStop(0.58, '#8A5A32'); ig.addColorStop(1, '#D2A45C');
      g.beginPath(); g.arc(52, 52, 30, 0, Math.PI * 2); g.fillStyle = ig; g.fill();
      g.restore();

      /* 瞳孔 */
      g.beginPath(); g.arc(52, 56, 15, 0, Math.PI * 2); g.fillStyle = '#24150F'; g.fill();
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
      coat: 0x343A4D, coatDark: 0x202638, tights: 0x382D2D,
      skirt: 0x30374A, skirtIn: 0x171B28,
      cream: 0xF0E8D9, creamDim: 0xCFC1AA,
      skin: 0xE9BC98, skinDim: 0xC98F70,
      hair: 0x5A3828, hairDark: 0x342018,
      leather: 0x6F4933, leatherDark: 0x3A261D, sole: 0x201713,
      gold: 0xC28A36, goldLight: 0xE4BD69,
      scarf: 0x343A4D, silver: 0xBFC5C8, red: 0xA84335, bedroll: 0xA88764
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
      leatherDark: plMat(C.leatherDark, G2),
      sole: plMat(C.sole, G2),
      gold: plMat(C.gold, G2),
      goldLight: plMat(C.goldLight, G2),
      scarf: plMat(C.scarf, G3, { double: true }),
      silver: plMat(C.silver, G2),
      red: plMat(C.red, G3, { double: true }),
      bedroll: plMat(C.bedroll, G3)
    };

    /* Mark character materials for live re-skinning (we clone so world objects are unaffected). */
    MAT.coat.userData = { role: 'coat', orig: C.coat };
    MAT.coatDark.userData = { role: 'coatDark', orig: C.coatDark };
    MAT.skirt.userData = { role: 'skirt', orig: C.skirt };
    MAT.scarf.userData = { role: 'scarf', orig: C.scarf };
    MAT.hair.userData = { role: 'hair', orig: C.hair };
    MAT.hairDark.userData = { role: 'hairDark', orig: C.hairDark };
    MAT.tights.userData = { role: 'tights', orig: C.tights };
    Object.keys(MAT).forEach(k => { if (!MAT[k].userData.role) MAT[k].userData = { role: 'fixed' }; });
    charMats = MAT;   // module-level reference for live re-skinning

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
      const upperLeg = new THREE.Group();
      upperLeg.position.set(R.hipPivX * sd, P.yHip, 0);

      put(upperLeg, plMerge([
        { g: new THREE.SphereGeometry(0.122, 12, 10) },                                    // 髖球
        { g: new THREE.CylinderGeometry(0.118, 0.100, 0.56, 12), m: plM(0, -0.29, 0) },    // 大腿
        { g: new THREE.SphereGeometry(0.098, 10, 8), m: plM(0, -0.56, 0) }                 // 膝球
      ]), MAT.tights);

      const lowerLeg = new THREE.Group();
      lowerLeg.position.set(0, -0.56, 0);
      upperLeg.add(lowerLeg);
      put(lowerLeg, plMerge([
        { g: new THREE.CylinderGeometry(0.095, 0.082, 0.48, 12), m: plM(0, -0.24, 0) }     // dark travel tights
      ]), MAT.tights);

      put(lowerLeg, plMerge([
        { g: new THREE.CylinderGeometry(0.122, 0.114, 0.10, 14), m: plM(0, -0.46, 0) },    // 靴口翻邊
        { g: new THREE.CylinderGeometry(0.114, 0.100, 0.31, 14), m: plM(0, -0.655, 0) }    // 靴筒
      ]), MAT.leather);

      const foot = new THREE.Group();
      foot.position.set(0, -0.785, 0.055);
      lowerLeg.add(foot);
      put(foot, plMerge([
        { g: new THREE.SphereGeometry(0.10, 12, 10),
          m: plM(0, 0, 0, 0, 0, 0, 0.98, 0.85, 1.50) },                                   // 圓鞋頭
        { g: new THREE.CylinderGeometry(0.108, 0.104, 0.022, 14),
          m: plM(0, -0.070, -0.035, 0, 0, 0, 1, 1, 1.68) }
      ]), MAT.leather);
      put(foot, plMerge([
        { g: new THREE.CylinderGeometry(0.104, 0.098, 0.075, 14),
          m: plM(0, -0.1175, -0.035, 0, 0, 0, 1, 1, 1.72) }                               // 鞋底
      ]), MAT.sole);

      put(lowerLeg, plMerge([
        { g: new THREE.TorusGeometry(0.122, 0.013, 8, 36), m: plM(0, -0.415, 0, Math.PI / 2) }
      ]), MAT.leatherDark);

      put(lowerLeg, plMerge([
        { g: new THREE.TorusGeometry(0.117, 0.009, 8, 30, 2.2),
          m: plM(0, -0.50, 0, Math.PI / 2, 0, 0.9) },
        { g: new THREE.TorusGeometry(0.108, 0.008, 8, 30, 2.2),
          m: plM(0, -0.64, 0, Math.PI / 2, 0, 0.9) },
        { g: new THREE.TorusGeometry(0.103, 0.008, 8, 30, 2.2),
          m: plM(0, -0.75, 0, Math.PI / 2, 0, 0.9) }
      ]), MAT.gold);

      upperLeg.userData.lower = lowerLeg;
      upperLeg.userData.foot = foot;
      player.add(upperLeg);
      limbs.legs.push(upperLeg);
    });

    /* ================= 裙（12 褶，§2.7）================= */
    const skirtGrp = new THREE.Group();
    skirtGrpRef = skirtGrp;
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

    const underSkirtGeo = skirtGeo.clone();
    underSkirtGeo.applyMatrix4(new THREE.Matrix4().makeScale(0.92, 1.08, 0.92));
    const underSkirt = put(skirtGrp, underSkirtGeo, MAT.cream);
    underSkirt.position.y = 1.30;

    /* 裙內殼：同幾何 scale 0.985、BackSide、色 ×0.55 → 仰角不透空 */
    const skirtInGeo = skirtGeo.clone();
    skirtInGeo.applyMatrix4(new THREE.Matrix4().makeScale(0.985, 1, 0.985));
    const skirtInner = put(skirtGrp, skirtInGeo, MAT.skirtIn, false);
    skirtInner.position.y = 1.34;

    /* 裙擺 trim：同一套褶位移（amp 固定 0.080） */
    const trimGeo = skirtFold(new THREE.CylinderGeometry(0.404, 0.408, 0.035, SEG * 2, 1, true),
      function () { return 0.018; });
    const skirtTrim = put(skirtGrp, trimGeo, MAT.gold);
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

    const coatMesh = put(torsoGrp, jacketGeo, MAT.leather);
    put(torsoGrp, hemGeo, MAT.skirt);
    playerBody = torsoGrp;

    const mantleGeo = new THREE.CylinderGeometry(0.305, 0.270, 0.22, 20, 1, true);
    mantleGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.78));
    mantleGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.48, -0.012));
    put(torsoGrp, mantleGeo, MAT.coatDark);

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
      { g: beltGeo, m: plM(0, -0.12, 0) },
      { g: new THREE.BoxGeometry(0.052, 0.56, 0.026), m: plM(-0.105, 0.18, 0.202, 0, 0, -0.24) },
      { g: new THREE.BoxGeometry(0.052, 0.56, 0.026), m: plM(0.105, 0.18, 0.202, 0, 0, 0.24) }
    ]), MAT.leatherDark);

    /* 金屬件：腰帶六角扣 + 扣芯 + 左胸臂章（臂章貼在橢圓胸面上） */
    put(torsoGrp, plMerge([
      { g: new THREE.CylinderGeometry(0.058, 0.058, 0.022, 6), m: plM(0, -0.12, 0.182, Math.PI / 2) },
      { g: new THREE.CylinderGeometry(0.026, 0.026, 0.026, 8), m: plM(0, -0.12, 0.189, Math.PI / 2) },
      { g: new THREE.CylinderGeometry(0.058, 0.058, 0.016, 8), m: plM(-0.148, 0.32, 0.166, Math.PI / 2) },
      { g: new THREE.SphereGeometry(0.018, 8, 6), m: plM(0, 0.40, 0.210) },
      { g: new THREE.SphereGeometry(0.018, 8, 6), m: plM(0, 0.28, 0.214) },
      { g: new THREE.SphereGeometry(0.018, 8, 6), m: plM(0, 0.16, 0.215) }
    ]), MAT.gold);

    /* ================= 手臂（pivot 在肩，§2.8）================= */
    limbs.arms = [];
    [-1, 1].forEach(function (sd) {
      const upperArm = new THREE.Group();
      upperArm.position.set(R.shoulderPivX * sd, P.yShoulder, 0);
      upperArm.rotation.z = -0.17 * sd;   // 外張角與 movePlayer 的 ±0.17 一致

      put(upperArm, plMerge([
        { g: new THREE.SphereGeometry(0.145, 14, 12), m: plM(0, 0, 0, 0, 0, 0, 1.08, 0.82, 1.0) }
      ]), MAT.coat);
      put(upperArm, plMerge([
        { g: new THREE.SphereGeometry(0.128, 14, 12), m: plM(0, -0.13, 0, 0, 0, 0, 1.0, 1.18, 0.95) },
        { g: new THREE.CylinderGeometry(0.118, 0.094, 0.31, 12), m: plM(0, -0.22, 0) }
      ]), MAT.cream);
      put(upperArm, plMerge([
        { g: new THREE.SphereGeometry(0.092, 10, 8), m: plM(0, -0.36, 0) }
      ]), MAT.skin);

      const lowerArm = new THREE.Group();
      lowerArm.position.set(0, -0.36, 0);
      upperArm.add(lowerArm);
      put(lowerArm, plMerge([
        { g: new THREE.CylinderGeometry(0.088, 0.078, 0.23, 12), m: plM(0, -0.115, 0) }
      ]), MAT.skin);

      put(upperArm, plMerge([
        { g: new THREE.TorusGeometry(0.134, 0.011, 8, 36), m: plM(0, 0.012, 0, Math.PI / 2) },    // 袖口滾邊
      ]), MAT.cream);
      put(lowerArm, plMerge([
        { g: new THREE.CylinderGeometry(0.090, 0.098, 0.13, 12), m: plM(0, -0.265, 0) },
        { g: new THREE.TorusGeometry(0.098, 0.010, 8, 32), m: plM(0, -0.205, 0, Math.PI / 2) }
      ]), MAT.cream);

      const hand = new THREE.Group();
      hand.position.set(0, -0.375, 0.006);
      lowerArm.add(hand);
      put(hand, plMerge([
        { g: new THREE.SphereGeometry(0.072, 12, 10), m: plM(0, 0, 0, 0, 0, 0, 0.86, 1.12, 0.80) }, // 手
        { g: new THREE.SphereGeometry(0.028, 8, 6),
          m: plM(0.030 * sd, 0.035, 0.036, 0, 0, -0.5 * sd, 0.85, 1.35, 0.85) }                   // 拇指
      ]), MAT.leatherDark);

      const weaponMount = new THREE.Group();
      weaponMount.position.set(0, 0, 0);
      hand.add(weaponMount);
      upperArm.userData.lower = lowerArm;
      upperArm.userData.hand = hand;
      upperArm.userData.weaponMount = weaponMount;
      player.add(upperArm);
      limbs.arms.push(upperArm);
    });

    /* ================= 頭（§3、§4）================= */
    const headGrp = new THREE.Group();
    headGrp.position.set(0, P.yHeadC - P.yTorsoPiv, 0);
    torsoGrp.add(headGrp);
    limbs.head = headGrp;

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
    put(headGrp, skullGeo, animeToonMaterial({
      color: 0xffffff, map: makeFaceTexture(), gradientMap: G4,
      rimColor: 0xffe8d7, rimStrength: 0.28
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

    /* Loose layered strands frame the face and blend into the travel braids. */
    [-1, 1].forEach(function (sd) {
      [[0.288, 0.082, 0.070, 0.40, -0.05],
       [0.320, -0.075, 0.050, 0.34, -0.02],
       [0.255, -0.035, 0.075, 0.31, 0.06]].forEach(function (s) {
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

    const braidRoot = new THREE.Group();
    braidRoot.position.set(0.15, 0.105, -0.29);
    braidRoot.rotation.x = 0.58;
    headGrp.add(braidRoot);
    limbs.braids = [];
    let braidParent = braidRoot;
    for (let bi = 0; bi < 6; bi++) {
      const joint = new THREE.Group();
      joint.position.y = bi ? -0.115 : 0;
      const radius = 0.092 - bi * 0.008;
      const bead = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), bi % 2 ? MAT.hairDark : MAT.hair);
      bead.position.y = -0.066;
      bead.scale.set(0.88, 1.22, 0.92);
      joint.add(bead);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.76, 0.009, 6, 12), MAT.gold);
      tie.position.set(0, -0.115, 0);
      tie.rotation.x = Math.PI / 2;
      joint.add(tie);
      braidParent.add(joint);
      limbs.braids.push(joint);
      braidParent = joint;
    }

    /* ================= 領巾（limbs.cape，pivot 在領口，§2.11）================= */
    const cape = new THREE.Group();
    cape.position.set(0, 2.34 - P.yTorsoPiv, -0.16);
    limbs.cape = cape;
    torsoGrp.add(cape);

    /* 圍頸兩圈：半徑要大於立領，否則整條領巾被領子吃掉 */
    const band1 = new THREE.CylinderGeometry(0.126, 0.134, 0.085, 16, 1, true);
    band1.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.020, 0.15));
    const band2 = new THREE.CylinderGeometry(0.126, 0.140, 0.080, 16, 1, true);
    band2.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.040, 0.15));
    put(cape, plMerge([{ g: band1 }, { g: band2 }]), MAT.scarf);

    const capeSegments = [];
    const capeLengths = [0.36, 0.40, 0.38];
    const capeWidths = [[0.62, 0.58], [0.58, 0.48], [0.48, 0.34]];
    let capeParent = cape;
    capeLengths.forEach(function (len, i) {
      const joint = new THREE.Group();
      joint.position.set(0, i ? -capeLengths[i - 1] : -0.07, i ? -0.025 : -0.02);
      joint.rotation.x = 0.10 + i * 0.07;
      const panel = new THREE.PlaneGeometry(1, len, 4, 2);
      const panelPos = panel.attributes.position;
      for (let vi = 0; vi < panelPos.count; vi++) {
        const localY = panelPos.getY(vi);
        const t = (len / 2 - localY) / len;
        const width = capeWidths[i][0] + (capeWidths[i][1] - capeWidths[i][0]) * t;
        const fold = Math.cos(panelPos.getX(vi) * Math.PI * 4) * 0.014;
        panelPos.setXYZ(vi, panelPos.getX(vi) * width, localY - len / 2, fold);
      }
      panelPos.needsUpdate = true;
      panel.computeVertexNormals();
      put(joint, panel, MAT.coat);
      const embroidery = new THREE.Mesh(new THREE.PlaneGeometry(0.68, len * 0.80, 2, 2), MAT.gold);
      embroidery.position.set(0, -len * 0.58, 0.009);
      embroidery.scale.x = capeWidths[i][1] * 0.78;
      joint.add(embroidery);
      capeParent.add(joint);
      capeSegments.push(joint);
      capeParent = joint;
    });
    cape.userData.segments = capeSegments;

    const backpack = new THREE.Group();
    backpack.position.set(0, 0.12, -0.245);
    backpack.rotation.x = -0.10;
    torsoGrp.add(backpack);
    const packBody = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.27), MAT.leather);
    packBody.position.set(0, 0.16, -0.02);
    backpack.add(packBody);
    const packFlap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.20, 0.035), MAT.bedroll);
    packFlap.position.set(0, 0.42, 0.128);
    backpack.add(packFlap);
    [-1, 1].forEach(function (side) {
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.25, 0.16), MAT.leather);
      pocket.position.set(side * 0.22, 0.03, 0.12);
      backpack.add(pocket);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.065, 0.02), MAT.gold);
      buckle.position.set(side * 0.22, 0.075, 0.215);
      backpack.add(buckle);
    });
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.64, 12), MAT.bedroll);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.53, -0.035);
    backpack.add(roll);
    [-1, 1].forEach(function (side) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.022, 6, 18), MAT.leatherDark);
      strap.rotation.y = Math.PI / 2;
      strap.position.set(side * 0.25, 0.53, -0.035);
      backpack.add(strap);
    });
    const packStraps = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.055, 0.03), MAT.gold);
    packStraps.position.set(0, -0.06, 0.15);
    backpack.add(packStraps);
    limbs.backpack = backpack;

    const backMount = new THREE.Group();
    backMount.position.set(0.34, 0.56, -0.19);
    backMount.rotation.x = -0.16;
    torsoGrp.add(backMount);
    const backSword = buildWeapon('sword');
    backSword.position.set(0, -0.03, -0.08);
    backSword.rotation.set(-0.10, 0.08, 0.12);
    backSword.scale.setScalar(0.78);
    backMount.add(backSword);
    const ribbonMat = MAT.red;
    [-1, 1].forEach(function (side) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.42, 1, 5), ribbonMat);
      ribbon.position.set(side * 0.07, 0.72, -0.02);
      ribbon.rotation.z = side * -0.24;
      backMount.add(ribbon);
    });
    limbs.backMount = backMount;

    const lantern = new THREE.Group();
    lantern.position.set(0.39, -0.12, -0.04);
    const lanternBody = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 8), MAT.gold);
    lanternBody.position.y = -0.085;
    lantern.add(lanternBody);
    const lanternGlass = new THREE.Mesh(new THREE.SphereGeometry(0.047, 8, 8), animeToonMaterial({
      color: 0xffcf74, emissive: 0xff9b42, emissiveIntensity: 0.85,
      rimColor: 0xffe6a8, rimStrength: 0.6
    }));
    lanternGlass.position.y = -0.085;
    lantern.add(lanternGlass);
    torsoGrp.add(lantern);

    /* ================= 左手寶珠（玩法道具；右手留給武器）================= */
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 14, 12),
      animeToonMaterial({
        color: 0xc8fff0, emissive: 0x35e0b0, emissiveIntensity: 1.5,
        rimColor: 0xffffff, rimStrength: 0.65
      })
    );
    orb.position.set(-0.02, 0, 0.085);
    limbs.arms[0].userData.hand.add(orb);
    const orbLight = new THREE.PointLight(0x54e3b0, 0.8, 7, 2);
    orbLight.position.copy(orb.position);
    limbs.arms[0].userData.hand.add(orbLight);

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

    rim = new THREE.DirectionalLight(0x9fd4ff, 0.34);
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
  function setPrimaryHandler(fn) { primaryHandler = fn; }

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

    /* Left mouse button = primary attack (Genshin/CS-style), active only while
       pointer-locked so menu clicks and the initial lock click are safe. */
    cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== cv) return;
      if (primaryHandler) primaryHandler();
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
    if ((keys[' '] || touchJump) && onGround) { vy = 9.6; onGround = false; touchJump = false; if (window.SFX) SFX.jump(); }
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
    /* footstep dust while running on the ground */
    dustTimer -= dt;
    if (spd > 4 && onGround && dustTimer <= 0 && combatEnabled) {
      dustTimer = 0.17;
      addFxDust(player.position.x, player.position.y, player.position.z);
    }
    if (limbs.legs.length === 2) {
      if (onGround) {
        limbs.legs.forEach(function (leg, i) {
          const stride = Math.sin(walkPhase + i * Math.PI);
          const knee = leg.userData.lower;
          const foot = leg.userData.foot;
          leg.rotation.x = stride * amp;
          knee.rotation.x = Math.max(0, -stride) * amp * 0.82;
          foot.rotation.x = -leg.rotation.x * 0.20 - knee.rotation.x * 0.28;
        });
        limbs.arms[0].rotation.x = -Math.sin(walkPhase) * amp * 0.75;
        limbs.arms[1].rotation.x = Math.sin(walkPhase) * amp * 0.75;
        limbs.arms.forEach(function (arm) {
          arm.userData.lower.rotation.x = -0.12 - Math.max(0, -arm.rotation.x) * 0.25;
          arm.userData.hand.rotation.z = 0;
        });
        if (limbs.torso) limbs.torso.position.y = 1.7 + Math.abs(Math.sin(walkPhase)) * 0.035 * amp;
        if (limbs.torso) limbs.torso.rotation.z = Math.sin(walkPhase) * 0.02 * amp;
      } else {
        limbs.legs[0].rotation.x = 0.55;
        limbs.legs[1].rotation.x = -0.25;
        limbs.legs[0].userData.lower.rotation.x = 0.32;
        limbs.legs[1].userData.lower.rotation.x = 0.68;
        limbs.legs[0].userData.foot.rotation.x = -0.16;
        limbs.legs[1].userData.foot.rotation.x = -0.28;
        limbs.arms[0].rotation.x = -0.7;
        limbs.arms[1].rotation.x = -0.35;
        limbs.arms[0].userData.lower.rotation.x = -0.42;
        limbs.arms[1].userData.lower.rotation.x = -0.28;
        if (limbs.torso) limbs.torso.position.y = 1.7;
      }
      if (limbs.cape) {
        limbs.cape.rotation.x = 0;
        limbs.cape.rotation.z = Math.sin(walkPhase * 0.8) * 0.018;
        const capeSegments = limbs.cape.userData.segments || [];
        capeSegments.forEach(function (segment, i) {
          const flow = 0.10 + i * 0.07 + amp * (0.18 + i * 0.09);
          segment.rotation.x = flow + Math.sin(elapsed * 4.2 - i * 0.72) * (0.025 + amp * 0.035);
          segment.rotation.z = Math.sin(elapsed * 2.1 - i * 0.55) * (0.012 + amp * 0.018);
        });
      }
      if (limbs.torso) {
        const idle = Math.max(0, 1 - spd / 5);
        limbs.torso.scale.y = 1 + Math.sin(elapsed * 1.7) * 0.013 * idle;
        limbs.arms[0].rotation.z = -0.17 - Math.sin(elapsed * 1.1) * 0.02 * idle;
        limbs.arms[1].rotation.z = 0.17 + Math.sin(elapsed * 1.1) * 0.02 * idle;
        if (limbs.head) {
          limbs.head.rotation.y = Math.sin(elapsed * 0.52) * 0.035 * idle;
          limbs.head.rotation.z = -limbs.torso.rotation.z * 0.45;
        }
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
    /* impact camera shake */
    if (shakeT > 0) {
      shakeT -= dtOrInit === 1 ? 0 : dtOrInit;
      const a = shakeAmp * Math.max(0, shakeT) * 2.2;
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.y += (Math.random() - 0.5) * a * 0.6;
      if (shakeT <= 0) shakeAmp = 0;
    }

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
      sky.material.uniforms.horizon.value.lerp(
        new THREE.Color(Z.skyBot).lerp(new THREE.Color(Z.skyTop), 0.16), lerp
      );
    }
    sun.target.position.set(player.position.x, player.position.y, player.position.z);
    sun.position.set(player.position.x + 70, player.position.y + 120, player.position.z + 40);
    rim.position.set(player.position.x - 70, player.position.y + 48, player.position.z - 65);
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

  /* ==================================================================
     COMBAT MODULE — weapons, enemies, effects, animation, AI
     All models are original procedural geometry in the existing toon style.
     ================================================================== */

  /* ---------- weapon model factory (returns a Group) ---------- */
  function buildWeapon(id) {
    const def = (typeof WEAPONS !== 'undefined') ? WEAPONS.find(w => w.id === id) : null;
    const w = def || { type: 'sword', color: 0xdfeaf2, glow: 0x8ff0c8 };
    const steel = plMat(w.color, plRamps().G2);
    const glow = new THREE.MeshBasicMaterial({ color: w.glow });
    const grip = plMat(0x40322c, plRamps().G2);
    const gold = plMat(0xe8c46a, plRamps().G2);
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rx, ry, rz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      g.add(m); return m;
    };
    const t = w.type;
    if (t === 'sword' || t === 'great') {
      const L = t === 'great' ? 1.15 : 0.82, W = t === 'great' ? 0.13 : 0.085;
      add(new THREE.CylinderGeometry(0.028, 0.032, 0.26, 8), grip, 0, -0.13, 0);           // handle
      add(new THREE.BoxGeometry(W * 3.4, 0.05, 0.06), gold, 0, 0.01, 0);                    // crossguard
      const blade = new THREE.BoxGeometry(W, L, 0.035);
      add(blade, steel, 0, 0.03 + L / 2, 0);
      add(new THREE.ConeGeometry(W * 0.72, 0.16, 4), steel, 0, 0.03 + L + 0.08, 0);         // tip
      add(new THREE.BoxGeometry(0.012, L * 0.92, 0.008), glow, 0, 0.03 + L / 2, 0.021);     // rune
    } else if (t === 'staff') {
      add(new THREE.CylinderGeometry(0.026, 0.030, 1.55, 8), grip, 0, 0.30, 0);
      add(new THREE.TorusGeometry(0.13, 0.022, 8, 20), gold, 0, 1.06, 0);
      add(new THREE.IcosahedronGeometry(0.10, 0), glow, 0, 1.06, 0);
      add(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 1.06, 0);
    } else if (t === 'bow') {
      const bow = add(new THREE.TorusGeometry(0.42, 0.028, 8, 24, Math.PI * 1.15), gold, 0, 0.25, 0, 0, 0, Math.PI * 0.42);
      bow.scale.set(0.55, 1, 1);
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.82, 5), glow, 0.10, 0.25, 0);          // string
      add(new THREE.CylinderGeometry(0.028, 0.028, 0.24, 8), grip, 0, 0.10, 0);
    } else if (t === 'daggers') {
      [-1, 1].forEach(sd => {
        add(new THREE.CylinderGeometry(0.020, 0.024, 0.18, 8), grip, sd * 0.07, -0.09, 0);
        add(new THREE.BoxGeometry(0.05, 0.42, 0.03), steel, sd * 0.07, 0.21, 0, 0, 0, sd * 0.12);
        add(new THREE.BoxGeometry(0.010, 0.38, 0.008), glow, sd * 0.07, 0.21, 0.018, 0, 0, sd * 0.12);
      });
    }
    g.userData.type = t;
    g.userData.kind = 'weapon';
    g.userData.tipY = t === 'staff' ? 1.06 : t === 'bow' ? 0.55 : t === 'daggers' ? 0.42 : 1.0;
    return g;
  }

  /* ---------- attach / swap weapon on right hand ---------- */
  function equipWeapon(id) {
    weaponId = id;
    const mount = limbs.arms[1] && limbs.arms[1].userData.weaponMount;
    if (weaponGroup && mount) mount.remove(weaponGroup);
    if (!limbs.arms[1]) return;
    weaponGroup = buildWeapon(id);
    /* Hold at the hand, blade angled UP and OUT so it reads clearly from the
       third-person camera (a downward blade hid behind the skirt/body). */
    weaponGroup.position.set(0.06, 0.035, 0.15);
    weaponGroup.rotation.set(-0.55, 0, -0.28);
    weaponGroup.scale.setScalar(1.05);
    mount.add(weaponGroup);
  }

  /* ---------- apply a colour skin + gender/role tint to the character ---------- */
  function applyCharacterLook(charIdArg, skinIdArg) {
    if (charIdArg) charId = charIdArg;
    if (skinIdArg) skinId = skinIdArg;
    const C = (typeof CHARACTERS !== 'undefined') && CHARACTERS.find(c => c.id === charId);
    if (!C || !player || !charMats) return;
    /* Each character has a signature coat colour; skin overrides it with a themed palette. */
    const palette = {
      default: null,                                  // use character's own colour
      ember:   { coat: 0xC8453A, dark: 0x8A2E28, skirt: 0xE8915A, scarf: 0xF0B44A, hair: 0x5A2A24 },
      tide:    { coat: 0x2F74A8, dark: 0x1D4E78, skirt: 0x5FC8D8, scarf: 0x8FE8F0, hair: 0x244A66 },
      aurora:  { coat: 0x8A5FC0, dark: 0x5E3F8A, skirt: 0xB89AE8, scarf: 0x8FF0D8, hair: 0x6A4A86 },
      nova:    { coat: 0xC9A83A, dark: 0x8C7226, skirt: 0xF0DC7A, scarf: 0xFFF0A0, hair: 0x7A6A30 }
    };
    const pal = palette[skinId] || (palette.default ? palette[palette.default] : null);
    const coat = pal ? pal.coat : C.color;
    const tint = (mat, hex) => { if (mat && mat.color && mat.userData.role !== 'fixed') mat.color.copy(new THREE.Color(plS(hex))); };
    const darken = (hex, f) => {
      const c = new THREE.Color(hex); c.multiplyScalar(f);
      return c.getHex();
    };
    tint(charMats.coat, coat);
    tint(charMats.coatDark, darken(coat, 0.62));
    tint(charMats.skirt, pal ? pal.skirt : (C.gender === 'male' ? darken(coat, 0.8) : C.color));
    tint(charMats.scarf, pal ? pal.scarf : coat);
    tint(charMats.hair, pal ? pal.hair : C.hair);
    tint(charMats.hairDark, darken(pal ? pal.hair : C.hair, 0.7));
    // male characters: broader frame, no skirt (trousers instead), darker tights
    const male = C.gender === 'male';
    if (skirtGrpRef) skirtGrpRef.visible = !male;
    if (charMats.tights) tint(charMats.tights, male ? 0x24303c : (charId === 'lyra' ? 0x382D2D : 0x1B3A46));
    player.scale.set(male ? 1.06 : 1.0, male ? 1.03 : 1.0, male ? 1.06 : 1.0);
    if (limbs.torso && !attackAnim) limbs.torso.scale.x = male ? 1.18 : 1.0;
  }

  /* ---------- enemy model factory (original procedural animals) ---------- */
  function buildEnemy(typeId) {
    const E = (typeof ENEMY_TYPES !== 'undefined') && ENEMY_TYPES.find(e => e.id === typeId);
    const e = E || { color: 0x9b6b4a, scale: 1 };
    const bodyMat = plMat(e.color, plRamps().G4);
    const dark = plMat(0x3a2c28, plRamps().G2);
    const glow = new THREE.MeshBasicMaterial({ color: 0xff6a5a });
    const g = new THREE.Group();
    const legs = [], parts = { legs: legs };
    const add = (geo, mat, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); if (sx) { m.scale.set(sx, sy, sz); m.userData.bs = [sx, sy, sz]; }
      m.castShadow = true; g.add(m); return m;
    };
    if (typeId === 'boar') {
      add(new THREE.SphereGeometry(0.55, 14, 10), bodyMat, 0, 0.62, 0, 1.25, 0.85, 0.95);
      add(new THREE.SphereGeometry(0.34, 12, 10), bodyMat, 0, 0.72, 0.62, 1, 0.9, 0.95);   // head
      add(new THREE.ConeGeometry(0.09, 0.28, 6), dark, -0.18, 0.92, 0.78, 1, 1, 1);        // tusks
      add(new THREE.ConeGeometry(0.09, 0.28, 6), dark, 0.18, 0.92, 0.78, 1, 1, 1);
      [[-0.3, 0.32], [0.3, 0.32], [-0.3, -0.32], [0.3, -0.32]].forEach(function (lp) {
        const leg = add(new THREE.CylinderGeometry(0.06, 0.05, 0.42, 6), dark, lp[0], 0.21, lp[1]);
        legs.push(leg);
      });
      add(new THREE.SphereGeometry(0.07, 8, 6), glow, -0.15, 0.80, 0.88);                 // eyes
      add(new THREE.SphereGeometry(0.07, 8, 6), glow, 0.15, 0.80, 0.88);
      g.userData.height = 1.1;
    } else if (typeId === 'slime') {
      parts.body = add(new THREE.SphereGeometry(0.46, 16, 12), bodyMat, 0, 0.42, 0, 1.1, 0.95, 1.1);
      add(new THREE.SphereGeometry(0.09, 8, 6), glow, -0.18, 0.52, 0.40);
      add(new THREE.SphereGeometry(0.09, 8, 6), glow, 0.18, 0.52, 0.40);
      g.userData.height = 0.9;
    } else { // crab
      parts.body = add(new THREE.SphereGeometry(0.52, 14, 10), bodyMat, 0, 0.52, 0, 1.3, 0.65, 1);
      [-1, 1].forEach(sd => {
        const claw = add(new THREE.SphereGeometry(0.22, 10, 8), bodyMat, sd * 0.62, 0.5, 0.1);
        legs.push(claw);
        add(new THREE.ConeGeometry(0.14, 0.4, 6), dark, sd * 0.78, 0.72, 0.16, 1, 1, 1);
        for (let i = -1; i <= 1; i++) legs.push(add(new THREE.CylinderGeometry(0.04, 0.03, 0.4, 5), dark, sd * 0.5, 0.2, i * 0.3));
      });
      add(new THREE.SphereGeometry(0.07, 8, 6), glow, -0.2, 0.7, 0.45);
      add(new THREE.SphereGeometry(0.07, 8, 6), glow, 0.2, 0.7, 0.45);
      g.userData.height = 0.95;
    }
    g.userData.parts = parts;
    g.scale.setScalar(e.scale || 1);
    return g;
  }

  /* ---------- spawn enemies around fields & roads ---------- */
  function spawnEnemies() {
    enemies.forEach(en => { if (en.group.parent) scene.remove(en.group); });
    enemies.length = 0;
    if (!combatEnabled || typeof ENEMY_TYPES === 'undefined') return;
    const zones = Object.keys(ZONES);
    const N = Math.min(COMBAT_RULES.enemyCap, 16);
    for (let i = 0; i < N; i++) {
      const zone = zones[i % zones.length];
      const Z = ZONES[zone];
      const ang = Math.random() * Math.PI * 2;
      const rad = 12 + Math.random() * 44;
      let x = Z.cx + Math.cos(ang) * rad;
      let z = Z.cz + Math.sin(ang) * rad;
      x = Math.max(-185, Math.min(185, x)); z = Math.max(-185, Math.min(185, z));
      const roll = Math.random();
      const type = ENEMY_TYPES[roll < 0.55 ? 0 : roll < 0.82 ? 1 : 2];
      const group = buildEnemy(type.id);
      group.position.set(x, heightAt(x, z), z);
      scene.add(group);
      enemies.push({
        id: 'e' + i, type: type, group: group,
        hp: type.hp, maxHp: type.hp, alive: true,
        respawn: 0, hitFlash: 0, bob: Math.random() * 6.28,
        homeX: x, homeZ: z, state: 'idle', atkCd: 0
      });
    }
  }

  /* ---------- transient effects ---------- */
  function addFxRing(x, y, z, color, maxR, dur) {
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.34, 24), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.08, z);
    scene.add(mesh);
    fx.push({ mesh: mesh, t: 0, dur: dur || 0.4, maxR: maxR || 2, kind: 'ring' });
  }
  function addFxSlash(x, y, z, yawAng, color) {
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.09, 6, 20, Math.PI * 1.1), mat);
    mesh.position.set(x, y + 1.4, z);
    mesh.rotation.set(0, yawAng, -0.4);
    scene.add(mesh);
    fx.push({ mesh: mesh, t: 0, dur: 0.28, kind: 'slash' });
  }
  function addFxSpark(x, y, z, color) {
    const mat = new THREE.SpriteMaterial({ map: softDot(64), color: color, transparent: true, opacity: 1, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y + 1.1, z); sp.scale.setScalar(0.9);
    scene.add(sp);
    fx.push({ mesh: sp, t: 0, dur: 0.45, kind: 'spark' });
  }
  function addFxDust(x, y, z) {
    const mat = new THREE.SpriteMaterial({ map: softDot(64), color: 0xcfc8b8, transparent: true, opacity: 0.5, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.15, z + (Math.random() - 0.5) * 0.5);
    sp.scale.setScalar(0.55);
    scene.add(sp);
    fx.push({ mesh: sp, t: 0, dur: 0.7, kind: 'dust' });
  }
  function addFxTrail(x, y, z, color) {
    const mat = new THREE.SpriteMaterial({ map: softDot(64), color: color, transparent: true, opacity: 0.75, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z); sp.scale.setScalar(0.85);
    scene.add(sp);
    fx.push({ mesh: sp, t: 0, dur: 0.22, kind: 'trail' });
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { scene.remove(f.mesh); if (f.mesh.geometry) f.mesh.geometry.dispose(); fx.splice(i, 1); continue; }
      if (f.kind === 'ring') {
        const s = 1 + k * f.maxR; f.mesh.scale.setScalar(s);
        f.mesh.material.opacity = 0.9 * (1 - k);
      } else if (f.kind === 'slash') {
        f.mesh.material.opacity = 0.85 * (1 - k);
        f.mesh.scale.setScalar(0.6 + k * 0.7);
      } else if (f.kind === 'spark') {
        f.mesh.position.y += dt * 1.2; f.mesh.material.opacity = 1 - k;
        f.mesh.scale.setScalar(0.9 + k * 0.8);
      } else if (f.kind === 'dust') {
        f.mesh.position.y += dt * 0.5;
        f.mesh.scale.setScalar(0.55 + k * 0.9);
        f.mesh.material.opacity = 0.5 * (1 - k);
      } else if (f.kind === 'trail') {
        f.mesh.scale.setScalar(0.85 - k * 0.4);
        f.mesh.material.opacity = 0.75 * (1 - k);
      }
    }
  }

  function triggerShake(amp, dur) {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeT = Math.max(shakeT, dur || 0.25);
  }

  /* ---------- trigger an attack pose ---------- */
  function triggerAttack(style) {
    const dur = style === 'heavy' ? 0.62 : style === 'cast' ? 0.5 : style === 'flurry' ? 0.24 : style === 'shoot' ? 0.3 : 0.42;
    attackAnim = { t: 0, dur: dur, style: style };
  }

  /* ---------- perform a hit: damage enemies in front, fire hooks ---------- */
  function performAttack(weapon, comboStep, isSkill) {
    const w = weapon || (typeof WEAPONS !== 'undefined' && WEAPONS.find(x => x.id === weaponId)) || { damage: 12, reach: 3.4, glow: 0x8ff0c8, anim: 'slash' };
    const C = (typeof CHARACTERS !== 'undefined') && CHARACTERS.find(c => c.id === charId);
    const reach = w.reach * (isSkill ? 1.55 : 1);
    const comboMul = 1 + Math.min(COMBAT_RULES.comboCap, comboStep || 0) * COMBAT_RULES.comboBonus;
    const dmg = Math.round((w.damage + (C ? C.bonus * 20 : 0)) * comboMul * (isSkill ? 2.2 : 1));
    const px = player.position.x, py = player.position.y, pz = player.position.z;
    /* Player model faces local +z; world forward = (sin rotY, cos rotY). */
    const fwdX = Math.sin(player.rotation.y), fwdZ = Math.cos(player.rotation.y);
    triggerAttack(isSkill ? 'cast' : w.anim);
    addFxSlash(px, py, pz, player.rotation.y, w.glow);
    triggerShake(isSkill ? 0.5 : 0.28, isSkill ? 0.4 : 0.24);
    if (isSkill) addFxRing(px, py, pz, w.glow, 3.2, 0.6);
    attackTrail = { t: 0, dur: (isSkill ? 0.5 : 0.42), color: w.glow };

    let hitAny = false, killed = 0;
    enemies.forEach(en => {
      if (!en.alive) return;
      const dx = en.group.position.x - px, dz = en.group.position.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > reach) return;
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < (isSkill ? -0.1 : 0.15)) return;   // must be roughly in front (skill = 360°)
      hitAny = true;
      en.hp -= dmg;
      en.hitFlash = 0.22;
      en.group.position.x += fwdX * 0.35; en.group.position.z += fwdZ * 0.35;
      addFxSpark(en.group.position.x, en.group.position.y, en.group.position.z, 0xffe08a);
      if (combatHooks.onHit) combatHooks.onHit(en, dmg, comboStep, isSkill);
      if (en.hp <= 0) {
        en.alive = false; en.respawn = COMBAT_RULES.respawnDelay;
        en.dying = 0.45;                       // play a topple-and-shrink death animation
        addFxRing(en.group.position.x, en.group.position.y, en.group.position.z, 0xffc85f, 2.4, 0.55);
        killed++;
        triggerShake(0.4, 0.3);
        if (combatHooks.onKill) combatHooks.onKill(en);
      }
    });
    return { hit: hitAny, killed: killed, damage: dmg };
  }

  /* ---------- override limb poses during an attack (called after movePlayer) ---------- */
  function applyAttackPose(dt) {
    if (!attackAnim || !limbs.arms.length) return;
    attackAnim.t += dt;
    const k = Math.min(1, attackAnim.t / attackAnim.dur);
    const s = attackAnim.style;
    const swing = Math.sin(k * Math.PI);           // 0→1→0
    const wind = k < 0.3 ? k / 0.3 : 0;
    const strike = k >= 0.3 ? (k - 0.3) / 0.7 : 0;
    if (s === 'slash' || s === 'heavy') {
      const amp = s === 'heavy' ? 2.3 : 1.9;
      limbs.arms[1].rotation.x = -wind * 1.2 + strike * amp;
      limbs.arms[1].rotation.z = 0.17 - strike * 1.1;
      limbs.arms[1].userData.lower.rotation.x = -0.55 + swing * 0.92;
      limbs.arms[1].userData.hand.rotation.z = -wind * 0.45 + strike * 0.65;
      limbs.arms[0].rotation.x = -0.4 - swing * 0.5;
      limbs.arms[0].userData.lower.rotation.x = -0.35 - swing * 0.35;
      limbs.torso.rotation.y = -wind * 0.5 + strike * 0.9;
    } else if (s === 'cast') {
      limbs.arms[1].rotation.x = -1.6 - swing * 0.4;
      limbs.arms[1].rotation.z = 0.5;
      limbs.arms[1].userData.lower.rotation.x = -0.72;
      limbs.arms[1].userData.hand.rotation.z = swing * 0.55;
      limbs.arms[0].rotation.x = -0.9;
      limbs.arms[0].userData.lower.rotation.x = -0.88;
      limbs.torso.position.y = 1.7 + swing * 0.08;
    } else if (s === 'shoot') {
      limbs.arms[1].rotation.x = -1.5;
      limbs.arms[1].rotation.z = 0.05;
      limbs.arms[1].userData.lower.rotation.x = -0.18;
      limbs.arms[0].rotation.x = -1.35;
      limbs.arms[0].userData.lower.rotation.x = -1.10;
      limbs.torso.rotation.y = 0.2;
    } else if (s === 'flurry') {
      const f = Math.sin(k * Math.PI * 6);
      limbs.arms[0].rotation.x = -0.9 + f * 0.7;
      limbs.arms[1].rotation.x = -0.9 - f * 0.7;
      limbs.arms[0].userData.lower.rotation.x = -0.45 - f * 0.32;
      limbs.arms[1].userData.lower.rotation.x = -0.45 + f * 0.32;
      limbs.arms[0].userData.hand.rotation.z = f * 0.45;
      limbs.arms[1].userData.hand.rotation.z = -f * 0.45;
      limbs.torso.rotation.y = f * 0.25;
    }
    if (k >= 1) {
      attackAnim = null;
      if (limbs.torso) { limbs.torso.rotation.y = 0; limbs.torso.position.y = 1.7; }
    }
  }

  /* ---------- enemy AI, animation, respawn ---------- */
  function updateCombat(dt) {
    if (!combatEnabled) return;
    updateFx(dt);
    /* weapon trail while attacking */
    if (attackTrail) {
      attackTrail.t += dt;
      if (attackTrail.t < attackTrail.dur && weaponGroup) {
        weaponGroup.updateWorldMatrix(true, false);
        const tp = weaponGroup.getWorldPosition(new THREE.Vector3());
        addFxTrail(tp.x, tp.y + (weaponGroup.userData.tipY || 0.8) * 0.85, tp.z, attackTrail.color);
      } else attackTrail = null;
    }
    const px = player.position.x, pz = player.position.z;
    enemies.forEach(en => {
      if (!en.alive) {
        /* dying: topple + shrink before hiding */
        if (en.dying > 0) {
          en.dying -= dt;
          const k = Math.max(0, en.dying / 0.45);
          en.group.rotation.x = -(1 - k) * 1.45;
          en.group.scale.setScalar(en.type.scale * Math.max(0.05, k));
          if (en.dying <= 0) { en.group.visible = false; en.group.rotation.x = 0; }
        }
        en.respawn -= dt;
        if (en.respawn <= 0) {
          en.alive = true; en.hp = en.maxHp; en.group.visible = true;
          en.group.rotation.x = 0; en.group.scale.setScalar(en.type.scale);
          en.group.position.set(en.homeX, heightAt(en.homeX, en.homeZ), en.homeZ);
        }
        return;
      }
      const g = en.group;
      const dx = px - g.position.x, dz = pz - g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < COMBAT_RULES.aggroRange && dist > COMBAT_RULES.attackRange) {
        const sp = en.type.speed * dt;
        g.position.x += (dx / dist) * sp; g.position.z += (dz / dist) * sp;
        g.rotation.y = Math.atan2(-dx, -dz);
        en.state = 'chase';
      } else if (dist <= COMBAT_RULES.attackRange) {
        en.state = 'attack';
        en.atkCd -= dt;
        if (en.atkCd <= 0) {
          en.atkCd = 1.4;
          if (combatHooks.onHurt) combatHooks.onHurt(en);
        }
      } else {
        en.state = 'idle';
      }
      g.position.y = heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(elapsed * 3 + en.bob)) * 0.07;
      /* limb / body animation */
      const parts = g.userData.parts;
      if (parts) {
        const moveK = en.state === 'chase' ? 1 : en.state === 'attack' ? 0.55 : 0.18;
        if (parts.legs && parts.legs.length) {
          parts.legs.forEach(function (lg, i) {
            lg.rotation.x = Math.sin(elapsed * 9 + i * Math.PI * 0.72) * 0.55 * moveK;
            lg.rotation.z = Math.cos(elapsed * 9 + i * 1.7) * 0.14 * moveK;
          });
        }
        if (parts.body && parts.body.userData.bs) {
          const bs = parts.body.userData.bs;
          const sq = Math.sin(elapsed * 4.5 + en.bob);
          parts.body.scale.set(bs[0] * (1 - sq * 0.05), bs[1] * (1 + sq * 0.12), bs[2] * (1 - sq * 0.05));
        }
      }
      if (en.hitFlash > 0) {
        en.hitFlash -= dt;
        g.scale.setScalar(en.type.scale * (1 + en.hitFlash * 0.8));
      } else {
        g.scale.setScalar(en.type.scale);
      }
    });
    applyAttackPose(dt);
  }

  /* ---------- combat public helpers ---------- */
  function setCombatEnabled(v) { combatEnabled = !!v; if (combatEnabled && enemies.length === 0) spawnEnemies(); }
  function setCombatHooks(h) { combatHooks = h || {}; }
  function getEnemies() { return enemies.map(e => ({ id: e.id, type: e.type.id, hp: e.hp, maxHp: e.maxHp, alive: e.alive, x: e.group.position.x, z: e.group.position.z })); }

  /* ---------- minimap ---------- */
  /* 以玩家為中心的局部地圖：解決「全世界壓縮太多、要手動放大先睇到」嘅問題。
     放大倍率由 MM_VIEW 控制（數值越小＝越近、越大越清晰）。目標在視野外時，
     於地圖邊緣畫方向箭頭，玩家永遠知道往哪走。 */
  const MMW = 360;
  const MM_VIEW = 130;              // 可視半徑（世界單位）；130 約涵蓋一個分區
  const MM_HALF = MMW / 2;
  function drawMinimap(playerPos, camYaw, allNodes, doneSet, target, wpUnlocked) {
    const ctx = MAP_C.getContext('2d');
    ctx.clearRect(0, 0, MMW, MMW);
    const sc = MM_HALF / MM_VIEW;                        // 世界單位 → 像素
    const toMap = (x, z) => [MM_HALF + (x - playerPos.x) * sc, MM_HALF + (z - playerPos.z) * sc];
    const px = MM_HALF, py = MM_HALF;                    // 玩家固定在中心

    ctx.save();
    ctx.beginPath(); ctx.arc(MM_HALF, MM_HALF, MM_HALF - 3, 0, Math.PI * 2); ctx.clip();

    /* 底色 */
    ctx.fillStyle = 'rgba(18,30,34,.55)';
    ctx.fillRect(0, 0, MMW, MMW);

    /* 分區色塊 + 代號 */
    const zc = { A: 'rgba(120,170,210,.34)', B: 'rgba(90,160,105,.36)', C: 'rgba(130,132,140,.36)', D: 'rgba(120,95,180,.38)' };
    for (const k in ZONES) {
      const Z = ZONES[k];
      const [mx, my] = toMap(Z.cx, Z.cz);
      ctx.fillStyle = zc[k];
      ctx.beginPath(); ctx.arc(mx, my, 78 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.font = '700 26px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(k, mx, my);
    }

    /* 任務節點 */
    allNodes.forEach(n => {
      const [mx, my] = toMap(n.x, n.z);
      if (mx < -20 || mx > MMW + 20 || my < -20 || my > MMW + 20) return;
      const isDone = doneSet.has(n.id);
      const rr = n.main ? 6.4 : 4.4;
      let col = '#a99ff0';
      if (isDone) col = 'rgba(110,140,130,.6)';
      else if (n.type === 'npc') col = '#4fd6a4';
      else if (n.type === 'chest') col = '#ffc85f';
      else if (n.type === 'guild') col = '#6fb8e8';
      else if (n.type === 'shop') col = '#ff9d5c';
      ctx.beginPath(); ctx.arc(mx, my, rr, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (n.main && !isDone) {
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my, rr + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.4; ctx.stroke();
      } else if (!isDone) {
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    });

    /* 傳送錨點 */
    if (typeof WAYPOINTS !== 'undefined') {
      WAYPOINTS.forEach(function (w) {
        const m = toMap(w.x, w.z);
        if (m[0] < -20 || m[0] > MMW + 20 || m[1] < -20 || m[1] > MMW + 20) return;
        const on = wpUnlocked && wpUnlocked.has(w.id);
        ctx.save(); ctx.translate(m[0], m[1]); ctx.rotate(Math.PI / 4);
        ctx.beginPath(); ctx.rect(-5, -5, 10, 10);
        ctx.fillStyle = on ? '#7fe8e0' : 'rgba(120,142,152,.65)'; ctx.fill();
        ctx.strokeStyle = on ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.3)';
        ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
      });
    }

    /* 目標：視野內畫路線＋脈衝圈；視野外在邊緣畫方向箭頭 */
    if (target) {
      const [tx, ty] = toMap(target.x, target.z);
      const dx = tx - px, dy = ty - py;
      const dist = Math.hypot(dx, dy);
      if (dist <= MM_HALF - 26) {
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = 'rgba(143,240,200,.8)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.restore();
        const pulse = 12 + Math.sin(performance.now() / 320) * 3;
        ctx.strokeStyle = 'rgba(143,240,200,.95)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(tx, ty, pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#eafff7'; ctx.fill();
      } else {
        const a = Math.atan2(dy, dx), er = MM_HALF - 26;
        const ex = px + Math.cos(a) * er, ey = py + Math.sin(a) * er;
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8);
        ctx.closePath();
        ctx.fillStyle = 'rgba(143,240,200,.95)'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();
      }
    }

    /* 玩家（中心，白色三角隨視角旋轉） */
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-camYaw);
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4.5); ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();

    ctx.restore();   // 解除圓形裁剪

    /* 邊框 + 指北 */
    ctx.beginPath(); ctx.arc(MM_HALF, MM_HALF, MM_HALF - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(220,240,232,.9)';
    ctx.font = '700 16px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('N', MM_HALF, 22);
    ctx.textAlign = 'left';
  }

  let lastT = 0;
  function update(dt, totalTime) {
    elapsed = totalTime;
    if (scene.userData.grassWindTime) scene.userData.grassWindTime.value = totalTime;
    if (!locked) movePlayer(dt);
    updateCombat(dt);
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
    setInteractHandler, setPrimaryHandler, isTouchMode: function () { return touchMode; },
    setWaypointState, teleportTo,
    /* combat API */
    setCombatEnabled, setCombatHooks, spawnEnemies, getEnemies,
    performAttack, equipWeapon, applyCharacterLook,
    get combatState() { return { weapon: weaponId, character: charId, skin: skinId, enabled: combatEnabled }; },
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
