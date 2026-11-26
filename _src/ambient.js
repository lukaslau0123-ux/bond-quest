/* ============================================================
   ambient.js — Phase 2 environment motion (lightweight, no assets)
   - floating electron motes (three bond families)
   - drifting pollen
   - animated sky gradient (slow time drift in the existing sky shader)
   - cloth / banner sway
   - water shimmer highlight
   All updates are O(points) with throttle + device tier + reduced-motion.
   ============================================================ */
(function (global) {
  'use strict';
  const T = global.THREE;
  if (!T) { global.Ambient = { init: function () { }, update: function () { } }; return; }

  const S = {
    scene: null, tier: 1, reduced: false,
    motes: null, motesBase: null, pollen: null, pollenBase: null,
    shimmer: null, shimmerBase: null,
    cloths: [], skyMat: null, skyBase: null,
    t: 0, lastUpdate: 0
  };

  function tierOf() {
    const small = (window.innerWidth || 1280) < 820;
    const lowMem = (navigator.deviceMemory || 4) <= 2;
    const cores = navigator.hardwareConcurrency || 4;
    return (small || lowMem || cores <= 2) ? 0 : 1;
  }

  function softDot(size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const c = cv.getContext('2d'), g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
    const tex = new T.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }

  function makePoints(count, radius, color, size, baseY, dotTex) {
    const arr = new Float32Array(count * 3), base = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = baseY + Math.random() * 12;
      base.push([x, y, z]);
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(arr, 3));
    const mat = new T.PointsMaterial({
      color: color, size: size, map: dotTex, transparent: true, opacity: 0.75,
      blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    return { points: new T.Points(geo, mat), base: base, arr: arr, geo: geo };
  }

  function init(scene) {
    S.scene = scene;
    S.tier = tierOf();
    S.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const dot = softDot(48);
    const mCount = S.tier ? 110 : 46;
    const pCount = S.tier ? 90 : 34;
    const motes = makePoints(mCount, 150, 0x9ff4ff, 0.85, 2.0, dot);
    motes.points.name = 'electron-motes';
    scene.add(motes.points); S.motes = motes;
    const pollen = makePoints(pCount, 165, 0xffe9a8, 0.55, 1.6, dot);
    pollen.points.name = 'pollen';
    scene.add(pollen.points); S.pollen = pollen;
    /* water shimmer: sparse glints on the plane */
    const shimmer = makePoints(S.tier ? 64 : 24, 190, 0xd6fbff, 1.1, -2.86, dot);
    shimmer.points.name = 'water-shimmer';
    scene.add(shimmer.points); S.shimmer = shimmer;

    /* sky gradient drift: add a time uniform without touching existing look */
    scene.traverse(function (o) {
      if (o.isMesh && o.material && o.material.uniforms && o.material.uniforms.top && o.material.uniforms.horizon) {
        if (!S.skyMat) {
          S.skyMat = o.material;
          S.skyMat.uniforms.uAmbientTime = { value: 0 };
          const fs = S.skyMat.fragmentShader;
          if (fs && fs.indexOf('uAmbientTime') < 0) {
            S.skyMat.fragmentShader = fs.replace('void main(){', 'uniform float uAmbientTime;\nvoid main(){')
              .replace('  gl_FragColor = vec4(col, 1.0);',
                '  float drift = sin(uAmbientTime * 0.045) * 0.5 + 0.5;\n' +
                '  col = mix(col, col * vec3(1.04, 1.02, 0.97), drift * 0.25);\n' +
                '  gl_FragColor = vec4(col, 1.0);');
            S.skyMat.needsUpdate = true;
          }
        }
      }
    });

    /* banner / cloth sway: mark candidate meshes from the upgraded academy model */
    scene.traverse(function (o) {
      if (o.isMesh && o.userData && (o.userData.banner !== undefined || o.userData.cape)) S.cloths.push(o);
    });
  }

  function animatePoints(set, t, mode) {
    if (!set) return;
    const p = set.geo.attributes.position, arr = p.array, b = set.base;
    for (let i = 0; i < b.length; i++) {
      const k = i * 3, x = b[i][0], y = b[i][1], z = b[i][2];
      if (mode === 'shimmer') {
        arr[k] = x + Math.sin(t * 0.6 + i) * 0.8;
        arr[k + 1] = y + Math.sin(t * 1.7 + i * 0.7) * 0.05;
        arr[k + 2] = z + Math.cos(t * 0.5 + i) * 0.8;
      } else if (mode === 'pollen') {
        arr[k] = x + Math.sin(t * 0.22 + i * 0.9) * 2.4;
        arr[k + 1] = y + Math.sin(t * 0.35 + i * 0.4) * 1.3;
        arr[k + 2] = z + Math.cos(t * 0.2 + i * 0.7) * 2.2;
      } else {
        arr[k] = x + Math.sin(t * 0.5 + i * 1.3) * 1.5;
        arr[k + 1] = y + Math.sin(t * 0.9 + i * 0.6) * 0.9;
        arr[k + 2] = z + Math.cos(t * 0.45 + i * 1.1) * 1.5;
      }
    }
    p.needsUpdate = true;
  }

  function update(dt, totalTime) {
    if (!S.scene) return;
    S.t += dt;
    if (S.skyMat && S.skyMat.uniforms.uAmbientTime) S.skyMat.uniforms.uAmbientTime.value = S.t;
    if (S.cloths.length) {
      for (let i = 0; i < S.cloths.length; i++) {
        const c = S.cloths[i];
        c.rotation.z = Math.sin(S.t * 1.4 + i) * 0.045;
        c.rotation.y = Math.sin(S.t * 0.8 + i * 0.5) * 0.03;
      }
    }
    if (S.reduced) return;                 /* static sky/cloth only, no particle motion */
    /* throttle point updates to ~20 Hz; cheap enough for low-end devices */
    if (S.t - S.lastUpdate < 0.05) return;
    S.lastUpdate = S.t;
    animatePoints(S.motes, S.t, 'motes');
    animatePoints(S.pollen, S.t, 'pollen');
    animatePoints(S.shimmer, S.t, 'shimmer');
  }

  global.Ambient = {
    init: init, update: update,
    get stats() { return { tier: S.tier, reduced: S.reduced, motes: S.motes ? S.motes.base.length : 0 }; }
  };
})(window);
