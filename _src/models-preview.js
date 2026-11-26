/* ============================================================
   models-preview.js — STANDALONE upgraded 3D models (Phase 1)
   Pure functions returning THREE.Group. No game logic, no assets.
   Loaded only by preview.html. Phase 2 will swap these into
   buildPlayer / buildEnemy / buildTown after visual approval.
   All geometry procedural; rim-light via back-face shell.
   ============================================================ */
(function (global) {
  'use strict';
  var T = global.THREE;
  if (!T) { global.PreviewModels = null; return; }

  /* ---- shared toon ramp (3-band, no external texture) ---- */
  var rampData = new Uint8Array([70, 70, 70, 165, 165, 165, 245, 245, 245]);
  var rampTex = new T.DataTexture(rampData, 3, 1, T.RGBFormat);
  rampTex.needsUpdate = true;
  rampTex.minFilter = T.NearestFilter;
  rampTex.magFilter = T.NearestFilter;

  function toon(color, emissive, ei) {
    var m = new T.MeshToonMaterial({ color: color, gradientMap: rampTex });
    if (emissive !== undefined) { m.emissive = new T.Color(emissive); m.emissiveIntensity = ei || 0.35; }
    return m;
  }
  function glow(color, op) {
    return new T.MeshBasicMaterial({ color: color, transparent: true, opacity: op === undefined ? 1 : op, depthWrite: false, toneMapped: false });
  }
  /* rim light = slightly larger back-face shell */
  function rim(mesh, color, scale, op) {
    var r = new T.Mesh(mesh.geometry, new T.MeshBasicMaterial({
      color: color, side: T.BackSide, transparent: true, opacity: op === undefined ? 0.55 : op,
      depthWrite: false, toneMapped: false
    }));
    r.scale.setScalar(scale || 1.07);
    mesh.add(r);
    return r;
  }
  function put(g, geo, mat, x, y, z, sx, sy, sz) {
    var m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (sx !== undefined) m.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  }

  /* ============================================================
     1. ELARA — refined player model
     pivot at feet (y=0); faces local +z; total height ~3.3
     ============================================================ */
  function buildElara() {
    var g = new T.Group();
    var skin = toon(0xf3d9c4), skinR = 0xf7e6d6;
    var cloth = toon(0x343a4d), cloth2 = toon(0x24304a);
    var leather = toon(0x4a3529), metal = toon(0xbfc9d6, 0x223344, 0.3);
    var accent = toon(0x8fd8c0, 0x2f8a70, 0.5), hair = toon(0x5a3828);
    var eyeW = toon(0xffffff), iris = toon(0x2f7d86, 0x123838, 0.4);

    var limbs = { legs: [], arms: [] };

    /* boots + legs */
    [-0.19, 0.19].forEach(function (x) {
      var boot = put(g, new T.BoxGeometry(0.24, 0.30, 0.38), leather, x, 0.16, 0.04);
      put(g, new T.BoxGeometry(0.26, 0.08, 0.42), metal, x, 0.04, 0.05);
      rim(boot, 0x6fd8ff, 1.05, 0.22);
      var leg = put(g, new T.CylinderGeometry(0.095, 0.11, 0.86, 10), cloth2, x, 0.72, 0);
      limbs.legs.push(leg);
    });
    /* skirt / shorts */
    var skirt = put(g, new T.CylinderGeometry(0.30, 0.46, 0.52, 14, 1, true), cloth, 0, 1.28, 0);
    rim(skirt, 0x8fd8c0, 1.05, 0.28);
    put(g, new T.CylinderGeometry(0.315, 0.32, 0.10, 14), leather, 0, 1.56, 0);
    put(g, new T.BoxGeometry(0.16, 0.16, 0.06), accent, 0, 1.55, 0.31); /* belt buckle */

    /* torso, layered outfit */
    var torso = put(g, new T.CylinderGeometry(0.32, 0.26, 0.74, 12), cloth, 0, 1.98, 0);
    rim(torso, 0x8fd8c0, 1.06, 0.3);
    put(g, new T.BoxGeometry(0.30, 0.36, 0.06), cloth2, 0, 1.99, 0.27); /* chest panel */
    put(g, new T.BoxGeometry(0.09, 0.30, 0.04), accent, 0, 2.00, 0.31);
    /* shoulder plates */
    [-1, 1].forEach(function (s) {
      var sp = put(g, new T.SphereGeometry(0.19, 12, 9), metal, s * 0.37, 2.28, 0, 1, 0.62, 1);
      rim(sp, 0x9fe8ff, 1.08, 0.35);
      put(g, new T.BoxGeometry(0.06, 0.16, 0.10), accent, s * 0.46, 2.22, 0.12);
    });
    /* neck */
    put(g, new T.CylinderGeometry(0.09, 0.10, 0.18, 10), skin, 0, 2.42, 0);

    /* arms (pivot at shoulder so Phase 2 can animate) */
    [-1, 1].forEach(function (s) {
      var pivot = new T.Group();
      pivot.position.set(s * 0.40, 2.30, 0);
      g.add(pivot);
      put(pivot, new T.CylinderGeometry(0.085, 0.075, 0.62, 10), cloth, 0, -0.31, 0);
      put(pivot, new T.CylinderGeometry(0.07, 0.065, 0.46, 10), leather, 0, -0.82, 0.02);
      put(pivot, new T.SphereGeometry(0.085, 10, 8), skin, 0, -1.08, 0.02);
      put(pivot, new T.BoxGeometry(0.15, 0.08, 0.16), metal, 0, -0.62, 0);
      limbs.arms.push(pivot);
    });

    /* ---- head: refined face ---- */
    var head = new T.Group(); head.position.set(0, 2.72, 0); g.add(head);
    var face = put(head, new T.SphereGeometry(0.30, 20, 16), skin, 0, 0, 0, 1, 1.08, 0.92);
    rim(face, skinR, 1.05, 0.3);
    /* chin */
    put(head, new T.SphereGeometry(0.15, 14, 10), skin, 0, -0.20, 0.06, 1, 0.7, 0.8);
    /* eyes */
    [-1, 1].forEach(function (s) {
      put(head, new T.SphereGeometry(0.062, 12, 10), eyeW, s * 0.115, 0.035, 0.255, 1, 0.75, 0.45);
      put(head, new T.SphereGeometry(0.036, 12, 10), iris, s * 0.115, 0.032, 0.288, 1, 1, 0.6);
      put(head, new T.SphereGeometry(0.011, 8, 6), toon(0xffffff), s * 0.102, 0.052, 0.312);
      /* brow */
      var brow = put(head, new T.BoxGeometry(0.12, 0.018, 0.02), hair, s * 0.115, 0.115, 0.255);
      brow.rotation.z = s * 0.16;
    });
    /* nose + mouth */
    put(head, new T.ConeGeometry(0.024, 0.075, 8), skin, 0, -0.045, 0.275, 1, 1, 1).rotation.x = Math.PI;
    put(head, new T.BoxGeometry(0.075, 0.014, 0.012), toon(0xc46b6b), 0, -0.135, 0.255);
    /* cheeks */
    [-1, 1].forEach(function (s) { put(head, new T.SphereGeometry(0.035, 10, 8), toon(0xe99b96), s * 0.18, -0.06, 0.225, 1, 0.6, 0.4); });

    /* hair: cap + layered bangs + back + braid */
    var cap = put(head, new T.SphereGeometry(0.315, 18, 14), hair, 0, 0.085, -0.01, 1.04, 0.9, 1.0);
    rim(cap, 0x9a6a4a, 1.05, 0.25);
    [-0.20, -0.07, 0.06, 0.19].forEach(function (x, i) {
      var bang = put(head, new T.ConeGeometry(0.075, 0.30 + (i % 2) * 0.08, 7), hair, x, 0.19, 0.215);
      bang.rotation.x = 0.34; bang.rotation.z = x * 0.7;
    });
    [-1, 1].forEach(function (s) {
      var side = put(head, new T.CylinderGeometry(0.07, 0.045, 0.42, 8), hair, s * 0.27, -0.10, -0.02);
      side.rotation.z = s * 0.10;
    });
    put(head, new T.SphereGeometry(0.20, 12, 10), hair, 0, -0.04, -0.24, 1, 1.2, 0.7);
    /* braid: chain of tapering spheres down the back */
    for (var i = 0; i < 7; i++) {
      var r = 0.085 - i * 0.007;
      put(head, new T.SphereGeometry(r, 10, 8), hair, 0, -0.20 - i * 0.13, -0.28 - Math.sin(i * 0.5) * 0.03);
    }
    put(head, new T.TorusGeometry(0.05, 0.016, 6, 12), accent, 0, -1.10, -0.28).rotation.x = Math.PI / 2;

    /* cape: segmented cloth with fold */
    var capeMat = toon(0x2a3550); capeMat.side = T.DoubleSide;
    var capeGeo = new T.PlaneGeometry(0.95, 1.75, 6, 8);
    var pos = capeGeo.attributes.position;
    for (var v = 0; v < pos.count; v++) {
      var vx = pos.getX(v), vy = pos.getY(v);
      pos.setZ(v, Math.cos(vx * 7) * 0.06 * (1 - (vy + 0.875) / 1.75) + Math.sin(vy * 2) * 0.03);
    }
    pos.needsUpdate = true; capeGeo.computeVertexNormals();
    var cape = put(g, capeGeo, capeMat, 0, 1.30, -0.30);
    cape.rotation.x = -0.10;
    g.userData.cape = cape;
    /* clasp */
    put(g, new T.SphereGeometry(0.075, 12, 10), accent, 0, 2.22, -0.24);

    /* sheathed sword on back */
    var sword = new T.Group(); sword.position.set(0.30, 1.85, -0.30); sword.rotation.z = -0.45; g.add(sword);
    put(sword, new T.BoxGeometry(0.07, 0.95, 0.025), metal, 0, 0, 0);
    put(sword, new T.BoxGeometry(0.30, 0.05, 0.06), leather, 0, -0.48, 0);
    put(sword, new T.CylinderGeometry(0.035, 0.035, 0.24, 8), leather, 0, -0.62, 0);

    g.userData.label = 'ELARA · Adventurer';
    g.userData.limbs = limbs;
    g.userData.height = 3.3;
    return g;
  }

  /* ============================================================
     2a. IONIC — glowing crystal gel (electron-transfer spirit)
     ============================================================ */
  function buildIonicEnemy() {
    var g = new T.Group();
    var gelMat = toon(0x3fd8ff, 0x1a7f9c, 0.55); gelMat.transparent = true; gelMat.opacity = 0.5;
    var gel = put(g, new T.SphereGeometry(0.62, 20, 16), gelMat, 0, 0.86, 0, 1, 1.12, 1);
    rim(gel, 0x9ff4ff, 1.08, 0.7);
    /* inner octahedral crystal core */
    var core = put(g, new T.OctahedronGeometry(0.36, 0), glow(0xd9fbff), 0, 0.92, 0.18, 1, 1.35, 1);
    rim(core, 0x6fe7ff, 1.12, 0.5);
    /* orbiting electrons */
    for (var i = 0; i < 3; i++) {
      var e = put(g, new T.SphereGeometry(0.075, 10, 8), glow(0xbdf3ff), Math.cos(i * 2.09) * 0.82, 0.9 + Math.sin(i * 2.09) * 0.25, Math.sin(i * 2.09) * 0.82);
      e.userData.orbit = i * 2.09;
    }
    /* transferred-electron trail */
    put(g, new T.TorusGeometry(0.78, 0.018, 6, 32), glow(0x6fe7ff, 0.7), 0, 0.88, 0).rotation.x = Math.PI / 2.3;
    /* ground pool */
    put(g, new T.CircleGeometry(0.85, 28), glow(0x3fd8ff, 0.18), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'IONIC · crystal gel';
    g.userData.family = 'ionic'; g.userData.height = 1.7;
    return g;
  }

  /* ============================================================
     2b. COVALENT — linked dual-core (shared electron pair)
     ============================================================ */
  function buildCovalentEnemy() {
    var g = new T.Group();
    var body = toon(0x5fd0a8, 0x1f7a5c, 0.28);
    [-1, 1].forEach(function (s) {
      var core = put(g, new T.SphereGeometry(0.42, 18, 14), body, s * 0.52, 1.0, 0, 1, 1.05, 1);
      rim(core, 0xa8ffd8, 1.09, 0.6);
      /* electron shell */
      var sh = put(g, new T.TorusGeometry(0.52, 0.022, 6, 28), glow(0xbfffe0, 0.8), s * 0.52, 1.0, 0);
      sh.rotation.x = s * 0.7; sh.userData.shell = s;
      /* little eyes */
      put(g, new T.SphereGeometry(0.055, 10, 8), glow(0x143a2e), s * 0.52 + s * 0.12, 1.05, 0.39);
    });
    /* shared pair: two electrons in the overlap + bond rod */
    put(g, new T.CylinderGeometry(0.06, 0.06, 0.62, 10), toon(0x3f9c7a), 0, 1.0, 0).rotation.z = Math.PI / 2;
    [0.12, -0.12].forEach(function (z) {
      var e = put(g, new T.SphereGeometry(0.085, 10, 8), glow(0xe0fff0), 0, 1.0, z);
      e.userData.shared = true;
    });
    /* bridging arcs */
    put(g, new T.TorusGeometry(0.62, 0.016, 6, 30, Math.PI), glow(0x8fffd0, 0.65), 0, 1.0, 0).rotation.x = Math.PI / 2;
    put(g, new T.CircleGeometry(0.95, 28), glow(0x5fd0a8, 0.16), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'COVALENT · linked dual-core';
    g.userData.family = 'covalent'; g.userData.height = 1.7;
    return g;
  }

  /* ============================================================
     2c. METALLIC — faceted ore golem (delocalised-electron sea)
     ============================================================ */
  function buildMetallicEnemy() {
    var g = new T.Group();
    var ore = toon(0xd8a13c, 0x6a4410, 0.22);
    var dark = toon(0x5a3d1c);
    /* faceted body */
    var body = put(g, new T.DodecahedronGeometry(0.72, 0), ore, 0, 1.05, 0, 1.1, 1.15, 0.9);
    rim(body, 0xffe6a8, 1.06, 0.5);
    /* glowing cracks (delocalised sea) */
    [-1, 1].forEach(function (s) {
      var crack = put(g, new T.BoxGeometry(0.05, 0.5, 0.03), glow(0xfff0b0), s * 0.28, 1.08, 0.62);
      crack.rotation.z = s * 0.35;
    });
    put(g, new T.SphereGeometry(0.16, 12, 10), glow(0xfff6cf), 0, 1.1, 0.66);
    /* head */
    var head = put(g, new T.IcosahedronGeometry(0.36, 0), ore, 0, 1.95, 0.04);
    rim(head, 0xffe6a8, 1.08, 0.5);
    [-1, 1].forEach(function (s) { put(g, new T.SphereGeometry(0.055, 10, 8), glow(0xfff4c0), s * 0.13, 1.98, 0.32); });
    /* arms + fists */
    [-1, 1].forEach(function (s) {
      var arm = put(g, new T.CylinderGeometry(0.16, 0.20, 0.78, 6), dark, s * 0.82, 1.14, 0);
      arm.rotation.z = s * 0.18;
      var fist = put(g, new T.DodecahedronGeometry(0.28, 0), ore, s * 0.95, 0.70, 0.04);
      rim(fist, 0xffe6a8, 1.06, 0.4);
    });
    /* legs */
    [-0.32, 0.32].forEach(function (x) {
      put(g, new T.CylinderGeometry(0.18, 0.22, 0.56, 6), dark, x, 0.30, 0);
      put(g, new T.BoxGeometry(0.42, 0.16, 0.52), ore, x, 0.08, 0.06);
    });
    /* ore shards floating */
    [0, 1, 2].forEach(function (i) {
      var sh = put(g, new T.TetrahedronGeometry(0.11), ore, Math.cos(i * 2.1) * 0.95, 2.15 + Math.sin(i) * 0.15, Math.sin(i * 2.1) * 0.95);
      sh.userData.float = i;
    });
    put(g, new T.CircleGeometry(0.92, 28), glow(0xffc85f, 0.14), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    g.userData.label = 'METALLIC · ore golem';
    g.userData.family = 'metallic'; g.userData.height = 2.3;
    return g;
  }

  /* ============================================================
     3. CHEM ACADEMY — Windvale town landmark
     ============================================================ */
  function buildChemAcademy() {
    var g = new T.Group();
    var stone = toon(0xd9cfba), stone2 = toon(0xb9ae97);
    var trim = toon(0x8fd8c0, 0x2f8a70, 0.4), roofMat = toon(0x3f5d70);
    var dark = toon(0x1c2a2e);

    /* steps + plinth */
    put(g, new T.BoxGeometry(6.2, 0.25, 1.4), stone2, 0, 0.12, 3.6);
    put(g, new T.BoxGeometry(5.6, 0.25, 1.0), stone, 0, 0.34, 3.2);
    /* main hall */
    put(g, new T.BoxGeometry(6.0, 4.4, 4.4), stone, 0, 2.55, 0.6);
    put(g, new T.BoxGeometry(6.3, 0.28, 4.7), stone2, 0, 4.80, 0.6);
    /* roof */
    var roof = put(g, new T.ConeGeometry(4.5, 2.0, 4), roofMat, 0, 5.85, 0.6);
    roof.rotation.y = Math.PI / 4; roof.scale.z = 0.82;
    rim(roof, 0x8fd8c0, 1.03, 0.25);
    /* corner pillars */
    [-1, 1].forEach(function (s) {
      [-1, 1].forEach(function (t) {
        put(g, new T.CylinderGeometry(0.24, 0.28, 4.3, 10), stone2, s * 2.75, 2.55, 0.6 + t * 1.9);
      });
    });
    /* arched entrance: two pillars + half torus + dark door */
    [-1, 1].forEach(function (s) { put(g, new T.CylinderGeometry(0.20, 0.22, 2.9, 12), stone2, s * 1.0, 1.45, 2.92); });
    var arch = put(g, new T.TorusGeometry(1.0, 0.20, 10, 28, Math.PI), trim, 0, 2.8, 2.92);
    arch.rotation.z = 0;
    put(g, new T.BoxGeometry(1.8, 2.7, 0.14), dark, 0, 1.45, 2.86);
    /* door detail */
    put(g, new T.TorusGeometry(0.42, 0.05, 8, 22), trim, 0.55, 1.5, 2.96);
    put(g, new T.SphereGeometry(0.09, 10, 8), glow(0xffe9a8), 0.40, 1.5, 3.0);
    /* signage (procedural canvas texture — no external asset) */
    var cv = document.createElement('canvas'); cv.width = 640; cv.height = 160;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#14242a'; ctx.fillRect(0, 0, 640, 160);
    ctx.strokeStyle = '#8fd8c0'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 624, 144);
    ctx.fillStyle = '#eafff6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 66px sans-serif'; ctx.fillText('CHEM ACADEMY', 320, 68);
    ctx.fillStyle = '#8fd8c0'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('WINDVALE · BOND STUDIES', 320, 124);
    var signTex = new T.CanvasTexture(cv); signTex.needsUpdate = true;
    var sign = put(g, new T.PlaneGeometry(3.4, 0.68), new T.MeshBasicMaterial({ map: signTex, side: T.DoubleSide, toneMapped: false }), 0, 4.30, 2.95);
    sign.userData.sign = true;
    /* windows */
    [-1, 1].forEach(function (s) {
      [1.9, 3.2].forEach(function (y) {
        var w = put(g, new T.BoxGeometry(0.7, 0.9, 0.10), glow(0xffe9a8, 0.85), s * 2.15, y, 2.86);
        put(g, new T.BoxGeometry(0.06, 0.9, 0.12), trim, s * 2.15, y, 2.94);
        put(g, new T.BoxGeometry(0.7, 0.06, 0.12), trim, s * 2.15, y, 2.94);
      });
    });
    /* banners (cloth sway target for Phase 2) */
    [-1, 1].forEach(function (s) {
      var b = put(g, new T.PlaneGeometry(0.7, 2.0), toon(s < 0 ? 0x3fd8ff : 0xffc85f), s * 3.05, 2.9, 2.4);
      b.material.side = T.DoubleSide; b.userData.banner = s;
    });
    g.userData.label = 'CHEM ACADEMY · Windvale';
    g.userData.height = 6.9;
    return g;
  }

  global.PreviewModels = {
    buildElara: buildElara,
    buildIonic: buildIonicEnemy,
    buildCovalent: buildCovalentEnemy,
    buildMetallic: buildMetallicEnemy,
    buildAcademy: buildChemAcademy,
    names: ['elara', 'ionic', 'covalent', 'metallic', 'academy'],
    /* shared helpers for variant builders (Phase 1b) */
    helpers: { toon: toon, glow: glow, rim: rim, put: put, rampTex: rampTex },
    build: function (name) {
      switch (name) {
        case 'elara': return buildElara();
        case 'ionic': return buildIonicEnemy();
        case 'covalent': return buildCovalentEnemy();
        case 'metallic': return buildMetallicEnemy();
        case 'academy': return buildChemAcademy();
        default: return null;
      }
    }
  };
})(window);
