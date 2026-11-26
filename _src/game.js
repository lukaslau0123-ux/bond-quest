/* ============================================================
   Bond Quest — game logic
   ============================================================ */

(function () {
  'use strict';

  const STATE = { WORLD: 'WORLD', DIALOG: 'DIALOG', DOTCROSS: 'DOTCROSS', VOCAB: 'VOCAB', SUMMARY: 'SUMMARY' };
  let state = STATE.WORLD;
  let started = false;
  let paused = false;
  let guided = false;
  let recruitClaims = 0;
  let LANG = 'en';
  try { LANG = localStorage.getItem('bq_lang') === 'zh' ? 'zh' : 'en'; } catch (e) { }
  let gachaOpen = false, gachaCurrent = null, gachaRevealed = false;
  let dailyOpen = false, dailyPending = null;

  function isZh() { return LANG === 'zh'; }
  function bi(en, zh) { return isZh() && zh ? zh : en; }
  function textOf(obj) { if (!obj) return ''; return (isZh() && obj.zh) ? obj.zh : (obj.en || ''); }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const done = new Set();
  const nodeCorrect = new Map();
  let correctCount = 0;
  const attempts = [];

  let activeTime = 0;
  let lastFrame = 0;

  const $ = id => document.getElementById(id);

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

  /* ---------------- sound effects (procedural WebAudio, no files) ---------------- */
  const SFX = (function () {
    let ctx = null;
    let muted = false;
    try { muted = localStorage.getItem('bq_mute') === '1'; } catch (e) { }
    function ac() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(f0, f1, dur, type, vol, delay) {
      const a = ac(); if (!a || muted) return;
      const t0 = a.currentTime + (delay || 0);
      const o = a.createOscillator(), gn = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
    function noise(dur, vol, freq) {
      const a = ac(); if (!a || muted) return;
      const t0 = a.currentTime;
      const n = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, n, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = a.createBufferSource(); src.buffer = buf;
      const fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = freq || 1200;
      const gn = a.createGain(); gn.gain.setValueAtTime(vol || 0.2, t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(fl); fl.connect(gn); gn.connect(a.destination);
      src.start(t0);
    }
    return {
      swing() { noise(0.12, 0.18, 2400); tone(320, 90, 0.12, 'sawtooth', 0.08); },
      hit() { noise(0.08, 0.32, 900); tone(180, 60, 0.1, 'square', 0.18); },
      kill() { tone(160, 40, 0.35, 'sawtooth', 0.22); noise(0.22, 0.22, 600); tone(520, 130, 0.3, 'sine', 0.12, 0.05); },
      coin() { tone(880, 1320, 0.09, 'sine', 0.16); tone(1320, 1760, 0.14, 'sine', 0.14, 0.06); },
      good() { tone(523, 523, 0.09, 'sine', 0.16); tone(659, 659, 0.09, 'sine', 0.16, 0.09); tone(784, 784, 0.16, 'sine', 0.18, 0.18); },
      bad() { tone(220, 110, 0.28, 'square', 0.14); },
      jump() { tone(220, 520, 0.14, 'sine', 0.1); },
      skill() { tone(400, 1200, 0.3, 'sine', 0.2); tone(800, 2400, 0.25, 'sine', 0.1, 0.05); },
      click() { tone(660, 660, 0.05, 'sine', 0.1); },
      hurt() { tone(140, 70, 0.2, 'sawtooth', 0.18); },
      unlock() { tone(440, 660, 0.12, 'sine', 0.16); tone(660, 990, 0.18, 'sine', 0.16, 0.1); },
      correct() { tone(740, 988, 0.11, 'sine', 0.15); tone(988, 1318, 0.16, 'triangle', 0.13, 0.07); tone(1480, 1760, 0.2, 'sine', 0.1, 0.16); },
      perfect() { [523,659,784,1046,1318].forEach((f,i) => tone(f, f * 1.04, 0.34, i % 2 ? 'triangle' : 'sine', 0.13, i * 0.075)); noise(0.22, 0.07, 3800); },
      gacha() { tone(180, 720, 0.5, 'sine', 0.13); tone(360, 1440, 0.42, 'triangle', 0.1, 0.08); noise(0.34, 0.1, 1800); },
      rare(rarity) { const base = rarity >= 5 ? 392 : rarity >= 4 ? 330 : 262; [1,1.25,1.5,2].forEach((m,i) => tone(base*m, base*m*1.02, rarity >= 5 ? 0.5 : 0.3, 'sine', 0.12, i * 0.08)); if (rarity >= 5) noise(0.4, 0.11, 5200); },
      isMuted() { return muted; },
      toggleMute() { muted = !muted; try { localStorage.setItem('bq_mute', muted ? '1' : '0'); } catch (e) { } return muted; },
      resume() { ac(); }
    };
  })();
  window.SFX = SFX;   // world.js (jump/land) and inline handlers use this

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
    kills: 0,
    crystals: 0,
    spentCrystals: 0,
    streak: 0,
    bestStreak: 0,
    pity: 0,
    daily: { date: '', answers: [], done: false }
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
        weapon: COMBAT.weapon, character: COMBAT.character, skin: COMBAT.skin, kills: COMBAT.kills,
        crystals: COMBAT.crystals, spentCrystals: COMBAT.spentCrystals,
        streak: COMBAT.streak, bestStreak: COMBAT.bestStreak, pity: COMBAT.pity,
        gachaPulls: recruitClaims, daily: COMBAT.daily
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
      COMBAT.crystals = Math.max(0, Number(d.crystals) || 0);
      COMBAT.spentCrystals = Math.max(0, Number(d.spentCrystals) || 0);
      COMBAT.streak = Math.max(0, Number(d.streak) || 0);
      COMBAT.bestStreak = Math.max(COMBAT.streak, Number(d.bestStreak) || 0);
      COMBAT.pity = Math.max(0, Number(d.pity) || 0);
      if (d.daily && typeof d.daily === 'object') COMBAT.daily = { date: String(d.daily.date || ''), answers: Array.isArray(d.daily.answers) ? d.daily.answers.slice(0, 3) : [], done: !!d.daily.done };
      if (Number.isFinite(Number(d.gachaPulls))) recruitClaims = Math.max(0, Number(d.gachaPulls));
    } catch (e) { }
  }

  function addScore(n) { COMBAT.score += n; saveCombat(); updateCombatHUD(); }
  function addGold(n) { COMBAT.gold += n; saveCombat(); updateCombatHUD(); }
  function addCrystals(n) { COMBAT.crystals = Math.max(0, COMBAT.crystals + n); saveCombat(); updateCombatHUD(); }

  function ensureDaily() {
    const key = todayKey();
    if (!COMBAT.daily || COMBAT.daily.date !== key) {
      COMBAT.daily = { date: key, answers: [], done: false };
      saveCombat();
    }
    return COMBAT.daily;
  }
  function challengeDoneCount() {
    return NODES.filter(n => (n.type === 'npc' || n.type === 'chest') && done.has(n.id)).length;
  }
  function drawsEarned() { return Math.floor(challengeDoneCount() / GACHA_RULES.challengesPerDraw); }
  function drawCharges() { return Math.max(0, drawsEarned() - recruitClaims); }
  function challengeToNextDraw() {
    const rem = challengeDoneCount() % GACHA_RULES.challengesPerDraw;
    return rem === 0 ? GACHA_RULES.challengesPerDraw : GACHA_RULES.challengesPerDraw - rem;
  }
  function rewardMultiplier() { return COMBAT.streak >= REWARD_RULES.streakAt ? REWARD_RULES.streakMultiplier : 1; }
  function awardCorrectStep(baseXp, baseGold, opts) {
    const o = opts || {};
    COMBAT.streak = Math.max(0, COMBAT.streak) + 1;
    COMBAT.bestStreak = Math.max(COMBAT.bestStreak, COMBAT.streak);
    const mult = rewardMultiplier();
    const dailyMult = o.daily ? REWARD_RULES.dailyMultiplier : 1;
    const xp = Math.round(baseXp * mult * dailyMult);
    const gold = Math.round(baseGold * mult * dailyMult);
    COMBAT.score += xp;
    COMBAT.gold += gold;
    saveCombat();
    updateCombatHUD();
    return { xp, gold, mult, dailyMult, streak: COMBAT.streak };
  }
  function breakStreak() {
    if (!COMBAT.streak) return;
    COMBAT.streak = 0;
    saveCombat();
    updateCombatHUD();
  }
  function awardPerfectChallenge() {
    COMBAT.score += REWARD_RULES.perfectXp;
    COMBAT.gold += REWARD_RULES.perfectGold;
    COMBAT.crystals += REWARD_RULES.perfectCrystals;
    saveCombat();
    updateCombatHUD();
    return { xp: REWARD_RULES.perfectXp, gold: REWARD_RULES.perfectGold, crystals: REWARD_RULES.perfectCrystals };
  }

  /* Hook the world combat engine to the reward economy. */
  function initCombat() {
    loadCombat();
    saveCombat();   // ensure a baseline record exists from the first session
    WORLD.setCombatHooks({
      onHit: function (enemy, dmg, combo, isSkill) {
        SFX.hit();
        const s = COMBAT_RULES.hitScore + (combo || 0);
        const g = COMBAT_RULES.hitGold;
        addScore(s); addGold(g);
        if (Math.random() < 0.45) { SFX.coin(); floatReward('+' + s + '  +' + g + 'g', enemy.group.position); }
      },
      onKill: function (enemy) {
        SFX.kill();
        COMBAT.kills++;
        addScore(enemy.type.score); addGold(enemy.type.gold);
        toast('⚔ ' + enemy.type.name + ' defeated! <b>+' + enemy.type.score + ' XP</b> · <b>+' + enemy.type.gold + ' gold</b>', 1800);
        floatReward('+' + enemy.type.score + '  +' + enemy.type.gold + 'g', enemy.group.position, true);
        saveCombat();
      },
      onHurt: function (enemy) {
        if (COMBAT.hurtCd > 0) return;
        COMBAT.hurtCd = 1.0;
        SFX.hurt();
        const el = $('hurtFlash'); if (el) { el.style.opacity = '1'; setTimeout(() => { el.style.opacity = '0'; }, 260); }
      }
    });
    WORLD.equipWeapon(COMBAT.weapon);
    WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
    let enabled = false;
    try { enabled = localStorage.getItem('bq_combat_enabled') === '1'; } catch (e) { }
    setCombatMode(enabled);
    updateCombatHUD();
  }
  COMBAT.hurtCd = 0;

  function setCombatMode(enabled) {
    $('combatToggle').checked = enabled;
    document.body.classList.toggle('combat-on', enabled);
    WORLD.setCombatEnabled(enabled);
    try { localStorage.setItem('bq_combat_enabled', enabled ? '1' : '0'); } catch (e) { }
  }

  /* ================================================================
     INTERACTIVE TRAINING MISSION (do-it-yourself, CoD-style)
     The player learns by DOING, not reading:
       1 MOVE   — actually walk 8 m          (input is measured)
       2 APPROACH — walk to the glowing NPC  (distance is measured)
       3 INTERACT — actually press E         (interaction is measured)
       4 ANSWER — actually pick an answer    (first dialog choice)
       done   — celebration, combat unlocked, bonus hint
     Progress bar fills as the player performs each real action.
     ================================================================ */
  const TUT_KEY = 'bq_tut_v1';
  let tutStep = 0;            // 0 not started · 1 move · 2 approach · 3 pressE · 4 answer · 5 done
  let tutMoved = 0;           // metres actually walked in step 1
  let tutLastPos = null;      // last player position for move measuring
  let tutCelebrate = 0;
  let introTrial = null;
  let introTrialTicker = 0;
  const TUT_MOVE_GOAL = 8;

  function tutSeen() { try { return !!localStorage.getItem(TUT_KEY); } catch (e) { return false; } }

  function tutShow(step) {
    tutStep = step;
    const bh = $('bigHint'); if (!bh) return;
    const touch = WORLD.isTouchMode();
    const txt = {
      1: ['🎮 TRAINING · STEP 1 OF 3', touch ? 'DRAG THE LEFT STICK TO WALK' : 'HOLD  W  TO WALK', touch ? 'Push the stick — walk 8 m to continue.' : 'Keep holding until the bar is full.'],
      2: ['🎮 TRAINING · STEP 2 OF 3', 'WALK TO THE GLOWING PERSON', 'Follow the green light beam!'],
      3: ['🎮 TRAINING · STEP 3 OF 3', touch ? 'TAP  THE  E  BUTTON' : 'PRESS  E', touch ? 'You are close — tap Interact!' : 'You are close — press E to talk!'],
      4: ['🎯', 'PICK AN ANSWER', 'Any answer works — you are learning!']
    }[step];
    if (!txt) return;
    bh.querySelector('.bhStep').textContent = txt[0];
    bh.querySelector('.bhText').textContent = txt[1];
    bh.querySelector('.bhSub').textContent = txt[2];
    bh.className = 'bh show s' + step;
  }
  function tutHide() { const bh = $('bigHint'); if (bh) bh.className = 'bh'; }

  function tutProgress(k) {
    const el = $('bhFill'); if (el) el.style.width = Math.round(Math.max(0, Math.min(1, k)) * 100) + '%';
  }

  function tutStart() {
    if (tutSeen() || mainDone()) return;
    setTimeout(() => {
      if (guided || state !== STATE.WORLD) return;
      tutShow(1); tutProgress(0); SFX.click();
    }, 700);
  }
  function tutAdvance(next) {
    SFX.coin();
    tutShow(next);
  }
  function tutComplete() {
    tutShow(5);
    const bh = $('bigHint'); if (bh) bh.className = 'bh show s3 done';
    bh.querySelector('.bhStep').textContent = '🎉';
    bh.querySelector('.bhText').textContent = 'TRAINING COMPLETE!';
    bh.querySelector('.bhSub').textContent = 'You are ready — the world is yours!';
    tutProgress(1);
    SFX.unlock();
    tutCelebrate = performance.now() + 2600;
    try { localStorage.setItem(TUT_KEY, '1'); } catch (e) { }
  }
  function formatTrialTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function startIntroTrial() {
    if (!started) return;
    tutStep = 0;
    tutCelebrate = 0;
    tutHide();
    introTrial = { started: performance.now(), collected: 0, total: 3, done: false };
    document.body.classList.add('intro-trial');
    setQuestCollapsed(true);
    const hud = $('trialHud');
    hud.classList.add('show');
    hud.classList.remove('complete');
    $('trialTimer').textContent = '0:00';
    $('trialGoal').textContent = 'Run through all 3 electron motes';
    document.querySelectorAll('.trialPip').forEach(p => p.classList.remove('got'));
    WORLD.setBondTrialHooks({
      onCollect: function (def, count, total) {
        if (!introTrial) return;
        introTrial.collected = count;
        const pip = document.querySelector('.trialPip[data-trial="' + def.family + '"]');
        if (pip) pip.classList.add('got');
        $('trialGoal').textContent = count + ' / ' + total + ' · ' + def.label;
        COMBAT.score += 2;
        COMBAT.gold += 1;
        saveCombat();
        updateCombatHUD();
        SFX.correct();
        burstAt(innerWidth / 2, innerHeight * 0.48, def.family === 'ionic' ? '#3fd8ff' : def.family === 'covalent' ? '#5fd0a8' : '#ffc85f', 26);
        floatScreenText('+' + 2 + ' XP · +' + 1 + ' gold', innerWidth / 2, innerHeight * 0.46);
        toast(def.label + ' collected!', 1100);
        logEvent({ type: 'bond_trial_mote', family: def.family, collected: count });
        if (count >= total) completeIntroTrial();
      },
      onComplete: function (info) { completeIntroTrial(info); }
    });
    const trial = WORLD.startBondTrial({ x: 0, z: -1.5 });
    introTrial.total = trial ? trial.total : 3;
    introTrialTicker = setInterval(function () {
      if (!introTrial || introTrial.done) return;
      $('trialTimer').textContent = formatTrialTime((performance.now() - introTrial.started) / 1000);
    }, 250);
  }

  function completeIntroTrial(info) {
    if (!introTrial || introTrial.done) return;
    introTrial.done = true;
    clearInterval(introTrialTicker);
    introTrialTicker = 0;
    const elapsed = info && info.elapsed ? info.elapsed : (performance.now() - introTrial.started) / 1000;
    COMBAT.score += 10;
    COMBAT.gold += 5;
    COMBAT.bestStreak = Math.max(COMBAT.bestStreak, COMBAT.streak);
    saveCombat();
    updateCombatHUD();
    const hud = $('trialHud');
    hud.classList.add('complete');
    $('trialTimer').textContent = formatTrialTime(elapsed);
    $('trialGoal').textContent = 'FIRST BOND FORGED · ' + elapsed.toFixed(1) + 's · +10 XP · +5 gold';
    showBanner('FIRST BOND', bi('Ionic cyan · Covalent green · Metallic gold · Combat unlocked', 'Ionic cyan · Covalent green · Metallic gold · Combat 已解鎖'));
    SFX.perfect();
    burstAt(innerWidth / 2, innerHeight * 0.46, '#ffd86a', 54);
    setCombatMode(true);
    hud.classList.add('celebrating');
    setTimeout(function () { if (introTrial) hud.classList.remove('celebrating'); }, 2300);
    logEvent({ type: 'bond_trial_complete', elapsed: +elapsed.toFixed(2) });
  }

  function finishIntroTrial() {
    if (!introTrial) return;
    clearInterval(introTrialTicker);
    introTrialTicker = 0;
    WORLD.stopBondTrial();
    WORLD.setBondTrialHooks(null);
    introTrial = null;
    document.body.classList.remove('intro-trial');
    $('trialHud').classList.remove('show', 'complete', 'celebrating');
    setQuestCollapsed(false);
    openNextLab();
  }

  function tickTutorial() {
    if (tutCelebrate && performance.now() > tutCelebrate) { tutCelebrate = 0; tutHide(); return; }
    if (tutCelebrate) return;
    if (tutStep === 0 || tutStep >= 5) return;
    if (state !== STATE.WORLD || !started) return;
    /* re-show the banner after closing a modal */
    const bhEl = $('bigHint');
    if (bhEl && !bhEl.classList.contains('show')) tutShow(tutStep);
    const p = WORLD.player.position;
    if (tutStep === 1) {
      if (tutLastPos) tutMoved += Math.hypot(p.x - tutLastPos.x, p.z - tutLastPos.z);
      tutLastPos = { x: p.x, z: p.z };
      tutProgress(tutMoved / TUT_MOVE_GOAL);
      if (tutMoved >= TUT_MOVE_GOAL) tutAdvance(2);
      return;
    }
    const t = trackedNode();
    if (!t) return;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (tutStep === 2) {
      tutProgress(1 - d / 26);
      if (d < 7) tutAdvance(3);
      return;
    }
    if (tutStep === 3) {
      tutProgress(Math.max(0, 1 - Math.max(0, d - 4) / 4));
    }
  }
  /* legacy alias: keep the celebration banner visible during tutComplete */
  function questCelebrate() {
    if (!tutCelebrate) tutHide();
  }

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
    if (!started || paused || state !== STATE.WORLD || !WORLD.combatState.enabled) return;
    const now = performance.now() / 1000;
    if (now - COMBAT.lastHit > COMBAT_RULES.comboWindow) COMBAT.combo = 0;
    if (isSkill && COMBAT.skillCd > 0) { toast('Skill recharging — ' + COMBAT.skillCd.toFixed(1) + 's'); return; }
    const w = WPN[COMBAT.weapon];
    if (now - COMBAT.lastHit < w.rate && !isSkill) return;
    const comboStep = isSkill ? 0 : COMBAT.combo;
    if (!WORLD.performAttack(w, comboStep, isSkill, updateAttackCombo)) return;
    if (isSkill) { COMBAT.skillCd = COMBAT_RULES.skillCooldown; SFX.skill(); }
    else SFX.swing();
    COMBAT.lastHit = now;
  }

  function updateAttackCombo(res) {
    if (res.hit) {
      COMBAT.combo = Math.min(COMBAT_RULES.comboCap, COMBAT.combo + 1);
      COMBAT.comboTimer = performance.now() / 1000 + COMBAT_RULES.comboWindow;
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
    if (n.main) return { locked: false };
    const t = tierOfNode(n);
    if (t >= 2 && correctCount < 3) return { locked: true, need: 3 };
    if (t >= 3 && correctCount < 6) return { locked: true, need: 6 };
    return { locked: false };
  }

  /* ---------------- HUD ---------------- */
  function mainDone() { return NODES.filter(n => n.main && done.has(n.id)).length; }

  /* Brief highlight on the HUD region pill when the player crosses a region border. */
  let zonePulseTimer = null;
  function zonePulse() {
    const el = $('zoneLabel'); if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;            // restart the animation
    el.classList.add('pulse');
    clearTimeout(zonePulseTimer);
    zonePulseTimer = setTimeout(() => el.classList.remove('pulse'), 1600);
  }

  /* ---------------- account progress bridge ---------------- */
  // The account system only touches game state through these two functions: snapshot exports, apply restores.
  function snapshotProgress() {
    return {
      v: 1,
      done: [...done],
      recruitClaims,
      correct: correctCount,
      freePass: freePass,
      wp: [...unlockedWp],
      beacon: JSON.parse(JSON.stringify(WORLD.BEACON_CFG)),
      coach: (function () { try { return !!localStorage.getItem('bq_coach_v2'); } catch (e) { return false; } })(),
      combat: {
        score: COMBAT.score, gold: COMBAT.gold, weapons: COMBAT.weapons.slice(),
        characters: COMBAT.characters.slice(), skins: COMBAT.skins.slice(),
        weapon: COMBAT.weapon, character: COMBAT.character, skin: COMBAT.skin, kills: COMBAT.kills,
        crystals: COMBAT.crystals, spentCrystals: COMBAT.spentCrystals,
        streak: COMBAT.streak, bestStreak: COMBAT.bestStreak, pity: COMBAT.pity,
        gachaPulls: recruitClaims, daily: COMBAT.daily
      }
    };
  }

  function applyProgress(p) {
    if (!p) return;
    done.clear();
    nodeCorrect.clear();
    (p.done || []).forEach(function (id) { done.add(id); nodeCorrect.set(id, true); });
    recruitClaims = Math.max(0, Number(p.recruitClaims) || 0);
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
      COMBAT.crystals = Math.max(0, Number(c.crystals) || 0);
      COMBAT.spentCrystals = Math.max(0, Number(c.spentCrystals) || 0);
      COMBAT.streak = Math.max(0, Number(c.streak) || 0);
      COMBAT.bestStreak = Math.max(COMBAT.streak, Number(c.bestStreak) || 0);
      COMBAT.pity = Math.max(0, Number(c.pity) || 0);
      if (Number.isFinite(Number(c.gachaPulls))) recruitClaims = Math.max(0, Number(c.gachaPulls));
      if (c.daily && typeof c.daily === 'object') COMBAT.daily = { date: String(c.daily.date || ''), answers: Array.isArray(c.daily.answers) ? c.daily.answers.slice(0, 3) : [], done: !!c.daily.done };
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
    const st = $('streakNum'); if (st) st.textContent = COMBAT.streak;
    const sm = $('streakMul'); if (sm) sm.textContent = '×' + rewardMultiplier().toFixed(1);
    const sp = $('streakPill'); if (sp) sp.classList.toggle('hot', COMBAT.streak >= REWARD_RULES.streakAt);
    const d = ensureDaily();
    const db = $('dailyBadge'); if (db) db.textContent = d.done ? '✓' : (d.answers.length + '/3');
    const dailyBtn = $('dailyBtn'); if (dailyBtn) dailyBtn.classList.toggle('ready', !d.done);
    const charges = drawCharges();
    const gb = $('gachaBadge'); if (gb) gb.textContent = charges > 0 ? String(charges) : '';
    const gachaBtn = $('gachaBtn'); if (gachaBtn) {
      gachaBtn.classList.toggle('ready', charges > 0);
      gachaBtn.title = 'Companion draw · ' + charges + ' charge(s) · pity ' + COMBAT.pity + '/' + GACHA_RULES.pityMax;
    }
    const wp = $('weaponPill'); if (wp) wp.title = 'Equipped weapon · press 1–5 to swap';
    const cp = $('charPill'); if (cp) cp.title = 'Active character · press C to switch';
  }

  /* ---------------- language toggle ---------------- */
  function syncLanguageUI() {
    document.body.classList.toggle('lang-zh', isZh());
    const lb = $('langBtn'); if (lb) lb.textContent = isZh() ? '中文' : 'EN';
    document.querySelectorAll('[data-lang-toggle]').forEach(b => { b.textContent = isZh() ? '中文 / EN' : 'EN / 中文'; });
  }
  function toggleLanguage() {
    LANG = isZh() ? 'en' : 'zh';
    try { localStorage.setItem('bq_lang', LANG); } catch (e) { }
    syncLanguageUI();
    if (state === STATE.DIALOG && dlg) {
      $('npcLine').textContent = guided
        ? bi('Challenge · Classify ' + dlg.c.f, '挑戰 · 分類 ' + dlg.c.f)
        : bi('Classify ' + dlg.c.f + ' in three steps.', '用三個步驟分類 ' + dlg.c.f + '。');
      if (dlg.lastAnswer) renderDialogFeedback(); else renderDialogStep();
      $('dialogHintBtn').textContent = bi('Hint', '提示');
      $('dialogCloseBtn').textContent = bi('Leave', '離開');
    }
    if (state === STATE.DOTCROSS && dcq) {
      $('dcTitle').textContent = dcq.q.compound + ' — ' + bi('Dot-and-cross diagram', 'Dot-and-cross 圖');
      $('dcHintBtn').textContent = bi('Hint', '提示');
      $('dcResetBtn').textContent = bi('Reset', '重設');
      $('dcCloseBtn').textContent = bi('Leave', '離開');
      $('dcCheckBtn').textContent = dcq.solved ? bi('Back to world', '返回世界') : bi('Check', '檢查');
      const dht = $('dcHowTitle');
      if (dht) dht.textContent = bi('How to do it — follow these steps', '做法 — 按步驟完成');
      const dl = $('dcLegend');
      if (dl) dl.textContent = bi('One click fills a complete electron pair. Use Erase to clear a pair, or Auto-fill shell for 1 crystal. Keyboard: arrows move · Enter places.', '一下點擊會填入完整 electron pair。用 Erase 清除整對，或用 Auto-fill shell（1 crystal）自動填滿。鍵盤：方向鍵移動 · Enter 放置。');
      const tb = $('dcToolbar').querySelector('[data-tool="pair"]');
      const eb = $('dcToolbar').querySelector('[data-tool="erase"]');
      if (tb) tb.textContent = '✚ ' + bi('Pair', '電子對');
      if (eb) eb.textContent = '⌫ ' + bi('Erase', '擦除');
      const bb = $('dcBracketBtn'); if (bb) bb.textContent = '[ ] ' + bi('Brackets', '括號');
      renderDC();
    }
    if (dailyOpen) renderDaily();
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
    paused = (state !== STATE.WORLD) || helpOpen || mapOpen || coachOn || shopOpen || guildOpen || beaconOpen || wpOpen || charModalOpen || gachaOpen || dailyOpen || $('glossaryDrawer').classList.contains('show');
    if (paused) { const cb = $('comboBadge'); if (cb) cb.classList.remove('show'); }
  }
  function releasePointerForModal() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { }
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

  function openNextLab() {
    if (!started || paused || state !== STATE.WORLD || CLOUD.isOpen()) return;
    const node = nextMainNode();
    guided = true;
    tutStep = 0;
    tutCelebrate = 0;
    tutHide();
    if (!node) { showSummary(); return; }
    WORLD.teleportTo(node.x, node.z);
    if (node.type === 'npc') openDialog(node);
    else openDotCross(node);
  }

  function labCompletionActions(container, close) {
    const actions = document.createElement('div');
    actions.className = 'labChoices';
    const next = document.createElement('button');
    next.className = 'primary';
    next.textContent = nextMainNode() ? 'Next challenge' : 'See revision summary';
    next.addEventListener('click', () => { close(true); openNextLab(); });
    actions.appendChild(next);
    if (recruitsAvailable() > 0) {
      const recruit = document.createElement('button');
      recruit.className = 'ghost';
      recruit.textContent = bi('Open companion draw', '開啟伙伴抽卡');
      recruit.addEventListener('click', () => { close(true); openGacha(); });
      actions.appendChild(recruit);
    }
    container.appendChild(actions);
  }

  function startSession(openLab, introLevel) {
    $('startScreen').classList.remove('show');
    started = true;
    WORLD.setLocked(false);
    lastFrame = performance.now();
    SESSION.startTime = Date.now();
    logEvent({ type: 'start', mode: introLevel ? 'bond_trial' : openLab ? 'lab' : 'explore' });
    if (introLevel) { WORLD.requestLock(); startIntroTrial(); }
    else if (openLab) openNextLab();
    else { WORLD.requestLock(); tutStart(); }
    if (!storeOk) toast('Browser storage is blocked. Use Export data to keep a copy of your session.', 5000);
  }

  /* ================= DIALOG (classification) ================= */
  let dlg = null;

  function optionSets(c) {
    const s1 = [
      { v: 1, en: 'A metal + a non-metal', zh: '金屬 + 非金屬 (metal + non-metal)' },
      { v: 2, en: 'Non-metal atoms only', zh: '只有非金屬原子 (non-metal atoms only)' },
      { v: 3, en: 'Metal atoms only', zh: '只有金屬原子 (metal atoms only)' }
    ];
    const s2 = [
      { v: 1, en: c.id === 'nh4cl' ? 'Attraction between NH₄⁺ and Cl⁻ ions' : 'Electron transfer',
        zh: c.id === 'nh4cl' ? 'NH₄⁺ 與 Cl⁻ 離子之間的吸引力 (ionic attraction)' : '電子轉移 (electron transfer)' },
      { v: 2, en: 'Electron sharing', zh: '共用電子 (electron sharing)' },
      { v: 3, en: 'Delocalised electrons', zh: '離域電子 (delocalised electrons)' }
    ];
    const s3 = [
      { v: 1, en: 'Ionic bond', zh: 'Ionic bond（離子鍵）' },
      { v: 2, en: 'Covalent bond', zh: 'Covalent bond（共價鍵）' },
      { v: 3, en: 'Metallic bond', zh: 'Metallic bond（金屬鍵）' }
    ];
    return [s1, s2, s3];
  }

  function explain(c, step) {
    if (c.id === 'nh4cl') {
      return [
        { en: 'N, H and Cl are all non-metals. This compound is an exception to the usual element-type shortcut.',
          zh: 'N、H、Cl 全部都是 non-metal。這題是元素分類捷徑嘅例外。' },
        { en: 'N and H share electrons within NH₄⁺. The salt itself is made of NH₄⁺ and Cl⁻ ions.',
          zh: 'NH₄⁺ 內部由 N 與 H 共用電子 (electron sharing)。整種鹽則由 NH₄⁺ 與 Cl⁻ 離子組成。' },
        { en: 'NH₄⁺ and Cl⁻ attract electrostatically in a giant ionic lattice. The N–H bonds within NH₄⁺ are covalent.',
          zh: 'NH₄⁺ 與 Cl⁻ 在 giant ionic lattice 中以靜電吸引。NH₄⁺ 內部嘅 N–H bonds 是 covalent。' }
      ][step - 1];
    }
    if (step === 1) {
      if (c.comp === 1) return { en: 'One metal + one non-metal: the metal will lose electrons and the non-metal will gain them.',
        zh: '一種金屬 + 一種非金屬：金屬會失去電子，非金屬會得到電子 (electron transfer)。' };
      if (c.comp === 2) return { en: 'All the atoms are non-metals, so no atom easily loses electrons — they share electrons instead.',
        zh: '所有原子都是 non-metal，沒有原子容易失去電子，所以改為共用電子 (electron sharing)。' };
      return { en: 'Only metal atoms are present: their valence electrons are free to move through the whole structure.',
        zh: '只有金屬原子：valence electrons 可以在整個結構中自由移動 (delocalised)。' };
    }
    if (step === 2) {
      if (c.ebeh === 1) return { en: 'Electrons are transferred from the metal to the non-metal, forming positive and negative ions.',
        zh: '電子由金屬轉移 (electron transfer) 到非金屬，形成正、負離子。' };
      if (c.ebeh === 2) return { en: 'Atoms share electron pairs. Hydrogen can fill its shell with two electrons. Some atoms, such as B in BF₃, bond with fewer than eight.',
        zh: '原子共用電子對 (shared electron pairs)。H 只需 2 粒電子填滿 shell；B in BF₃ 等原子亦可以少於八隅體。' };
      return { en: 'Valence electrons are delocalised into a "sea of electrons" shared by all the metal ions.',
        zh: 'Valence electrons 離域成 electron sea，由所有金屬離子共同吸引。' };
    }
    if (c.bond === 1) return { en: 'Oppositely charged ions attract each other electrostatically — that is the ionic bond.',
      zh: '相反電荷的離子互相靜電吸引，這就是 ionic bond。' };
    if (c.bond === 2) return { en: 'The shared electron pairs are attracted to both nuclei — that is the covalent bond.',
      zh: '共用電子對 (shared electron pair) 同時受兩個原子核吸引，這就是 covalent bond。' };
    return { en: 'The positive metal ions are held by the delocalised electrons around them — that is the metallic bond.',
      zh: '正金屬離子被周圍的 delocalised electrons 吸引，這就是 metallic bond。' };
  }

  /* ---------------- three-part error feedback ---------------- */
  const NUMC = ['①', '②', '③', '④', '⑤'];

  function wxCard(you, why, rule, title, opts) {
    const o = opts || {};
    const attr = o.atom === undefined ? '' : ' data-hi="' + o.atom + '"';
    const zh = isZh();
    const youTxt = zh && you.zh ? you.zh : you.en;
    const whyTxt = zh && why.zh ? why.zh : why.en;
    const ruleTxt = zh && rule.zh ? rule.zh : rule.en;
    return '<div class="wx"' + attr + '>' +
      (title ? '<div class="wxTitle">' + title + '</div>' : '') +
      '<div class="wxRow"><div class="wxTag you">' + (zh ? '你的答案<br><em>YOUR ANSWER</em>' : 'YOUR ANSWER') + '</div>' +
        '<div class="wxTxt"><span class="wxEn">' + youTxt + '</span>' + (!zh && you.zh ? '<span class="wxZh">' + you.zh + '</span>' : '') + '</div></div>' +
      '<div class="wxRow"><div class="wxTag why">' + (zh ? '為何不成立<br><em>WHY IT FAILS</em>' : 'WHY IT FAILS') + '</div>' +
        '<div class="wxTxt"><span class="wxEn">' + whyTxt + '</span>' + (!zh && why.zh ? '<span class="wxZh">' + why.zh + '</span>' : '') + '</div></div>' +
      '<div class="wxRow"><div class="wxTag rule">' + (zh ? '正確規則<br><em>THE RULE</em>' : 'THE RULE') + '</div>' +
        '<div class="wxTxt"><span class="wxEn">' + ruleTxt + '</span>' + (!zh && rule.zh ? '<span class="wxZh">' + rule.zh + '</span>' : '') + '</div></div>' +
      (o.tapHint ? '<div class="wxTap">' + o.tapHint + '</div>' : '') +
      '</div>';
  }

  function stepWhy(c, step, chosen) {
    if (c.id === 'nh4cl' && step > 1) return explain(c, step);
    const f = c.f;
    if (step === 1) {
      if (c.comp === 1) {
        if (chosen === 2) return {
          en: f + ' contains a metal as well as a non-metal, so "non-metals only" cannot be right.',
          zh: f + ' 同時含金屬與非金屬，所以「只有 non-metal atoms」不正確。'
        };
        return {
          en: f + ' contains a non-metal as well as a metal, so it is not "metal atoms only".',
          zh: f + ' 同時含非金屬與金屬，所以不是「只有 metal atoms」。'
        };
      }
      if (c.comp === 2) {
        if (chosen === 1) return {
          en: 'There is no metal in ' + f + ' — every atom is a non-metal, so it cannot be metal + non-metal.',
          zh: f + ' 沒有金屬；每粒原子都是 non-metal，所以不是 metal + non-metal。'
        };
        return {
          en: 'There is no metal atom in ' + f + '; all the atoms are non-metals.',
          zh: f + ' 沒有金屬原子；全部都是 non-metal atoms。'
        };
      }
      if (chosen === 1) return {
        en: f + ' is a single metal — there is no non-metal in the formula.',
        zh: f + ' 是單一金屬，formula 中沒有 non-metal。'
      };
      return {
        en: 'The atom in ' + f + ' is a metal, not a non-metal.',
        zh: f + ' 中的原子是 metal，不是 non-metal。'
      };
    }

    if (step === 2) {
      if (c.ebeh === 1) {
        if (chosen === 2) return {
          en: 'In ' + f + ' the metal loses its outer electron(s) and the non-metal gains them. The electron moves completely from one atom to the other — that is transfer, not sharing.',
          zh: '在 ' + f + ' 中，金屬失去外層電子，非金屬得到電子。電子完全轉移 (transfer) 到另一粒原子，不是共用 (sharing)。'
        };
        return {
          en: 'In ' + f + ' the electrons remain associated with individual ions. There is no sea of delocalised electrons.',
          zh: '在 ' + f + ' 中，電子仍屬於個別離子 (individual ions)，沒有 delocalised electron sea。'
        };
      }
      if (c.ebeh === 2) {
        if (chosen === 1) return {
          en: 'Both atoms in ' + f + ' are non-metals; neither loses electrons easily, so no complete transfer happens.',
          zh: f + ' 的原子都是 non-metal，兩者都不易失去電子，所以沒有完整 electron transfer。'
        };
        return {
          en: 'There is no metal lattice in ' + f + ', so there is no "sea" of delocalised electrons.',
          zh: f + ' 沒有 metal lattice，所以沒有 delocalised electron sea。'
        };
      }
      if (chosen === 1) return {
        en: 'The outer electrons in ' + f + ' do not move to a particular atom — they leave their atoms and move through the whole structure.',
        zh: f + ' 的外層電子不是轉移給某一粒原子，而是離開原子並在整個結構中移動 (delocalised)。'
      };
      return {
        en: 'Metals do not form fixed shared pairs; their valence electrons are delocalised.',
        zh: '金屬不會形成固定的 shared pairs；其 valence electrons 是 delocalised。'
      };
    }

    if (c.bond === 1) {
      if (chosen === 2) return {
        en: 'A covalent bond comes from a shared pair. In ' + f + ' the electrons were transferred to make ions, so the attraction is between ions — not a shared pair.',
        zh: 'Covalent bond 來自 shared pair。在 ' + f + ' 中，電子已轉移而形成 ions，所以吸引力在 ions 之間，不是 shared pair。'
      };
      return {
        en: 'A metallic bond needs a metal lattice with delocalised electrons. ' + f + ' is an ionic lattice.',
        zh: 'Metallic bond 需要 metal lattice 和 delocalised electrons；' + f + ' 是 ionic lattice。'
      };
    }
    if (c.bond === 2) {
      if (chosen === 1) return {
        en: 'An ionic bond needs positive and negative ions. ' + f + ' has no ions — only shared electron pairs.',
        zh: 'Ionic bond 需要正、負 ions；' + f + ' 沒有 ions，只有 shared electron pairs。'
      };
      return {
        en: f + ' is not a metal, so there is no electron sea and no metallic bond.',
        zh: f + ' 不是 metal，所以沒有 electron sea，也沒有 metallic bond。'
      };
    }
    if (chosen === 1) return {
      en: 'There are no positive and negative ions in ' + f + '; it is positive metal ions surrounded by delocalised electrons.',
      zh: f + ' 沒有正、負 ions；它是由正金屬離子與周圍 delocalised electrons 組成。'
    };
    return {
      en: 'There are no shared pairs in ' + f + '; the valence electrons are delocalised.',
      zh: f + ' 沒有 shared pairs；其 valence electrons 是 delocalised。'
    };
  }

  function openDialog(node) {
    releasePointerForModal();
    const c = COMP[node.compound];
    dlg = { node, c, step: 0, picks: [], hintUsed: false, wrongSteps: 0, lastAnswer: null };
    if (tutStep === 3) tutAdvance(4);   // training: the player actually pressed E!
    $('npcName').textContent = node.label.en + ' · ' + c.f;
    $('npcAvatar').textContent = c.f.replace(/[₀-₉]/g, '').slice(0, 2);
    const mission = NODES.filter(n => n.main).indexOf(node) + 1;
    $('npcLine').textContent = guided
      ? bi('Challenge ' + mission + ' of ' + MAIN_TOTAL + ' · Classify ' + c.f, '第 ' + mission + ' / ' + MAIN_TOTAL + ' 題 · 分類 ' + c.f)
      : bi('Classify ' + c.f + ' in three steps.', '用三個步驟分類 ' + c.f + '。');
    setState(STATE.DIALOG);
    openModal('dialogModal');
    renderDialogStep();
  }

  function renderDialogStep() {
    const c = dlg.c;
    $('dialogActions').replaceChildren();
    const sets = optionSets(c);
    const structure = dlg.step === 3;
    const total = dlg.node.id === 'n9' ? 4 : 3;
    const stepLabel = isZh() ? [
      c.f + ' 含有哪類元素？',
      c.id === 'nh4cl' ? '固體 NH₄Cl 中的 ions 靠什麼互相吸引？' : c.f + ' 的外層電子 (outer electrons) 會怎樣？',
      '什麼 bond 把 ' + c.f + ' 結合在一起？',
      'BF₃ 與 diamond 都有 covalent bonds。兩者結構有何分別？'
    ][dlg.step] : [
      'What types of elements are in ' + c.f + '?',
      c.id === 'nh4cl' ? 'What holds the ions in solid NH₄Cl together?' : 'What happens to the outer electrons in ' + c.f + '?',
      'What type of bond holds ' + c.f + ' together?',
      'BF₃ and diamond both have covalent bonds. What is the difference in structure?'
    ][dlg.step];

    const opts = structure ? [
      { v: 1, en: 'BF₃ forms separate molecules. Diamond is a giant network.', zh: 'BF₃ 形成獨立分子 (separate molecules)；diamond 是 giant covalent network。' },
      { v: 2, en: 'Both form separate molecules because both are covalent.', zh: '兩者都是 covalent，所以都形成獨立分子 (separate molecules)。' },
      { v: 3, en: 'Diamond is a metallic lattice because its structure is giant.', zh: 'Diamond 是 giant structure，所以是 metallic lattice。' }
    ] : sets[dlg.step].slice();
    const expected = [c.comp, c.ebeh, c.bond, 1][dlg.step];
    if (c.trap && c.trap.step === dlg.step + 1) {
      opts.push({ v: -1, en: c.trap.en, zh: c.trap.zh, trap: true });
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

    $('stepDots').innerHTML = Array.from({ length: total }, (_, i) => i).map(i =>
      '<div class="d ' + (i < dlg.step ? 'done' : i === dlg.step ? 'on' : '') + '"></div>').join('');

    $('dialogBody').innerHTML =
      '<div class="qBlock">' + stepLabel + '</div>' +
      '<div class="qZh">' + bi('Question ' + (dlg.step + 1) + ' of ' + total + ' · Choose one answer.', '第 ' + (dlg.step + 1) + ' / ' + total + ' 題 · 選一個答案。') + '</div>' +
      '<div class="options" id="dlgOpts">' +
      shuffled.map((o, i) =>
        '<button class="opt" data-v="' + o.v + '" data-i="' + i + '">' + textOf(o) + '</button>').join('') +
      '</div>' +
      '<div class="fb" id="dlgFb" role="status" aria-live="polite"></div>';

    $('dlgOpts').querySelectorAll('.opt').forEach(btn => {
      btn.addEventListener('click', () => pickOption(btn, expected, opts));
    });
    $('dialogBody').insertAdjacentHTML('beforeend', '<div class="kbdHint">' + bi('↑ ↓ choose · Enter confirm', '↑ ↓ 選擇 · Enter 確認') + '</div>');
    $('dialogHintBtn').style.display = dlg.hintUsed ? 'none' : '';
    $('dialogHintBtn').textContent = bi('Hint', '提示');
    dlg.keyIndex = 0;
    focusDialogChoice(0);
    $('dialogBody').closest('.modalBody').scrollTop = 0;
  }

  function focusDialogChoice(idx) {
    const opts = Array.from(document.querySelectorAll('#dlgOpts .opt')).filter(b => !b.disabled);
    if (!opts.length) return;
    dlg.keyIndex = (idx + opts.length) % opts.length;
    opts.forEach((b, i) => b.classList.toggle('kbdFocus', i === dlg.keyIndex));
    try { opts[dlg.keyIndex].focus({ preventScroll: true }); } catch (e) { }
  }

  function moveDialogChoice(delta) {
    if (!dlg || dlg.lastAnswer) return false;
    const opts = document.querySelectorAll('#dlgOpts .opt');
    if (!opts.length) return false;
    focusDialogChoice((dlg.keyIndex || 0) + delta);
    return true;
  }

  function handleDialogEnter() {
    if (state !== STATE.DIALOG || !dlg || !$('dialogModal').classList.contains('show')) return false;
    const active = document.activeElement;
    if (active && active.matches('button') && !active.classList.contains('opt') && !active.closest('#dialogActions')) return false;
    if (active && active.closest('#dialogActions')) { active.click(); return true; }
    if (dlg.lastAnswer) {
      const next = document.querySelector('#dialogActions .primary');
      if (next && !next.disabled) { next.click(); return true; }
      return false;
    }
    const selected = document.querySelector('#dlgOpts .opt.kbdFocus') || document.querySelector('#dlgOpts .opt');
    if (selected && !selected.disabled) { selected.click(); return true; }
    return false;
  }

  function structureExplanation() {
    return { en: 'BF₃ forms separate molecules. In diamond, each carbon atom bonds to four other carbon atoms, making a continuous covalent network.',
      zh: 'BF₃ 形成獨立分子 (separate molecules)。Diamond 中每粒 carbon atom 與四粒其他 carbon atoms 形成 covalent bonds，構成連續的 giant covalent network。' };
  }

  function burstAt(x, y, color, count) {
    const layer = $('floatLayer'); if (!layer) return;
    const n = count || 18;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.className = 'correctParticle';
      const ang = Math.random() * Math.PI * 2;
      const dist = 42 + Math.random() * 76;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.setProperty('--bx', Math.cos(ang) * dist + 'px');
      el.style.setProperty('--by', Math.sin(ang) * dist + 'px');
      el.style.setProperty('--pc', color || (Math.random() < .5 ? '#8ff0c8' : '#ffd86a'));
      el.style.animationDelay = (Math.random() * .06) + 's';
      layer.appendChild(el);
      setTimeout(() => el.remove(), 850);
    }
  }
  function floatScreenText(text, x, y, cls) {
    const layer = $('floatLayer'); if (!layer) return;
    const el = document.createElement('div');
    el.className = 'floatScreenText ' + (cls || '');
    el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
  function feedbackShake(el) {
    const card = el && el.closest ? el.closest('.modalCard') : null;
    if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    card.classList.remove('feedbackShake');
    void card.offsetWidth;
    card.classList.add('feedbackShake');
    setTimeout(() => card.classList.remove('feedbackShake'), 340);
  }
  function showBanner(title, subtext) {
    const el = $('perfectBanner'); if (!el) return;
    const main = el.querySelector('b'); if (main) main.textContent = title;
    const sub = $('perfectSub'); if (sub) sub.textContent = subtext || '';
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2400);
  }
  function showPerfectBond(subtext) {
    showBanner('PERFECT BOND', subtext || bi('All steps clean · bonus secured', '全部一次答對 · 額外獎勵已取得'));
  }
  function answerJuice(btn, reward, perfect) {
    const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    burstAt(x, y, perfect ? '#ffd86a' : '#8ff0c8', perfect ? 34 : 20);
    floatScreenText('+' + reward.xp + ' XP  +' + reward.gold + 'g', x, y - 12, perfect ? 'perfect' : '');
    if (reward.streak >= REWARD_RULES.streakAt) floatScreenText('STREAK ×' + reward.mult.toFixed(1), x, y + 24, 'streak');
    feedbackShake(btn);
  }

  function pickOption(btn, expected, opts) {
    const v = Number(btn.dataset.v);
    if (tutStep === 4) tutComplete();   // training: the player actually answered!
    const c = dlg.c;
    const ok = v === expected;
    const fb = $('dlgFb');
    const optionList = $('dlgOpts');
    optionList.querySelectorAll('.opt').forEach(b => { b.disabled = true; });
    optionList.hidden = true;
    $('dialogBody').querySelector('.qZh').textContent = bi('Question ' + (dlg.step + 1) + ' review', '第 ' + (dlg.step + 1) + ' 題回顧');

    const structure = dlg.step === 3;
    const ex = structure ? structureExplanation() : explain(c, dlg.step + 1);
    const correctOption = opts.find(o => o.v === expected);
    const chosenOpt = opts.find(o => o.v === v) || { en: '—', zh: '—' };
    const why = structure ? ex : (v === -1 && c.trap) ? c.trap.why : stepWhy(c, dlg.step + 1, v);
    if (ok) {
      const reward = awardCorrectStep(REWARD_RULES.stepXp, REWARD_RULES.stepGold);
      SFX.correct();
      answerJuice(btn, reward, false);
      dlg.lastAnswer = { ok, v, expected, opts, ex, why, correctOption, chosenOpt, structure, reward };
    } else {
      SFX.bad();
      dlg.wrongSteps++;
      breakStreak();
      dlg.lastAnswer = { ok, v, expected, opts, ex, why, correctOption, chosenOpt, structure, reward: null };
    }
    renderDialogFeedback();

    dlg.tries = (dlg.tries || 0) + 1;
    attempts.push({
      type: 'classify', compound: c.f, step: dlg.step + 1,
      chosen: v, correct: ok, hintUsed: dlg.hintUsed, attempt: dlg.tries
    });
    logEvent({ type: 'classify', compound: c.f, step: dlg.step + 1, chosen: v, correct: ok, hintUsed: dlg.hintUsed });

    const foot = $('dialogActions');
    foot.replaceChildren();
    $('dialogHintBtn').style.display = 'none';
    if (!ok) {
      const retry = document.createElement('button');
      retry.className = 'ghost';
      retry.textContent = bi('Try again', '再試一次');
      retry.addEventListener('click', () => {
        renderDialogStep();
        $('dlgOpts').querySelector('button').focus();
      });
      foot.appendChild(retry);
    }
    const nb = document.createElement('button');
    nb.className = 'primary';
    nb.style.width = 'auto';
    const hasNext = dlg.step < (dlg.node.id === 'n9' ? 3 : 2);
    nb.textContent = hasNext ? bi('Next question', '下一題') : bi('Finish challenge', '完成挑戰');
    nb.addEventListener('click', () => {
      if (hasNext) { dlg.step++; dlg.tries = 0; renderDialogStep(); }
      else finishDialog();
    });
    foot.appendChild(nb);
    nb.focus({ preventScroll: true });
  }

  function renderDialogFeedback() {
    if (!dlg || !dlg.lastAnswer) return;
    const a = dlg.lastAnswer;
    const fb = $('dlgFb'); if (!fb) return;
    const whyText = textOf(a.why);
    const exText = textOf(a.ex);
    const detail = whyText === exText ? '' : '<p>' + whyText + '</p>';
    const rewardHtml = a.reward
      ? '<div class="rewardChip">+' + a.reward.xp + ' XP · +' + a.reward.gold + ' gold' + (a.reward.streak >= REWARD_RULES.streakAt ? ' · STREAK ×' + a.reward.mult.toFixed(1) : '') + '</div>'
      : '';
    fb.className = 'fb show answerFeedback ' + (a.ok ? 'isCorrect' : 'isWrong');
    fb.innerHTML = '<div class="answerKey"><span>' + (a.ok ? bi('✓ Correct', '✓ 正確') : bi('✓ Correct answer', '✓ 正確答案')) + '</span><strong>' +
      textOf(a.correctOption) + '</strong><p>' + exText + '</p>' + rewardHtml + '</div>';
    if (!a.ok) {
      fb.innerHTML += '<div class="answerMiss"><span>' + bi('× Your answer', '× 你的答案') + '</span><strong>' + textOf(a.chosenOpt) + '</strong>' + detail + '</div>';
    }
    if (dlg.c.note && dlg.step === 2) {
      fb.innerHTML += '<span class="fbZh" style="margin-top:8px">💡 ' + textOf(dlg.c.note) + '</span>';
    }
  }

  function finishDialog() {
    const c = dlg.c;
    const wasDone = done.has(dlg.node.id);
    const clean = dlg.wrongSteps === 0;
    const perfect = clean && !dlg.hintUsed;
    if (clean && !nodeCorrect.get(dlg.node.id)) {
      correctCount++;
      nodeCorrect.set(dlg.node.id, true);
    }
    let bonus = null;
    if (perfect && !wasDone) {
      bonus = awardPerfectChallenge();
      SFX.perfect();
      showPerfectBond(bi('All steps clean · bonus secured', '全部一次答對 · 完美獎勵已取得'));
    }
    done.add(dlg.node.id); questCelebrate();
    WORLD.setNodeState(dlg.node.id, 'done');
    $('dialogBody').innerHTML =
      '<div class="fb show ok ' + (perfect ? 'perfectResult' : '') + '" style="margin-top:0">' +
      (perfect ? bi('★ PERFECT BOND — ' + c.f + ' classified correctly at every step.', '★ PERFECT BOND — 你每一步都正確分類 ' + c.f + '。')
               : clean ? bi('✓ ' + c.f + ' classified. You used a hint — try explaining the reasoning again yourself.', '✓ 已分類 ' + c.f + '。你使用了提示，試著自己再解釋一次。')
                       : bi('✓ ' + c.f + ' classified. Review the rule below.', '✓ 已分類 ' + c.f + '。請重溫下方規則。')) +
      '<p>' + textOf(explain(c, 3)) + '</p>' +
      (bonus ? '<div class="rewardChip perfect">+' + bonus.xp + ' XP · +' + bonus.gold + ' gold · +' + bonus.crystals + ' crystal</div>' : '') +
      '<span class="fbZh">' + bi('Main progress: ' + mainDone() + ' / ' + MAIN_TOTAL, '主線進度：' + mainDone() + ' / ' + MAIN_TOTAL) + '</span></div>';
    $('dialogHintBtn').style.display = 'none';
    $('dialogActions').replaceChildren();
    $('dialogCloseBtn').textContent = bi('Back to world', '返回世界');
    refreshLocks();
    updateHUD();
    updateCombatHUD();
    if (guided) labCompletionActions($('dialogBody'), closeDialog);
    persist();
    toast((dlg.node.main ? '✓ Quest complete! +1 — ' : '✓ Side quest complete — ') + c.f + ' classified');
  }

  function closeDialog(next) {
    closeModal('dialogModal');
    setState(STATE.WORLD);
    $('dialogCloseBtn').textContent = bi('Leave', '離開');
    dlg = null;
    updateHUD();
    guided = false;
    if (next === true) return;
    checkAllMainDone();
    WORLD.relock();
  }

  $('dialogCloseBtn').addEventListener('click', closeDialog);
  $('dialogHintBtn').addEventListener('click', () => {
    if (!dlg) return;
    dlg.hintUsed = true;
    $('dialogHintBtn').style.display = 'none';
    const c = dlg.c;
    const ex = dlg.step === 3 ? structureExplanation() : explain(c, dlg.step + 1);
    const fb = $('dlgFb');
    fb.className = 'fb show no';
    fb.innerHTML = bi('Hint: ', '提示：') + textOf(ex);
  });

  /* ================= DOT-AND-CROSS ================= */
  let dcq = null;

  function angDist(a, b) {
    let d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  }

  function openDotCross(node) {
    releasePointerForModal();
    dcq = {
      node, q: DC[node.dc], marks: {}, charges: {}, bracket: false,
      tool: 'pair', tries: 0, hintUsed: false, hintSlot: null, solved: false, hiAtom: -1, autoFilled: false
    };
    const q = dcq.q;
    $('dcTitle').textContent = q.compound + ' — ' + bi('Dot-and-cross diagram', 'Dot-and-cross 圖');
    $('dcSub').textContent = q.type === 'ionic'
      ? bi('One click fills a complete pair. Use crosses for the non-metal’s original electrons and dots for electrons transferred from the metal. Include brackets and charges.',
           '一下點擊即可填入完整電子對。用 crosses 表示非金屬原有電子，用 dots 表示由金屬轉移 (transferred) 的電子，並加上 brackets 與 charges。')
      : bi('One click fills a complete pair. Use dots for the first atom (' + q.atoms[0].sym + ') and crosses for its bonding partners.',
           '一下點擊即可填入完整電子對。第一粒原子 (' + q.atoms[0].sym + ') 用 dots，成鍵伙伴用 crosses。');
    $('dcFeedback').className = 'dcFeedback';
    $('dcFeedback').innerHTML = '';
    $('dcCheckBtn').textContent = bi('Check', '檢查');
    $('dcHintBtn').disabled = false;
    $('dcHintBtn').textContent = bi('Hint', '提示');
    $('dcResetBtn').disabled = false;
    $('dcResetBtn').textContent = bi('Reset', '重設');
    $('dcCloseBtn').textContent = bi('Leave', '離開');
    const dht = $('dcHowTitle');
    if (dht) dht.textContent = bi('How to do it — follow these steps', '做法 — 按步驟完成');
    const dl = $('dcLegend');
    if (dl) dl.textContent = bi('One click fills a complete electron pair. Use Erase to clear a pair, or Auto-fill shell for 1 crystal. Keyboard: arrows move · Enter places.',
      '一下點擊會填入完整 electron pair。用 Erase 清除整對，或用 Auto-fill shell（1 crystal）自動填滿。鍵盤：方向鍵移動 · Enter 放置。');
    $('dcToolbar').className = 'dcToolbar' + (q.type === 'ionic' ? ' ionic' : '');
    $('dcToolbar').innerHTML =
      '<button class="toolBtn active" data-tool="pair">✚ ' + bi('Pair', '電子對') + '</button>' +
      '<button class="toolBtn" data-tool="erase">⌫ ' + bi('Erase', '擦除') + '</button>' +
      '<span class="toolSep"></span>' +
      '<button class="toolBtn ionOnly" id="dcBracketBtn">[ ] ' + bi('Brackets', '括號') + '</button>';
    $('dcToolbar').querySelectorAll('[data-tool]').forEach(b => {
      b.addEventListener('click', () => {
        dcq.tool = b.dataset.tool;
        $('dcToolbar').querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b));
      });
    });
    const bb = $('dcBracketBtn');
    if (bb) bb.addEventListener('click', () => {
      if (dcq.solved) return;
      dcq.bracket = !dcq.bracket;
      bb.classList.toggle('active', dcq.bracket);
      renderDC();
    });

    setState(STATE.DOTCROSS);
    openModal('dotcrossModal');
    renderDC();
    setTimeout(function () {
      const first = $('dcStage').querySelector('.slot');
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { } }
    }, 60);
  }

  function focusNextDCSlot(afterSi) {
    const slots = Array.from(document.querySelectorAll('#dcStage .slot'));
    if (!slots.length) return;
    const score = si => (dcq.marks[si] || []).length;
    let idx = slots.findIndex(el => score(Number(el.dataset.si)) < 2);
    if (idx < 0) {
      const check = $('dcCheckBtn');
      if (check) { try { check.focus({ preventScroll: true }); } catch (e) { } }
      return;
    }
    if (afterSi !== undefined) {
      const after = slots.findIndex(el => Number(el.dataset.si) > afterSi && score(Number(el.dataset.si)) < 2);
      if (after >= 0) idx = after;
    }
    try { slots[idx].focus({ preventScroll: true }); } catch (e) { }
  }

  function moveDCFocus(delta) {
    if (state !== STATE.DOTCROSS || !dcq) return false;
    const slots = Array.from(document.querySelectorAll('#dcStage .slot'));
    if (!slots.length) return false;
    let idx = slots.indexOf(document.activeElement);
    if (idx < 0) idx = 0;
    else idx = (idx + delta + slots.length) % slots.length;
    try { slots[idx].focus({ preventScroll: true }); } catch (e) { }
    return true;
  }

  function handleDotCrossEnter() {
    if (state !== STATE.DOTCROSS || !dcq) return false;
    const active = document.activeElement;
    if (active && active.closest('#dotcrossModal')) {
      if (active.matches('.slot')) return false;
      if (active.matches('button')) return false;
    }
    const firstEmpty = Array.from(document.querySelectorAll('#dcStage .slot')).find(el => (dcq.marks[Number(el.dataset.si)] || []).length < 2);
    if (firstEmpty) {
      firstEmpty.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
    if (dcq.solved) { closeDC(); return true; }
    const st = dcState();
    if (st.total > 0 && st.filled === st.total) { checkDC(); return true; }
    return false;
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

  function autoPairForSlot(si) {
    const s = dcq.slots[si];
    if (!s) return [];
    if (s.kind === 'bond') return ['dot', 'cross'];
    if (dcq.q.type === 'ionic') {
      const target = dcq.q.atoms.reduce((sum, a) => sum + Math.max(0, a.charge || 0), 0);
      let usedDots = 0;
      Object.keys(dcq.marks).forEach(k => { (dcq.marks[k] || []).forEach(m => { if (m === 'dot') usedDots++; }); });
      return usedDots < target ? ['dot', 'cross'] : ['cross', 'cross'];
    }
    return s.atom === 0 ? ['dot', 'dot'] : ['cross', 'cross'];
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
    const steps = [{ txt: bi('Fill every electron slot on the diagram', '填滿圖中每個 electron slot'),
      note: st.filled + ' / ' + st.total + ' ' + bi('pairs', '對'), done: st.total > 0 && st.filled === st.total }];
    if (st.ionic) {
      steps.push({ txt: bi('Put square brackets [ ] around each ion', '用 [ ] square brackets 包住每個 ion'), done: st.bracket });
      steps.push({ txt: bi('Set the charge of each ion', '設定每個 ion 的 charge'), done: st.chargesOk });
    }
    steps.push({ txt: bi('Press "Check" to see your result', '按 "Check" 查看結果'), done: false, act: true });

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
    $('dcHowProg').textContent = doneCount + ' / ' + graded + ' ' + bi('done', '完成');

    let msg;
    if (firstTodo < 0 || steps[firstTodo].act) {
      msg = bi('All steps done — press <b>"Check"</b> at the bottom right.', '全部完成 — 按右下角 <b>"Check"</b>。');
    } else if (firstTodo === 0) {
      const left = st.total - st.filled;
      msg = bi('<b>Tap a dashed slot</b> to place a complete electron pair. <b>' + left + '</b> pair(s) still to place.',
        '<b>點擊虛線 slot</b> 會直接填入完整 electron pair。還差 <b>' + left + '</b> 對。');
    } else if (!st.bracket) {
      msg = bi('Click the <b>[ ] Brackets</b> button to enclose every ion.', '按 <b>[ ] Brackets</b> 包住每個 ion。');
    } else if (!st.chargesOk) {
      msg = bi('Choose the charges below: metal ions are positive, non-metal ions are negative.', '在下方選擇 charges：metal ions 為正，non-metal ions 為負。');
    } else {
      msg = bi('Press <b>"Check"</b> at the bottom right to see if you got it right.', '按右下角 <b>"Check"</b> 查看結果。');
    }
    $('dcNow').innerHTML = msg;
    const auto = $('dcAutoBtn');
    if (auto) {
      auto.textContent = bi('Auto-fill shell · 1 ◈', '自動填滿殼層 · 1 ◈');
      auto.disabled = dcq.solved || shardBalance() < REWARD_RULES.autoFillCrystals;
    }
  }

  function renderDC() {
    const q = dcq.q;
    const slots = dcSlots(q);
    dcq.slots = slots;
    const atoms = q.atoms;

    const left = Math.min(...atoms.map(a => a.x - a.r)) - 62;
    const top = Math.min(...atoms.map(a => a.y - a.r)) - 55;
    const right = Math.max(...atoms.map(a => a.x + a.r)) + 82;
    const bottom = Math.max(...atoms.map(a => a.y + a.r)) + 55;
    let svg = '<svg viewBox="' + [left, top, right - left, bottom - top].join(' ') + '" xmlns="http://www.w3.org/2000/svg">';
    atoms.forEach((a, i) => {
      if (dcq.bracket) {
        const radius = a.r + (a.lonePairs ? 46 : 14);
        const x = a.x - radius, y = a.y - radius, width = radius * 2;
        svg += '<path d="M' + (x + 12) + ' ' + y + ' h-12 v' + width + ' h12 M' + (x + width - 12) + ' ' + y + ' h12 v' + width + ' h-12" fill="none" stroke="#8ff0c8" stroke-width="3"/>';
      }
      svg += '<circle cx="' + a.x + '" cy="' + a.y + '" r="' + a.r + '" fill="rgba(60,120,110,.15)" stroke="#7fd8bd" stroke-width="2"/>';
      svg += '<text x="' + a.x + '" y="' + (a.y + 10) + '" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="600" fill="#eafff7">' + a.sym + '</text>';
      if (q.type === 'ionic') {
        const ch = dcq.charges[i] || 0;
        if (ch !== 0) {
          const lbl = ch === 1 ? '+' : ch === -1 ? '−' : ch === 2 ? '2+' : '2−';
          const offset = a.r + (a.lonePairs ? 46 : 14);
          svg += '<text x="' + (a.x + offset + 5) + '" y="' + (a.y - offset + 5) + '" font-family="sans-serif" font-size="26" font-weight="700" fill="#ffd27a">' + lbl + '</text>';
        }
      }
      if (dcq.hiAtom === i) {
        svg += '<circle class="dcHi" cx="' + a.x + '" cy="' + a.y + '" r="' + (a.r + 30) + '" fill="none" stroke="#ffd27a" stroke-width="2.5" stroke-dasharray="7 5"/>';
      }
    });

    slots.forEach((s, si) => {
      const marks = dcq.marks[si] || [];
      const empty = marks.length === 0;
      const slotLabel = s.kind === 'bond' ? 'Bond pair' : atoms[s.atom].sym + ' lone pair';
      svg += '<circle class="slot ' + (dcq.hintSlot === si ? 'slotHint' : '') + '" role="button" tabindex="0" aria-label="' +
        slotLabel + ', slot ' + (si + 1) + ', ' + marks.length + ' of 2 electrons" data-si="' + si + '" cx="' + s.x + '" cy="' + s.y +
        '" r="' + (s.kind === 'bond' ? 24 : 20) + '" stroke="' + (empty ? 'rgba(143,240,200,.5)' : 'rgba(255,255,255,.2)') +
        '" stroke-width="' + (empty ? 1.4 : 1) + '"' + (empty ? ' stroke-dasharray="4 4"' : '') + '/>';
      if (empty) {
        svg += '<circle cx="' + s.x + '" cy="' + s.y + '" r="2" fill="rgba(143,240,200,.45)" pointer-events="none"/>';
      }
      marks.forEach((m, mi) => {
        const ox = marks.length === 1 ? 0 : (mi === 0 ? -8 : 8);
        svg += '<text x="' + (s.x + ox) + '" y="' + (s.y + 8) + '" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="700" fill="' +
          (m === 'dot' ? '#9ff5d0' : '#ffd27a') + '" pointer-events="none">' + (m === 'dot' ? '•' : '×') + '</text>';
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
        extra += '<div class="dcNote">' + bare.join(' and ') +
          ' transferred its original valence electrons. This diagram omits its inner shells. Place electrons only around ' +
          withE.join(' and ') + '.</div>';
      }
    }
    $('dcStage').innerHTML = svg + extra;

    $('dcStage').querySelectorAll('.slot').forEach(el => {
      const placeElectron = keyboard => {
        if (dcq.solved) return;
        const si = Number(el.dataset.si);
        if (dcq.tool === 'erase') dcq.marks[si] = [];
        else dcq.marks[si] = autoPairForSlot(si);
        dcq.hintSlot = null;
        renderDC();
        if (keyboard) focusNextDCSlot(si);
      };
      el.addEventListener('click', () => placeElectron(false));
      el.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        placeElectron(true);
      });
    });
    $('dcStage').querySelectorAll('[data-ch]').forEach(b => {
      b.addEventListener('click', () => {
        if (dcq.solved) return;
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
    let bondShort = 0, bondMix = 0, loneMix = 0, transferred = 0;

    slots.forEach((s, si) => {
      const m = dcq.marks[si] || [];
      if (s.kind === 'lone') {
        loneCount[s.atom] += m.length;
        if (q.type === 'ionic') transferred += m.filter(mark => mark === 'dot').length;
        else if (m.some(mark => mark !== (s.atom === 0 ? 'dot' : 'cross'))) loneMix++;
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
      you: { en: loneMix + ' lone pair slot(s) use a symbol from the other atom.',
             zh: '' + loneMix + '' },
      why: { en: 'A covalent lone pair stays on its own atom, so use that atom’s symbol for both electrons.',
             zh: '' },
      rule: { en: 'Lone pair = same symbol. Bond pair = 1 dot + 1 cross.',
              zh: '' }
    });

    const transferTarget = atoms.reduce((sum, atom) => sum + Math.max(0, atom.charge || 0), 0);
    if (q.type === 'ionic' && transferred !== transferTarget) errs.push({
      title: 'Transferred electrons',
      you: { en: 'Your diagram shows ' + transferred + ' transferred electron(s) as dots.' },
      why: { en: 'The metal transfers ' + transferTarget + ' electron(s). The remaining electrons on the non-metal came from the non-metal itself.' },
      rule: { en: 'Use dots for electrons from the metal and crosses for the non-metal’s original electrons.' }
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
      if (tutStep === 4) tutComplete();   // training via a chest works too
      const perfect = dcq.tries === 1 && !dcq.hintUsed;
      const stepReward = awardCorrectStep(REWARD_RULES.stepXp, REWARD_RULES.stepGold);
      let bonus = null;
      if (perfect) {
        bonus = awardPerfectChallenge();
        SFX.perfect();
        showPerfectBond(bi('Diagram clean on the first check · bonus secured', '第一次檢查即完全正確 · 完美獎勵已取得'));
      } else {
        SFX.correct();
      }
      answerJuice($('dcCheckBtn'), stepReward, perfect);
      fb.innerHTML = '<div class="fbBanner ok' + (perfect ? ' perfectResult' : '') + '"><span class="fbIcon">✓</span><div>' +
        '<b>' + bi('Bond diagram complete!', 'Dot-and-cross 圖完成！') + '</b>' +
        '<em>' + textOf(q.hint) + '</em>' +
        '<div class="rewardChip">+' + stepReward.xp + ' XP · +' + stepReward.gold + ' gold' + (stepReward.streak >= REWARD_RULES.streakAt ? ' · STREAK ×' + stepReward.mult.toFixed(1) : '') + '</div>' +
        (bonus ? '<div class="rewardChip perfect">+' + bonus.xp + ' XP · +' + bonus.gold + ' gold · +' + bonus.crystals + ' crystal</div>' : '') +
        '</div></div>';
      if (!nodeCorrect.get(dcq.node.id)) {
        correctCount++;
        nodeCorrect.set(dcq.node.id, true);
      }
      done.add(dcq.node.id); questCelebrate();
      WORLD.setNodeState(dcq.node.id, 'done');
      $('dcCheckBtn').textContent = bi('Back to world', '返回世界');
      $('dcHintBtn').disabled = true;
      $('dcResetBtn').disabled = true;
      if (guided) labCompletionActions(fb, closeDC);
      toast((dcq.node.main ? '✓ Quest complete! +1 — ' : '✓ Chest complete — ') + q.compound + ' mastered · +' + stepReward.xp + ' XP');
      logEvent({ type: 'dotcross', compound: q.compound, correct: true, attempt: dcq.tries, hintUsed: dcq.hintUsed, xp: stepReward.xp, gold: stepReward.gold, perfect });
      refreshLocks();
      updateHUD();
      updateCombatHUD();
    } else {
      SFX.bad();
      breakStreak();
      const MAXW = 2;
      fb.innerHTML = '<div class="fbBanner bad"><span class="fbIcon">✗</span><div>' +
        '<b>' + errs.length + ' ' + bi('thing(s) still need fixing', '項需要修正') + '</b>' +
        '<em>' + bi('Read each card: what you drew, why it fails, and the correct rule. Tap a card to highlight the spot.', '閱讀每張卡：你畫了什麼、為何不成立、正確規則是什麼。點擊卡片可標示位置。') + '</em>' +
        '</div></div>' +
        errs.slice(0, MAXW).map((e, i) => wxCard(e.you, e.why, e.rule, NUMC[i] + ' ' + e.title,
          { atom: e.atom, tapHint: e.atom === undefined ? '' : bi('Tap → highlighted with a yellow ring on the diagram', '點擊 → 圖中以黃圈標示') })).join('') +
        (errs.length > MAXW ? '<div class="wxRest"><b>' + (errs.length - MAXW) + ' ' + bi('more to fix:', '項待修正：') + '</b>' +
          errs.slice(MAXW).map(e => e.title).join(', ') + '</div>' : '') +
        (dcq.tries >= 3 ? '<div class="wxRest" style="border-color:rgba(255,220,120,.4);background:rgba(255,220,120,.08);color:#ffe8b0">' +
          bi('You have tried 3 times — press Hint to reveal exactly where the next electron goes.', '你已嘗試 3 次 — 按 Hint 顯示下一個電子對的位置。') + '</div>' : '');

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

  function closeDC(next) {
    closeModal('dotcrossModal');
    setState(STATE.WORLD);
    $('dcCheckBtn').textContent = bi('Check', '檢查');
    dcq = null;
    updateHUD();
    guided = false;
    if (next === true) return;
    checkAllMainDone();
    WORLD.relock();
  }

  $('dcCheckBtn').addEventListener('click', () => { if (dcq && dcq.solved) closeDC(); else checkDC(); });
  $('dcCloseBtn').addEventListener('click', closeDC);
  $('dcAutoBtn').addEventListener('click', () => {
    if (!dcq || dcq.solved) return;
    if (shardBalance() < REWARD_RULES.autoFillCrystals) { toast(bi('Not enough crystals', 'Crystal 不足')); return; }
    COMBAT.spentCrystals += REWARD_RULES.autoFillCrystals;
    dcq.hintUsed = true;
    dcq.autoFilled = true;
    dcq.hintSlot = null;
    const slots = dcq.slots || dcSlots(dcq.q);
    dcq.slots = slots;
    slots.forEach((slot, si) => {
      if ((dcq.marks[si] || []).length < 2) dcq.marks[si] = autoPairForSlot(si);
    });
    saveCombat();
    updateCombatHUD();
    renderDC();
    SFX.unlock();
    toast(bi('Shell auto-filled — now add brackets and charges if needed.', '殼層已自動填滿 — 如需要，請加上 brackets 與 charges。'));
  });
  $('dcResetBtn').addEventListener('click', () => {
    if (!dcq) return;
    dcq.marks = {}; dcq.hintSlot = null; dcq.solved = false;
    $('dcCheckBtn').textContent = bi('Check', '檢查');
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
        '<div class="hintBox"><b>①</b> ' + bi('Find the <b>glowing slot</b> on the diagram', '在圖中找出 <b>發光的 slot</b>') + ' (' + owner + ')<br>' +
        '<b>②</b> ' + bi('Click that slot <b>once</b> to place the full pair<br>', '點擊該 slot <b>一次</b>，會填入完整電子對<br>') +
        '<b>③</b> ' + (q.type === 'ionic' ? bi('Use dots for transferred electrons and crosses for the original electrons.', 'transferred electrons 用 dots，原有電子用 crosses。') :
          s.kind === 'lone' ? bi('Use ' + (s.atom === 0 ? 'two dots (••)' : 'two crosses (××)') + ' for this lone pair.', '這對 lone pair 用 ' + (s.atom === 0 ? '兩個 dots (••)' : '兩個 crosses (××)') + '。') : bi('A bond pair needs <b>one • and one ×</b>', 'Bond pair 需要 <b>一個 • 和一個 ×</b>')) + '</div>' +
        '<div class="fbSub">' + textOf(q.hint) + '</div>';
    } else if (q.type === 'ionic' && !dcq.bracket) {
      fb.innerHTML = '<div class="hintBox">' + bi('All electrons are placed — now click <b>[ ] Brackets</b> above to enclose each ion.', '電子已全部放好 — 按上方 <b>[ ] Brackets</b> 包住每個 ion。') + '</div>';
    } else if (q.type === 'ionic' && q.atoms.some((a, i) => (dcq.charges[i] || 0) !== a.charge)) {
      fb.innerHTML = '<div class="hintBox">Last step: choose the charges below.<br>' +
        '<b>Metals</b> lose electrons → become <b>positive</b>; <b>non-metals</b> gain electrons → become <b>negative</b>.<br>' +
        'The charge number equals the number of electrons lost or gained.</div>';
    } else {
      fb.innerHTML = '<div class="hintBox">' + bi('The diagram is complete — press <b>"Check"</b> at the bottom right to see your result.', '圖已完成 — 按右下角 <b>"Check"</b> 查看結果。') + '</div>' +
        '<div class="fbSub">' + textOf(q.hint) + '</div>';
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
    done.add(vocabNode.id); questCelebrate();
    if (tutStep === 4) tutComplete();   // training via a crystal works too
    WORLD.setNodeState(vocabNode.id, 'done');
    logEvent({ type: 'vocab', term: vocabNode.term });
    closeModal('vocabModal');
    setState(STATE.WORLD);
    SFX.unlock();
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
      : '<b>Review the three bonding models below.</b> The bars show answers from this session.';

    const mins = activeTime / 60;
    $('sumFootNote').textContent = 'Suggested play time: 6–10 minutes. You used ' + mins.toFixed(1) +
      ' minutes' + (mins < 6 ? ' — take your time and read the explanations.' : mins > 10 ? ' — no rush, you can revisit in several sessions.' : ' — nicely paced.') +
      ' Guest progress stays on this device. Signed-in progress syncs to your account.';

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
      setTimeout(() => { if (state === STATE.WORLD && !paused && !CLOUD.isOpen() && !SESSION.summary) showSummary(); }, 550);
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
    { sel: '#scorePill', title: '⑥ Fight enemies & earn rewards', text: 'Wild enemies roam the fields. Click the LEFT MOUSE BUTTON to attack (chain combos!), K for a skill. Every hit gives Score and Gold — watch the counters up here. Press B to spend Gold in the Shop on new weapons, outfits and characters, and C to swap character. That is the whole game!' }
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
   // (training mission is started from startBtn now)
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
  const BM = { canvas: null, zoom: 1, cx: 0, cz: 0, base: 1, labelScale: 1, dragging: false, moved: false, sx: 0, sy: 0, cx0: 0, cz0: 0 };

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
    const u = BM.labelScale;
    const { width, height } = ctx.canvas;
    const gap = 5 * u;
    if (x < 0 || x > width || y < -24 * u || y > height + 24 * u) return;
    ctx.font = '650 ' + (hot ? 17 : 15) * u + 'px "Segoe UI", sans-serif';
    const w = ctx.measureText(text).width + 18 * u;
    const h = (hot ? 28 : 25) * u;
    if (w + 2 * gap > width) return;
    const rx = Math.max(gap, Math.min(width - w - gap, x - w / 2));
    const offsets = hot ? [0] : [0, 25, -25];
    for (const offset of offsets) {
      const ry = Math.max(gap, Math.min(height - h - gap, y + offset * u - h / 2));
      if (boxes.some(b => rx < b.x + b.w + gap && rx + w + gap > b.x &&
        ry < b.y + b.h + gap && ry + h + gap > b.y)) continue;
      boxes.push({ x: rx, y: ry, w, h });
      ctx.fillStyle = hot ? '#163b33' : '#101a20';
      ctx.fillRect(rx, ry, w, h);
      ctx.strokeStyle = hot ? '#8ff0c8' : '#4b635f';
      ctx.lineWidth = u;
      ctx.strokeRect(rx, ry, w, h);
      ctx.fillStyle = hot ? '#dbfff0' : '#edf6f2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, rx + w / 2, ry + h / 2);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      return;
    }
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
    const u = BM.labelScale;
    $('mapObjective').textContent = t ? nodeTitle(t) + ' · ' + Math.round(Math.hypot(t.x - p.x, t.z - p.z)) + ' m' : 'All main challenges complete';

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

    const town = WORLD.townBounds;
    ctx.fillStyle = 'rgba(229,201,143,.21)';
    ctx.strokeStyle = 'rgba(246,219,163,.62)';
    ctx.lineWidth = 1.5 * u;
    const townX = bmX(town.left), townZ = bmY(town.back);
    const townWidth = (town.right - town.left) * s, townDepth = (town.front - town.back) * s;
    ctx.fillRect(townX, townZ, townWidth, townDepth);
    ctx.strokeRect(townX, townZ, townWidth, townDepth);

    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (let g = -200; g <= 200; g += 50) {
      ctx.beginPath(); ctx.moveTo(bmX(g), y0); ctx.lineTo(bmX(g), y0 + wh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, bmY(g)); ctx.lineTo(x0 + ww, bmY(g)); ctx.stroke();
    }



    const boxes = [];
    if (t) {
      ctx.save();
      ctx.setLineDash([11, 9]);
      ctx.strokeStyle = 'rgba(143,240,200,.95)';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bmX(p.x), bmY(p.z)); ctx.lineTo(bmX(t.x), bmY(t.z)); ctx.stroke();
      ctx.restore();

    }

    NODES.forEach(n => {
      const isDone = done.has(n.id);
      const lock = isLockedNode(n).locked;
      const isTarget = t && t.id === n.id;
      const R = (n.main ? 10 : 7.5) * u;
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
        ctx.font = '700 ' + 12 * u + 'px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(NODES.filter(x => x.main).indexOf(n) + 1), bmX(n.x), bmY(n.z) + 4 * u);
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
    ctx.restore();
    if (t) mapLabel(ctx, nodeTitle(t), bmX(t.x), bmY(t.z) - 43 * u, true, boxes);
    mapLabel(ctx, 'You', bmX(p.x), bmY(p.z) + 24 * u, false, boxes);
    mapLabel(ctx, 'Windvale', townX + townWidth / 2, townZ + townDepth + 20 * u, false, boxes);
    cands.sort((a, b) => b.pri - a.pri);
    cands.forEach(cd => {
      const n = cd.n;
      const yOff = (n.main ? 26 : 23) * u;
      mapLabel(ctx, shortLabel(n), bmX(n.x), bmY(n.z) - yOff, false, boxes);
    });

    if (BM.zoom >= 1.7) {
      WAYPOINTS.forEach(w => {
        if (!unlockedWp.has(w.id)) return;
        mapLabel(ctx, w.name.en, bmX(w.x), bmY(w.z) - 25 * u, false, boxes);
      });
    }

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

    ctx.strokeStyle = 'rgba(140,240,200,.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, ww, wh);

    ctx.fillStyle = 'rgba(200,225,215,.45)';
    ctx.font = '700 ' + 15 * u + 'px "Segoe UI", sans-serif';
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
    ctx.font = '600 ' + 13 * u + 'px "Segoe UI", sans-serif';
    ctx.fillText('50 m', bx + barW + 8, by + 4);
  }

  function hitTest(px, py) {
    let best = null, bestD = 16 * BM.labelScale;
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
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    BM.labelScale = dpr;
    const w = Math.round(wrap.clientWidth * dpr);
    const h = Math.round(wrap.clientHeight * dpr);
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
    $('glossaryList').innerHTML = GLOSSARY.map(g => {
      return '<div class="glItem">' +
        '<div><span class="t">' + g.en + '</span>' + (termUnlocked(g.id) ? ' ✓' : '') + '</div>' +
        '<div class="d">' + g.def.en + '</div>' +
        '</div>';
    }).join('');
  }
  $('glossaryBtn').addEventListener('click', openGlossary);
  $('glossaryCloseBtn').addEventListener('click', () => {
    $('glossaryDrawer').classList.remove('show');
    syncPaused();
  });

  /* ================= SHOP & GUILD ================= */
  let freePass = 0;
  const boughtTerms = new Set();
  let guildOpen = false, shopOpen = false;

  function shardBalance() { return Math.max(0, countCollected() + COMBAT.crystals - COMBAT.spentCrystals); }
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
        else if (!gateOk) { label = '🔒 ' + w.scoreReq + ' XP'; dis = ' disabled'; }
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
        else if (!gateOk) { label = '🔒 ' + s.scoreReq + ' XP'; dis = ' disabled'; }
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
        else if (!gateOk) { label = '🔒 ' + c.scoreReq + ' XP'; dis = ' disabled'; }
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
    const gateTag = scoreReq > 0 ? '<span class="siGate' + (gateOk ? ' ok' : '') + '">' + (gateOk ? '✓ ' : '🔒 ') + scoreReq + ' XP</span>' : '';
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
        if (COMBAT.score < w.scoreReq) { toast('Need ' + w.scoreReq + ' unlock XP to buy this'); return; }
        if (COMBAT.gold < w.gold) { toast('Not enough gold'); return; }
        COMBAT.gold -= w.gold; COMBAT.weapons.push(id);
        SFX.unlock(); toast('⚔ Purchased <b>' + w.name + '</b>!');
      }
      COMBAT.weapon = id; WORLD.equipWeapon(id);
      toast('Equipped <b>' + w.name + '</b>');
      saveCombat(); renderShop(); updateCombatHUD(); return;
    }
    if (act === 'skins') {
      const s = SKN[id]; if (!s) return;
      if (COMBAT.skins.indexOf(id) < 0) {
        if (COMBAT.score < s.scoreReq) { toast('Need ' + s.scoreReq + ' unlock XP to buy this'); return; }
        if (COMBAT.gold < s.gold) { toast('Not enough gold'); return; }
        COMBAT.gold -= s.gold; COMBAT.skins.push(id);
        SFX.unlock(); toast('✦ Purchased <b>' + s.name + '</b>!');
      }
      COMBAT.skin = id; WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
      saveCombat(); renderShop(); updateCombatHUD(); return;
    }
    if (act === 'characters') {
      const c = CHR[id]; if (!c) return;
      if (COMBAT.characters.indexOf(id) < 0) {
        if (COMBAT.score < c.scoreReq) { toast('Need ' + c.scoreReq + ' unlock XP to unlock ' + c.name); return; }
        COMBAT.characters.push(id);
        SFX.unlock(); toast('☻ Unlocked <b>' + c.name + '</b> — ' + c.role + '!');
      }
      COMBAT.character = id; WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
      saveCombat(); renderShop(); updateCombatHUD(); renderCharList(); return;
    }
  }

  function buyTerm() {
    if (shardBalance() < 1) { toast('Not enough crystals'); return; }
    const pool = GLOSSARY.filter(g => !termUnlocked(g.id));
    if (!pool.length) { toast('All words are already unlocked'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    boughtTerms.add(pick.id);
    COMBAT.spentCrystals += 1;
    saveCombat();
    refreshGlossary();
    renderShop();
    updateHUD();
    toast('✓ New word unlocked: ' + pick.en + ' — check your glossary');
  }

  function buyPass() {
    if (shardBalance() < 2) { toast('Not enough crystals'); return; }
    COMBAT.spentCrystals += 2;
    saveCombat();
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

  /* ---------------- gacha / character switcher ---------------- */
  function recruitPool() {
    return CHARACTERS.filter(character => !COMBAT.characters.includes(character.id));
  }

  function rarityOf(c) { return Number(c.rarity) || 3; }
  function starText(n) { return '★'.repeat(Math.max(1, Math.min(5, n || 3))); }
  function hexColor(n) { return '#' + (Number(n) || 0).toString(16).padStart(6, '0'); }

  function recruitsAvailable() {
    return Math.min(recruitPool().length, drawCharges());
  }

  function gachaStatusText() {
    const pool = recruitPool();
    if (!pool.length) return bi('Every companion is already bonded to you.', '所有伙伴都已加入你的隊伍。');
    const charges = recruitsAvailable();
    if (charges > 0) return bi(charges + ' draw charge(s) ready · pity ' + COMBAT.pity + '/' + GACHA_RULES.pityMax,
      charges + ' 次抽卡機會 · pity ' + COMBAT.pity + '/' + GACHA_RULES.pityMax);
    return bi('Complete ' + challengeToNextDraw() + ' more chemistry challenge(s) for the next draw.', '再完成 ' + challengeToNextDraw() + ' 個 chemistry challenge 即可獲得下次抽卡。');
  }

  function chooseGachaCharacter() {
    let pool = recruitPool();
    if (!pool.length) return null;
    const forceFive = COMBAT.pity >= GACHA_RULES.pityMax - 1;
    if (forceFive) {
      const five = pool.filter(c => rarityOf(c) >= 5);
      if (five.length) pool = five;
      else {
        const best = Math.max.apply(null, pool.map(rarityOf));
        pool = pool.filter(c => rarityOf(c) === best);
      }
    }
    const weights = GACHA_RULES.weights;
    const total = pool.reduce((sum, c) => sum + (weights[rarityOf(c)] || 1), 0);
    let roll = Math.random() * total;
    for (const c of pool) {
      roll -= weights[rarityOf(c)] || 1;
      if (roll <= 0) return c;
    }
    return pool[pool.length - 1];
  }

  function gachaFigure(c) {
    const male = c.gender === 'male';
    const quote = {
      lyra: 'A steady blade and a steadier mind.',
      kael: 'Hold the line. The lattice will not break.',
      mira: 'Orbitals align — let the electrons dance.',
      dorian: 'Every arrow follows the strongest bond.',
      vex: 'Two sigils, one perfect resonance.'
    }[c.id] || 'A new bond joins the party.';
    return '<div class="gachaPortrait ' + (male ? 'male' : 'female') + '" style="--cc:' + hexColor(c.color) + ';--hair:' + hexColor(c.hair) + '">' +
      '<div class="gachaHalo"></div>' +
      '<svg class="gachaFigure" viewBox="0 0 280 390" aria-hidden="true">' +
        '<ellipse class="gShadow" cx="140" cy="365" rx="76" ry="13"/>' +
        '<g class="gPose">' +
          '<path class="gCape" d="M94 148 Q42 252 68 344 L116 320 L140 178 Z"/>' +
          '<path class="gCape gCapeR" d="M186 148 Q238 252 212 344 L164 320 L140 178 Z"/>' +
          '<path class="gBody" d="M103 140 Q140 118 177 140 L196 285 Q168 305 140 306 Q112 305 84 285 Z"/>' +
          '<path class="gLegL" d="M112 286 L132 356 L146 356 L143 284 Z"/>' +
          '<path class="gLegR" d="M168 286 L148 356 L134 356 L137 284 Z"/>' +
          '<path class="gArmL" d="M105 157 Q72 205 75 263 L91 269 Q101 216 121 178 Z"/>' +
          '<path class="gArmR" d="M175 157 Q218 190 221 239 L203 250 Q192 208 160 178 Z"/>' +
          '<circle class="gNeck" cx="140" cy="125" r="16"/>' +
          '<ellipse class="gHead" cx="140" cy="88" rx="42" ry="49"/>' +
          '<path class="gHair" d="M102 84 Q103 30 143 28 Q187 27 181 95 Q161 64 143 65 Q120 66 102 84 Z"/>' +
          '<path class="gHair gBang" d="M108 65 Q119 49 134 48 Q119 68 112 94 Z M144 48 Q162 42 177 60 Q160 64 151 91 Z"/>' +
          '<circle class="gEye" cx="124" cy="91" r="3.4"/><circle class="gEye" cx="156" cy="91" r="3.4"/>' +
          '<path class="gScarf" d="M116 129 Q140 143 164 129 L171 146 Q140 162 109 146 Z"/>' +
          '<path class="gAccent" d="M140 155 L150 179 L140 203 L130 179 Z"/>' +
        '</g>' +
      '</svg>' +
      '<div class="gachaQuote">“' + quote + '”</div>' +
      '</div>';
  }

  function renderGachaIdle() {
    const pool = recruitPool();
    gachaCurrent = null; gachaRevealed = false;
    const charges = recruitsAvailable();
    $('gachaCard').classList.remove('flipped');
    $('gachaModal').classList.remove('revealed', 'rarity-3', 'rarity-4', 'rarity-5');
    $('gachaFront').innerHTML = '';
    $('gachaBeams').innerHTML = '';
    $('gachaSub').textContent = gachaStatusText();
    $('gachaMeta').textContent = 'Pity ' + COMBAT.pity + ' / ' + GACHA_RULES.pityMax + ' · ' +
      (COMBAT.pity >= GACHA_RULES.pityMax - 1 ? bi('5-star guaranteed next draw', '下次保證 5-star') : bi('A 5-star is guaranteed by pity', 'Pity 保證會出 5-star'));
    const btn = $('gachaDrawBtn');
    btn.disabled = !pool.length || charges <= 0;
    btn.textContent = !pool.length ? bi('All companions collected', '所有伙伴已收集') : charges > 0 ? bi('Draw companion', '抽伙伴') : bi('No draw charge yet', '暫無抽卡機會');
  }

  function openGacha() {
    if (!started || CLOUD.isOpen()) return;
    gachaOpen = true;
    renderGachaIdle();
    $('gachaModal').classList.add('show');
    $('gachaModal').setAttribute('aria-hidden', 'false');
    const bh = $('gachaCard').querySelector('.gachaBackHint');
    if (bh) bh.textContent = bi('Tap to reveal', '點擊揭示');
    $('gachaDoneBtn').textContent = bi('Close', '關閉');
    WORLD.setLocked(true);
    syncPaused();
    SFX.click();
  }

  function closeGacha() {
    gachaOpen = false;
    $('gachaModal').classList.remove('show');
    $('gachaModal').setAttribute('aria-hidden', 'true');
    syncPaused();
    if (state === STATE.WORLD && !charModalOpen) WORLD.relock();
  }

  function drawGacha() {
    const character = chooseGachaCharacter();
    if (!character || recruitsAvailable() <= 0) {
      toast(gachaStatusText());
      return;
    }
    recruitClaims++;
    COMBAT.characters.push(character.id);
    const rarity = rarityOf(character);
    COMBAT.pity = rarity >= 5 ? 0 : Math.min(GACHA_RULES.pityMax, COMBAT.pity + 1);
    saveCombat();
    logEvent({ type: 'gacha', character: character.id, rarity, pity: COMBAT.pity });
    gachaCurrent = character;
    gachaRevealed = false;
    const front = $('gachaFront');
    front.innerHTML = '<div class="gachaFrontInner rarity-' + rarity + '">' +
      '<div class="gachaRarityLine">' + starText(rarity) + '</div>' +
      gachaFigure(character) +
      '<div class="gachaName">' + character.name + '</div>' +
      '<div class="gachaRole">' + character.role + ' · ' + starText(rarity) + '</div>' +
      '<div class="gachaElement">' + (character.gender === 'male' ? 'VANGUARD BOND' : 'RESONANCE BOND') + '</div>' +
      '</div>';
    $('gachaCard').classList.remove('flipped');
    $('gachaModal').classList.remove('revealed', 'rarity-3', 'rarity-4', 'rarity-5');
    $('gachaModal').classList.add('rarity-' + rarity);
    const beamCount = rarity >= 5 ? 18 : rarity >= 4 ? 12 : 8;
    $('gachaBeams').innerHTML = Array.from({ length: beamCount }, (_, i) =>
      '<i style="--i:' + i + ';--n:' + beamCount + '"></i>').join('');
    $('gachaSub').textContent = bi('The bond is forming…', '化學鍵正在形成…');
    $('gachaMeta').textContent = bi('Pity ' + COMBAT.pity + ' / ' + GACHA_RULES.pityMax, 'Pity ' + COMBAT.pity + ' / ' + GACHA_RULES.pityMax);
    const btn = $('gachaDrawBtn');
    btn.disabled = true;
    btn.textContent = bi('Revealing…', '揭示中…');
    SFX.gacha();
    clearTimeout(drawGacha._timer);
    drawGacha._timer = setTimeout(revealGacha, 420);
  }

  function revealGacha() {
    if (!gachaCurrent || gachaRevealed) return;
    gachaRevealed = true;
    const c = gachaCurrent;
    const rarity = rarityOf(c);
    $('gachaCard').classList.add('flipped');
    $('gachaModal').classList.add('revealed', 'rarity-' + rarity);
    $('gachaSub').textContent = bi(c.name + ' joined your party!', c.name + ' 已加入你的隊伍！');
    $('gachaMeta').textContent = starText(rarity) + ' · ' + bi('Pity ' + COMBAT.pity + ' / ' + GACHA_RULES.pityMax, 'Pity ' + COMBAT.pity + ' / ' + GACHA_RULES.pityMax);
    setTimeout(() => {
      const fig = $('gachaFront').querySelector('.gachaPortrait');
      if (fig) fig.classList.add('entrance');
      SFX.rare(rarity);
      burstAt(innerWidth * .5, innerHeight * .5, rarity >= 5 ? '#ffd86a' : rarity >= 4 ? '#c9a7ff' : '#8ff0c8', rarity >= 5 ? 52 : 34);
    }, 380);
    const left = recruitsAvailable();
    const btn = $('gachaDrawBtn');
    btn.disabled = left <= 0;
    btn.textContent = left > 0 ? bi('Draw again', '再抽一次') : bi('No draw charge yet', '暫無抽卡機會');
    renderCharList();
    updateCombatHUD();
  }

  function renderCharList(message) {
    const box = $('charList'); if (!box) return;
    const pool = recruitPool();
    const available = recruitsAvailable();
    $('recruitStatus').textContent = [
      typeof message === 'string' ? message : '',
      pool.length ? gachaStatusText() : bi('You have unlocked every companion.', '所有伙伴都已解鎖。')
    ].filter(Boolean).join(' ');
    const pity = $('gachaPity');
    if (pity) pity.textContent = 'Pity ' + COMBAT.pity + ' / ' + GACHA_RULES.pityMax;
    const rb = $('recruitBtn');
    if (rb) {
      rb.disabled = !pool.length;
      rb.textContent = available > 0 ? bi('Open companion draw · ' + available + ' ready', '開啟伙伴抽卡 · ' + available + ' 次') : bi('Open companion draw', '開啟伙伴抽卡');
    }
    box.innerHTML = CHARACTERS.map(c => {
      const owned = COMBAT.characters.indexOf(c.id) >= 0;
      const active = COMBAT.character === c.id;
      const gateOk = COMBAT.score >= c.scoreReq || owned;
      let label = active ? bi('Active', '使用中') : owned ? bi('Play as', '使用此角色') : (gateOk ? bi('Unlock free', '免費解鎖') : '🔒 ' + c.scoreReq + ' XP');
      const dis = active || !gateOk ? ' disabled' : '';
      return '<div class="charCard' + (active ? ' active' : '') + (owned ? '' : ' locked') + '" data-id="' + c.id + '">' +
        '<div class="charAvatar ca-' + c.id + '" style="--cc:' + hexColor(c.color) + '">' + (c.gender === 'male' ? '♂' : '♀') + '</div>' +
        '<div class="charInfo"><div class="charName">' + c.name + ' <span class="charRarity">' + starText(rarityOf(c)) + '</span></div>' +
        '<div class="charRole">' + c.role + '</div><div class="charDesc">' + c.desc + '</div></div>' +
        '<button data-id="' + c.id + '"' + dis + '>' + label + '</button></div>';
    }).join('');
    box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => {
      shopAction(b.dataset.id, 'characters');
      renderCharList();
    }));
  }
  function openCharModal() {
    if (!started || paused || CLOUD.isOpen()) return;
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
    if (owned.length < 2) { toast('Unlock more characters at the shop or companion draw'); return; }
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

  /* ---------------- daily 3-question set ---------------- */
  function dailySeed() {
    const key = todayKey();
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function dailyQuestions() {
    let seed = dailySeed();
    const pickOne = arr => { seed = (seed * 1664525 + 1013904223) >>> 0; return arr[seed % arr.length]; };
    return [1, 2, 3].map(bond => {
      const pool = COMPOUNDS.filter(c => c.bond === bond && c.tier <= 2);
      return { c: pickOne(pool.length ? pool : COMPOUNDS.filter(c => c.bond === bond)), step: 3 };
    });
  }
  function dailyRewardText() {
    const nextStreak = Math.max(0, COMBAT.streak) + 1;
    const mult = nextStreak >= REWARD_RULES.streakAt ? REWARD_RULES.streakMultiplier : 1;
    return '+' + Math.round(REWARD_RULES.stepXp * REWARD_RULES.dailyMultiplier * mult) + ' XP · +' + Math.round(REWARD_RULES.stepGold * REWARD_RULES.dailyMultiplier * mult) + ' gold';
  }
  function openDaily() {
    if (!started || CLOUD.isOpen()) return;
    ensureDaily();
    dailyOpen = true;
    dailyPending = null;
    renderDaily();
    $('dailyModal').classList.add('show');
    WORLD.setLocked(true);
    syncPaused();
  }
  function closeDaily() {
    dailyOpen = false;
    $('dailyModal').classList.remove('show');
    syncPaused();
    if (state === STATE.WORLD && !gachaOpen) WORLD.relock();
  }
  function renderDaily() {
    const d = ensureDaily();
    const qs = dailyQuestions();
    const answered = d.answers.length;
    const idx = Math.min(answered, 3);
    $('dailyProgress').innerHTML = qs.map((q, i) => {
      const a = d.answers[i];
      return '<span class="dailyDot ' + (a ? (a.correct ? 'ok' : 'bad') : i === idx ? 'now' : '') + '">' + (a ? (a.correct ? '✓' : '×') : (i + 1)) + '</span>';
    }).join('') + '<span class="dailyBonusTag">' + bi('2× REWARDS', '雙倍獎勵') + '</span>';
    $('dailyTitle').textContent = bi('Daily 3-question set', '每日三題挑戰');
    $('dailySub').textContent = bi('One set per day · each correct answer pays double XP and gold.', '每日一組 · 每題答對可獲雙倍 XP 與 gold。');
    $('dailyCloseBtn').textContent = bi('Close', '關閉');

    if (dailyPending) {
      const a = dailyPending;
      const c = qs[a.index].c;
      const explainText = textOf(explain(c, 3));
      $('dailyBody').innerHTML = '<div class="qBlock">' + bi('What type of bond holds ' + c.f + ' together?', '什麼 bond 把 ' + c.f + ' 結合在一起？') + '</div>' +
        '<div class="fb show answerFeedback ' + (a.ok ? 'isCorrect' : 'isWrong') + '"><div class="answerKey"><span>' + (a.ok ? bi('✓ Correct · double reward', '✓ 正確 · 雙倍獎勵') : bi('✓ Correct answer', '✓ 正確答案')) + '</span>' +
        '<strong>' + textOf({ v: c.bond, en: ['', 'Ionic bond', 'Covalent bond', 'Metallic bond'][c.bond], zh: ['', 'Ionic bond（離子鍵）', 'Covalent bond（共價鍵）', 'Metallic bond（金屬鍵）'][c.bond] }) + '</strong><p>' + explainText + '</p></div>' +
        '<div class="answerMiss"><span>' + bi('× Your answer', '× 你的答案') + '</span><strong>' + textOf(a.chosen) + '</strong></div>' +
        (a.reward ? '<div class="rewardChip">+' + a.reward.xp + ' XP · +' + a.reward.gold + ' gold' + (a.reward.streak >= REWARD_RULES.streakAt ? ' · STREAK ×' + a.reward.mult.toFixed(1) : '') + '</div>' : '') + '</div>' +
        '<button class="primary dailyNextBtn" id="dailyNextBtn">' + (answered >= 3 ? bi('Finish daily set', '完成每日挑戰') : bi('Next question', '下一題')) + '</button>';
      $('dailyNextBtn').addEventListener('click', () => {
        dailyPending = null;
        if (COMBAT.daily.answers.length >= 3) COMBAT.daily.done = true;
        saveCombat(); updateCombatHUD(); renderDaily();
      });
      return;
    }

    if (d.done || answered >= 3) {
      if (!d.done) { d.done = true; saveCombat(); updateCombatHUD(); }
      const right = d.answers.filter(a => a.correct).length;
      $('dailyBody').innerHTML = '<div class="dailyDone"><b>' + bi('Daily drill complete', '每日挑戰完成') + '</b>' +
        '<p>' + bi(right + ' / 3 correct · rewards already added.', '答對 ' + right + ' / 3 · 獎勵已加入。') + '</p>' +
        '<span>' + bi('A fresh set unlocks tomorrow.', '明日會解鎖新一組。') + '</span></div>';
      return;
    }

    const c = qs[idx].c;
    const opts = [
      { v: 1, en: 'Ionic bond', zh: 'Ionic bond（離子鍵）' },
      { v: 2, en: 'Covalent bond', zh: 'Covalent bond（共價鍵）' },
      { v: 3, en: 'Metallic bond', zh: 'Metallic bond（金屬鍵）' }
    ];
    $('dailyBody').innerHTML = '<div class="qBlock">' + bi('What type of bond holds ' + c.f + ' together?', '什麼 bond 把 ' + c.f + ' 結合在一起？') + '</div>' +
      '<div class="qZh">' + bi('Daily question ' + (idx + 1) + ' of 3 · double rewards', '每日第 ' + (idx + 1) + ' / 3 題 · 雙倍獎勵') + '</div>' +
      '<div class="options dailyOptions">' + opts.map(o => '<button class="opt" data-v="' + o.v + '">' + textOf(o) + '</button>').join('') + '</div>' +
      '<div class="dailyRewardHint">' + dailyRewardText() + '</div>';
    $('dailyBody').querySelectorAll('.opt').forEach(btn => btn.addEventListener('click', () => answerDaily(btn, c, opts)));
  }

  function answerDaily(btn, c, opts) {
    const d = ensureDaily();
    if (dailyPending || d.done || d.answers.length >= 3) return;
    const idx = d.answers.length;
    const chosen = opts.find(o => o.v === Number(btn.dataset.v)) || { v: 0, en: '—', zh: '—' };
    const ok = chosen.v === c.bond;
    let reward = null;
    if (ok) {
      reward = awardCorrectStep(REWARD_RULES.stepXp, REWARD_RULES.stepGold, { daily: true });
      SFX.correct();
      answerJuice(btn, reward, false);
    } else {
      SFX.bad();
      breakStreak();
      feedbackShake(btn);
    }
    d.answers.push({ compound: c.id, value: chosen.v, correct: ok });
    dailyPending = { index: idx, ok, chosen, reward };
    saveCombat();
    logEvent({ type: 'daily', compound: c.f, chosen: chosen.v, correct: ok, reward });
    updateCombatHUD();
    renderDaily();
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
    SESSION.combat = { score: COMBAT.score, gold: COMBAT.gold, crystals: COMBAT.crystals, spentCrystals: COMBAT.spentCrystals, streak: COMBAT.streak, bestStreak: COMBAT.bestStreak, pity: COMBAT.pity, kills: COMBAT.kills, weapons: COMBAT.weapons.slice(), characters: COMBAT.characters.slice(), daily: COMBAT.daily };
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
    if (state !== STATE.WORLD || !started || paused || CLOUD.isOpen()) return;
    SFX.click();
    tutHide();   // clear the training banner while a modal is open
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
    if (e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (CLOUD.isOpen()) { CLOUD.close(); return; }
      if (coachOn) { coachEnd(); return; }
      if (wpOpen) { closeWpList(); return; }
      if (beaconOpen) { closeBeacon(); return; }
      if (gachaOpen) { closeGacha(); return; }
      if (dailyOpen) { closeDaily(); return; }
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
    if (state === STATE.DIALOG && (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
      if (moveDialogChoice(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1)) { e.preventDefault(); return; }
    }
    if (state === STATE.DOTCROSS && (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
      if (moveDCFocus(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1)) { e.preventDefault(); return; }
    }
    if (e.key === 'Enter') {
      if (handleDialogEnter() || handleDotCrossEnter()) { e.preventDefault(); return; }
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
    WORLD.setPrimaryHandler(function () { playerAttack(false); });   // left mouse = attack
    WORLD.setInteractHandler(function () {
      if (helpOpen || mapOpen || wpOpen || shopOpen || guildOpen || beaconOpen || charModalOpen) return;
      interact();
    });
    loadWaypoints();
    WORLD.onZoneChange = k => {
      const Z = ZONES[k];
      /* No centre-screen toast on zone change — it fires on every border crossing and
         interrupts play. The HUD zone pill always shows the current region; a brief
         pulse on that pill conveys the change without blocking the view. */
      const zp = document.getElementById('zoneLabel');
      if (zp) {
        zp.classList.remove('pulse'); void zp.offsetWidth; zp.classList.add('pulse');
        setTimeout(function () { zp.classList.remove('pulse'); }, 1600);
      }
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
    // mute toggle
    const muteBtn = $('muteBtn');
    if (muteBtn) {
      const syncMute = () => { muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊'; muteBtn.title = SFX.isMuted() ? 'Sound off' : 'Sound on'; };
      syncMute();
      muteBtn.addEventListener('click', () => { SFX.toggleMute(); syncMute(); });
    }
    $('combatToggle').addEventListener('change', e => setCombatMode(e.target.checked));
    $('recruitBtn').addEventListener('click', openGacha);
    $('gachaBtn').addEventListener('click', openGacha);
    $('dailyBtn').addEventListener('click', openDaily);
    $('gachaCloseBtn').addEventListener('click', closeGacha);
    $('gachaDoneBtn').addEventListener('click', closeGacha);
    $('gachaDrawBtn').addEventListener('click', drawGacha);
    $('gachaCard').addEventListener('click', () => {
      if (!gachaCurrent) drawGacha();
      else if (!gachaRevealed) revealGacha();
    });
    $('dailyCloseBtn').addEventListener('click', closeDaily);
    $('langBtn').addEventListener('click', toggleLanguage);
    document.querySelectorAll('[data-lang-toggle]').forEach(b => b.addEventListener('click', toggleLanguage));
    $('labBtn').addEventListener('click', openNextLab);
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
    syncLanguageUI();
    ensureDaily();
    refreshLocks();
    updateHUD();
    updateCombatHUD();
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

    $('startBtn').addEventListener('click', () => startSession(false, true));
    $('exploreBtn').addEventListener('click', () => startSession(false, false));
    $('trialContinueBtn').addEventListener('click', finishIntroTrial);
    WORLD.setLocked(true);

    lastFrame = performance.now();
    window.__world = WORLD;
    window.__bq = { openDialog, openDotCross, openVocab, showSummary, interact, state: () => state, DC, COMP, TERM, NODES, attempts, openBigMap, openGacha, drawGacha, openDaily, toggleLanguage, startIntroTrial, completeIntroTrial, finishIntroTrial, combat: () => COMBAT, getState: () => ({ state, helpOpen, mapOpen, wpOpen }), wp: { list: () => [...unlockedWp], open: openWpList, tp: doTeleport, pop: showTpPop, all: WAYPOINTS, dbg: () => { const c = BM.canvas, r = c.getBoundingClientRect(), wr = $('mapWrap').getBoundingClientRect(); return { cw: c.width, ch: c.height, rw: r.width, rh: r.height, rl: r.left - wr.left, rt: r.top - wr.top, s: bmScale(), zoom: BM.zoom, cx: BM.cx, cz: BM.cz }; } } };
    requestAnimationFrame(loop);
  }

  let mapTick = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.max(0, Math.min(0.05, (now - lastFrame) / 1000)) || 0.016;
    lastFrame = now;

    if (started && !document.hidden && (!paused || state === STATE.DIALOG || state === STATE.DOTCROSS)) activeTime += dt;
    const moving = started && !paused && state === STATE.WORLD;
    if (moving) {
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
    tickTutorial();
    if (introTrial && !introTrial.done) $('trialTimer').textContent = formatTrialTime((performance.now() - introTrial.started) / 1000);
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
