/* ============================================================
   Bond Quest — game logic
   ============================================================ */

(function () {
  'use strict';

  const STATE = { WORLD: 'WORLD', DIALOG: 'DIALOG', DOTCROSS: 'DOTCROSS', VOCAB: 'VOCAB', SUMMARY: 'SUMMARY' };
  let state = STATE.WORLD;
  let started = false;
  let paused = false;

  const done = new Set();
  const nodeCorrect = new Map();
  let correctCount = 0;
  const attempts = [];

  let activeTime = 0;
  let lastFrame = 0;

  const $ = id => document.getElementById(id);

  const INTRO_HTML = `
    <div class="introGrid" style="align-items:start">
      <div class="qsBox">
        <div class="qsHead">YOUR MISSION</div>
        <p class="qsGoal">Explore <b>4 regions</b> and complete <b>9 quests</b>. Along the way you will master <b>ionic</b>, <b>covalent</b> and <b>metallic</b> bonding — and learn to draw <b>dot-and-cross diagrams</b>.</p>
      </div>

      <div class="qsBox">
        <div class="qsHead">HOW TO PLAY — 3 SIMPLE STEPS</div>
        <div class="ruleRow"><span class="rn">1</span><span>Walk up to a <b>glowing NPC, chest or crystal</b>.</span></div>
        <div class="ruleRow"><span class="rn">2</span><span>Press <kbd>E</kbd> when the prompt appears.</span></div>
        <div class="ruleRow"><span class="rn">3</span><span>Answer the questions or draw the electrons → quest complete, and your progress <b>+1</b>.</span></div>
      </div>
    </div>

    <div class="qsBox">
      <div class="qsHead">QUICK START — 5 STEPS</div>
      <ol class="qsOl">
        <li>Press <b>Start exploring</b> below.</li>
        <li>Read the <b>CURRENT OBJECTIVE</b> panel on the left: it tells you what to do, how far away it is (e.g. <b>26 m</b>) and the direction (e.g. <b>NW</b>).</li>
        <li>Follow the <b>white arrow</b> in the panel and on the mini-map. Press <kbd>M</kbd> at any time to open the big map.</li>
        <li>When you arrive, a prompt appears in the middle of the screen — press <kbd>E</kbd>.</li>
        <li>Finish the questions or the diagram → the counter at the top goes <b>+1</b>, and the panel automatically switches to your next quest.</li>
      </ol>
      <p class="qsGoal" style="margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.09);font-size:12px;color:#9fbcb1">
        <b style="color:#8ff0c8">Want to move faster?</b> Walk to a blue anchor and press <kbd>E</kbd> to activate it. Then press <kbd>M</kbd> and click the anchor, or press <kbd>T</kbd>, to teleport. Stuck? Just press the <b>Hint</b> button.
      </p>
    </div>

    <div class="qsBox">
      <div class="qsHead"> ACTION COMBAT — FIGHT, EARN, UPGRADE</div>
      <div class="ruleRow"><span class="rn">⚔</span><span>Wild <b>enemies</b> roam the fields and roads. Press <kbd>J</kbd> to attack — chain hits into a <b>combo</b> for bonus damage.</span></div>
      <div class="ruleRow"><span class="rn">✦</span><span>Press <kbd>K</kbd> for a powerful <b>skill</b> (recharges over time). Every hit and defeat gives <b>Score</b> and <b>Gold</b>.</span></div>
      <div class="ruleRow"><span class="rn">◉</span><span>Spend Gold in the <b>Shop</b> on weapons, outfits and characters. Higher <b>Score</b> unlocks the best gear. Press <kbd>B</kbd> to shop, <kbd>C</kbd> to swap character, <kbd>1–5</kbd> to switch weapons.</span></div>
    </div>

    <div class="qsBox">
      <div class="qsHead">LEARN BY DOING — 2 EXAMPLES</div>
      <div class="exRow"><b>① Answer questions (talk to an NPC):</b> "What is NaCl made of?" → choose <b>A metal + a non-metal</b> → "What happens to the electrons?" → <b>Electron transfer</b> → "What kind of bond?" → <b>Ionic bond</b>. Three correct steps finish the quest.</div>
      <div class="exRow"><b>② Draw a dot-and-cross diagram (open a chest):</b> choose <b>•</b> → click each dotted slot beside Cl <b>twice</b> to place a pair → click <b>[ ] Brackets</b> → set Na to <b>+</b> and Cl to <b>−</b> → press <b>Check</b>. Follow the live checklist beside the diagram.</div>
    </div>

    <div class="ctrlRow">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
      <span><kbd>Space</kbd> Jump</span>
      <span><kbd>Mouse</kbd> Look around</span>
      <span><kbd>E</kbd> Interact</span>
      <span><kbd>J</kbd> Attack</span>
      <span><kbd>K</kbd> Skill</span>
      <span><kbd>C</kbd> Character</span>
      <span><kbd>1-5</kbd> Weapon</span>
      <span><kbd>B</kbd> Shop</span>
      <span><kbd>M</kbd> Map</span>
      <span><kbd>T</kbd> Teleport</span>
      <span><kbd>H</kbd> Help</span>
    </div>
`;

  /* ---------------- session ---------------- */
  const KEY = 'f4e_bonding_session_v1';
  const SESSION = {
    sessionId: 'anon-' + Math.random().toString(36).slice(2, 8),
    startTime: Date.now(), endTime: null,
    events: [],
    exploration: { zonesVisited: [], timePerZone: {}, pathSamples: [], distanceTraveled: 0 },
    summary: null
  };
  let storeOk = true;
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(SESSION)); }
    catch (e) { storeOk = false; }
    try { CLOUD.save(); } catch (e) { }
  }
  function logEvent(ev) {
    ev.t = Math.round(activeTime);
    SESSION.events.push(ev);
    persist();
  }

  /* ---------------- toast ---------------- */
  function toast(msg, ms) {
    const wrap = $('toastWrap');
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = msg;
    wrap.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; }, ms || 2200);
    setTimeout(() => d.remove(), (ms || 2200) + 400);
  }

  /* ============================================================
     COMBAT + REWARD LOOP  (original action-RPG layer)
     ============================================================ */
  const COMBAT = {
    score: 0,
    gold: 0,
    weapons: ['sword'],          // owned weapon ids
    characters: ['lyra'],        // unlocked character ids
    skins: ['default'],          // owned skin ids
    weapon: 'sword',             // equipped
    character: 'lyra',           // active
    skin: 'default',
    combo: 0,
    comboTimer: 0,
    skillCd: 0,
    lastHit: 0,
    kills: 0
  };
  let shopTab = 'gear';          // gear | skins | characters
  let charModalOpen = false;
  const WPN = Object.fromEntries(WEAPONS.map(w => [w.id, w]));
  const CHR = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
  const SKN = Object.fromEntries(SKINS.map(s => [s.id, s]));

  function saveCombat() {
    try {
      const d = {
        score: COMBAT.score, gold: COMBAT.gold, weapons: COMBAT.weapons,
        characters: COMBAT.characters, skins: COMBAT.skins,
        weapon: COMBAT.weapon, character: COMBAT.character, skin: COMBAT.skin, kills: COMBAT.kills
      };
      localStorage.setItem('bq_combat_v1', JSON.stringify(d));
    } catch (e) { }
  }
  function loadCombat() {
    try {
      const d = JSON.parse(localStorage.getItem('bq_combat_v1') || 'null');
      if (!d) return;
      COMBAT.score = d.score || 0; COMBAT.gold = d.gold || 0;
      COMBAT.weapons = Array.isArray(d.weapons) ? d.weapons : ['sword'];
      COMBAT.characters = Array.isArray(d.characters) ? d.characters : ['lyra'];
      COMBAT.skins = Array.isArray(d.skins) ? d.skins : ['default'];
      COMBAT.weapon = WPN[d.weapon] ? d.weapon : 'sword';
      COMBAT.character = CHR[d.character] ? d.character : 'lyra';
      COMBAT.skin = SKN[d.skin] ? d.skin : 'default';
      COMBAT.kills = d.kills || 0;
    } catch (e) { }
  }

  function addScore(n) { COMBAT.score += n; saveCombat(); updateCombatHUD(); }
  function addGold(n) { COMBAT.gold += n; saveCombat(); updateCombatHUD(); }

  /* Hook the world combat engine to the reward economy. */
  function initCombat() {
    loadCombat();
    saveCombat();   // ensure a baseline record exists from the first session
    WORLD.setCombatHooks({
      onHit: function (enemy, dmg, combo, isSkill) {
        const s = COMBAT_RULES.hitScore + (combo || 0);
        const g = COMBAT_RULES.hitGold;
        addScore(s); addGold(g);
        if (Math.random() < 0.45) floatReward('+' + s + '  +' + g + 'g', enemy.group.position);
      },
      onKill: function (enemy) {
        COMBAT.kills++;
        addScore(enemy.type.score); addGold(enemy.type.gold);
        toast('⚔ ' + enemy.type.name + ' defeated! <b>+' + enemy.type.score + ' score</b> · <b>+' + enemy.type.gold + ' gold</b>', 1800);
        floatReward('+' + enemy.type.score + '  +' + enemy.type.gold + 'g', enemy.group.position, true);
        saveCombat();
      },
      onHurt: function (enemy) {
        if (COMBAT.hurtCd > 0) return;
        COMBAT.hurtCd = 1.0;
        const el = $('hurtFlash'); if (el) { el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0'; }, 260); }
      }
    });
    WORLD.equipWeapon(COMBAT.weapon);
    WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
    WORLD.setCombatEnabled(true);
    updateCombatHUD();
  }
  COMBAT.hurtCd = 0;

  /* Floating reward text in screen space (lightweight, no 3D text needed). */
  function floatReward(text, worldPos, big) {
    const el = document.createElement('div');
    el.className = 'floatReward' + (big ? ' big' : '');
    el.textContent = text;
    const v = new THREE.Vector3(worldPos.x, worldPos.y + 1.4, worldPos.z).project(WORLD.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    $('floatLayer').appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  /* Perform a player attack. combo advances within a short window. */
  function playerAttack(isSkill) {
    if (!started || paused || state !== STATE.WORLD) return;
    const now = performance.now() / 1000;
    if (now - COMBAT.lastHit > COMBAT_RULES.comboWindow) COMBAT.combo = 0;
    if (isSkill) {
      if (COMBAT.skillCd > 0) { toast('Skill recharging — ' + COMBAT.skillCd.toFixed(1) + 's'); return; }
      COMBAT.skillCd = COMBAT_RULES.skillCooldown;
    }
    const w = WPN[COMBAT.weapon];
    if (now - COMBAT.lastHit < w.rate * 0.75 && !isSkill) return;  // rate limit
    const comboStep = isSkill ? 0 : COMBAT.combo;
    const res = WORLD.performAttack(w, comboStep, !!isSkill);
    COMBAT.lastHit = now;
    if (res.hit) {
      COMBAT.combo = Math.min(COMBAT_RULES.comboCap, COMBAT.combo + 1);
      COMBAT.comboTimer = now + COMBAT_RULES.comboWindow;
      const cb = $('comboBadge');
      if (cb) { cb.textContent = COMBAT.combo + ' HIT COMBO'; cb.classList.add('show'); clearTimeout(COMBAT._comboHide); COMBAT._comboHide = setTimeout(() => cb.classList.remove('show'), 1300); }
    }
  }

  function tickCombat(dt) {
    if (COMBAT.skillCd > 0) COMBAT.skillCd = Math.max(0, COMBAT.skillCd - dt);
    if (COMBAT.hurtCd > 0) COMBAT.hurtCd = Math.max(0, COMBAT.hurtCd - dt);
    const sk = $('skillFill'); if (sk) sk.style.width = (100 * (1 - COMBAT.skillCd / COMBAT_RULES.skillCooldown)) + '%';
  }

  /* ---------------- helpers ---------------- */
  const COMP = Object.fromEntries(COMPOUNDS.map(c => [c.id, c]));
  const DC = Object.fromEntries(DOTCROSS.map(d => [d.id, d]));
  const TERM = Object.fromEntries(GLOSSARY.map(g => [g.id, g]));

  function tierOfNode(n) {
    if (n.type === 'npc') return COMP[n.compound].tier;
    if (n.type === 'chest') return DC[n.dc].tier;
    return 1;
  }
  function isLockedNode(n) {
    const t = tierOfNode(n);
    if (t >= 2 && correctCount < 3) return { locked: true, need: 3 };
    if (t >= 3 && correctCount < 6) return { locked: true, need: 6 };
    return { locked: false };
  }

  /* ---------------- HUD ---------------- */
  function mainDone() { return NODES.filter(n => n.main && done.has(n.id)).length; }

  /* ---------------- account progress bridge ---------------- */
  // The account system only touches game state through these two functions: snapshot exports, apply restores.
  function snapshotProgress() {
    return {
      v: 1,
      done: [...done],
      correct: correctCount,
      freePass: freePass,
      wp: [...unlockedWp],
      beacon: JSON.parse(JSON.stringify(WORLD.BEACON_CFG)),
      coach: (function () { try { return !!localStorage.getItem('bq_coach_v2'); } catch (e) { return false; } })(),
      combat: {
        score: COMBAT.score, gold: COMBAT.gold, weapons: COMBAT.weapons.slice(),
        characters: COMBAT.characters.slice(), skins: COMBAT.skins.slice(),
        weapon: COMBAT.weapon, character: COMBAT.character, skin: COMBAT.skin, kills: COMBAT.kills
      }
    };
  }

  function applyProgress(p) {
    if (!p) return;
    done.clear();
    nodeCorrect.clear();
    (p.done || []).forEach(function (id) { done.add(id); nodeCorrect.set(id, true); });
    correctCount = p.correct || 0;
    freePass = p.freePass || 0;

    unlockedWp.clear();
    WAYPOINTS.forEach(function (w) { if (w.start) unlockedWp.add(w.id); });
    (p.wp || []).forEach(function (id) { if (wpById(id)) unlockedWp.add(id); });
    applyWaypoints();

    if (p.beacon) Object.assign(WORLD.BEACON_CFG, p.beacon);
    if (p.combat) {
      const c = p.combat;
      COMBAT.score = c.score || 0; COMBAT.gold = c.gold || 0; COMBAT.kills = c.kills || 0;
      COMBAT.weapons = Array.isArray(c.weapons) && c.weapons.length ? c.weapons : ['sword'];
      COMBAT.characters = Array.isArray(c.characters) && c.characters.length ? c.characters : ['lyra'];
      COMBAT.skins = Array.isArray(c.skins) && c.skins.length ? c.skins : ['default'];
      COMBAT.weapon = WPN[c.weapon] ? c.weapon : 'sword';
      COMBAT.character = CHR[c.character] ? c.character : 'lyra';
      COMBAT.skin = SKN[c.skin] ? c.skin : 'default';
      WORLD.equipWeapon(COMBAT.weapon);
      WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
      saveCombat();
      updateCombatHUD();
    }

    refreshLocks();
    updateHUD();
    renderQuestPanel();
    applyWaypoints();
  }

  /* ---------------- quest tracking ---------------- */
  let trackedId = null;
  let lastListSig = '';
  let lastBeaconNode = null;

  function nextMainNode() {
    return NODES.filter(n => n.main && !done.has(n.id))
      .sort((a, b) => NODES.indexOf(a) - NODES.indexOf(b))[0] || null;
  }
  function trackedNode() {
    if (trackedId) {
      const n = NODES.find(x => x.id === trackedId);
      if (n && !done.has(n.id)) return n;
      trackedId = null;
    }
    return nextMainNode();
  }
  function nodeTitle(n) {
    if (n.type === 'npc') return 'Classify ' + COMP[n.compound].f;
    if (n.type === 'chest') return 'Dot-cross: ' + DC[n.dc].compound;
    if (n.type === 'guild') return n.label ? n.label.en : 'Adventurers\' Guild';
    if (n.type === 'shop') return n.label ? n.label.en : 'Chem Supply Shop';
    return 'Vocab shard: ' + TERM[n.term].en;
  }
  function nodeDesc(n) {
    if (n.type === 'npc') return 'Talk to "' + n.label.en + '" and answer 3 steps: composition → electron behaviour → bond type.';
    if (n.type === 'chest') return 'Open "' + n.label.en + '" and draw the dot-and-cross diagram for ' + DC[n.dc].compound + '.';
    if (n.type === 'guild') return 'Browse every quest and its location, then pick your next objective.';
    if (n.type === 'shop') return 'Spend shards on hints and unlocks.';
    return 'Collect this shard to unlock the word "' + TERM[n.term].en + '".';
  }
  function shortLabel(n) {
    if (n.type === 'guild') return 'Guild';
    if (n.type === 'shop') return 'Shop';
    return nodeTitle(n);
  }
  const BEAR = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function bearingText(dx, dz) {
    let deg = Math.atan2(dx, -dz) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return BEAR[Math.round(deg / 45) % 8];
  }

  function qpItem(n, num, current) {
    const isDone = done.has(n.id);
    const lock = isLockedNode(n).locked;
    const cls = 'qpItem' + (isDone ? ' done' : '') + (lock && !isDone ? ' lock' : '') + (current && current.id === n.id ? ' cur' : '');
    const icon = isDone ? '✓' : (lock ? '!' : num);
    const sub = (n.type === 'crystal' ? 'Vocab shard' : (n.label ? n.label.en : '')) + (isDone ? ' · Done' : '');
    return '<div class="' + cls + '" data-id="' + n.id + '">' +
      '<div class="qiIcon">' + icon + '</div>' +
      '<div class="qiBody"><div class="qiName">' + nodeTitle(n) + '</div>' +
      '<div class="qiSub">' + sub + '</div></div></div>';
  }

  function renderQuestList(current) {
    const sig = NODES.map(n => (done.has(n.id) ? '1' : '0')).join('') + '|' + (current ? current.id : '-') + '|' + correctCount;
    if (sig === lastListSig) return;
    lastListSig = sig;

    const mains = NODES.filter(n => n.main);
    const sides = NODES.filter(n => !n.main && n.type !== 'crystal');
    const crys = NODES.filter(n => n.type === 'crystal');

    let html = '<div class="qpSect">MAIN</div>';
    mains.forEach((n, i) => { html += qpItem(n, i + 1, current); });
    html += '<div class="qpSect">SIDE</div>';
    sides.forEach(n => { html += qpItem(n, '·', current); });
    html += '<div class="qpSect">GLOSSARY</div>';
    crys.forEach(n => { html += qpItem(n, '·', current); });
    $('qpList').innerHTML = html;

    $('qpList').querySelectorAll('.qpItem').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (done.has(id)) return;
        trackedId = id;
        lastListSig = '';
        renderQuestPanel();
        toast('✓ Objective set: ' + nodeTitle(NODES.find(x => x.id === id)));
        if (mapOpen) drawBigMap();
      });
    });
  }

  let questCollapsed = false;
  function setQuestCollapsed(v) {
    questCollapsed = !!v;
    $('questPanel').classList.toggle('collapsed', questCollapsed);
    $('qpTab').classList.toggle('show', questCollapsed);
    $('qpFoldBtn').setAttribute('aria-expanded', String(!questCollapsed));
    $('qpTab').setAttribute('aria-expanded', String(!questCollapsed));
  }

  function renderQuestPanel() {
    const t = trackedNode();
    if (t !== lastBeaconNode) {
      lastBeaconNode = t;
      WORLD.setBeacon(t);
    }
    $('qpDone').textContent = mainDone();
    $('qpTotal').textContent = MAIN_TOTAL;
    $('qpBarFill').style.width = (mainDone() / MAIN_TOTAL * 100) + '%';

    if (!t) {
      $('qpTag').textContent = 'MAIN COMPLETE · ALL DONE';
      $('qpName').textContent = 'All main quests complete!';
      $('qpDesc').textContent = 'Keep exploring side quests, collect vocabulary, or press "↓" to export your data.';
      $('qpDist').textContent = '—';
      $('qpBear').textContent = '';
      $('qpStep').textContent = '';
      $('qpArrow').style.transform = 'rotate(0deg)';
    } else {
      const p = WORLD.player.position;
      const dx = t.x - p.x, dz = t.z - p.z;
      const dist = Math.hypot(dx, dz);
      const lock = isLockedNode(t);
      $('qpTag').textContent = t.main ? 'CURRENT OBJECTIVE' : 'SIDE QUEST';
      $('qpName').textContent = nodeTitle(t);
      $('qpDesc').textContent = nodeDesc(t) + ' Press E when you arrive.';
      $('qpDist').textContent = Math.round(dist) + ' m away';
      $('qpBear').textContent = '· ' + bearingText(dx, dz);

      const fx = -Math.sin(WORLD.yaw), fz = -Math.cos(WORLD.yaw);
      const rx = Math.cos(WORLD.yaw), rz = -Math.sin(WORLD.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      $('qpArrow').style.transform = 'rotate(' + (ang * 180 / Math.PI) + 'deg)';

      if (lock.locked && freePass > 0) {
        $('qpStep').textContent = 'You hold a Guild Pass — you can enter directly. Walk there and press E.';
      } else if (lock.locked) {
        $('qpStep').textContent = 'Locked: complete ' + lock.need + ' questions to unlock (you have ' + correctCount + ').';
      } else if (dist <= (t.ir || 3.6)) {
        $('qpStep').textContent = 'You\'ve arrived — press E to ' +
          (t.type === 'npc' ? 'answer questions' : t.type === 'chest' ? 'open the chest'
            : t.type === 'guild' ? 'browse quests' : t.type === 'shop' ? 'open the shop' : 'collect the shard') + '.';
      } else {
        $('qpStep').textContent = 'Follow the white arrow ' + bearingText(dx, dz) + ' for ' + Math.round(dist) + ' m, or press M for the big map.';
      }
    }
    renderQuestList(t);
  }

  function updateHUD() {
    const Z = ZONES[WORLD.zoneNow];
    $('zoneLabel').textContent = Z.en;
    $('counterNum').textContent = mainDone();
    $('counterTotal').textContent = MAIN_TOTAL;
    const tDone = $('qpTabDone'), tTotal = $('qpTabTotal');
    if (tDone) tDone.textContent = mainDone();
    if (tTotal) tTotal.textContent = MAIN_TOTAL;

    const m = Math.floor(activeTime / 60), s = Math.floor(activeTime % 60);
    $('timerPill').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

    renderQuestPanel();
  }

  function updateCombatHUD() {
    const sn = $('scoreNum'); if (sn) sn.textContent = COMBAT.score;
    const gn = $('goldNum'); if (gn) gn.textContent = COMBAT.gold;
    const wn = $('weaponName'); if (wn) wn.textContent = (WPN[COMBAT.weapon] || WPN.sword).name;
    const cn = $('charName'); if (cn) cn.textContent = (CHR[COMBAT.character] || CHR.lyra).name;
    const wp = $('weaponPill'); if (wp) wp.title = 'Equipped weapon · press 1–5 to swap';
    const cp = $('charPill'); if (cp) cp.title = 'Active character · press C to switch';
  }

  /* ---------------- interaction prompt ---------------- */
  function refreshPrompt() {
    if (state !== STATE.WORLD || !started) { $('prompt').classList.remove('show'); return; }
    const p = $('prompt');
    const wpNear = nearWpInfo(3.9);
    const n = WORLD.nearestNode(3.6);
    const pp = WORLD.player.position;
    const dn = n ? Math.hypot(n.x - pp.x, n.z - pp.z) : Infinity;
    if (wpNear && wpNear.d < dn) {
      p.innerHTML = unlockedWp.has(wpNear.wp.id)
        ? 'Press <kbd>E</kbd> to teleport from ' + wpNear.wp.name.en
        : 'Press <kbd>E</kbd> to activate waypoint · ' + wpNear.wp.name.en;
      p.classList.add('show');
      return;
    }
    if (!n) { p.classList.remove('show'); return; }
    const lock = isLockedNode(n);
    if (lock.locked) {
      p.innerHTML = '🔒 Unlocks after ' + lock.need + ' correct answers (you have ' + correctCount + ')';
    } else if (n.type === 'npc') {
      p.innerHTML = 'Press <kbd>E</kbd> to talk to ' + n.label.en + ' — answer 3 questions';
    } else if (n.type === 'chest') {
      p.innerHTML = 'Press <kbd>E</kbd> to open ' + n.label.en + ' — draw the diagram';
    } else if (n.type === 'guild') {
      p.innerHTML = 'Press <kbd>E</kbd> to enter the Guild — browse all quests';
    } else if (n.type === 'shop') {
      p.innerHTML = 'Press <kbd>E</kbd> to enter the Shop — spend shards';
    } else {
      p.innerHTML = 'Press <kbd>E</kbd> to collect a vocab shard';
    }
    p.classList.add('show');
  }

  /* ---------------- modal helpers ---------------- */
  function syncPaused() {
    paused = (state !== STATE.WORLD) || helpOpen || mapOpen || coachOn || shopOpen || guildOpen || beaconOpen || wpOpen || charModalOpen || $('glossaryDrawer').classList.contains('show');
    if (paused) { const cb = $('comboBadge'); if (cb) cb.classList.remove('show'); }
  }
  function openModal(id) {
    $(id).classList.add('show');
    syncPaused();
  }
  function closeModal(id) {
    $(id).classList.remove('show');
    syncPaused();
  }
  function setState(s) {
    state = s;
    WORLD.setLocked(s !== STATE.WORLD);
    syncPaused();
  }

  /* ================= DIALOG (classification) ================= */
  let dlg = null;

  function optionSets(c) {
    const s1 = [
      { v: 1, en: 'A metal + a non-metal', zh: '' },
      { v: 2, en: 'Non-metal atoms only', zh: '' },
      { v: 3, en: 'Metal atoms only', zh: '' }
    ];
    const s2 = [
      { v: 1, en: 'Electron transfer', zh: '' },
      { v: 2, en: 'Electron sharing', zh: '' },
      { v: 3, en: 'Delocalised electrons', zh: '' }
    ];
    const s3 = [
      { v: 1, en: 'Ionic bond', zh: '' },
      { v: 2, en: 'Covalent bond', zh: '' },
      { v: 3, en: 'Metallic bond', zh: '' }
    ];
    return [s1, s2, s3];
  }

  function explain(c, step) {
    if (step === 1) {
      if (c.comp === 1) return { en: 'One metal + one non-metal: the metal will lose electrons and the non-metal will gain them.', zh: '' };
      if (c.comp === 2) return { en: 'All the atoms are non-metals, so no atom easily loses electrons — they share electrons instead.', zh: '' };
      return { en: 'Only metal atoms are present: their valence electrons are free to move through the whole structure.', zh: '' };
    }
    if (step === 2) {
      if (c.ebeh === 1) return { en: 'Electrons are transferred from the metal to the non-metal, forming positive and negative ions.', zh: '' };
      if (c.ebeh === 2) return { en: 'Each atom shares pairs of electrons so both reach a full outer shell.', zh: '' };
      return { en: 'Valence electrons are delocalised into a "sea of electrons" shared by all the metal ions.', zh: '' };
    }
    if (c.bond === 1) return { en: 'Oppositely charged ions attract each other electrostatically — that is the ionic bond.', zh: '' };
    if (c.bond === 2) return { en: 'The shared electron pairs are attracted to both nuclei — that is the covalent bond.', zh: '' };
    return { en: 'The positive metal ions are held by the delocalised electrons around them — that is the metallic bond.', zh: '' };
  }

  /* ---------------- three-part error feedback ---------------- */
  const NUMC = ['①', '②', '③', '④', '⑤'];

  function wxCard(you, why, rule, title, opts) {
    const o = opts || {};
    const attr = o.atom === undefined ? '' : ' data-hi="' + o.atom + '"';
    return '<div class="wx"' + attr + '>' +
      (title ? '<div class="wxTitle">' + title + '</div>' : '') +
      '<div class="wxRow"><div class="wxTag you">YOUR ANSWER</div>' +
        '<div class="wxTxt"><span class="wxEn">' + you.en + '</span></div></div>' +
      '<div class="wxRow"><div class="wxTag why">WHY IT FAILS</div>' +
        '<div class="wxTxt"><span class="wxEn">' + why.en + '</span></div></div>' +
      '<div class="wxRow"><div class="wxTag rule">THE RULE</div>' +
        '<div class="wxTxt"><span class="wxEn">' + rule.en + '</span></div></div>' +
      (o.tapHint ? '<div class="wxTap">' + o.tapHint + '</div>' : '') +
      '</div>';
  }

  function stepRule(step) {
    if (step === 1) return {
      en: 'Read the formula first: metal + non-metal → electrons are transferred; non-metals only → electrons are shared; metal only → electrons are delocalised.',
      zh: ''
    };
    if (step === 2) return {
      en: 'Electron behaviour follows the composition: transfer for metal + non-metal, sharing for non-metals only, delocalised for metals only.',
      zh: ''
    };
    return {
      en: 'The bond type follows the electron behaviour: transfer → ionic bond; sharing → covalent bond; delocalised → metallic bond.',
      zh: ''
    };
  }

  function stepWhy(c, step, chosen) {
    const f = c.f;
    if (step === 1) {
      if (c.comp === 1) {
        if (chosen === 2) return {
          en: f + ' contains a metal as well as a non-metal, so "non-metals only" cannot be right.',
          zh: f + ''
        };
        return {
          en: f + ' contains a non-metal as well as a metal, so it is not "metal atoms only".',
          zh: f + ''
        };
      }
      if (c.comp === 2) {
        if (chosen === 1) return {
          en: 'There is no metal in ' + f + ' — every atom is a non-metal, so it cannot be metal + non-metal.',
          zh: f + ''
        };
        return {
          en: 'There is no metal atom in ' + f + '; all the atoms are non-metals.',
          zh: f + ''
        };
      }
      if (chosen === 1) return {
        en: f + ' is a single metal — there is no non-metal in the formula.',
        zh: f + ''
      };
      return {
        en: 'The atom in ' + f + ' is a metal, not a non-metal.',
        zh: f + ''
      };
    }

    if (step === 2) {
      if (c.ebeh === 1) {
        if (chosen === 2) return {
          en: 'In ' + f + ' the metal loses its outer electron(s) and the non-metal gains them. The electron moves completely from one atom to the other — that is transfer, not sharing.',
          zh: f + ''
        };
        return {
          en: 'Delocalisation only happens in a metal lattice. In ' + f + ' the electrons stay with a particular ion, so they are not free to move around.',
          zh: '' + f + ''
        };
      }
      if (c.ebeh === 2) {
        if (chosen === 1) return {
          en: 'Both atoms in ' + f + ' are non-metals; neither loses electrons easily, so no complete transfer happens.',
          zh: f + ''
        };
        return {
          en: 'There is no metal lattice in ' + f + ', so there is no "sea" of delocalised electrons.',
          zh: f + ''
        };
      }
      if (chosen === 1) return {
        en: 'The outer electrons in ' + f + ' do not move to a particular atom — they leave their atoms and move through the whole structure.',
        zh: f + ''
      };
      return {
        en: 'Metals do not form fixed shared pairs; their valence electrons are delocalised.',
        zh: ''
      };
    }

    if (c.bond === 1) {
      if (chosen === 2) return {
        en: 'A covalent bond comes from a shared pair. In ' + f + ' the electrons were transferred to make ions, so the attraction is between ions — not a shared pair.',
        zh: '' + f + ''
      };
      return {
        en: 'A metallic bond needs a metal lattice with delocalised electrons. ' + f + ' is an ionic lattice.',
        zh: '' + f + ''
      };
    }
    if (c.bond === 2) {
      if (chosen === 1) return {
        en: 'An ionic bond needs positive and negative ions. ' + f + ' has no ions — only shared electron pairs.',
        zh: '' + f + ''
      };
      return {
        en: f + ' is not a metal, so there is no electron sea and no metallic bond.',
        zh: f + ''
      };
    }
    if (chosen === 1) return {
      en: 'There are no positive and negative ions in ' + f + '; it is positive metal ions surrounded by delocalised electrons.',
      zh: f + ''
    };
    return {
      en: 'There are no shared pairs in ' + f + '; the valence electrons are delocalised.',
      zh: f + ''
    };
  }

  function openDialog(node) {
    const c = COMP[node.compound];
    dlg = { node, c, step: 0, picks: [], hintUsed: false, wrongSteps: 0 };
    $('npcName').textContent = node.label.en + ' · ' + c.f;
    $('npcAvatar').textContent = c.f.replace(/[₀-₉]/g, '').slice(0, 2);
    $('npcLine').textContent = 'Help me classify ' + c.f + ' — answer three quick steps: composition, electron behaviour, bond type.';
    setState(STATE.DIALOG);
    openModal('dialogModal');
    renderDialogStep();
  }

  function renderDialogStep() {
    const c = dlg.c;
    const sets = optionSets(c);
    const stepLabel = ['Step 1 · Composition', 'Step 2 · Electron behaviour', 'Step 3 · Bond type'][dlg.step];

    let opts = sets[dlg.step].slice();
    const expected = [c.comp, c.ebeh, c.bond][dlg.step];
    if (c.trap && c.trap.step === dlg.step + 1) {
      opts.push({ v: -1, en: c.trap.en, trap: true });
    }
    if (dlg.shuffleSeed === undefined) dlg.shuffleSeed = Math.floor(Math.random() * 999);
    // stable-ish shuffle per step
    const order = opts.map((o, i) => i);
    let sd = dlg.shuffleSeed + dlg.step * 37;
    for (let i = order.length - 1; i > 0; i--) {
      sd = (sd * 9301 + 49297) % 233280;
      const j = Math.floor(sd / 233280 * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const shuffled = order.map(i => opts[i]);

    $('stepDots').innerHTML = [0, 1, 2].map(i =>
      '<div class="d ' + (i < dlg.step ? 'done' : i === dlg.step ? 'on' : '') + '"></div>').join('');

    $('dialogBody').innerHTML =
      '<div class="qBlock">' + stepLabel + '</div>' +
      '<div class="qZh">Choose the best answer, then press Next.</div>' +
      '<div class="options" id="dlgOpts">' +
      shuffled.map((o, i) =>
        '<button class="opt" data-v="' + o.v + '" data-i="' + i + '">' + o.en + '</button>').join('') +
      '</div>' +
      '<div class="fb" id="dlgFb"></div>';

    $('dlgOpts').querySelectorAll('.opt').forEach(btn => {
      btn.addEventListener('click', () => pickOption(btn, expected, opts));
    });
    $('dialogHintBtn').style.display = dlg.hintUsed ? 'none' : '';
  }

  function pickOption(btn, expected, opts) {
    const v = Number(btn.dataset.v);
    const c = dlg.c;
    const ok = v === expected;
    const fb = $('dlgFb');
    $('dlgOpts').querySelectorAll('.opt').forEach(b => {
      b.disabled = true;
      const bv = Number(b.dataset.v);
      if (bv === expected) b.classList.add('correct');
      else if (b === btn) b.classList.add('wrong');
      else b.classList.add('dim');
    });

    let ex = explain(c, dlg.step + 1);
    if (!ok) {
      dlg.wrongSteps++;
      const chosenOpt = opts.find(o => o.v === v) || { en: '—' };
      const why = (v === -1 && c.trap) ? c.trap.why : stepWhy(c, dlg.step + 1, v);
      const rule = stepRule(dlg.step + 1);
      fb.className = 'fb show no';
      fb.innerHTML = '<div class="fbHead">✗ Not quite — check the three parts below</div>' +
        wxCard(chosenOpt, why, rule, '');
      setTimeout(() => { try { fb.scrollIntoView({ block: 'start' }); } catch (e) { } }, 30);
    } else {
      fb.className = 'fb show ok';
      fb.innerHTML = '✓ ' + ex.en;
    }
    if (c.note && dlg.step === 2) {
      fb.innerHTML += '<span class="fbZh" style="margin-top:8px">💡 ' + c.note.en + '</span>';
    }

    attempts.push({
      type: 'classify', compound: c.f, step: dlg.step + 1,
      chosen: v, correct: ok, hintUsed: dlg.hintUsed, attempt: 1
    });
    logEvent({ type: 'classify', compound: c.f, step: dlg.step + 1, chosen: v, correct: ok, hintUsed: dlg.hintUsed });

    const foot = document.createElement('div');
    foot.style.marginTop = '14px';
    foot.style.display = 'flex';
    foot.style.justifyContent = 'flex-end';
    const nb = document.createElement('button');
    nb.className = 'primary';
    nb.style.width = 'auto';
    nb.textContent = dlg.step < 2 ? 'Next' : 'Finish';
    nb.addEventListener('click', () => {
      if (dlg.step < 2) { dlg.step++; renderDialogStep(); }
      else finishDialog();
    });
    const old = $('dialogBody').querySelector('.dlgNext');
    if (old) old.remove();
    foot.className = 'dlgNext';
    foot.appendChild(nb);
    $('dialogBody').appendChild(foot);
  }

  function finishDialog() {
    const c = dlg.c;
    const clean = dlg.wrongSteps === 0;
    const perfect = clean && !dlg.hintUsed;
    if (clean && !nodeCorrect.get(dlg.node.id)) {
      correctCount++;
      nodeCorrect.set(dlg.node.id, true);
    }
    done.add(dlg.node.id);
    WORLD.setNodeState(dlg.node.id, 'done');
    $('dialogBody').innerHTML =
      '<div class="fb show ok" style="margin-top:0">' +
      (perfect ? '★ Perfect! You have fully mastered the classification of ' + c.f + '.'
               : clean ? '✓ ' + c.f + ' classified. You used a hint — try explaining the reasoning again yourself.'
                       : '✓ ' + c.f + ' classified. You missed a step — review the explanation above.') +
      '<span class="fbZh">Main progress: ' + mainDone() + ' / ' + MAIN_TOTAL + '</span></div>';
    $('dialogHintBtn').style.display = 'none';
    $('dialogCloseBtn').textContent = 'Back to world';
    refreshLocks();
    toast((dlg.node.main ? '✓ Quest complete! +1 — ' : '✓ Side quest complete — ') + c.f + ' classified');
  }

  function closeDialog() {
    closeModal('dialogModal');
    setState(STATE.WORLD);
    $('dialogCloseBtn').textContent = 'Leave';
    dlg = null;
    updateHUD();
    checkAllMainDone();
    WORLD.relock();
  }

  $('dialogCloseBtn').addEventListener('click', closeDialog);
  $('dialogHintBtn').addEventListener('click', () => {
    if (!dlg) return;
    dlg.hintUsed = true;
    $('dialogHintBtn').style.display = 'none';
    const c = dlg.c;
    const ex = explain(c, dlg.step + 1);
    const fb = $('dlgFb');
    fb.className = 'fb show no';
    fb.innerHTML = 'Hint: ' + ex.en + '<span class="fbZh">(Using a hint means this attempt will not count as perfect.)</span>';
  });

  /* ================= DOT-AND-CROSS ================= */
  let dcq = null;

  function angDist(a, b) {
    let d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  }

  function openDotCross(node) {
    dcq = {
      node, q: DC[node.dc], marks: {}, charges: {}, bracket: false,
      tool: 'dot', tries: 0, hintUsed: false, hintSlot: null, solved: false, hiAtom: -1
    };
    const q = dcq.q;
    $('dcTitle').textContent = q.compound + ' — Dot-and-cross diagram';
    $('dcSub').textContent = q.type === 'ionic'
      ? 'Ionic compound: draw the outer-shell electrons of each ion, then add square brackets and charges'
      : 'Covalent compound: draw shared electron pairs (one dot + one cross) and lone pairs';
    $('dcFeedback').className = 'dcFeedback';
    $('dcFeedback').innerHTML = '';
    $('dcCheckBtn').textContent = 'Check';
    $('dcToolbar').className = 'dcToolbar' + (q.type === 'ionic' ? ' ionic' : '');
    $('dcToolbar').innerHTML =
      '<button class="toolBtn active" data-tool="dot">• Dot</button>' +
      '<button class="toolBtn" data-tool="cross">× Cross</button>' +
      '<button class="toolBtn" data-tool="erase">⌫ Erase</button>' +
      '<span class="toolSep"></span>' +
      '<button class="toolBtn ionOnly" id="dcBracketBtn">[ ] Brackets</button>';
    $('dcToolbar').querySelectorAll('[data-tool]').forEach(b => {
      b.addEventListener('click', () => {
        dcq.tool = b.dataset.tool;
        $('dcToolbar').querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b));
      });
    });
    const bb = $('dcBracketBtn');
    if (bb) bb.addEventListener('click', () => {
      dcq.bracket = !dcq.bracket;
      bb.classList.toggle('active', dcq.bracket);
      renderDC();
    });

    setState(STATE.DOTCROSS);
    openModal('dotcrossModal');
    renderDC();
  }

  function dcSlots(q) {
    const slots = [];
    const atoms = q.atoms;
    atoms.forEach((a, i) => {
      const bondAngles = [];
      q.bonds.forEach(b => {
        if (b.a === i) bondAngles.push(Math.atan2(atoms[b.b].y - a.y, atoms[b.b].x - a.x));
        if (b.b === i) bondAngles.push(Math.atan2(atoms[b.a].y - a.y, atoms[b.a].x - a.x));
      });
      if (a.lonePairs > 0) {
        const cands = [];
        for (let k = 0; k < 24; k++) {
          const ang = k / 24 * Math.PI * 2;
          let ok = true;
          for (const ba of bondAngles) { if (angDist(ang, ba) < 0.62) { ok = false; break; } }
          if (ok) cands.push(ang);
        }
        const n = a.lonePairs;
        for (let k = 0; k < n && cands.length; k++) {
          const ang = cands[Math.min(cands.length - 1, Math.floor(k * cands.length / n))];
          slots.push({
            kind: 'lone', atom: i,
            x: a.x + Math.cos(ang) * (a.r + 19),
            y: a.y + Math.sin(ang) * (a.r + 19),
            max: 2
          });
        }
      }
    });
    q.bonds.forEach(b => {
      const A = atoms[b.a], B = atoms[b.b];
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const midx = (A.x + B.x) / 2, midy = (A.y + B.y) / 2;
      for (let p = 0; p < b.pairs; p++) {
        const off = (p - (b.pairs - 1) / 2) * 26;
        slots.push({ kind: 'bond', a: b.a, b: b.b, x: midx - uy * off, y: midy + ux * off, max: 2 });
      }
    });
    return slots;
  }

  function dcState() {
    const q = dcq.q;
    const slots = dcq.slots || [];
    let filled = 0;
    slots.forEach((s, si) => { if ((dcq.marks[si] || []).length >= 2) filled++; });
    const ionic = q.type === 'ionic';
    const chargesOk = !ionic || q.atoms.every((a, i) => (dcq.charges[i] || 0) === a.charge);
    return { filled, total: slots.length, ionic, chargesOk, bracket: !!dcq.bracket };
  }

  // Live checklist: each step's completion is worked out from the actual drawing, and the next action is highlighted.
  function renderDCHelp() {
    if (!dcq) return;
    const st = dcState();
    const steps = [{ txt: 'Fill every electron slot on the diagram', note: st.filled + ' / ' + st.total + ' pairs', done: st.total > 0 && st.filled === st.total }];
    if (st.ionic) {
      steps.push({ txt: 'Put square brackets [ ] around each ion', done: st.bracket });
      steps.push({ txt: 'Set the charge of each ion', done: st.chargesOk });
    }
    steps.push({ txt: 'Press "Check" to see your result', done: false, act: true });

    const firstTodo = steps.findIndex(s => !s.done);
    $('dcSteps').innerHTML = steps.map((s, i) => {
      const cls = s.done ? 'done' : (i === firstTodo ? 'doing' : 'todo');
      return '<li class="dcStep ' + cls + '">' +
        '<span class="dcStepNum">' + (s.done ? '✓' : (i + 1)) + '</span>' +
        '<span class="dcStepTxt">' + s.txt + (s.note ? '<em>' + s.note + '</em>' : '') + '</span>' +
        '</li>';
    }).join('');

    const graded = steps.length - 1;
    const doneCount = steps.slice(0, graded).filter(s => s.done).length;
    $('dcHowProg').textContent = doneCount + ' / ' + graded + ' done';

    let msg;
    if (firstTodo < 0 || steps[firstTodo].act) {
      msg = 'All steps done — press <b>"Check"</b> at the bottom right.';
    } else if (firstTodo === 0) {
      const left = st.total - st.filled;
      msg = '<b>Click a dashed slot twice</b>: the 1st click places •, the 2nd adds another electron. ' +
        'Lone pairs use <b>••</b>; bond pairs use <b>• + ×</b>. <b>' + left + '</b> pair(s) still to place.';
    } else if (!st.bracket) {
      msg = 'Click the <b>[ ] Brackets</b> button above to enclose every ion — this shows which electrons belong to that ion.';
    } else if (!st.chargesOk) {
      msg = 'Choose the charges below: <b>metal ions are positive</b> (they lost electrons), <b>non-metal ions are negative</b> (they gained electrons).';
    } else {
      msg = 'Press <b>"Check"</b> at the bottom right to see if you got it right.';
    }
    $('dcNow').innerHTML = msg;
  }

  function renderDC() {
    const q = dcq.q;
    const slots = dcSlots(q);
    dcq.slots = slots;
    const atoms = q.atoms;

    let svg = '<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">';
    atoms.forEach((a, i) => {
      if (dcq.bracket) {
        svg += '<rect x="' + (a.x - a.r - 15) + '" y="' + (a.y - a.r - 15) + '" width="' + (a.r * 2 + 30) + '" height="' + (a.r * 2 + 30) + '" rx="8" fill="none" stroke="#8ff0c8" stroke-width="2"/>';
      }
      svg += '<circle cx="' + a.x + '" cy="' + a.y + '" r="' + a.r + '" fill="rgba(60,120,110,.15)" stroke="#7fd8bd" stroke-width="2"/>';
      svg += '<text x="' + a.x + '" y="' + (a.y + 10) + '" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="600" fill="#eafff7">' + a.sym + '</text>';
      if (q.type === 'ionic') {
        const ch = dcq.charges[i] || 0;
        if (ch !== 0) {
          const lbl = ch === 1 ? '+' : ch === -1 ? '−' : ch === 2 ? '2+' : '2−';
          svg += '<text x="' + (a.x + a.r + 12) + '" y="' + (a.y - a.r - 4) + '" font-family="sans-serif" font-size="26" font-weight="700" fill="#ffd27a">' + lbl + '</text>';
        }
      }
      if (dcq.hiAtom === i) {
        svg += '<circle class="dcHi" cx="' + a.x + '" cy="' + a.y + '" r="' + (a.r + 30) + '" fill="none" stroke="#ffd27a" stroke-width="2.5" stroke-dasharray="7 5"/>';
      }
    });

    slots.forEach((s, si) => {
      const marks = dcq.marks[si] || [];
      const empty = marks.length === 0;
      svg += '<circle class="slot ' + (dcq.hintSlot === si ? 'slotHint' : '') + '" data-si="' + si + '" data-kind="' + s.kind + '" data-atom="' + (s.atom !== undefined ? s.atom : '') + '" cx="' + s.x + '" cy="' + s.y + '" r="' + (s.kind === 'bond' ? 24 : 20) + '" stroke="' + (empty ? 'rgba(143,240,200,.5)' : 'rgba(255,255,255,.2)') + '" stroke-width="' + (empty ? 1.4 : 1) + '"' + (empty ? ' stroke-dasharray="4 4"' : '') + '/>';
      if (empty) {
        svg += '<circle cx="' + s.x + '" cy="' + s.y + '" r="2" fill="rgba(143,240,200,.45)"/>';
      }
      marks.forEach((m, mi) => {
        const ox = marks.length === 1 ? 0 : (mi === 0 ? -8 : 8);
        svg += '<text x="' + (s.x + ox) + '" y="' + (s.y + 8) + '" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="700" fill="' +
          (m === 'dot' ? '#9ff5d0' : '#ffd27a') + '">' + (m === 'dot' ? '•' : '×') + '</text>';
      });
    });
    svg += '</svg>';

    let extra = '';
    if (q.type === 'ionic') {
      const need2 = atoms.some(a => Math.abs(a.charge) === 2);
      const list = need2 ? [0, 1, -1, 2, -2] : [0, 1, -1];
      extra = '<div class="dcCharges">' +
        atoms.map((a, i) =>
          '<div class="dcChRow"><span class="dcChLab">' + a.sym + ' charge</span>' +
          list.map(v =>
            '<button class="toolBtn dcChBtn' + ((dcq.charges[i] || 0) === v ? ' on' : '') + '" data-ch="' + i + ':' + v + '">' +
            (v === 0 ? '0' : v === 1 ? '+' : v === -1 ? '−' : v === 2 ? '2+' : '2−') + '</button>').join('') +
          '</div>').join('') + '</div>';

      // Explain why some ions have no slots around them — the most common point of confusion.
      const bare = atoms.filter(a => a.lonePairs === 0).map(a => a.sym);
      const withE = atoms.filter(a => a.lonePairs > 0).map(a => a.sym);
      if (bare.length && withE.length) {
        extra += '<div class="dcNote">The outer electrons of ' + bare.join(' and ') +
          ' have been transferred away, so there are <b>no slots</b> around them — place electrons only around ' +
          withE.join(' and ') + '.</div>';
      }
    }
    $('dcStage').innerHTML = svg + extra;

    $('dcStage').querySelectorAll('.slot').forEach(el => {
      el.addEventListener('click', () => {
        const si = Number(el.dataset.si);
        const slot = dcq.slots[si];
        dcq.marks[si] = dcq.marks[si] || [];
        if (dcq.tool === 'erase') dcq.marks[si] = [];
        else if (dcq.marks[si].length < slot.max) dcq.marks[si].push(dcq.tool);
        renderDC();
      });
    });
    $('dcStage').querySelectorAll('[data-ch]').forEach(b => {
      b.addEventListener('click', () => {
        const parts = b.dataset.ch.split(':');
        dcq.charges[Number(parts[0])] = Number(parts[1]);
        dcq.hiAtom = -1;
        renderDC();
      });
    });

    renderDCHelp();
  }

  function checkDC() {
    if (!dcq) return;
    const q = dcq.q;
    const slots = dcq.slots;
    const atoms = q.atoms;
    const errs = [];
    const loneCount = {};
    atoms.forEach((_, i) => { loneCount[i] = 0; });
    let bondShort = 0, bondMix = 0, loneMix = 0;

    slots.forEach((s, si) => {
      const m = dcq.marks[si] || [];
      if (s.kind === 'lone') {
        loneCount[s.atom] += m.length;
        if (m.length === 2 && m[0] !== m[1]) loneMix++;
      } else if (m.length !== 2) {
        bondShort++;
      } else if (!(m.includes('dot') && m.includes('cross'))) {
        bondMix++;
      }
    });

    const fmtC = n => n === 1 ? '+' : n === -1 ? '−' : n === 2 ? '2+' : n === -2 ? '2−' : '0';

    atoms.forEach((a, i) => {
      if (a.lonePairs > 0 && loneCount[i] !== a.lonePairs * 2) {
        const need = a.lonePairs * 2;
        errs.push({
          atom: i,
          title: a.sym + ' — Lone pairs',
          you: { en: a.sym + ' currently has ' + loneCount[i] + ' lone-pair electron(s) drawn.',
                 zh: a.sym + '' + loneCount[i] + '' },
          why: { en: a.sym + ' needs ' + a.lonePairs + ' lone pair' + (a.lonePairs > 1 ? 's' : '') + ' = ' + need + ' electrons' +
                   (a.bondPairs ? ', plus ' + a.bondPairs + ' shared pair' + (a.bondPairs > 1 ? 's' : '') + ' in the bond' + (a.bondPairs > 1 ? 's' : '') : '') +
                   '. Its outer shell therefore holds ' + (need + a.bondPairs * 2) + ' electrons in total.',
                 zh: a.sym + '' + a.lonePairs + '' + need + '' +
                   (a.bondPairs ? '' + a.bondPairs + '' : '') +
                   '' + (need + a.bondPairs * 2) + '' },
          rule: { en: 'Only outer-shell electrons are drawn; the number of lone pairs follows from the outer-shell electron count.',
                  zh: '' }
        });
      }
    });

    if (loneMix) errs.push({
      title: 'Lone-pair symbols',
      you: { en: loneMix + ' lone pair(s) use one dot and one cross.',
             zh: '' + loneMix + '' },
      why: { en: 'A lone pair is supplied by ONE atom, so its two electrons are drawn with the same symbol (both dots or both crosses). Only a shared pair mixes the symbols.',
             zh: '' },
      rule: { en: 'Lone pair = same symbol. Bond pair = 1 dot + 1 cross.',
              zh: '' }
    });

    if (bondShort) errs.push({
      title: 'Bond pairs',
      you: { en: bondShort + ' shared pair(s) have fewer than 2 electrons.',
             zh: '' + bondShort + '' },
      why: { en: 'A shared pair is made of one electron from each atom — so it always contains 2 electrons.',
             zh: '' },
      rule: { en: 'Every bond pair must be drawn as 1 dot + 1 cross.',
              zh: '' }
    });

    if (bondMix) errs.push({
      title: 'Bond-pair symbols',
      you: { en: bondMix + ' shared pair(s) use two symbols of the same kind.',
             zh: '' + bondMix + '' },
      why: { en: 'Two dots would mean one atom supplied both electrons — then it is not a shared pair.',
             zh: '' },
      rule: { en: 'Every bond pair must be drawn as 1 dot + 1 cross.',
              zh: '' }
    });

    if (q.type === 'ionic') {
      if (!dcq.bracket) errs.push({
        title: 'Square brackets',
        you: { en: 'No square brackets are drawn around the ions.',
               zh: '' },
        why: { en: 'In an ionic lattice each ion owns a fixed set of electrons; the brackets show which electrons belong to that ion.',
               zh: '' },
        rule: { en: 'Draw [ ] around every ion and write its charge at the top right.',
                zh: '' }
      });
      atoms.forEach((a, i) => {
        const ch = dcq.charges[i] || 0;
        if (ch !== a.charge) {
          errs.push({
            atom: i,
            title: a.sym + ' — Charge',
            you: { en: a.sym + ' is labelled ' + fmtC(ch) + '.', zh: a.sym + '' + fmtC(ch) + '' },
            why: { en: a.sym + ' must be ' + fmtC(a.charge) + ': it has ' +
                     (a.charge > 0 ? 'lost ' + a.charge + ' electron' + (a.charge > 1 ? 's' : '')
                                   : 'gained ' + Math.abs(a.charge) + ' electron' + (Math.abs(a.charge) > 1 ? 's' : '')) + '.',
                   zh: a.sym + '' + fmtC(a.charge) + '' +
                     (a.charge > 0 ? '' + a.charge + '' : '' + Math.abs(a.charge) + '') + '' },
            rule: { en: 'Charge = protons − electrons; write it at the top right of the ion.',
                    zh: '' }
          });
        }
      });
      const total = atoms.reduce((sum, a, i) => sum + (dcq.charges[i] || 0), 0);
      if (total !== 0) errs.push({
        title: 'Overall charge',
        you: { en: 'All the ion charges add up to ' + (total > 0 ? '+' : '') + total + '.',
               zh: '' + (total > 0 ? '+' : '') + total + '' },
        why: { en: 'A compound is electrically neutral overall, so the positive and negative charges must cancel exactly.',
               zh: '' },
        rule: { en: 'The sum of all ion charges must equal 0.',
                zh: '' }
      });
    }

    dcq.tries++;
    const ok = errs.length === 0;
    const fb = $('dcFeedback');
    fb.className = 'dcFeedback show';
    setTimeout(() => { try { fb.scrollIntoView({ block: 'start' }); } catch (e) { } }, 30);

    if (ok) {
      dcq.solved = true;
      fb.innerHTML = '<div class="fbBanner ok"><span class="fbIcon">✓</span><div>' +
        '<b>Perfect diagram!</b>' +
        '<em>' + (q.type === 'ionic'
          ? 'Electrons were transferred completely: the cation lost electrons, the anion reached a full outer shell, and every ion has brackets and a charge.'
          : 'Every shared pair is 1 dot + 1 cross; lone pairs stay with their own atom and are not shared.') + '</em>' +
        '</div></div>';
      correctCount++;
      nodeCorrect.set(dcq.node.id, true);
      done.add(dcq.node.id);
      WORLD.setNodeState(dcq.node.id, 'done');
      $('dcCheckBtn').textContent = 'Back to world';
      toast((dcq.node.main ? '✓ Quest complete! +1 — ' : '✓ Chest complete — ') + q.compound + ' mastered');
      logEvent({ type: 'dotcross', compound: q.compound, correct: true, attempt: dcq.tries, hintUsed: dcq.hintUsed });
      refreshLocks();
      updateHUD();
    } else {
      const MAXW = 2;
      fb.innerHTML = '<div class="fbBanner bad"><span class="fbIcon">✗</span><div>' +
        '<b>' + errs.length + ' thing(s) still need fixing</b>' +
        '<em>No worries — read each card: what you drew, why it fails, and the correct rule. <b>Tap a card</b> to highlight the spot on the diagram.</em>' +
        '</div></div>' +
        errs.slice(0, MAXW).map((e, i) => wxCard(e.you, e.why, e.rule, NUMC[i] + ' ' + e.title,
          { atom: e.atom, tapHint: e.atom === undefined ? '' : 'Tap → highlighted with a <b>yellow ring</b> on the diagram' })).join('') +
        (errs.length > MAXW ? '<div class="wxRest"><b>' + (errs.length - MAXW) + ' more to fix:</b>' +
          errs.slice(MAXW).map(e => e.title).join(', ') + '</div>' : '') +
        (dcq.tries >= 3 ? '<div class="wxRest" style="border-color:rgba(255,220,120,.4);background:rgba(255,220,120,.08);color:#ffe8b0">' +
          'You have tried 3 times — press <b>Hint</b> to reveal exactly where the next electron goes.</div>' : '');

      // Tap a card → highlight the matching atom on the diagram
      fb.querySelectorAll('.wx[data-hi]').forEach(el => {
        el.addEventListener('click', () => {
          const i = Number(el.dataset.hi);
          dcq.hiAtom = (dcq.hiAtom === i) ? -1 : i;
          renderDC();
          if (dcq.hiAtom >= 0) {
            try { $('dcStage').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
          }
        });
      });
      setTimeout(() => { try { fb.scrollIntoView({ block: 'start' }); } catch (e) { } }, 30);
      logEvent({ type: 'dotcross', compound: q.compound, correct: false, attempt: dcq.tries, errors: errs.length, hintUsed: dcq.hintUsed });
    }
    attempts.push({ type: 'dotcross', compound: q.compound, correct: ok, attempt: dcq.tries, hintUsed: dcq.hintUsed });
  }

  function closeDC() {
    closeModal('dotcrossModal');
    setState(STATE.WORLD);
    $('dcCheckBtn').textContent = 'Check';
    dcq = null;
    updateHUD();
    checkAllMainDone();
    WORLD.relock();
  }

  $('dcCheckBtn').addEventListener('click', () => { if (dcq && dcq.solved) closeDC(); else checkDC(); });
  $('dcCloseBtn').addEventListener('click', closeDC);
  $('dcResetBtn').addEventListener('click', () => {
    if (!dcq) return;
    dcq.marks = {}; dcq.hintSlot = null; dcq.solved = false;
    $('dcCheckBtn').textContent = 'Check';
    renderDC();
    $('dcFeedback').className = 'dcFeedback';
  });
  $('dcHintBtn').addEventListener('click', () => {
    if (!dcq) return;
    dcq.hintUsed = true;
    const q = dcq.q;
    const fb = $('dcFeedback');
    let target = -1;
    dcq.slots.forEach((s, si) => {
      if (target === -1 && (dcq.marks[si] || []).length < 2) target = si;
    });
    dcq.hintSlot = target;
    dcq.hiAtom = -1;
    renderDC();
    fb.className = 'dcFeedback show';

    if (target >= 0) {
      const s = dcq.slots[target];
      const owner = s.kind === 'lone'
        ? q.atoms[s.atom].sym + ' lone pair'
        : q.atoms[s.a].sym + ' — ' + q.atoms[s.b].sym + ' bond pair';
      fb.innerHTML =
        '<div class="hintBox"><b>①</b> Find the <b>glowing slot</b> on the diagram (' + owner + ')<br>' +
        '<b>②</b> Click that slot <b>twice</b> to place a pair of electrons<br>' +
        '<b>③</b> ' + (s.kind === 'lone' ? 'A lone pair uses the <b>same symbol</b> (two dots ••)' : 'A bond pair needs <b>one • and one ×</b>') + '</div>' +
        '<div class="fbSub">' + q.hint.en + '</div>';
    } else if (q.type === 'ionic' && !dcq.bracket) {
      fb.innerHTML = '<div class="hintBox">All electrons are placed — now click <b>[ ] Brackets</b> above to enclose each ion.</div>';
    } else if (q.type === 'ionic' && q.atoms.some((a, i) => (dcq.charges[i] || 0) !== a.charge)) {
      fb.innerHTML = '<div class="hintBox">Last step: choose the charges below.<br>' +
        '<b>Metals</b> lose electrons → become <b>positive</b>; <b>non-metals</b> gain electrons → become <b>negative</b>.<br>' +
        'The charge number equals the number of electrons lost or gained.</div>';
    } else {
      fb.innerHTML = '<div class="hintBox">The diagram is complete — press <b>"Check"</b> at the bottom right to see your result.</div>' +
        '<div class="fbSub">' + q.hint.en + '</div>';
    }
    try { $('dcStage').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
  });

  /* ================= VOCAB ================= */
  let vocabNode = null;
  function openVocab(node) {
    vocabNode = node;
    const t = TERM[node.term];
    $('vocabTerm').textContent = t.en;
    $('vocabZh').textContent = 'Glossary term · newly unlocked';
    $('vocabDef').innerHTML = t.def.en;
    setState(STATE.VOCAB);
    openModal('vocabModal');
  }
  $('vocabCollectBtn').addEventListener('click', () => {
    if (!vocabNode) return;
    done.add(vocabNode.id);
    WORLD.setNodeState(vocabNode.id, 'done');
    logEvent({ type: 'vocab', term: vocabNode.term });
    closeModal('vocabModal');
    setState(STATE.WORLD);
    toast('✓ Vocabulary collected: <b>' + TERM[vocabNode.term].en + '</b> — added to your glossary');
    vocabNode = null;
    updateHUD();
    refreshGlossary();
    WORLD.relock();
  });

  /* ================= SUMMARY ================= */
  function computeSummary() {
    const byType = { ionic: { c: 0, t: 0 }, covalent: { c: 0, t: 0 }, metallic: { c: 0, t: 0 } };
    attempts.forEach(a => {
      const c = COMPOUNDS.find(x => x.f === a.compound);
      if (!c) return;
      const t = c.bond === 1 ? 'ionic' : c.bond === 2 ? 'covalent' : 'metallic';
      byType[t].t++;
      if (a.correct) byType[t].c++;
    });
    return byType;
  }

  function showSummary() {
    const by = computeSummary();
    const totalC = attempts.filter(a => a.correct).length;
    const totalT = attempts.length;
    const pct = totalT ? Math.round(totalC / totalT * 100) : 0;

    $('sumStats').innerHTML =
      stat('Objectives completed', mainDone() + ' / ' + MAIN_TOTAL) +
      stat('Accuracy', pct + '%') +
      stat('Time', Math.floor(activeTime / 60) + ' min ' + Math.floor(activeTime % 60) + ' s') +
      stat('Glossary', countCollected() + ' collected') +
      stat('Waypoints', unlockedWp.size + ' / ' + WAYPOINTS.length);

    const rows = [
      ['ionic', 'Ionic', '#6fb8e8'],
      ['covalent', 'Covalent', '#5fd0a8'],
      ['metallic', 'Metallic', '#c9b36a']
    ];
    $('sumBars').innerHTML = rows.map(([k, label, col]) => {
      const d = by[k];
      const p = d.t ? Math.round(d.c / d.t * 100) : 0;
      return '<div class="barRow"><div class="barTop"><span>' + label + '</span><span>' + d.c + '/' + d.t + ' · ' + p + '%</span></div>' +
        '<div class="barTrack"><div class="barFill" style="width:' + p + '%;background:' + col + '"></div></div></div>';
    }).join('');

    const weak = [];
    if (by.ionic.t && by.ionic.c / by.ionic.t < 0.75) weak.push('Ionic bonding (remember square brackets and charges — electrons are transferred completely)');
    if (by.covalent.t && by.covalent.c / by.covalent.t < 0.75) weak.push('Covalent bonding (bond pairs = 1 dot + 1 cross; lone pairs are not shared)');
    if (by.metallic.t && by.metallic.c / by.metallic.t < 0.75) weak.push('Metallic bonding (electrons are delocalised, not transferred)');
    $('sumWeak').innerHTML = weak.length
      ? '<b>Review:</b> ' + weak.join('; ') + '. Open the glossary to check the definitions.'
      : '<b>Well done!</b> You have a solid grasp of all three bond types. Try the unfamiliar compounds in Crystal Cavern.';

    const mins = activeTime / 60;
    $('sumFootNote').textContent = 'Suggested play time: 6–10 minutes. You used ' + mins.toFixed(1) +
      ' minutes' + (mins < 6 ? ' — take your time and read the explanations.' : mins > 10 ? ' — no rush, you can revisit in several sessions.' : ' — nicely paced.') +
      '  Your data stays on this device and is never uploaded.';

    setState(STATE.SUMMARY);
    openModal('summaryModal');
    SESSION.summary = { correct: totalC, total: totalT, accuracy: pct, byType: by, done: mainDone(), glossary: countCollected(), waypoints: unlockedWp.size };
    SESSION.endTime = Date.now();
    persist();
  }
  function stat(l, v) { return '<div class="statBox"><div class="lbl">' + l + '</div><div class="val">' + v + '</div></div>'; }
  function countCollected() { return NODES.filter(n => n.type === 'crystal' && done.has(n.id)).length; }

  $('sumCloseBtn').addEventListener('click', () => {
    closeModal('summaryModal');
    setState(STATE.WORLD);
    WORLD.relock();
  });
  $('sumGlossaryBtn').addEventListener('click', openGlossary);
  $('sumExportBtn').addEventListener('click', exportData);

  function checkAllMainDone() {
    const mains = NODES.filter(n => n.main);
    if (mains.every(n => done.has(n.id)) && !SESSION.summary) {
      setTimeout(showSummary, 550);
    }
  }

  /* ================= HELP ================= */
  let helpOpen = false;
  let mapOpen = false;
  function openHelp() {
    helpOpen = true;
    $('helpModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
  }
  function closeHelp() {
    helpOpen = false;
    $('helpModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused();
    WORLD.relock();
  }
  $('helpBtn').addEventListener('click', openHelp);
  $('helpCloseBtn').addEventListener('click', closeHelp);

  /* ================= BEACON SETTINGS ================= */
  let beaconOpen = false;
  function loadBeaconCfg() {
    try {
      const j = JSON.parse(localStorage.getItem('bq_beacon_v1') || 'null');
      if (j) Object.assign(WORLD.BEACON_CFG, j);
    } catch (e) { }
  }
  function saveBeaconCfg() {
    try { localStorage.setItem('bq_beacon_v1', JSON.stringify(WORLD.BEACON_CFG)); } catch (e) { }
    try { CLOUD.save(); } catch (e) { }
  }
  function renderBeaconCfg() {
    const c = WORLD.BEACON_CFG;
    $('bcSize').value = c.size; $('bcSizeV').textContent = Number(c.size).toFixed(1) + 'x';
    $('bcHeight').value = c.height; $('bcHeightV').textContent = Math.round(c.height) + ' m';
    $('bcRadius').value = c.radius; $('bcRadiusV').textContent = Number(c.radius).toFixed(1);
    $('bcDist').value = c.maxDist; $('bcDistV').textContent = Math.round(c.maxDist) + ' m';
    $('bcDur').value = String(c.duration || 0);
    $('bcCond').value = c.condition;
    $('bcThrough').checked = !!c.through;
  }
  function openBeacon() {
    beaconOpen = true;
    renderBeaconCfg();
    $('beaconModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
  }
  function closeBeacon() {
    beaconOpen = false;
    $('beaconModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused();
    WORLD.relock();
  }
  $('qpBeaconBtn').addEventListener('click', openBeacon);
  $('bcClose').addEventListener('click', closeBeacon);
  $('bcReset').addEventListener('click', () => {
    Object.assign(WORLD.BEACON_CFG, { size: 1, height: 42, radius: 2.4, maxDist: 240, duration: 0, through: true, condition: 'all' });
    renderBeaconCfg(); saveBeaconCfg();
    WORLD.setBeacon(trackedNode());
    toast('✓ Objective marker settings reset');
  });
  ['bcSize', 'bcHeight', 'bcRadius', 'bcDist'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      WORLD.BEACON_CFG.size = Number($('bcSize').value);
      WORLD.BEACON_CFG.height = Number($('bcHeight').value);
      WORLD.BEACON_CFG.radius = Number($('bcRadius').value);
      WORLD.BEACON_CFG.maxDist = Number($('bcDist').value);
      renderBeaconCfg();
      saveBeaconCfg();
    });
  });
  $('bcDur').addEventListener('change', function () {
    WORLD.BEACON_CFG.duration = Number($('bcDur').value);
    saveBeaconCfg();
    WORLD.setBeacon(trackedNode());
  });
  $('bcCond').addEventListener('change', function () {
    WORLD.BEACON_CFG.condition = $('bcCond').value;
    saveBeaconCfg();
  });
  $('bcThrough').addEventListener('change', function () {
    WORLD.BEACON_CFG.through = $('bcThrough').checked;
    saveBeaconCfg();
  });

  /* ================= COACH (first-run guide) ================= */
  const COACH_STEPS = [
    { sel: null, title: '① Welcome to Bond Quest', text: 'Your mission: explore 4 regions and complete 9 quests about chemical bonding. This quick tour shows you exactly how to play.' },
    { sel: '#questPanel', title: '② Follow your CURRENT OBJECTIVE', text: 'This panel tells you what to do next, the distance in metres, and a compass direction. Follow the white arrow and you will get there.' },
    { sel: '#minimap', title: '③ Use the maps', text: 'Top right is the mini-map: the white arrow is you, the green ring is your target. Press M any time for the big map — drag to pan, scroll to zoom, click a marker to make it your objective.' },
    { sel: null, title: '④ Get close, then press E', text: 'Walk up to a glowing NPC, chest or crystal. When you are close enough, a prompt appears — press E. If a quest says LOCKED, answer a few questions first or buy a Guild Pass.' },
    { sel: '#topbar', title: '⑤ Answer or draw — then repeat', text: 'Talk to an NPC and answer 3 questions, or open a chest and place electrons on the dotted slots then press Check. Each finished quest adds +1 to the counter above.' },
    { sel: '#scorePill', title: '⑥ Fight enemies & earn rewards', text: 'Wild enemies roam the fields. Press J to attack (chain combos!), K for a skill. Every hit gives Score and Gold — watch the counters up here. Press B to spend Gold in the Shop on new weapons, outfits and characters, and C to swap character. That is the whole game!' }
  ];
  let coachOn = false, coachIdx = 0;

  function coachShow(i) {
    coachIdx = Math.max(0, Math.min(COACH_STEPS.length - 1, i));
    const st = COACH_STEPS[coachIdx];
    const card = $('coachCard'), hole = $('coachHole');
    coachOn = true;
    WORLD.setLocked(true);
    syncPaused();
    card.style.display = 'block';
    $('coachStep').textContent = (coachIdx + 1) + ' / ' + COACH_STEPS.length;
    $('coachTitle').textContent = st.title;
    $('coachText').textContent = st.text;
    $('coachNext').textContent = coachIdx === COACH_STEPS.length - 1 ? 'Start playing' : 'Next';
    $('coachSkip').textContent = 'Skip';

    if (st.sel === '#questPanel' && questCollapsed) setQuestCollapsed(false);
    if (st.sel && document.querySelector(st.sel)) {
      const r = document.querySelector(st.sel).getBoundingClientRect();
      hole.style.display = 'block';
      hole.style.left = (r.left - 8) + 'px';
      hole.style.top = (r.top - 8) + 'px';
      hole.style.width = (r.width + 16) + 'px';
      hole.style.height = (r.height + 16) + 'px';
      let cx = r.right + 22;
      if (cx + 342 > window.innerWidth) cx = Math.max(16, r.left - 354);
      const cy = Math.max(16, Math.min(r.top, window.innerHeight - 240));
      card.style.left = cx + 'px';
      card.style.top = cy + 'px';
    } else {
      hole.style.display = 'none';
      card.style.left = Math.max(16, (window.innerWidth - 330) / 2) + 'px';
      card.style.top = Math.max(16, (window.innerHeight - 230) / 2) + 'px';
    }
  }

  function coachEnd() {
    coachOn = false;
    $('coachCard').style.display = 'none';
    $('coachHole').style.display = 'none';
    syncPaused();
    if (state === STATE.WORLD) { WORLD.setLocked(false); WORLD.relock(); }
    try { localStorage.setItem('bq_coach_v2', '1'); } catch (e) { }
    try { CLOUD.save(); } catch (e) { }
  }

  $('coachNext').addEventListener('click', () => {
    if (coachIdx >= COACH_STEPS.length - 1) coachEnd();
    else coachShow(coachIdx + 1);
  });
  $('coachSkip').addEventListener('click', coachEnd);
  window.addEventListener('resize', () => { if (coachOn) coachShow(coachIdx); });
  $('helpCoachBtn').addEventListener('click', () => {
    closeHelp();
    setTimeout(() => coachShow(0), 80);
  });

  /* ================= TELEPORT WAYPOINTS ================= */
  const WP_KEY = 'f4e_waypoints_v1';
  const unlockedWp = new Set();
  let wpOpen = false, tpTarget = null, tpBusy = false;

  function wpById(id) { return WAYPOINTS.find(w => w.id === id) || null; }

  function loadWaypoints() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WP_KEY) || 'null'); } catch (e) { }
    unlockedWp.clear();
    WAYPOINTS.forEach(w => { if (w.start) unlockedWp.add(w.id); });
    if (Array.isArray(saved)) saved.forEach(id => { if (wpById(id)) unlockedWp.add(id); });
    applyWaypoints();
  }
  function saveWaypoints() {
    try { localStorage.setItem(WP_KEY, JSON.stringify([...unlockedWp])); } catch (e) { }
    try { CLOUD.save(); } catch (e) { }
  }
  function applyWaypoints() {
    WAYPOINTS.forEach(w => WORLD.setWaypointState(w.id, unlockedWp.has(w.id)));
  }

  function nearWpInfo(maxDist) {
    const p = WORLD.player.position;
    let best = null, bestD = Infinity;
    WAYPOINTS.forEach(w => {
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < maxDist && d < bestD) { bestD = d; best = w; }
    });
    return best ? { wp: best, d: bestD } : null;
  }

  function unlockWaypoint(w) {
    unlockedWp.add(w.id);
    saveWaypoints();
    applyWaypoints();
    logEvent({ type: 'waypoint-unlock', id: w.id, name: w.name.en });
    SESSION.exploration.waypoints = [...unlockedWp];
    persist();
    toast('⟡ Fast travel unlocked: ' + w.name.en + '<br><span style="font-size:11.5px;color:#8fb2a6">Press M to open the map, then click this blue anchor to teleport</span>', 3600);
    refreshPrompt();
    updateHUD();
  }

  function onWpInteract(w) {
    if (!unlockedWp.has(w.id)) { unlockWaypoint(w); return; }
    openWpList();
  }

  function renderWpList() {
    const p = WORLD.player.position;
    $('wpDone').textContent = unlockedWp.size;
    $('wpTotal').textContent = WAYPOINTS.length;
    let html = '';
    WAYPOINTS.forEach(w => {
      const on = unlockedWp.has(w.id);
      const d = Math.round(Math.hypot(w.x - p.x, w.z - p.z));
      const here = on && d <= 6;
      const Z = ZONES[w.zone];
      html += '<div class="wpRow ' + (on ? 'on' : 'locked') + (here ? ' here' : '') + '">' +
        '<div class="wpIcon"><span>⟡</span></div>' +
        '<div class="wpBody"><div class="wpName">' + w.name.en + '</div>' +
        '<div class="wpSub">' + Z.en + ' · ' + (here ? 'You are here' : on ? 'Active — ready to teleport' : 'Inactive — walk here and press E') + '</div></div>' +
        '<div class="wpDist">' + d + ' m</div>' +
        (here ? '<button disabled>Here</button>'
          : '<button data-go="' + w.id + '"' + (on ? '' : ' disabled') + '>Teleport</button>') +
        '</div>';
    });
    $('wpList').innerHTML = html;
    $('wpList').querySelectorAll('[data-go]').forEach(b => {
      b.addEventListener('click', () => {
        const w = wpById(b.dataset.go);
        if (w) doTeleport(w);
      });
    });
  }

  function openWpList() {
    if (state !== STATE.WORLD) return;
    wpOpen = true;
    renderWpList();
    $('wpModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
  }
  function closeWpList() {
    wpOpen = false;
    $('wpModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused();
    WORLD.relock();
  }

  function doTeleport(w) {
    if (tpBusy) return;
    if (!unlockedWp.has(w.id)) { toast('This waypoint is not active — walk here and press E to activate it'); return; }
    tpBusy = true;
    hideTpPop();
    if (mapOpen) closeBigMap();
    if (wpOpen) closeWpList();
    const fade = $('tpFade');
    fade.classList.add('on');
    setTimeout(() => {
      WORLD.teleportTo(w.x, w.z);
      WORLD.setLocked(false);
      if (!SESSION.exploration.zonesVisited.includes(w.zone)) SESSION.exploration.zonesVisited.push(w.zone);
      SESSION.exploration.waypoints = [...unlockedWp];
      logEvent({ type: 'teleport', to: w.id, zone: w.zone });
      persist();
      updateHUD();
      refreshPrompt();
      setTimeout(() => {
        fade.classList.remove('on');
        toast('⟡ Teleported to ' + w.name.en + ' · ' + ZONES[w.zone].en, 2600);
        tpBusy = false;
        WORLD.relock();
      }, 280);
    }, 320);
  }

  $('wpCloseBtn').addEventListener('click', closeWpList);
  $('qpWpBtn').addEventListener('click', openWpList);
  $('wpMapBtn').addEventListener('click', () => { closeWpList(); setTimeout(openBigMap, 60); });

  /* ================= BIG MAP ================= */
  const BM = { canvas: null, zoom: 1, cx: 0, cz: 0, base: 1, dragging: false, moved: false, sx: 0, sy: 0, cx0: 0, cz0: 0 };

  function initBigMap() {
    BM.canvas = $('bigMap');
    BM.base = Math.min(BM.canvas.width, BM.canvas.height) / 410;
    BM.cx = 0; BM.cz = 0;
    bindBigMap();
  }

  function bmScale() { return BM.base * BM.zoom; }
  function bmX(x) { return (x - BM.cx) * bmScale() + BM.canvas.width / 2; }
  function bmY(z) { return (z - BM.cz) * bmScale() + BM.canvas.height / 2; }

  function clampPan() {
    BM.cx = Math.max(-260, Math.min(260, BM.cx));
    BM.cz = Math.max(-260, Math.min(260, BM.cz));
  }

  function updateZoomLabel() { $('mapZoomVal').textContent = Math.round(BM.zoom * 100) + '%'; }

  function zoomAt(factor, px, py) {
    const c = BM.canvas;
    if (px === undefined) { px = c.width / 2; py = c.height / 2; }
    const s0 = bmScale();
    const wx = (px - c.width / 2) / s0 + BM.cx;
    const wz = (py - c.height / 2) / s0 + BM.cz;
    BM.zoom = Math.max(0.55, Math.min(4, BM.zoom * factor));
    const s1 = bmScale();
    BM.cx = wx - (px - c.width / 2) / s1;
    BM.cz = wz - (py - c.height / 2) / s1;
    clampPan();
    updateZoomLabel();
    drawBigMap();
  }

  function mapLabel(ctx, text, x, y, hot, boxes) {
    ctx.font = '500 12px sans-serif';
    const w = ctx.measureText(text).width + 14;
    const rx = x - w / 2, ry = y - 10, rw = w, rh = 20;
    if (boxes) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (rx < b.x + b.w + 4 && rx + rw + 4 > b.x && ry < b.y + b.h + 3 && ry + rh + 3 > b.y) return false;
      }
      boxes.push({ x: rx, y: ry, w: rw, h: rh });
    }
    ctx.fillStyle = hot ? 'rgba(9,30,23,.95)' : 'rgba(8,16,20,.82)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = hot ? 'rgba(143,240,200,.85)' : 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.fillStyle = hot ? '#dbfff0' : 'rgba(205,228,220,.8)';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4);
    ctx.textAlign = 'left';
    return true;
  }

  let mapTex = null;
  function ensureMapTex() {
    if (mapTex) return mapTex;
    const S = 480;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const hs = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = (x / S) * 400 - 200, wz = (y / S) * 400 - 200;
        hs[y * S + x] = WORLD.heightAt(wx, wz);
      }
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = (x / S) * 400 - 200, wz = (y / S) * 400 - 200;
        let wsum = 0; const ws = {};
        for (const k in ZONES) {
          const Z = ZONES[k];
          const wob = Math.sin(wx * 0.062 + Z.cx) * 7 + Math.cos(wz * 0.049 + Z.cz) * 7 + Math.sin((wx + wz) * 0.028) * 9;
          const d = Math.hypot(wx - Z.cx, wz - Z.cz) + wob;
          const t = Math.max(0, Math.min(1, (d - 54) / 46));
          ws[k] = 1 - (t * t * (3 - 2 * t)) + 0.001;
          wsum += ws[k];
        }
        let r = 0, gg2 = 0, b = 0;
        for (const k in ZONES) {
          const c = ZONES[k].ground;
          r += c[0] * ws[k] / wsum; gg2 += c[1] * ws[k] / wsum; b += c[2] * ws[k] / wsum;
        }
        const h = hs[y * S + x];
        const sl = hs[y * S + Math.max(0, x - 1)] - hs[y * S + Math.min(S - 1, x + 1)];
        const sv = hs[Math.max(0, y - 1) * S + x] - hs[Math.min(S - 1, y + 1) * S + x];
        const shade = Math.max(0.45, Math.min(1.55, 1 + (sv * 0.6 - sl * 0.4) * 0.055));
        const snow = Math.max(0, Math.min(1, (h - 24) / 20));
        r = r * (1 - snow) + 0.92 * snow;
        gg2 = gg2 * (1 - snow) + 0.95 * snow;
        b = b * (1 - snow) + 0.99 * snow;
        const i4 = (y * S + x) * 4;
        img.data[i4] = Math.max(0, Math.min(255, r * shade * 235));
        img.data[i4 + 1] = Math.max(0, Math.min(255, gg2 * shade * 235));
        img.data[i4 + 2] = Math.max(0, Math.min(255, b * shade * 235));
        img.data[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    mapTex = cv;
    return cv;
  }

  function drawBigMap() {
    if (!BM.canvas) return;
    const c = BM.canvas, ctx = c.getContext('2d');
    const W = c.width, H = c.height, s = bmScale();
    const t = trackedNode();
    const p = WORLD.player.position;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030910';
    ctx.fillRect(0, 0, W, H);

    const x0 = bmX(-200), y0 = bmY(-200), ww = 400 * s, wh = 400 * s;

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, ww, wh); ctx.clip();

    const tex2 = ensureMapTex();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.97;
    ctx.drawImage(tex2, x0, y0, ww, wh);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (let g = -200; g <= 200; g += 50) {
      ctx.beginPath(); ctx.moveTo(bmX(g), y0); ctx.lineTo(bmX(g), y0 + wh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, bmY(g)); ctx.lineTo(x0 + ww, bmY(g)); ctx.stroke();
    }



    const boxes = [];
    let tLabel = null;
    if (t) {
      ctx.save();
      ctx.setLineDash([11, 9]);
      ctx.strokeStyle = 'rgba(143,240,200,.95)';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bmX(p.x), bmY(p.z)); ctx.lineTo(bmX(t.x), bmY(t.z)); ctx.stroke();
      ctx.restore();

      const dTxt = Math.round(Math.hypot(t.x - p.x, t.z - p.z)) + ' m';
      const ddx = bmX(t.x) - bmX(p.x), ddy = bmY(t.z) - bmY(p.z);
      const dlen = Math.hypot(ddx, ddy) || 1;
      const lx = bmX(p.x) + ddx * 0.22, ly = bmY(p.z) + ddy * 0.22;
      mapLabel(ctx, dTxt, lx - ddy / dlen * 26, ly + ddx / dlen * 26, false, boxes);

      const tx = bmX(t.x), ty = bmY(t.z) - 62;
      ctx.font = '500 12px sans-serif';
      const lw = ctx.measureText(nodeTitle(t)).width + 14;
      boxes.push({ x: tx - lw / 2 - 8, y: ty - 16, w: lw + 16, h: 34 });
      tLabel = { x: tx, y: ty };
    }

    NODES.forEach(n => {
      const isDone = done.has(n.id);
      const lock = isLockedNode(n).locked;
      const isTarget = t && t.id === n.id;
      const R = n.main ? 10 : (n.type === 'guild' || n.type === 'shop' ? 9 : 7);
      const fill = isDone ? '#5b6f68'
        : lock ? '#4a4f52'
          : n.type === 'npc' ? '#4fd6a4'
            : n.type === 'chest' ? '#ffc85f' : '#a99ff0';

      if (isTarget) {
        const cx = bmX(n.x), cy = bmY(n.z);
        ctx.beginPath(); ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(143,240,200,.95)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy - R - 7);
        ctx.lineTo(cx - 8, cy - R - 21);
        ctx.lineTo(cx + 8, cy - R - 21);
        ctx.closePath();
        ctx.fillStyle = '#8ff0c8';
        ctx.fill();
        ctx.strokeStyle = 'rgba(6,18,14,.75)'; ctx.lineWidth = 1.6; ctx.stroke();
      }
      const mx0 = bmX(n.x), my0 = bmY(n.z);
      ctx.beginPath();
      if (n.type === 'guild') {
        ctx.rect(mx0 - R, my0 - R, R * 2, R * 2);
      } else if (n.type === 'shop') {
        ctx.moveTo(mx0, my0 - R - 1);
        ctx.lineTo(mx0 + R + 1, my0);
        ctx.lineTo(mx0, my0 + R + 1);
        ctx.lineTo(mx0 - R - 1, my0);
        ctx.closePath();
      } else {
        ctx.arc(mx0, my0, R, 0, Math.PI * 2);
      }
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke();

      if (n.main && !isDone) {
        ctx.fillStyle = 'rgba(8,18,15,.85)';
        ctx.font = '600 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(NODES.filter(x => x.main).indexOf(n) + 1), bmX(n.x), bmY(n.z) + 3.5);
        ctx.textAlign = 'left';
      }
    });

    WAYPOINTS.forEach(w => {
      const on = unlockedWp.has(w.id);
      const cx = bmX(w.x), cy = bmY(w.z);
      const R = 8.5;
      if (on) {
        const grd = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R + 11);
        grd.addColorStop(0, 'rgba(127,232,224,.38)');
        grd.addColorStop(1, 'rgba(127,232,224,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(cx, cy, R + 11, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, R + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(127,232,224,.55)'; ctx.lineWidth = 1.8; ctx.stroke();
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-R * 0.72, -R * 0.72, R * 1.44, R * 1.44);
      if (on) {
        ctx.fillStyle = 'rgba(127,232,224,.95)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      } else {
        ctx.setLineDash([3.5, 3]);
        ctx.strokeStyle = 'rgba(127,232,224,.62)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      if (on) {
        ctx.beginPath(); ctx.arc(cx, cy, 2.9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(5,40,38,.92)';
        ctx.fill();
      }
    });

    const cands = [];
    NODES.forEach(n => {
      const isTarget = t && t.id === n.id;
      if (isTarget) return;
      const isLandmark = n.type === 'guild' || n.type === 'shop';
      if (!n.main && !isLandmark) return;
      if (!isLandmark && BM.zoom < 0.9) return;
      cands.push({ n, isTarget: false, pri: isLandmark ? 1 : 2 });
    });
    cands.sort((a, b) => a.pri - b.pri);
    cands.forEach(cd => {
      const n = cd.n;
      const yOff = (n.main ? 10 : 7) + 16;
      mapLabel(ctx, shortLabel(n), bmX(n.x), bmY(n.z) - yOff, false, boxes);
    });

    if (BM.zoom >= 1.7) {
      WAYPOINTS.forEach(w => {
        if (!unlockedWp.has(w.id)) return;
        mapLabel(ctx, w.name.en, bmX(w.x), bmY(w.z) - 26, false, boxes);
      });
    }

    if (t && tLabel) mapLabel(ctx, nodeTitle(t), tLabel.x, tLabel.y, true, null);
    mapLabel(ctx, 'YOU', bmX(p.x), bmY(p.z) + 34, false, boxes);

    ctx.save();
    ctx.translate(bmX(p.x), bmY(p.z));
    ctx.rotate(-WORLD.yaw);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 30, -Math.PI / 2 - 0.52, -Math.PI / 2 + 0.52);
    ctx.closePath();
    ctx.fillStyle = 'rgba(143,240,200,.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(7.5, 8); ctx.lineTo(0, 4.2); ctx.lineTo(-7.5, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();

    ctx.restore();

    ctx.strokeStyle = 'rgba(140,240,200,.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, ww, wh);

    ctx.fillStyle = 'rgba(200,225,215,.45)';
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, Math.max(16, y0 - 8));
    ctx.textAlign = 'left';

    const barW = 50 * s;
    const bx = x0 + 16, by = y0 + wh - 20;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barW, by); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by + 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + barW, by - 5); ctx.lineTo(bx + barW, by + 5); ctx.stroke();
    ctx.fillStyle = 'rgba(220,240,232,.6)';
    ctx.font = '11px sans-serif';
    ctx.fillText('50 m', bx + barW + 8, by + 4);
  }

  function hitTest(px, py) {
    let best = null, bestD = 16;
    NODES.forEach(n => {
      const d = Math.hypot(bmX(n.x) - px, bmY(n.z) - py);
      if (d < bestD) { bestD = d; best = n; }
    });
    return best;
  }

  function wpHitTest(px, py) {
    let best = null, bestD = 18;
    WAYPOINTS.forEach(w => {
      const d = Math.hypot(bmX(w.x) - px, bmY(w.z) - py);
      if (d < bestD) { bestD = d; best = w; }
    });
    return best;
  }

  function hideTpPop() {
    tpTarget = null;
    const el = $('tpPop');
    if (el) el.classList.remove('show', 'below');
  }

  function showTpPop(w) {
    const c = BM.canvas, rect = c.getBoundingClientRect();
    if (!rect.width) return;
    const kx = rect.width / c.width, ky = rect.height / c.height;
    tpTarget = w;
    const on = unlockedWp.has(w.id);
    const d = Math.round(Math.hypot(w.x - WORLD.player.position.x, w.z - WORLD.player.position.z));
    const el = $('tpPop');
    $('tpName').textContent = w.name.en;
    $('tpMeta').className = 'tpMeta' + (on ? ' on' : '');
    $('tpMeta').textContent = ZONES[w.zone].en + ' · ' + d + ' m · ' +
      (on ? 'Active — ready to teleport' : 'Inactive — walk here and press E');
    const go = $('tpGo');
    go.disabled = !on;
    go.textContent = on ? 'Teleport' : 'Locked';

    el.classList.add('show');
    const ww = el.offsetWidth || 208, wh = el.offsetHeight || 96;
    let left = bmX(w.x) * kx, top = bmY(w.z) * ky - 26;
    left = Math.max(ww / 2 + 8, Math.min(rect.width - ww / 2 - 8, left));
    if (top - wh < 6) { el.classList.add('below'); top = bmY(w.z) * ky + 24; }
    else el.classList.remove('below');
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function bindBigMap() {
    const c = BM.canvas;
    c.addEventListener('pointerdown', e => {
      hideTpPop();
      BM.dragging = true; BM.moved = false;
      BM.sx = e.clientX; BM.sy = e.clientY;
      BM.cx0 = BM.cx; BM.cz0 = BM.cz;
      $('mapWrap').classList.add('drag');
      try { c.setPointerCapture(e.pointerId); } catch (err) { }
    });
    c.addEventListener('pointermove', e => {
      if (!BM.dragging) return;
      const rect = c.getBoundingClientRect();
      const k = c.width / rect.width;
      const dx = (e.clientX - BM.sx) * k, dy = (e.clientY - BM.sy) * k;
      if (Math.abs(dx) + Math.abs(dy) > 4) BM.moved = true;
      const s = bmScale();
      BM.cx = BM.cx0 - dx / s;
      BM.cz = BM.cz0 - dy / s;
      clampPan();
      drawBigMap();
    });
    c.addEventListener('pointerup', e => {
      BM.dragging = false;
      $('mapWrap').classList.remove('drag');
      if (BM.moved) return;
      const rect = c.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (c.width / rect.width);
      const py = (e.clientY - rect.top) * (c.height / rect.height);
      const hitWp = wpHitTest(px, py);
      if (hitWp) { showTpPop(hitWp); return; }
      hideTpPop();
      const hit = hitTest(px, py);
      if (!hit) return;
      if (done.has(hit.id)) { toast('This objective is already complete'); return; }
      trackedId = hit.id;
      lastListSig = '';
      renderQuestPanel();
      drawBigMap();
      toast('✓ Objective set: ' + nodeTitle(hit));
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      hideTpPop();
      const rect = c.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (c.width / rect.width);
      const py = (e.clientY - rect.top) * (c.height / rect.height);
      zoomAt(e.deltaY < 0 ? 1.16 : 1 / 1.16, px, py);
    }, { passive: false });
  }

  function sizeMapCanvas() {
    const c = BM.canvas, wrap = $('mapWrap');
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.width * (620 / 960) * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w; c.height = h;
      BM.base = Math.min(w, h) / 410;
    }
  }

  function fitViewToObjective() {
    const c = BM.canvas;
    const p = WORLD.player.position, t = trackedNode();
    let minX = p.x, maxX = p.x, minZ = p.z, maxZ = p.z;
    if (t) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
    }
    WAYPOINTS.forEach(w => {
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
    });
    const pad = 78;
    const w = Math.max(120, maxX - minX) + pad * 2;
    const h = Math.max(120, maxZ - minZ) + pad * 2;
    const sc = Math.min(c.width / w, c.height / h);
    BM.zoom = Math.max(0.8, Math.min(1.9, sc / BM.base));
    BM.cx = (minX + maxX) / 2;
    BM.cz = (minZ + maxZ) / 2;
    clampPan();
    updateZoomLabel();
  }

  function openBigMap() {
    if (state !== STATE.WORLD) return;
    mapOpen = true;
    $('bigMapModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
    sizeMapCanvas();
    fitViewToObjective();
    drawBigMap();
    requestAnimationFrame(drawBigMap);
  }
  function closeBigMap() {
    mapOpen = false;
    hideTpPop();
    $('bigMapModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused();
    WORLD.relock();
  }

  $('tpCancel').addEventListener('click', hideTpPop);
  $('tpGo').addEventListener('click', () => { if (tpTarget) doTeleport(tpTarget); });

  $('mapBtn').addEventListener('click', openBigMap);
  $('qpMapBtn').addEventListener('click', openBigMap);
  $('mapCloseBtn').addEventListener('click', closeBigMap);
  $('mapWpBtn').addEventListener('click', () => { closeBigMap(); setTimeout(openWpList, 70); });
  $('mapZoomIn').addEventListener('click', () => zoomAt(1.25));
  $('mapZoomOut').addEventListener('click', () => zoomAt(1 / 1.25));
  $('mapReset').addEventListener('click', () => {
    sizeMapCanvas();
    fitViewToObjective();
    drawBigMap();
  });
  window.addEventListener('resize', () => {
    if (!mapOpen) return;
    sizeMapCanvas();
    fitViewToObjective();
    drawBigMap();
  });

  /* ================= GLOSSARY ================= */
  function openGlossary() {
    refreshGlossary();
    $('glossaryDrawer').classList.add('show');
    syncPaused();
  }
  function refreshGlossary() {
    const collected = new Set(NODES.filter(n => n.type === 'crystal').map(n => n.term));
    const collectedDone = new Set(NODES.filter(n => n.type === 'crystal' && done.has(n.id)).map(n => n.term));
    $('glossaryList').innerHTML = GLOSSARY.map(g => {
      const unlocked = termUnlocked(g.id);
      return '<div class="glItem ' + (unlocked ? '' : 'locked') + '">' +
        '<div><span class="t">' + g.en + '</span></div>' +
        '<div class="d">' + (unlocked ? g.def.en : '🔒 Find the glowing shard in the world to unlock') + '</div>' +
        '</div>';
    }).join('');
  }
  $('glossaryBtn').addEventListener('click', openGlossary);
  $('glossaryCloseBtn').addEventListener('click', () => {
    $('glossaryDrawer').classList.remove('show');
    syncPaused();
  });

  /* ================= SHOP & GUILD ================= */
  let shardsSpent = 0, freePass = 0;
  const boughtTerms = new Set();
  let guildOpen = false, shopOpen = false;

  function shardBalance() { return Math.max(0, countCollected() - shardsSpent); }
  function termUnlocked(id) {
    if (boughtTerms.has(id)) return true;
    return NODES.some(n => n.type === 'crystal' && n.term === id && done.has(n.id));
  }

  function renderShop() {
    /* wallet */
    const sh = $('shopShards'); if (sh) sh.textContent = shardBalance();
    const sg = $('shopGold'); if (sg) sg.textContent = COMBAT.gold;
    const ss = $('shopScore'); if (ss) ss.textContent = COMBAT.score;
    /* tabs */
    document.querySelectorAll('#shopTabs .shopTab').forEach(b => b.classList.toggle('active', b.dataset.tab === shopTab));
    let html = '';
    if (shopTab === 'gear') {
      WEAPONS.forEach(w => {
        const owned = COMBAT.weapons.indexOf(w.id) >= 0;
        const equipped = COMBAT.weapon === w.id;
        const gateOk = COMBAT.score >= w.scoreReq;
        const afford = COMBAT.gold >= w.gold;
        let label, dis = '';
        if (equipped) { label = 'Equipped'; dis = ' disabled'; }
        else if (owned) { label = 'Equip'; }
        else if (!gateOk) { label = '🔒 ' + w.scoreReq + ' pts'; dis = ' disabled'; }
        else if (!afford) { label = w.gold + ' gold'; dis = ' disabled'; }
        else { label = 'Buy · ' + w.gold + ' gold'; }
        html += shopCard(w.id, w.name, w.desc, '⚔ ' + w.damage + ' dmg · ' + w.type.toUpperCase(),
          w.gold, w.scoreReq, owned, equipped, gateOk, label, dis, 'gear');
      });
    } else if (shopTab === 'skins') {
      SKINS.forEach(s => {
        const owned = COMBAT.skins.indexOf(s.id) >= 0;
        const equipped = COMBAT.skin === s.id;
        const gateOk = COMBAT.score >= s.scoreReq;
        const afford = COMBAT.gold >= s.gold;
        let label, dis = '';
        if (equipped) { label = 'Wearing'; dis = ' disabled'; }
        else if (owned) { label = 'Wear'; }
        else if (!gateOk) { label = '🔒 ' + s.scoreReq + ' pts'; dis = ' disabled'; }
        else if (!afford) { label = s.gold + ' gold'; dis = ' disabled'; }
        else { label = 'Buy · ' + s.gold + ' gold'; }
        html += shopCard(s.id, s.name, s.desc, 'Outfit colour theme', s.gold, s.scoreReq, owned, equipped, gateOk, label, dis, 'skins');
      });
    } else if (shopTab === 'characters') {
      CHARACTERS.forEach(c => {
        const owned = COMBAT.characters.indexOf(c.id) >= 0;
        const active = COMBAT.character === c.id;
        const gateOk = COMBAT.score >= c.scoreReq || owned;
        let label, dis = '';
        if (active) { label = 'Active'; dis = ' disabled'; }
        else if (owned) { label = 'Play as'; }
        else if (!gateOk) { label = '🔒 ' + c.scoreReq + ' pts'; dis = ' disabled'; }
        else { label = 'Unlock'; }
        const cost = 0;
        html += shopCard(c.id, c.name, c.desc, (c.gender === 'male' ? '♂' : '♀') + ' ' + c.role, cost, c.scoreReq, owned, active, gateOk, label, dis, 'characters');
      });
    } else if (shopTab === 'supplies') {
      const bal = shardBalance();
      const left = GLOSSARY.filter(g => !termUnlocked(g.id)).length;
      html += '<div class="shopItem"><div class="siBody"><div class="siName">Vocabulary Scroll</div>' +
        '<div class="siDesc">Unlock one random word you have not collected yet (' + left + ' still locked).</div></div>' +
        '<button data-act="term"' + (bal < 1 || left === 0 ? ' disabled' : '') + '>1 shard</button></div>' +
        '<div class="shopItem"><div class="siBody"><div class="siName">Guild Pass</div>' +
        '<div class="siDesc">Enter the next locked quest location directly, ignoring the requirement.' +
        (freePass > 0 ? ' (You hold ' + freePass + '.)' : '') + '</div></div>' +
        '<button data-act="pass"' + (bal < 2 ? ' disabled' : '') + '>2 shards</button></div>';
    }
    $('shopItems').innerHTML = html;
    $('shopItems').querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => shopAction(btn.dataset.id, btn.dataset.act));
    });
  }

  function shopCard(id, name, desc, meta, gold, scoreReq, owned, equipped, gateOk, label, dis, tab) {
    const gateTag = scoreReq > 0 ? '<span class="siGate' + (gateOk ? ' ok' : '') + '">' + (gateOk ? '✓ ' : '🔒 ') + scoreReq + ' pts</span>' : '';
    const priceTag = gold > 0 ? '<span class="siPrice">' + gold + ' g</span>' : (owned ? '' : '<span class="siPrice free">Free</span>');
    const ownedTag = owned ? '<span class="siOwned">Owned</span>' : '';
    return '<div class="shopItem' + (equipped ? ' equipped' : '') + '" data-kind="' + tab + '">' +
      '<div class="siArt si-' + id + '">' + (tab === 'gear' ? '⚔' : tab === 'characters' ? '☻' : '✦') + '</div>' +
      '<div class="siBody"><div class="siName">' + name + ' ' + ownedTag + '</div>' +
      '<div class="siMeta">' + meta + ' ' + gateTag + ' ' + priceTag + '</div>' +
      '<div class="siDesc">' + desc + '</div></div>' +
      '<button data-id="' + id + '" data-act="' + tab + '"' + dis + '>' + label + '</button></div>';
  }

  function shopAction(id, act) {
    if (act === 'term') { buyTerm(); return; }
    if (act === 'pass') { buyPass(); return; }
    if (act === 'gear') {
      const w = WPN[id]; if (!w) return;
      if (COMBAT.weapons.indexOf(id) < 0) {
        if (COMBAT.score < w.scoreReq) { toast('Need ' + w.scoreReq + ' score points to buy this'); return; }
        if (COMBAT.gold < w.gold) { toast('Not enough gold'); return; }
        COMBAT.gold -= w.gold; COMBAT.weapons.push(id);
        toast('⚔ Purchased <b>' + w.name + '</b>!');
      }
      COMBAT.weapon = id; WORLD.equipWeapon(id);
      toast('Equipped <b>' + w.name + '</b>');
      saveCombat(); renderShop(); updateCombatHUD(); return;
    }
    if (act === 'skins') {
      const s = SKN[id]; if (!s) return;
      if (COMBAT.skins.indexOf(id) < 0) {
        if (COMBAT.score < s.scoreReq) { toast('Need ' + s.scoreReq + ' score points to buy this'); return; }
        if (COMBAT.gold < s.gold) { toast('Not enough gold'); return; }
        COMBAT.gold -= s.gold; COMBAT.skins.push(id);
        toast('✦ Purchased <b>' + s.name + '</b>!');
      }
      COMBAT.skin = id; WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
      saveCombat(); renderShop(); updateCombatHUD(); return;
    }
    if (act === 'characters') {
      const c = CHR[id]; if (!c) return;
      if (COMBAT.characters.indexOf(id) < 0) {
        if (COMBAT.score < c.scoreReq) { toast('Need ' + c.scoreReq + ' score points to unlock ' + c.name); return; }
        COMBAT.characters.push(id);
        toast('☻ Unlocked <b>' + c.name + '</b> — ' + c.role + '!');
      }
      COMBAT.character = id; WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
      saveCombat(); renderShop(); updateCombatHUD(); renderCharList(); return;
    }
  }

  function buyTerm() {
    if (shardBalance() < 1) { toast('Not enough shards'); return; }
    const pool = GLOSSARY.filter(g => !termUnlocked(g.id));
    if (!pool.length) { toast('All words are already unlocked'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    boughtTerms.add(pick.id);
    shardsSpent += 1;
    refreshGlossary();
    renderShop();
    updateHUD();
    toast('✓ New word unlocked: ' + pick.en + ' — check your glossary');
  }

  function buyPass() {
    if (shardBalance() < 2) { toast('Not enough shards'); return; }
    shardsSpent += 2;
    freePass += 1;
    renderShop();
    toast('✓ Guild Pass purchased — you now hold ' + freePass + '.');
  }

  function openShop() {
    shopOpen = true;
    renderShop();
    $('shopModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
  }
  function closeShop() {
    shopOpen = false;
    $('shopModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused();
    WORLD.relock();
  }

  /* ---------------- character switcher ---------------- */
  function renderCharList() {
    const box = $('charList'); if (!box) return;
    box.innerHTML = CHARACTERS.map(c => {
      const owned = COMBAT.characters.indexOf(c.id) >= 0;
      const active = COMBAT.character === c.id;
      const gateOk = COMBAT.score >= c.scoreReq || owned;
      let label = active ? 'Active' : owned ? 'Play as' : (gateOk ? 'Unlock free' : '🔒 ' + c.scoreReq + ' pts');
      const dis = active || !gateOk ? ' disabled' : '';
      return '<div class="charCard' + (active ? ' active' : '') + (owned ? '' : ' locked') + '" data-id="' + c.id + '">' +
        '<div class="charAvatar ca-' + c.id + '" style="--cc:#' + c.color.toString(16).padStart(6, '0') + '">' + (c.gender === 'male' ? '♂' : '♀') + '</div>' +
        '<div class="charInfo"><div class="charName">' + c.name + '</div>' +
        '<div class="charRole">' + c.role + '</div><div class="charDesc">' + c.desc + '</div></div>' +
        '<button data-id="' + c.id + '"' + dis + '>' + label + '</button></div>';
    }).join('');
    box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => {
      shopAction(b.dataset.id, 'characters');
      renderCharList();
    }));
  }
  function openCharModal() {
    charModalOpen = true;
    renderCharList();
    $('charModal').classList.add('show');
    WORLD.setLocked(true); syncPaused();
  }
  function closeCharModal() {
    charModalOpen = false;
    $('charModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused(); WORLD.relock();
  }
  function cycleCharacter() {
    const owned = COMBAT.characters;
    if (owned.length < 2) { toast('Unlock more characters at the shop to switch'); return; }
    const i = owned.indexOf(COMBAT.character);
    const next = owned[(i + 1) % owned.length];
    COMBAT.character = next;
    WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
    saveCombat(); updateCombatHUD();
    toast('☻ Now playing as <b>' + CHR[next].name + '</b> — ' + CHR[next].role);
  }
  function cycleWeapon() {
    const owned = COMBAT.weapons;
    if (owned.length < 2) { toast('Unlock more weapons at the shop to swap'); return; }
    const i = owned.indexOf(COMBAT.weapon);
    const next = owned[(i + 1) % owned.length];
    COMBAT.weapon = next;
    WORLD.equipWeapon(next);
    saveCombat(); updateCombatHUD();
    toast('⚔ Equipped <b>' + WPN[next].name + '</b>');
  }

  function renderGuild() {
    const p = WORLD.player.position;
    const cur = trackedNode();
    let html = '';
    ['A', 'B', 'C', 'D'].forEach(k => {
      const Z = ZONES[k];
      const list = NODES.filter(n => n.zone === k && n.type !== 'crystal');
      if (!list.length) return;
      html += '<div class="guildZone">' + Z.en + '</div>';
      list.forEach(n => {
        const isDone = done.has(n.id);
        const lock = isLockedNode(n);
        const d = Math.round(Math.hypot(n.x - p.x, n.z - p.z));
        const cls = 'guildRow' + (isDone ? ' done' : '') + (lock.locked && !isDone ? ' lock' : '') + (cur && cur.id === n.id ? ' cur' : '');
        html += '<div class="' + cls + '" data-id="' + n.id + '">' +
          '<div class="grIcon">' + (isDone ? '✓' : lock.locked ? '!' : '›') + '</div>' +
          '<div class="grBody"><div class="grName">' + nodeTitle(n) + '</div>' +
          '<div class="grSub">' + (n.label ? n.label.en : '') +
          (isDone ? ' · Done' : lock.locked ? ' · Complete ' + lock.need + ' questions to unlock' : '') + '</div></div>' +
          '<div class="grDist">' + d + ' m</div></div>';
      });
    });
    $('guildBody').innerHTML = html;
    $('guildBody').querySelectorAll('.guildRow').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (done.has(id)) { toast('This quest is already complete'); return; }
        trackedId = id;
        lastListSig = '';
        renderQuestPanel();
        closeGuild();
        toast('✓ Quest accepted: ' + nodeTitle(NODES.find(x => x.id === id)));
      });
    });
  }

  function openGuild() {
    guildOpen = true;
    renderGuild();
    $('guildModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
  }
  function closeGuild() {
    guildOpen = false;
    $('guildModal').classList.remove('show');
    if (state === STATE.WORLD) WORLD.setLocked(false);
    syncPaused();
    WORLD.relock();
  }

  $('shopCloseBtn').addEventListener('click', closeShop);
  $('guildCloseBtn').addEventListener('click', closeGuild);
  $('guildMapBtn').addEventListener('click', () => { closeGuild(); setTimeout(openBigMap, 60); });

  /* ================= EXPORT ================= */
  function exportData() {
    SESSION.endTime = Date.now();
    SESSION.summary = SESSION.summary || { done: mainDone(), attempts: attempts.length };
    SESSION.combat = { score: COMBAT.score, gold: COMBAT.gold, kills: COMBAT.kills, weapons: COMBAT.weapons.slice(), characters: COMBAT.characters.slice() };
    persist();
    download('bondquest_session.json', JSON.stringify(SESSION, null, 2), 'application/json');
    const rows = [['type', 'compound', 'step', 'chosen', 'correct', 'hintUsed', 'attempt']];
    attempts.forEach(a => rows.push([a.type, a.compound, a.step || '', a.chosen !== undefined ? a.chosen : '', a.correct ? 1 : 0, a.hintUsed ? 1 : 0, a.attempt || 1]));
    const csv = rows.map(r => r.join(',')).join('\n');
    setTimeout(() => download('bondquest_attempts.csv', '\ufeff' + csv, 'text/csv'), 500);
    toast('✓ Exported JSON + CSV — keep these for your project record');
  }
  function download(name, text, mime) {
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
    } catch (e) { toast('Export failed: ' + e.message); }
  }
  $('exportBtn').addEventListener('click', exportData);

  /* ================= LOCKS ================= */
  function refreshLocks() {
    NODES.forEach(n => {
      if (done.has(n.id)) { WORLD.setNodeState(n.id, 'done'); return; }
      WORLD.setNodeState(n.id, isLockedNode(n).locked ? 'locked' : 'active');
    });
  }

  /* ================= INTERACTION ================= */
  function interact() {
    if (state !== STATE.WORLD || !started) return;
    const wpNear = nearWpInfo(3.9);
    const n = WORLD.nearestNode(3.6);
    const pp = WORLD.player.position;
    const dn = n ? Math.hypot(n.x - pp.x, n.z - pp.z) : Infinity;
    if (wpNear && wpNear.d < dn) { onWpInteract(wpNear.wp); return; }
    if (!n) return;
    if (done.has(n.id)) { toast('This objective is already complete'); return; }
    const lock = isLockedNode(n);
    if (lock.locked) {
      if (freePass > 0) {
        freePass--;
        toast('✓ Guild Pass used — entering directly');
      } else {
        toast('🔒 Unlocks after ' + lock.need + ' correct answers (you have ' + correctCount + ')');
        return;
      }
    }

    if (n.type === 'npc') openDialog(n);
    else if (n.type === 'chest') openDotCross(n);
    else if (n.type === 'guild') openGuild();
    else if (n.type === 'shop') openShop();
    else openVocab(n);
  }

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (CLOUD.isOpen()) { CLOUD.close(); return; }
      if (coachOn) { coachEnd(); return; }
      if (wpOpen) { closeWpList(); return; }
      if (beaconOpen) { closeBeacon(); return; }
      if (shopOpen) { closeShop(); return; }
      if (charModalOpen) { closeCharModal(); return; }
      if (guildOpen) { closeGuild(); return; }
      if (mapOpen) { closeBigMap(); return; }
      if (helpOpen) { closeHelp(); return; }
      if (state === STATE.DIALOG) closeDialog();
      else if (state === STATE.DOTCROSS) closeDC();
      else if (state === STATE.SUMMARY) { closeModal('summaryModal'); setState(STATE.WORLD); }
      else if ($('glossaryDrawer').classList.contains('show')) { $('glossaryDrawer').classList.remove('show'); syncPaused(); }
      return;
    }
    if (k === 'e' && state === STATE.WORLD && !helpOpen && !mapOpen) { interact(); }
    if (k === 'h' && state === STATE.WORLD && !mapOpen) { helpOpen ? closeHelp() : openHelp(); }
    if (k === 'm') {
      if (mapOpen) closeBigMap();
      else if (!helpOpen && state === STATE.WORLD) openBigMap();
    }
    if (k === 't') {
      if (mapOpen || helpOpen) return;
      if (wpOpen) closeWpList();
      else if (state === STATE.WORLD) openWpList();
    }
    /* ---- combat controls ---- */
    if (paused || state !== STATE.WORLD) return;
    if (k === 'j') { playerAttack(false); return; }
    if (k === 'k') { playerAttack(true); return; }
    if (k === 'c') { cycleCharacter(); return; }
    if (k === 'q') { cycleWeapon(); return; }
    if (k === 'b') { openShop(); return; }
    if (k >= '1' && k <= '5') {
      const id = WEAPONS[Number(k) - 1] && WEAPONS[Number(k) - 1].id;
      if (id && COMBAT.weapons.indexOf(id) >= 0) shopAction(id, 'gear');
      else toast('Weapon slot ' + k + ' is locked — buy it at the shop (B)');
    }
  });

  /* ================= BOOT / LOOP ================= */
  function boot() {
    loadBeaconCfg();
    WORLD.init($('scene'));
    // Touch "E interact" button: goes through the same entry point as the E key
    WORLD.setInteractHandler(function () {
      if (helpOpen || mapOpen || wpOpen || shopOpen || guildOpen || beaconOpen || charModalOpen) return;
      interact();
    });
    loadWaypoints();
    WORLD.onZoneChange = k => {
      const Z = ZONES[k];
      toast('Now entering ' + Z.en);
      if (!SESSION.exploration.zonesVisited.includes(k)) SESSION.exploration.zonesVisited.push(k);
      persist();
    };
    initBigMap();
    initCombat();
    // shop tabs
    document.querySelectorAll('#shopTabs .shopTab').forEach(b => b.addEventListener('click', () => {
      shopTab = b.dataset.tab; renderShop();
    }));
    // character modal
    const cmOpen = $('charBtn'), cmClose = $('charCloseBtn');
    if (cmOpen) cmOpen.addEventListener('click', openCharModal);
    if (cmClose) cmClose.addEventListener('click', closeCharModal);
    // touch combat buttons
    const bindAtk = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bindAtk('atkBtn', () => playerAttack(false));
    bindAtk('skillBtn', () => playerAttack(true));
    bindAtk('swapBtn', cycleCharacter);
    bindAtk('shopQuickBtn', () => openShop());
    $('startIntro').innerHTML = INTRO_HTML;
    $('helpBody').innerHTML = INTRO_HTML;
    $('qpFoldBtn').addEventListener('click', () => {
      setQuestCollapsed(true);
      setTimeout(() => { try { $('qpTab').focus({ preventScroll: true }); } catch (e) { } }, 60);
    });
    $('qpTab').addEventListener('click', () => {
      setQuestCollapsed(false);
      setTimeout(() => { try { $('qpFoldBtn').focus({ preventScroll: true }); } catch (e) { } }, 60);
    });
    $('qpToggle').addEventListener('click', () => {
      const l = $('qpList');
      l.classList.toggle('open');
      $('qpCaret').textContent = l.classList.contains('open') ? '▴' : '▾';
    });
    refreshLocks();
    updateHUD();
    WORLD.setBeacon(trackedNode());

    // ---- Account system ----
    $('authBtn').addEventListener('click', () => CLOUD.open());
    // Freeze the character while the account window is open so WASD typing does not move the player
    document.addEventListener('bq:auth-open', () => { WORLD.setLocked(true); });
    document.addEventListener('bq:auth-close', () => {
      WORLD.clearKeys();
      if (state === STATE.WORLD) WORLD.setLocked(false);
    });
    document.addEventListener('bq:toast', (e) => { if (e.detail && e.detail.msg) toast(e.detail.msg, 3200); });
    CLOUD.init({ snapshot: snapshotProgress, apply: applyProgress }).catch((err) => {
      console.warn('account init failed', err);
    });

    $('startBtn').addEventListener('click', () => {
      $('startScreen').classList.remove('show');
      started = true;
      lastFrame = performance.now();
      SESSION.startTime = Date.now();
      logEvent({ type: 'start' });
      WORLD.requestLock();
      let seenCoach = false;
      try { seenCoach = !!localStorage.getItem('bq_coach_v2'); } catch (e) { }
      if (!seenCoach) setTimeout(() => coachShow(0), 500);
      if (!storeOk) setTimeout(() => toast('⚠️ Browser storage is blocked — progress will not save automatically. Use "↓" to export your data.', 5000), 1200);
      toast('Follow the arrow in the quest panel on the left — when you arrive, press E to interact.');
    });

    lastFrame = performance.now();
    window.__world = WORLD;
    window.__bq = { openDialog, openDotCross, openVocab, showSummary, interact, state: () => state, DC, COMP, TERM, NODES, attempts, openBigMap, getState: () => ({ state, helpOpen, mapOpen, wpOpen }), wp: { list: () => [...unlockedWp], open: openWpList, tp: doTeleport, pop: showTpPop, all: WAYPOINTS, dbg: () => { const c = BM.canvas, r = c.getBoundingClientRect(), wr = $('mapWrap').getBoundingClientRect(); return { cw: c.width, ch: c.height, rw: r.width, rh: r.height, rl: r.left - wr.left, rt: r.top - wr.top, s: bmScale(), zoom: BM.zoom, cx: BM.cx, cz: BM.cz }; } } };
    requestAnimationFrame(loop);
  }

  let mapTick = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.max(0, Math.min(0.05, (now - lastFrame) / 1000)) || 0.016;
    lastFrame = now;

    const moving = started && !paused && state === STATE.WORLD;
    if (moving) {
      activeTime += dt;
      const p = WORLD.player.position;
      if (!loop._lastPos) loop._lastPos = { x: p.x, z: p.z, t: 0 };
      const dx = p.x - loop._lastPos.x, dz = p.z - loop._lastPos.z;
      const step = Math.hypot(dx, dz);
      if (step > 0.01) {
        SESSION.exploration.distanceTraveled += step;
        loop._lastPos.x = p.x; loop._lastPos.z = p.z;
      }
      if (now - (loop._sample || 0) > 2000) {
        loop._sample = now;
        SESSION.exploration.pathSamples.push({ x: Math.round(p.x), z: Math.round(p.z), t: Math.round(activeTime) });
        const zk = WORLD.zoneNow;
        SESSION.exploration.timePerZone[zk] = (SESSION.exploration.timePerZone[zk] || 0) + 2;
        persist();
      }
    }

    tickCombat(dt);
    WORLD.update(dt, now / 1000);

    if (++mapTick % 4 === 0) {
      WORLD.drawMinimap(WORLD.player.position, WORLD.yaw, NODES, done, trackedNode(), unlockedWp);
      updateHUD();
      refreshPrompt();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
