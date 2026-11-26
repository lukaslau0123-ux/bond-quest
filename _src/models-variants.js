/* ============================================================
   models-variants.js — Phase 1b: alternative bond-enemy + academy models
   v1 = original (PreviewModels.build). v2 / v3 = new takes.
   Elara is intentionally NOT included (user froze the player model).
   Pure procedural geometry, no external assets, no game logic.
   ============================================================ */
(function (global) {
  'use strict';
  var PM = global.PreviewModels; if (!PM) { global.PreviewVariants = null; return; }
  var T = global.THREE, H = PM.helpers;
  var toon = H.toon, glow = H.glow, rim = H.rim, put = H.put;

  /* ================= IONIC ================= */
  /* v2 — "PRISM WRAITH": floating faceted shards around a bright core */
  function ionicV2() {
    var g = new T.Group();
    var shell = toon(0x3fd8ff, 0x1a7f9c, 0.4); shell.transparent = true; shell.opacity = 0.42;
    var core = put(g, new T.IcosahedronGeometry(0.34, 0), glow(0xd9fbff), 0, 1.02, 0, 1, 1.25, 1);
    rim(core, 0x6fe7ff, 1.14, 0.55);
    /* faceted shard petals */
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * Math.PI * 2;
      var sh = put(g, new T.OctahedronGeometry(0.20 + (i % 2) * 0.06, 0), shell,
        Math.cos(a) * 0.62, 0.95 + Math.sin(i * 1.7) * 0.34, Math.sin(a) * 0.62, 0.75, 1.6, 0.75);
      sh.rotation.set(a * 0.4, a, a * 0.3);
      rim(sh, 0x9ff4ff, 1.08, 0.35);
      sh.userData.orbit = a;
    }
    /* transfer arcs */
    put(g, new T.TorusGeometry(0.72, 0.02, 6, 30, Math.PI * 1.4), glow(0x8ff0ff, 0.7), 0, 1.0, 0).rotation.x = Math.PI / 2.2;
    put(g, new T.TorusGeometry(0.52, 0.015, 6, 30, Math.PI), glow(0xd9fbff, 0.6), 0, 1.0, 0).rotation.y = Math.PI / 2;
    /* ionic charge symbols (canvas, no external asset) */
    ['+', '−'].forEach(function (sym, i) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 96;
      var c = cv.getContext('2d'); c.fillStyle = '#bff3ff'; c.font = 'bold 76px sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sym, 48, 50);
      var sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false, toneMapped: false }));
      sp.position.set(i ? 0.8 : -0.8, 1.25 + i * 0.18, 0.15); sp.scale.setScalar(0.38);
      g.add(sp);
    });
    put(g, new T.CircleGeometry(0.9, 28), glow(0x3fd8ff, 0.16), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'IONIC · prism wraith (v2)'; g.userData.family = 'ionic'; g.userData.height = 1.9;
    return g;
  }

  /* v3 — "ELECTRON BLOOM": flower of orbital petals, anion core */
  function ionicV3() {
    var g = new T.Group();
    var petalMat = toon(0x2fb8e8, 0x115f80, 0.45); petalMat.side = T.DoubleSide;
    var anion = put(g, new T.SphereGeometry(0.30, 16, 12), glow(0xe6fbff), 0, 1.0, 0, 1, 1.1, 1);
    rim(anion, 0x6fe7ff, 1.1, 0.5);
    /* four petal rings, alternating tilt */
    [0, 1, 2].forEach(function (ring) {
      var count = 4 + ring;
      for (var i = 0; i < count; i++) {
        var a = i / count * Math.PI * 2 + ring * 0.4;
        var petal = put(g, new T.SphereGeometry(0.24, 10, 8), petalMat,
          Math.cos(a) * (0.48 + ring * 0.16), 1.0 + Math.sin(a) * 0.12, Math.sin(a) * (0.48 + ring * 0.16),
          0.55, 1.5 + ring * 0.2, 0.35);
        petal.rotation.set(ring * 0.5, -a, Math.PI / 2 + a * 0.2);
        rim(petal, 0x9ff4ff, 1.06, 0.22);
      }
    });
    /* outer halo */
    put(g, new T.TorusGeometry(1.02, 0.014, 6, 40), glow(0x8ff0ff, 0.55), 0, 1.0, 0).rotation.x = Math.PI / 2;
    put(g, new T.CircleGeometry(1.0, 28), glow(0x3fd8ff, 0.14), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'IONIC · electron bloom (v3)'; g.userData.family = 'ionic'; g.userData.height = 1.9;
    return g;
  }

  /* ================= COVALENT ================= */
  /* v2 — "ORBITAL TWIN": faceted dual cores with crossed orbital loops */
  function covalentV2() {
    var g = new T.Group();
    var coreMat = toon(0x4fc79a, 0x1f7a5c, 0.25);
    [-1, 1].forEach(function (s) {
      var core = put(g, new T.IcosahedronGeometry(0.42, 0), coreMat, s * 0.55, 1.02, 0, 1, 1.05, 1);
      rim(core, 0xa8ffd8, 1.08, 0.4);
      /* crossed orbital loops */
      [0, 1].forEach(function (k) {
        var loop = put(g, new T.TorusGeometry(0.58, 0.018, 6, 30), glow(0xbfffe0, 0.75), s * 0.55, 1.02, 0);
        loop.rotation.x = k ? 1.05 : -0.55; loop.rotation.y = k ? 0.5 : -0.4;
      });
      put(g, new T.SphereGeometry(0.05, 10, 8), glow(0x123a2e), s * 0.55 + s * 0.13, 1.08, 0.36);
    });
    /* double shared pair between cores */
    put(g, new T.CylinderGeometry(0.055, 0.055, 0.72, 10), toon(0x3f9c7a), 0, 1.02, 0).rotation.z = Math.PI / 2;
    [0.11, -0.11].forEach(function (z) { put(g, new T.SphereGeometry(0.09, 10, 8), glow(0xe0fff0), 0, 1.02, z); });
    /* shared-electron cloud */
    var cloud = put(g, new T.SphereGeometry(0.24, 12, 10), glow(0xbfffe0, 0.22), 0, 1.02, 0, 1.5, 0.7, 0.7);
    cloud.userData.cloud = true;
    put(g, new T.CircleGeometry(0.92, 28), glow(0x5fd0a8, 0.13), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'COVALENT · orbital twin (v2)'; g.userData.family = 'covalent'; g.userData.height = 1.7;
    return g;
  }

  /* v3 — "BOND TRIO": three linked nuclei, resonant network */
  function covalentV3() {
    var g = new T.Group();
    var coreMat = toon(0x54cfa4, 0x1f7a5c, 0.24);
    var pts = [[0, 1.14, 0.52], [-0.62, 0.92, -0.36], [0.62, 0.92, -0.36]];
    pts.forEach(function (p, i) {
      var core = put(g, new T.DodecahedronGeometry(0.36, 0), coreMat, p[0], p[1], p[2]);
      rim(core, 0xa8ffd8, 1.09, 0.4);
      put(g, new T.TorusGeometry(0.46, 0.015, 6, 26), glow(0xbfffe0, 0.6), p[0], p[1], p[2]).rotation.x = i * 0.9;
    });
    /* three shared pairs at bond midpoints */
    [[0, 1], [1, 2], [2, 0]].forEach(function (pair) {
      var a = pts[pair[0]], b = pts[pair[1]];
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      put(g, new T.CylinderGeometry(0.045, 0.045, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 8), toon(0x3f9c7a), mx, my, mz).rotation.z = Math.PI / 2.6;
      put(g, new T.SphereGeometry(0.075, 10, 8), glow(0xe0fff0), mx, my, mz);
    });
    put(g, new T.CircleGeometry(0.92, 28), glow(0x5fd0a8, 0.13), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'COVALENT · bond trio (v3)'; g.userData.family = 'covalent'; g.userData.height = 1.6;
    return g;
  }

  /* ================= METALLIC ================= */
  /* v2 — "LATTICE COLOSSUS": stacked crystal lattice, tall angular */
  function metallicV2() {
    var g = new T.Group();
    var ore = toon(0xd8a13c, 0x6a4410, 0.2), dark = toon(0x5a3d1c);
    /* stack of offset cubes forming a lattice torso */
    [[0, 1.0, 0, 0], [0.42, 1.55, 0.1, 0.25], [-0.38, 2.05, -0.05, -0.2]].forEach(function (b, i) {
      var cube = put(g, new T.BoxGeometry(1.0 - i * 0.16, 0.62, 0.78 - i * 0.1), ore, b[0], b[1], b[2]);
      cube.rotation.y = b[3]; rim(cube, 0xffe6a8, 1.05, 0.32);
    });
    /* delocalised-electron seams */
    for (var i = 0; i < 4; i++) {
      put(g, new T.BoxGeometry(0.035, 0.9, 0.02), glow(0xfff0b0), -0.3 + i * 0.2, 1.35, 0.4).rotation.z = (i - 1.5) * 0.12;
    }
    var head = put(g, new T.OctahedronGeometry(0.34, 0), ore, 0, 2.55, 0.06); rim(head, 0xffe6a8, 1.08, 0.4);
    [-1, 1].forEach(function (s) {
      put(g, new T.SphereGeometry(0.05, 10, 8), glow(0xfff4c0), s * 0.12, 2.58, 0.29);
      var arm = put(g, new T.BoxGeometry(0.28, 1.0, 0.30), dark, s * 0.82, 1.6, 0); arm.rotation.z = s * 0.12;
      var fist = put(g, new T.BoxGeometry(0.44, 0.40, 0.44), ore, s * 0.9, 0.96, 0.02); rim(fist, 0xffe6a8, 1.06, 0.3);
      put(g, new T.BoxGeometry(0.34, 0.5, 0.40), ore, s * 0.32, 0.35, 0);
    });
    put(g, new T.CircleGeometry(0.85, 28), glow(0xffc85f, 0.13), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'METALLIC · lattice colossus (v2)'; g.userData.family = 'metallic'; g.userData.height = 2.9;
    return g;
  }

  /* v3 — "MOLTEN ANVIL": squat heavy smith golem with hammer fists */
  function metallicV3() {
    var g = new T.Group();
    var ore = toon(0xc98b2c, 0x6a4410, 0.2), dark = toon(0x4a3218);
    var body = put(g, new T.CylinderGeometry(0.78, 0.95, 0.95, 8), ore, 0, 1.0, 0); rim(body, 0xffe6a8, 1.06, 0.35);
    /* molten seam ring */
    put(g, new T.TorusGeometry(0.82, 0.045, 8, 32), glow(0xffd070), 0, 1.05, 0).rotation.x = Math.PI / 2;
    var head = put(g, new T.BoxGeometry(0.58, 0.46, 0.54), dark, 0, 1.72, 0.04); rim(head, 0xffd070, 1.06, 0.3);
    [-1, 1].forEach(function (s) {
      put(g, new T.BoxGeometry(0.10, 0.08, 0.04), glow(0xfff0b0), s * 0.15, 1.76, 0.31);
      /* heavy arm + hammer fist */
      var arm = put(g, new T.CylinderGeometry(0.18, 0.22, 0.78, 6), dark, s * 0.92, 1.22, 0); arm.rotation.z = s * 0.22;
      var hammer = put(g, new T.BoxGeometry(0.58, 0.42, 0.52), ore, s * 1.05, 0.74, 0.02); rim(hammer, 0xffe6a8, 1.06, 0.32);
      put(g, new T.BoxGeometry(0.62, 0.07, 0.56), glow(0xffd070, 0.7), s * 1.05, 0.74, 0.02);
      put(g, new T.BoxGeometry(0.40, 0.34, 0.50), ore, s * 0.34, 0.26, 0);
    });
    /* ember shards */
    [0, 1, 2, 3].forEach(function (i) {
      var a = i / 4 * Math.PI * 2;
      put(g, new T.TetrahedronGeometry(0.1), glow(0xffd070, 0.9), Math.cos(a) * 1.0, 1.9 + Math.sin(i) * 0.22, Math.sin(a) * 1.0);
    });
    put(g, new T.CircleGeometry(0.9, 28), glow(0xffc85f, 0.14), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'METALLIC · molten anvil (v3)'; g.userData.family = 'metallic'; g.userData.height = 2.2;
    return g;
  }

  /* ================= ACADEMY ================= */
  /* v2 — "GRAND HALL": twin wings, pillars, dome, wide steps */
  function academyV2() {
    var g = new T.Group();
    var stone = toon(0xe3d9c4), stone2 = toon(0xb9ae97);
    var roof = toon(0x3f5d70), trim = toon(0x8fd8c0, 0x2f8a70, 0.4);
    put(g, new T.BoxGeometry(8.2, 0.28, 1.8), stone2, 0, 0.14, 3.9);
    put(g, new T.BoxGeometry(7.4, 0.28, 1.3), stone, 0, 0.42, 3.4);
    put(g, new T.BoxGeometry(7.6, 4.8, 4.6), stone, 0, 2.95, 0.6);
    [-1, 1].forEach(function (s) {
      put(g, new T.BoxGeometry(2.2, 3.6, 3.4), stone, s * 4.7, 2.35, 0.6);
      put(g, new T.ConeGeometry(1.7, 1.4, 4), roof, s * 4.7, 4.85, 0.6).rotation.y = Math.PI / 4;
      /* wing columns */
      [-1, 1].forEach(function (t) { put(g, new T.CylinderGeometry(0.18, 0.20, 3.5, 10), stone2, s * 4.7 + t * 0.85, 2.3, 2.35); });
    });
    var mainRoof = put(g, new T.ConeGeometry(5.4, 2.0, 4), roof, 0, 6.35, 0.6); mainRoof.rotation.y = Math.PI / 4; mainRoof.scale.z = 0.82;
    /* dome */
    put(g, new T.SphereGeometry(0.7, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, 7.4, 0.6, 1, 0.7, 1);
    put(g, new T.SphereGeometry(0.12, 10, 8), glow(0xffe9a8), 0, 7.95, 0.6);
    /* arch */
    [-1, 1].forEach(function (s) { put(g, new T.CylinderGeometry(0.22, 0.24, 3.1, 12), stone2, s * 1.25, 1.7, 3.0); });
    put(g, new T.TorusGeometry(1.25, 0.24, 10, 28, Math.PI), trim, 0, 3.25, 3.0);
    put(g, new T.BoxGeometry(2.1, 3.0, 0.14), toon(0x1c2a2e), 0, 1.7, 2.94);
    /* sign */
    var cv = document.createElement('canvas'); cv.width = 640; cv.height = 160;
    var c = cv.getContext('2d'); c.fillStyle = '#14242a'; c.fillRect(0, 0, 640, 160);
    c.strokeStyle = '#8fd8c0'; c.lineWidth = 8; c.strokeRect(8, 8, 624, 144);
    c.fillStyle = '#eafff6'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 62px sans-serif'; c.fillText('CHEM ACADEMY', 320, 66);
    c.fillStyle = '#8fd8c0'; c.font = 'bold 22px sans-serif'; c.fillText('GRAND HALL · WINDVALE', 320, 126);
    put(g, new T.PlaneGeometry(3.7, 0.70), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), side: T.DoubleSide, toneMapped: false }), 0, 4.98, 3.04);
    [-1, 1].forEach(function (s) { [2.1, 3.4].forEach(function (y) {
      put(g, new T.BoxGeometry(0.72, 0.9, 0.1), glow(0xffe9a8, 0.8), s * 2.55, y, 2.96);
    }); });
    g.userData.label = 'CHEM ACADEMY · grand hall (v2)'; g.userData.height = 8.1;
    return g;
  }

  /* v3 — "GLASS LAB": modern glass-and-stone with observatory orb */
  function academyV3() {
    var g = new T.Group();
    var stone = toon(0xd9cfba), frame = toon(0x8fd8c0, 0x2f8a70, 0.35);
    var glass = toon(0x6fc4d8, 0x1f5f70, 0.35); glass.transparent = true; glass.opacity = 0.62;
    put(g, new T.BoxGeometry(6.6, 0.26, 1.5), stone, 0, 0.13, 3.5);
    put(g, new T.BoxGeometry(6.0, 4.2, 4.2), stone, 0, 2.35, 0.6);
    /* glass facade */
    put(g, new T.BoxGeometry(4.4, 3.1, 0.12), glass, 0, 2.45, 2.78);
    for (var i = -2; i <= 2; i++) { put(g, new T.BoxGeometry(0.08, 3.1, 0.14), frame, i * 0.88, 2.45, 2.86); }
    put(g, new T.BoxGeometry(4.5, 0.08, 0.14), frame, 0, 2.45, 2.86);
    /* roof + observatory orb */
    var roof = put(g, new T.BoxGeometry(6.4, 0.30, 4.6), frame, 0, 4.6, 0.6); rim(roof, 0x8fd8c0, 1.03, 0.25);
    put(g, new T.CylinderGeometry(0.55, 0.62, 0.7, 14), stone, 0, 5.05, 0.6);
    var orb = put(g, new T.SphereGeometry(0.62, 18, 14), glass, 0, 5.7, 0.6); rim(orb, 0x9ff4ff, 1.07, 0.5);
    put(g, new T.TorusGeometry(0.74, 0.03, 6, 30), frame, 0, 5.7, 0.6).rotation.x = Math.PI / 2.5;
    /* entrance */
    [-1, 1].forEach(function (s) { put(g, new T.CylinderGeometry(0.16, 0.18, 2.8, 12), stone, s * 1.2, 1.5, 2.95); });
    put(g, new T.TorusGeometry(0.92, 0.16, 10, 28, Math.PI), frame, 0, 2.75, 2.95);
    put(g, new T.BoxGeometry(1.6, 2.5, 0.12), toon(0x14242a), 0, 1.4, 2.9);
    /* sign */
    var cv = document.createElement('canvas'); cv.width = 640; cv.height = 160;
    var c = cv.getContext('2d'); c.fillStyle = '#14242a'; c.fillRect(0, 0, 640, 160);
    c.strokeStyle = '#8fd8c0'; c.lineWidth = 8; c.strokeRect(8, 8, 624, 144);
    c.fillStyle = '#eafff6'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 62px sans-serif'; c.fillText('CHEM ACADEMY', 320, 66);
    c.fillStyle = '#8fd8c0'; c.font = 'bold 22px sans-serif'; c.fillText('MODERN LAB · WINDVALE', 320, 126);
    put(g, new T.PlaneGeometry(3.5, 0.66), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), side: T.DoubleSide, toneMapped: false }), 0, 4.16, 3.02);
    g.userData.label = 'CHEM ACADEMY · glass lab (v3)'; g.userData.height = 6.4;
    return g;
  }

  var builders = {
    ionic: [null, ionicV2, ionicV3],
    covalent: [null, covalentV2, covalentV3],
    metallic: [null, metallicV2, metallicV3],
    academy: [null, academyV2, academyV3]
  };

  global.PreviewVariants = {
    hasVariants: function (name) { return !!builders[name]; },
    labels: { 1: 'v1', 2: 'v2', 3: 'v3' },
    build: function (name, variant) {
      var v = Number(variant) || 1;
      if (name === 'elara') return PM.build('elara');       // frozen
      var arr = builders[name]; if (!arr) return PM.build(name);
      var fn = arr[v - 1]; return fn ? fn() : PM.build(name);
    }
  };
})(window);
