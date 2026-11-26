/* ============================================================
   swords-preview.js — Particle Herald's blades (Phase 2b, preview only)
   3 procedural sword templates, each with a distinct bond-themed
   particle language. No external assets, no game logic.
   Return THREE.Group, pivot at grip (y=0), blade points +y.
   ============================================================ */
(function (global) {
  'use strict';
  const T = global.THREE;
  if (!T) { global.SwordModels = null; return; }
  const ramp = new Uint8Array([70, 70, 70, 165, 165, 165, 245, 245, 245]);
  const tex = new T.DataTexture(ramp, 3, 1, T.RGBFormat);
  tex.needsUpdate = true; tex.minFilter = tex.magFilter = T.NearestFilter;
  function toon(c, e) { const m = new T.MeshToonMaterial({ color: c, gradientMap: tex }); if (e) { m.emissive = new T.Color(e); m.emissiveIntensity = 0.4; } return m; }
  function glow(c, o) { return new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o === undefined ? 1 : o, depthWrite: false, toneMapped: false }); }
  function put(g, geo, mat, x, y, z, sx, sy, sz) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (sx) m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m; }
  function rim(m, c, s, o) { const r = new T.Mesh(m.geometry, new T.MeshBasicMaterial({ color: c, side: T.BackSide, transparent: true, opacity: o || 0.5, depthWrite: false, toneMapped: false })); r.scale.setScalar(s || 1.06); m.add(r); }

  /* common hilt */
  function hilt(g, gripColor, guardColor, guardGeo) {
    put(g, new T.CylinderGeometry(0.055, 0.05, 0.46, 10), toon(gripColor), 0, -0.23, 0);
    put(g, new T.TorusGeometry(0.075, 0.015, 6, 14), toon(guardColor), 0, -0.45, 0).rotation.x = Math.PI / 2;
    const guard = put(g, guardGeo || new T.BoxGeometry(0.52, 0.07, 0.13), toon(guardColor), 0, 0.02, 0);
    rim(guard, guardColor, 1.06, 0.3);
    put(g, new T.OctahedronGeometry(0.075, 0), glow(guardColor), 0, -0.50, 0);
  }

  /* ---------- 1. IONIC EDGE — split transfer blade ---------- */
  function ionicEdge() {
    const g = new T.Group();
    hilt(g, 0x1d4a66, 0x8ff0c8, new T.BoxGeometry(0.62, 0.08, 0.14));
    /* two half-blades with a visible transfer gap */
    [-1, 1].forEach(function (s) {
      const half = put(g, new T.BoxGeometry(0.10, 1.28, 0.032), toon(s < 0 ? 0x6fe7ff : 0xbfffe0),
        s * 0.055, 0.72, 0);
      half.rotation.z = -s * 0.035;
      rim(half, 0xd9fbff, 1.06, 0.45);
      put(g, new T.ConeGeometry(0.06, 0.24, 4), toon(s < 0 ? 0x6fe7ff : 0xbfffe0), s * 0.02, 1.46, 0).rotation.z = -s * 0.035;
    });
    /* leaping electron sparks crossing the gap */
    for (let i = 0; i < 5; i++) {
      const e = put(g, new T.SphereGeometry(0.032, 8, 6), glow(0xffffff), (i % 2 ? 0.07 : -0.07), 0.35 + i * 0.23, 0.03);
      e.userData.spark = i;
    }
    put(g, new T.TorusGeometry(0.13, 0.012, 6, 20), glow(0x8ff0c8, 0.7), 0, 0.45, 0).rotation.x = Math.PI / 2;
    g.userData.label = 'IONIC EDGE · electron transfer';
    g.userData.flavors = ['transfer', 'spark', 'charge'];
    return g;
  }

  /* ---------- 2. COVALENT TWIN — paired shared blade ---------- */
  function covalentTwin() {
    const g = new T.Group();
    hilt(g, 0x1c4a3a, 0x7dffc8, new T.BoxGeometry(0.56, 0.08, 0.14));
    /* two parallel blades joined by a shared electron filament */
    [-1, 1].forEach(function (s) {
      const b = put(g, new T.BoxGeometry(0.085, 1.34, 0.05), toon(0x5fd0a8), s * 0.11, 0.74, 0);
      rim(b, 0xbfffe0, 1.06, 0.42);
      put(g, new T.ConeGeometry(0.055, 0.22, 4), toon(0x5fd0a8), s * 0.11, 1.52, 0);
    });
    put(g, new T.CylinderGeometry(0.018, 0.018, 1.30, 8), glow(0xe0fff0, 0.9), 0, 0.74, 0.035);
    for (let i = 0; i < 4; i++) {
      put(g, new T.SphereGeometry(0.045, 10, 8), glow(0xffffff), 0, 0.34 + i * 0.31, 0.065);
    }
    /* orbital loops */
    [0, 1].forEach(function (k) {
      put(g, new T.TorusGeometry(0.24, 0.011, 6, 26), glow(0x8fffd0, 0.55), 0, 0.85, 0).rotation.x = k ? 0.7 : -0.7;
    });
    g.userData.label = 'COVALENT TWIN · shared pair';
    g.userData.flavors = ['shared', 'orbit', 'pair'];
    return g;
  }

  /* ---------- 3. METALLIC HALO — heavy delocalised greatsword ---------- */
  function metallicHalo() {
    const g = new T.Group();
    hilt(g, 0x5a3d1c, 0xffd070, new T.BoxGeometry(0.74, 0.10, 0.17));
    /* broad faceted blade */
    const blade = put(g, new T.CylinderGeometry(0.16, 0.20, 1.55, 6), toon(0xd8a13c, 0x6a4410), 0, 0.80, 0);
    blade.rotation.y = Math.PI / 6;
    rim(blade, 0xffe6a8, 1.05, 0.38);
    put(g, new T.ConeGeometry(0.17, 0.34, 6), toon(0xd8a13c), 0, 1.74, 0);
    /* delocalised electron sea — glowing seams + halo */
    [-1, 1].forEach(function (s) {
      put(g, new T.BoxGeometry(0.026, 1.3, 0.03), glow(0xfff0b0, 0.85), s * 0.085, 0.80, 0.15).rotation.z = s * 0.04;
    });
    put(g, new T.TorusGeometry(0.42, 0.016, 6, 36), glow(0xffd070, 0.7), 0, 0.95, 0).rotation.x = Math.PI / 2.4;
    /* orbiting ions */
    [0, 1, 2].forEach(function (i) {
      const a = i / 3 * Math.PI * 2;
      put(g, new T.OctahedronGeometry(0.055, 0), glow(0xfff6cf), Math.cos(a) * 0.42, 0.95 + Math.sin(a) * 0.18, Math.sin(a) * 0.42);
    });
    g.userData.label = 'METALLIC HALO · delocalised sea';
    g.userData.flavors = ['sea', 'halo', 'heavy'];
    return g;
  }

  const makers = [ionicEdge, covalentTwin, metallicHalo];
  global.SwordModels = {
    build: function (i) { const fn = makers[i]; return fn ? fn() : null; },
    count: makers.length,
    names: ['ionic-edge', 'covalent-twin', 'metallic-halo']
  };
})(window);
