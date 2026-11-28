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
    characters: ['lyra', 'kael'],  // unlocked character ids (both starters are free)
    /* Characters the player has actually taken control of. Only these may
       walk the world as companions: an untouched second starter used to trail
       the player from the very first second and read as a stranger following
       you around during the tutorial. */
    metRoster: ['lyra'],
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
    burstCharge: 0,
    lightStep: 0,
    trialDraws: 0,
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
        met: COMBAT.metRoster.slice(),
        streak: COMBAT.streak, bestStreak: COMBAT.bestStreak, pity: COMBAT.pity,
        gachaPulls: recruitClaims, trialDraws: COMBAT.trialDraws, daily: COMBAT.daily
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
      COMBAT.characters = Array.isArray(d.characters) ? d.characters.slice() : ['lyra', 'kael'];
      /* starter characters are free: make sure an older save can still swap */
      if (typeof CHARACTERS !== 'undefined') {
        CHARACTERS.forEach(function (c) { if (c.scoreReq <= 0 && COMBAT.characters.indexOf(c.id) < 0) COMBAT.characters.push(c.id); });
      }
      COMBAT.skins = Array.isArray(d.skins) ? d.skins : ['default'];
      COMBAT.weapon = WPN[d.weapon] ? d.weapon : 'sword';
      COMBAT.character = CHR[d.character] ? d.character : 'lyra';
      /* an older save has no `met` list: assume only the character they are
         actually playing has been taken control of, so upgrading does not
         silently spawn a second body next to them */
      COMBAT.metRoster = Array.isArray(d.met) ? d.met.filter(function (id) { return !!CHR[id]; }) : [COMBAT.character];
      if (COMBAT.metRoster.indexOf(COMBAT.character) < 0) COMBAT.metRoster.push(COMBAT.character);
      COMBAT.skin = SKN[d.skin] ? d.skin : 'default';
      COMBAT.kills = d.kills || 0;
      COMBAT.crystals = Math.max(0, Number(d.crystals) || 0);
      COMBAT.spentCrystals = Math.max(0, Number(d.spentCrystals) || 0);
      COMBAT.streak = Math.max(0, Number(d.streak) || 0);
      COMBAT.bestStreak = Math.max(COMBAT.streak, Number(d.bestStreak) || 0);
      COMBAT.pity = Math.max(0, Number(d.pity) || 0);
      COMBAT.trialDraws = Math.max(0, Number(d.trialDraws) || 0);
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
  function drawCharges() { return Math.max(0, drawsEarned() + (COMBAT.trialDraws || 0) - recruitClaims); }
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
      onHit: function (enemy, dmg, combo, isSkill, attackType) {
        SFX.hit();
        screenPunch(isSkill ? 2.2 : 1);
        COMBAT.burstCharge = Math.min(3, (COMBAT.burstCharge || 0) + 1);
        syncBurstMeter();
        const s = COMBAT_RULES.hitScore + (combo || 0);
        const g = COMBAT_RULES.hitGold;
        addScore(s); addGold(g);
        if (Math.random() < 0.45) { SFX.coin(); floatReward('+' + s + '  +' + g + 'g', enemy.group.position); }
      },
      onDamage: function (enemy, dmg, kind) {
        showDamageNumber(enemy.group.position, dmg, kind);
        if (enemy.boss) {
          const bh = $('bossHud');
          if (bh) { bh.classList.add('hurt'); setTimeout(function () { bh.classList.remove('hurt'); }, 130); }
        }
      },
      onReaction: function (info) { showBondReaction(info); },
      onKill: function (enemy) {
        SFX.kill();
        screenPunch(2.6);
        COMBAT.kills++;
        addScore(enemy.type.score); addGold(enemy.type.gold);
        toast('⚔ ' + enemy.type.name + ' defeated! <b>+' + enemy.type.score + ' XP</b> · <b>+' + enemy.type.gold + ' gold</b>', 1800);
        floatReward('+' + enemy.type.score + '  +' + enemy.type.gold + 'g', enemy.group.position, true);
        if (enemy.boss) {
          showBanner(enemy.type.name.toUpperCase() + ' DEFEATED', bi('Bond encounter cleared. Two other optional bosses wait in the outer regions.', 'Boss 已擊敗，外圍地區仲有其他可選挑戰。'));
          try { localStorage.setItem('bq_boss_down_' + (enemy.bossId || 'tyrant'), '1'); } catch (e) { }
        }
        if (enemy.trial && introTrial && !introTrial.firstKill) {
          introTrial.firstKill = true;
          let claimed = false; try { claimed = localStorage.getItem('bq_trial_first_kill_v1') === '1'; } catch (e) { }
          if (!claimed) {
            COMBAT.trialDraws = Math.max(0, COMBAT.trialDraws || 0) + 1;
            addScore(15); addGold(10);
            try { localStorage.setItem('bq_trial_first_kill_v1', '1'); } catch (e) { }
            toast(bi('✦ First bond kill: +15 XP · +10 gold · +1 companion draw charge', '✦ 首個 bond 擊破：+15 XP · +10 gold · +1 伙伴抽卡次數'), 2600);
            logEvent({ type: 'bond_trial_first_kill', family: enemy.trialFamily || 'unknown' });
          }
        }
        saveCombat();
        updateCombatHUD();
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
    syncParty();
    /* Combat is ON by default — a fresh player pressing J used to get nothing
       at all, which is why attacks felt like they did not exist. Only an
       explicit "off" stored by the player turns it back off. */
    let enabled = true;
    try { enabled = localStorage.getItem('bq_combat_enabled') !== '0'; } catch (e) { }
    setCombatMode(enabled);
    updateCombatHUD();
  }
  COMBAT.hurtCd = 0;

  /* A quick white flash on the HUD layer whenever a hit lands — together with
     the world-space impact and the camera kick this is what makes an attack
     feel like it connected instead of just "something happened". */
  function screenPunch(strength, colorHex) {
    const el = $('hitFlash'); if (!el) return;
    if (colorHex) {
      const c = '#' + ('000000' + Number(colorHex).toString(16)).slice(-6);
      el.style.background = 'radial-gradient(circle at 50% 55%,rgba(255,255,255,.26),' + c + '55 42%,transparent 76%)';
    } else {
      el.style.background = '';
    }
    el.style.opacity = String(Math.min(0.92, 0.22 + strength * 0.26));
    clearTimeout(screenPunch.t);
    screenPunch.t = setTimeout(function () { el.style.opacity = '0'; }, 110);
  }

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
  const TUT_KEY = 'bq_tut_v3';
  let tutStep = 0;            // 0 idle · 1 move · 2 look · 3 approach · 4 pressE · 5 answer · 6 done
  let tutMoved = 0;           // metres actually walked in step 1
  let tutLastPos = null;      // last player position for move measuring
  let tutLook = 0;            // radians the camera has been turned in step 2
  let tutYaw = 0;             // last yaw sample for look measuring
  let tutCelebrate = 0;
  let introTrial = null;
  let introTrialTicker = 0;
  const TUT_MOVE_GOAL = 8;
  const TUT_LOOK_GOAL = 1.9;  // ~110 degrees of camera turn proves mouse-look

  function tutSeen() { try { return !!localStorage.getItem(TUT_KEY); } catch (e) { return false; } }

  /* Genshin-style guidance. Every step is ONE verb, the key that does it, a bar
     that fills as you actually do it, and a line that removes the fear of
     failing. No paragraph of instructions, no modal, nothing to dismiss. */
  function tutShow(step) {
    tutStep = step;
    const bh = $('bigHint'); if (!bh) return;
    const touch = WORLD.isTouchMode();
    const S = {
      1: { step: bi('TRAINING · STEP 1 OF 5', '新手教學 · 第 1 / 5 步'),
           keys: touch ? [bi('LEFT STICK', '左搖桿')] : ['W', 'A', 'S', 'D'],
           text: touch ? bi('DRAG THE STICK TO WALK', '拖動搖桿行路') : bi('HOLD  W  TO WALK', '按住 W 行路'),
           sub: bi('Walk 8 m and the bar fills. Nothing here can hurt you.', '行 8 米條就會滿。呢度無嘢會傷到你。') },
      2: { step: bi('TRAINING · STEP 2 OF 5', '新手教學 · 第 2 / 5 步'),
           keys: touch ? [bi('RIGHT SIDE', '右邊畫面')] : [bi('MOUSE', '滑鼠')],
           text: touch ? bi('SWIPE TO LOOK AROUND', '滑動畫面環視') : bi('MOVE THE MOUSE TO LOOK', '移動滑鼠環視四周'),
           sub: bi('Sweep about a quarter turn. This is how you spot the green beam.', '轉大約四分之一圈。之後就係靠呢樣揀綠色光柱。') },
      3: { step: bi('TRAINING · STEP 3 OF 5', '新手教學 · 第 3 / 5 步'),
           keys: touch ? [bi('WALK', '行過去')] : ['W', bi('SHIFT', 'SHIFT')],
           text: bi('FOLLOW THE GREEN BEAM', '跟住綠色光柱行'),
           sub: dlgGoalSub() },
      4: { step: bi('TRAINING · STEP 4 OF 5', '新手教學 · 第 4 / 5 步'),
           keys: ['E'],
           text: touch ? bi('TAP  THE  E  BUTTON', '撐 E 掉') : bi('PRESS  E  TO TALK', '按 E 開始對話'),
           sub: bi('Close enough. E opens the chemistry question.', '已經夠近，按 E 就會開化學題。') },
      5: { step: bi('TRAINING · STEP 5 OF 5', '新手教學 · 第 5 / 5 步'),
           keys: touch ? [bi('TAP', '點選')] : [bi('CLICK', '點擊'), '↑ ↓'],
           text: bi('READ THE CLUE, THEN PICK', '睇線索，再揀答案'),
           sub: bi('Elements → electrons → bond type. A wrong pick costs nothing in training.', '元素 → 電子 → 鍵型。絃習中答錯唔會扣任何嘢。') }
    }[step];
    if (!S) return;
    bh.querySelector('.bhStep').textContent = S.step;
    bh.querySelector('.bhText').textContent = S.text;
    const keys = bh.querySelector('.bhKeys');
    if (keys) keys.innerHTML = S.keys.map(function (k) { return '<kbd>' + k + '</kbd>'; }).join('');
    bh.querySelector('.bhSub').innerHTML = S.sub + '<b class="bhLive" id="bhLive"></b>';
    bh.className = 'bh show s' + step;
  }
  function tutHide() { const bh = $('bigHint'); if (bh) bh.className = 'bh'; }

  function tutProgress(k) {
    const el = $('bhFill'); if (el) el.style.width = Math.round(Math.max(0, Math.min(1, k)) * 100) + '%';
  }
  /* Live readout inside the banner: metres walked, degrees turned, metres left.
     Seeing the number move is what makes a prompt feel responsive rather than
     decorative - it proves the game noticed you. */
  function tutLive(msg) {
    const el = $('bhLive'); if (el) el.textContent = msg ? ' ' + msg : '';
  }

  /* The sub-line for step 2 names the actual compound the player is walking to,
     so a first-timer knows what the glowing figure is for. */
  function dlgGoalSub() {
    const t = trackedNode();
    if (!t) return 'Follow the green light beam!';
    if (t.type === 'chest') return 'Open the chest, then place electrons on the dot-and-cross diagram.';
    if (t.type === 'crystal') return 'Collect the crystal to unlock a chemistry word.';
    const c = COMP[t.compound];
    if (!c) return 'Talk to them — classify the compound.';
    return 'Talk to them: classify ' + c.f + ' in ' + dialogKinds(c).length + ' questions.';
  }

  /* force = the player explicitly asked for the lesson (Start button, or
     Help > Replay the tutorial). Without it a finished tutorial stays finished,
     so walking into a spirit later does not replay step 1 at you. */
  function tutStart(force) {
    if (!force && (tutSeen() || mainDone())) return;
    setTimeout(() => {
      if (guided || state !== STATE.WORLD) return;
      tutShow(1); tutProgress(0); tutLive('');
      tutLastPos = null; tutMoved = 0; tutLook = 0; tutYaw = WORLD.yaw || 0;
      SFX.click();
    }, 700);
  }
  /* Called after the 60-second Bond Trial ends: the fight has taught the combat
     controls, so now teach the chemistry loop the same way — by doing. */
  function tutStartAfterTrial() {
    if (tutSeen() || mainDone()) return;   /* the trial already taught it this run */
    tutStep = 0; tutMoved = 0; tutLook = 0; tutLastPos = null;
    setTimeout(() => { if (state === STATE.WORLD) tutStart(); }, 400);
  }
  function tutAdvance(next) {
    SFX.coin();
    tutShow(next);
    if (next === 2) { tutLook = 0; tutYaw = WORLD.yaw || 0; }
    if (next === 3) { tutMoved = 0; tutLastPos = null; }
  }
  function tutComplete() {
    tutStep = 6;
    const bh = $('bigHint'); if (!bh) return;
    bh.className = 'bh show s3 done';
    bh.querySelector('.bhStep').textContent = '\ud83c\udf89 ' + bi('TRAINING COMPLETE', '新手教學完成');
    bh.querySelector('.bhText').textContent = bi('YOU CAN READ A BOND', '你已經識睇化學鍵');
    bh.querySelector('.bhSub').innerHTML = bi(
      'Element types → electron behaviour → bond name → electron pairs.<br>That is every question in this game. Open a dot-and-cross chest next.',
      '元素種類 → 電子行為 → 鍵名 → 電子對。<br>全遊戲每一條題目都係呢條路。下一步去開 dot-and-cross 寶箱。');
    const keys = bh.querySelector('.bhKeys'); if (keys) keys.innerHTML = '';
    tutProgress(1); tutLive('');
    SFX.unlock();
    tutCelebrate = performance.now() + 6400;
    try { localStorage.setItem(TUT_KEY, '1'); } catch (e) { }
  }
  function formatTrialTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function startIntroTrial() {
    if (!started) return;
    tutStep = 0; tutCelebrate = 0; tutHide();
    introTrial = { started: performance.now(), kills: 0, collected: 0, total: 3, done: false, firstKill: false };
    document.body.classList.add('intro-trial'); setQuestCollapsed(true);
    const hud = $('trialHud'); hud.classList.add('show'); hud.classList.remove('complete');
    $('trialTimer').textContent = '0:00';
    $('trialGoal').textContent = bi('Defeat the ionic, covalent and metallic bond enemies', '擊敗 Ionic、Covalent、Metallic 三隻 bond 敵人');
    document.querySelectorAll('.trialPip').forEach(p => p.classList.remove('got'));
    const pipNames = { ionic: isZh() ? 'Ionic 離子' : 'Ionic', covalent: isZh() ? 'Covalent 共價' : 'Covalent', metallic: isZh() ? 'Metallic 金屬' : 'Metallic' };
    document.querySelectorAll('.trialPip').forEach(p => { const b = p.querySelector('b'); if (b) b.textContent = pipNames[p.dataset.trial] || p.dataset.trial; });
    WORLD.setBondTrialHooks({
      onKill: function (enemy, kills, total) { if (!introTrial) return; introTrial.kills = kills; introTrial.collected = kills; const pip = document.querySelector('.trialPip[data-trial="' + (enemy.trialFamily || '') + '"]'); if (pip) pip.classList.add('got'); $('trialGoal').textContent = bi('Bonds broken: ' + kills + ' / ' + total + ' · keep the combo alive', '已擊破 bond：' + kills + ' / ' + total + ' · 保持 combo'); logEvent({ type: 'bond_trial_kill', family: enemy.trialFamily || 'unknown', kills: kills }); },
      onComplete: function (info) { completeIntroTrial(info); }
    });
    const trial = WORLD.startBondTrial({ x: 0, z: -1.5 }); introTrial.total = trial ? trial.total : 3; setCombatMode(true);
    introTrialTicker = setInterval(function () { if (!introTrial || introTrial.done) return; $('trialTimer').textContent = formatTrialTime((performance.now() - introTrial.started) / 1000); }, 250);
  }
  function completeIntroTrial(info) {
    if (!introTrial || introTrial.done) return;
    introTrial.done = true; clearInterval(introTrialTicker); introTrialTicker = 0;
    const elapsed = info && info.elapsed ? info.elapsed : (performance.now() - introTrial.started) / 1000;
    saveCombat(); updateCombatHUD();
    const hud = $('trialHud'); hud.classList.add('complete'); $('trialTimer').textContent = formatTrialTime(elapsed);
    $('trialGoal').textContent = bi('ALL 3 BONDS BROKEN · ' + elapsed.toFixed(1) + 's · Chem Lab unlocked', '3 個 BOND 全破 · ' + elapsed.toFixed(1) + 's · Chem Lab 已解鎖');
    showBanner('FIRST BOND', bi('Ionic chain · Covalent bind · Metallic shockwave · Chem Lab unlocked', 'Ionic chain · Covalent bind · Metallic shockwave · Chem Lab 已解鎖'));
    SFX.perfect(); burstAt(innerWidth / 2, innerHeight * 0.46, '#ffd86a', 54); setCombatMode(true); hud.classList.add('celebrating'); setTimeout(function () { if (introTrial) hud.classList.remove('celebrating'); }, 2300);
    logEvent({ type: 'bond_trial_complete', elapsed: +elapsed.toFixed(2), kills: introTrial.kills });
  }
  function finishIntroTrial() {
    if (!introTrial || !introTrial.done) return;
    clearInterval(introTrialTicker); introTrialTicker = 0; WORLD.stopBondTrial(); WORLD.setBondTrialHooks(null); introTrial = null; document.body.classList.remove('intro-trial'); $('trialHud').classList.remove('show', 'complete', 'celebrating'); setQuestCollapsed(false);
    /* First run: walk the player through the chemistry loop before throwing a
       lab challenge at them. openNextLab() would teleport straight into a
       question with no explanation. */
    if (!tutSeen() && !mainDone()) { tutStartAfterTrial(); return; }
    openNextLab();
  }

  function tickTutorial() {
    if (tutCelebrate && performance.now() > tutCelebrate) { tutCelebrate = 0; tutHide(); return; }
    if (tutCelebrate) return;
    if (tutStep === 0 || tutStep >= 6) return;
    if (state !== STATE.WORLD || !started) return;
    /* re-show the banner after closing a modal */
    const bhEl = $('bigHint');
    if (bhEl && !bhEl.classList.contains('show')) tutShow(tutStep);
    const p = WORLD.player.position;
    if (tutStep === 1) {
      if (tutLastPos) tutMoved += Math.hypot(p.x - tutLastPos.x, p.z - tutLastPos.z);
      tutLastPos = { x: p.x, z: p.z };
      tutProgress(tutMoved / TUT_MOVE_GOAL);
      tutLive(tutMoved.toFixed(1) + ' / ' + TUT_MOVE_GOAL + ' m');
      if (tutMoved >= TUT_MOVE_GOAL) tutAdvance(2);
      return;
    }
    if (tutStep === 2) {
      /* accumulate absolute yaw change, so sweeping back and forth still counts */
      const now = WORLD.yaw || 0;
      let dy = now - tutYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      tutLook += Math.abs(dy); tutYaw = now;
      tutProgress(tutLook / TUT_LOOK_GOAL);
      tutLive(Math.round(Math.min(360, tutLook * 180 / Math.PI)) + '\u00b0');
      if (tutLook >= TUT_LOOK_GOAL) tutAdvance(3);
      return;
    }
    const t = trackedNode();
    if (!t) return;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (tutStep === 3) {
      tutProgress(1 - d / 26);
      tutLive(Math.max(0, Math.round(d - 4)) + ' m');
      if (d < 7) tutAdvance(4);
      return;
    }
    if (tutStep === 4) {
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

  function showDamageNumber(worldPos, dmg, kind) {
    const v = new THREE.Vector3(worldPos.x, worldPos.y + 1.8, worldPos.z).project(WORLD.camera);
    const el = document.createElement('div'); const reaction = kind === 'chain' || kind === 'shockwave';
    el.className = 'damageNumber' + ((kind === 'burst' || kind === 'heavy') ? ' crit' : reaction ? ' reaction' : '');
    el.textContent = (reaction ? '↯ ' : '') + '-' + Math.round(dmg);
    el.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px'; el.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    $('floatLayer').appendChild(el); setTimeout(function () { el.remove(); }, 780);
  }
  function showBondReaction(info) {
    const family = info && info.family;
    const data = { ionic: { title: 'IONIC CHAIN', zh: '離子連鎖', sub: 'knockback · electron-transfer pulse', subZh: '擊退 · 電子轉移脈衝' }, covalent: { title: 'COVALENT BIND', zh: '共價束縛', sub: 'shared-pair lock · slow', subZh: '共用電子對鎖定 · 減速' }, metallic: { title: 'METALLIC SHOCKWAVE', zh: '金屬震波', sub: 'delocalised-electron pulse · AoE', subZh: '離域電子脈衝 · 範圍傷害' } }[family];
    if (!data) return; const el = document.createElement('div'); el.className = 'bondReaction ' + family; el.innerHTML = (isZh() ? data.zh : data.title) + '<small>' + (isZh() ? data.subZh : data.sub) + '</small>'; document.body.appendChild(el); if (window.SFX) SFX.correct(); setTimeout(function () { el.remove(); }, 950);
  }
  function syncBurstMeter() {
    const charge = Math.max(0, Math.min(3, COMBAT.burstCharge || 0)); const fill = $('skillFill'); if (fill) fill.style.width = (charge / 3 * 100) + '%'; const label = document.querySelector('.skillLabel');
    if (label) {
      const C = CHR[COMBAT.character];
      const EL = (typeof ELEMENTS !== 'undefined') && C && ELEMENTS[C.element];
      const nm = EL ? EL.name.split(' ')[0].toUpperCase() : 'BURST';
      label.textContent = bi(nm + ' (K) ' + charge + '/3', (EL ? EL.name : '爆發') + ' (K) ' + charge + '/3');
    }
  }

  /* Perform a player attack. combo advances within a short window. */
  function playerAttack(mode) {
    if (!started || paused || state !== STATE.WORLD || !WORLD.combatState.enabled) return;
    let attackType = mode === true ? 'burst' : (typeof mode === 'string' ? mode : 'light');
    const comboIndex = COMBAT.lightStep || 0;
    if (attackType === 'light' && comboIndex >= 3) attackType = 'finisher';
    const now = performance.now() / 1000; const w = WPN[COMBAT.weapon];
    if (now - COMBAT.lastHit > COMBAT_RULES.comboWindow) { COMBAT.combo = 0; COMBAT.lightStep = 0; }
    if (attackType === 'burst') {
      if (COMBAT.skillCd > 0) { toast(bi('Skill recharging — ' + COMBAT.skillCd.toFixed(1) + 's', '技能冷卻中 — ' + COMBAT.skillCd.toFixed(1) + ' 秒')); return; }
    }
    const minGap = attackType === 'heavy' ? 0.82
      : attackType === 'charged' ? 0.95
      : attackType === 'burst' ? 0.25
      : attackType === 'finisher' ? Math.max(0.26, w.rate * 1.1)
      : w.rate;
    if (now - COMBAT.lastHit < minGap) return;
    const comboStep = (attackType === 'light' || attackType === 'finisher') ? Math.min(2, comboIndex) : 0;
    /* A skill always fires. Charging 3 hits makes it full power; casting early
       still works at reduced power, so pressing K never feels like nothing. */
    const charge = Math.max(0, Math.min(3, COMBAT.burstCharge || 0));
    const power = attackType === 'burst' ? (charge >= 3 ? 1 : 0.42 + charge * 0.16) : 1;
    if (!WORLD.performAttack(w, comboStep, attackType, updateAttackCombo, power)) return;
    if (attackType === 'light' || attackType === 'finisher') {
      COMBAT.lightStep = (comboIndex + 1) % 4;
      SFX.swing();
      if (attackType === 'finisher') { SFX.hit(); toast(bi('Combo finisher — big hit', '連段終結 — 重擊'), 650); }
    }
    else if (attackType === 'heavy') { SFX.hit(); toast(bi('Charged heavy — brace impact', '蓄力重擊 — 準備命中'), 700); }
    else if (attackType === 'charged') { SFX.hit(); toast(bi('Charged slam — ground shatter', '蓄力猛擊 — 震裂地面'), 800); }
    else {
      const C = CHR[COMBAT.character];
      const EL = (typeof ELEMENTS !== 'undefined') && C && ELEMENTS[C.element];
      COMBAT.burstCharge = charge >= 3 ? 0 : charge;
      COMBAT.skillCd = 1.2; syncBurstMeter(); SFX.skill();
      showBanner((EL ? EL.name : 'BURST BOND').toUpperCase(), bi(EL ? C.name + ' releases ' + EL.en : '3-hit charge released', EL ? C.name + ' 施放' + EL.zh : '3 次命中充能已釋放'));
      screenPunch(2.8, EL ? EL.color : null);
    }
    COMBAT.lastHit = now;
  }
  function updateAttackCombo(res) {
    if (res.hit) { COMBAT.combo = Math.min(COMBAT_RULES.comboCap, COMBAT.combo + 1); COMBAT.comboTimer = performance.now() / 1000 + COMBAT_RULES.comboWindow; const cb = $('comboBadge'); if (cb) { cb.textContent = COMBAT.combo + ' HIT COMBO'; cb.classList.add('show'); clearTimeout(COMBAT._comboHide); COMBAT._comboHide = setTimeout(() => cb.classList.remove('show'), 1300); } }
  }
  function tickCombat(dt) {
    if (COMBAT.skillCd > 0) COMBAT.skillCd = Math.max(0, COMBAT.skillCd - dt);
    if (COMBAT.hurtCd > 0) COMBAT.hurtCd = Math.max(0, COMBAT.hurtCd - dt);
    syncBurstMeter();
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
        met: COMBAT.metRoster.slice(),
        streak: COMBAT.streak, bestStreak: COMBAT.bestStreak, pity: COMBAT.pity,
        gachaPulls: recruitClaims, trialDraws: COMBAT.trialDraws, daily: COMBAT.daily
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
      COMBAT.metRoster = Array.isArray(c.met) ? c.met.filter(function (id) { return !!CHR[id]; }) : [COMBAT.character];
      if (COMBAT.metRoster.indexOf(COMBAT.character) < 0) COMBAT.metRoster.push(COMBAT.character);
      COMBAT.skin = SKN[c.skin] ? c.skin : 'default';
      COMBAT.crystals = Math.max(0, Number(c.crystals) || 0);
      COMBAT.spentCrystals = Math.max(0, Number(c.spentCrystals) || 0);
      COMBAT.streak = Math.max(0, Number(c.streak) || 0);
      COMBAT.bestStreak = Math.max(COMBAT.streak, Number(c.bestStreak) || 0);
      COMBAT.pity = Math.max(0, Number(c.pity) || 0);
      COMBAT.trialDraws = Math.max(0, Number(c.trialDraws) || 0);
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
    /* returning save with all main objectives already done → boss is present */
    const mains = NODES.filter(n => n.main);
    if (mains.length && mains.every(n => done.has(n.id)) && typeof BOSS !== 'undefined' && WORLD.spawnBoss) {
      WORLD.spawnBoss('tyrant'); WORLD.spawnBoss('golem'); WORLD.spawnBoss('hydra');
    }
    syncParty();
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
      const st = (window.Story && t.main) ? window.Story.forNode(t.id) : null;
      $('qpTag').textContent = st ? window.Story.chapterLabel(t.id) : (t.main ? 'CURRENT OBJECTIVE' : 'SIDE QUEST');
      $('qpName').textContent = st ? (st.client + ' · ' + nodeTitle(t)) : nodeTitle(t);
      $('qpDesc').textContent = st ? (st.objective + ' Press E when you arrive.')
                                   : (nodeDesc(t) + ' Press E when you arrive.');
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

  /* ---------------- boss health readout ---------------- */
  /* The world module owns the boss state machine; the HUD only reads it.
     Keeping the readout here means a designer can retune BOSS_VARIANTS in
     _src/world.js without touching any UI code. */
  const BOSS_HUD_RANGE = 34;      /* metres: hide the bar beyond this */
  let bossHudEl = null;

  function updateBossHUD() {
    if (!bossHudEl) bossHudEl = $('bossHud');
    const el = bossHudEl;
    if (!el) return;
    let list = null;
    try { list = WORLD.getBosses ? WORLD.getBosses() : null; } catch (e) { list = null; }
    const p = WORLD.player ? WORLD.player.position : null;
    let near = null, nearD = 1e9;
    if (list && p) {
      list.forEach(function (b) {
        if (!b.alive) return;
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < nearD) { nearD = d; near = b; }
      });
    }
    const inFight = !!near && nearD <= BOSS_HUD_RANGE && state === STATE.WORLD;
    if (!inFight) { el.classList.remove('show', 'casting', 'hurt'); return; }
    const pct = Math.max(0, Math.min(1, near.hp / Math.max(1, near.maxHp)));
    el.classList.add('show');
    const nm = $('bossName'); if (nm) nm.textContent = near.name;
    const fam = $('bossFamily');
    if (fam) {
      const family = near.id === 'hydra' ? 'covalent' : near.id === 'golem' ? 'ionic' : 'metallic';
      fam.className = 'bossFamily ' + family;
      fam.textContent = family.toUpperCase();
    }
    const fill = $('bossFill'); if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
    const hpTx = $('bossHpText');
    if (hpTx) hpTx.textContent = Math.round(near.hp) + ' / ' + near.maxHp;
    const casting = near.state === 'telegraph' && near.cast > 0;
    el.classList.toggle('casting', casting);
    const cast = $('bossCast');
    if (cast) {
      const win = near.id === 'golem' ? 0.95 : near.id === 'hydra' ? 0.72 : 0.82;
      cast.style.width = casting ? Math.max(0, Math.min(1, near.cast / win)) * 100 + '%' : '0%';
    }
    const stEl = $('bossState');
    if (stEl) stEl.textContent = casting ? 'CHARGING'
      : near.state === 'attack' ? 'STRIKING'
      : near.state === 'recover' ? 'RECOVER'
      : near.state === 'chase' ? 'HUNTING'
      : near.state === 'telegraph' ? 'CHARGING' : 'HOLDING';
    const kick = $('bossKicker');
    if (kick) kick.textContent = nearD < 12 ? 'BOND GUARDIAN · IN RANGE' : 'BOND GUARDIAN';
  }

  /* ---------------- language toggle ---------------- */  function syncLanguageUI() {
    document.body.classList.toggle('lang-zh', isZh());
    const lb = $('langBtn'); if (lb) lb.textContent = isZh() ? '中文' : 'EN';
    document.querySelectorAll('[data-lang-toggle]').forEach(b => { b.textContent = isZh() ? '中文 / EN' : 'EN / 中文'; });
    const ch = $('controlsHint'); if (ch) ch.textContent = bi('WASD move · LMB 4-hit combo · F heavy / hold = charged slam · Shift dash · K burst · E interact', 'WASD 移動 · 左鍵 4 連擊 · F 重擊（長按=蓄力猛擊）· Shift 衝刺 · K 爆發 · E 互動');
    syncBurstMeter();
  }
  function toggleLanguage() {
    LANG = isZh() ? 'en' : 'zh';
    try { localStorage.setItem('bq_lang', LANG); } catch (e) { }
    syncLanguageUI();
    if (state === STATE.DIALOG && dlg) {
      $('npcLine').textContent = (dlg.story && dlg.story.intro) ? dlg.story.intro
        : guided ? bi('Challenge · Classify ' + dlg.c.f, '挑戰 · 分類 ' + dlg.c.f)
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
      p.innerHTML = 'Press <kbd>E</kbd> to talk to ' + n.label.en + ' — classify the compound';
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

  /* ---------------- keyboard Enter = press the on-screen main button ----------------
     Everything in this game is clickable, but a keyboard-only player should never be
     forced to reach for the mouse. Enter presses the primary button of whichever
     panel is open (start screen, any modal, gacha, coach card). */
  function buttonUsable(b) {
    if (!b || b.disabled) return false;
    if (b.getClientRects().length === 0) return false;
    const cs = getComputedStyle(b);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none';
  }
  function pickButton(root, selectors) {
    if (!root) return null;
    for (let i = 0; i < selectors.length; i++) {
      const list = root.querySelectorAll(selectors[i]);
      for (let j = 0; j < list.length; j++) if (buttonUsable(list[j])) return list[j];
    }
    return null;
  }
  const ENTER_BUTTON_PICKS = ['.modalFoot .primary', 'button.primary', '.modalFoot button:last-of-type'];
  function enterPressesPrimary() {
    const ae = document.activeElement;
    /* A focused button already reacts to Enter natively — do not double-fire it. */
    if (ae && ae.tagName === 'BUTTON' && ae.getClientRects().length) return false;
    if (gachaOpen) {
      const card = $('gachaCard');
      if (gachaCurrent && !gachaRevealed && card) { card.click(); return true; }
      const gb = pickButton($('gachaModal'), ['.gachaActions .primary', '.gachaActions button:last-of-type']);
      if (gb) { gb.click(); return true; }
      return false;
    }
    if (coachOn) {
      const nb = $('coachNext');
      if (buttonUsable(nb)) { nb.click(); return true; }
    }
    const start = $('startScreen');
    if (start && start.classList.contains('show')) {
      const sb = pickButton(start, ['#startBtn', 'button.primary']);
      if (sb) { sb.click(); return true; }
    }
    const open = Array.prototype.slice.call(document.querySelectorAll('.modal.show'));
    for (let i = open.length - 1; i >= 0; i--) {
      const b = pickButton(open[i], ENTER_BUTTON_PICKS);
      if (b) { b.click(); return true; }
    }
    return false;
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
    syncParty();
    WORLD.setLocked(false);
    lastFrame = performance.now();
    SESSION.startTime = Date.now();
    logEvent({ type: 'start', mode: introLevel ? 'bond_trial' : openLab ? 'lab' : 'explore' });
    const beginPending = () => {
      if (openLab) openNextLab();
      else {
        WORLD.requestLock();
        /* "Start - learn by playing" is the guided entry point, so it teaches
           every single time it is pressed, even for a player whose old save
           already carries the finished-tutorial flag. Free roam says "skip
           tutorial" on the button, so it honours that and never teaches.
           Help > Replay the tutorial is the way back in either case. */
        if (introLevel) tutStart(true);
      }
    };
    /* Contextual, do-one-action teaching starts in the world. The seven long
       coach slides remain available from Help as an optional reference tour. */
    beginPending();
    /* Open the arc: the prologue chapter card names the world's problem once,
       right after the start screen clears. The tutorial banner is at the
       bottom of the screen, so the two do not collide. */
    if (window.Story && !tutSeen() && announcedChapter < 0) {
      announcedChapter = 0;
      lastChapterId = window.Story.chapters[0].id;
      setTimeout(function () { showChapter(window.Story.chapters[0]); }, 1150);
    }
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
    hideChapter();
    releasePointerForModal();
    const c = COMP[node.compound];
    const kinds = dialogKinds(c);
    if (node.id === 'n9') kinds.push('structure');
    /* Genshin-style safe practice: the training question is a rehearsal, so a wrong
       pick costs nothing - no streak break, no score loss. Without this the very
       first question a new player ever sees punishes them for exploring, which is
       exactly what makes a tutorial feel hostile.
       NOTE: computed BEFORE tutAdvance(), because pressing E at step 4 moves the
       tutorial to step 5 in the same call. */
    const trainingRun = (tutStep === 4 || tutStep === 5);
    dlg = { node, c, step: 0, picks: [], hintUsed: false, wrongSteps: 0, lastAnswer: null, kinds,
      practice: trainingRun };
    if (tutStep === 4) tutAdvance(5);   // training: the player actually pressed E!
    $('npcName').textContent = node.label.en + ' · ' + c.f;
    $('npcAvatar').textContent = c.f.replace(/[₀-₉]/g, '').slice(0, 2);
    /* The narrative layer was already written in story.js but never reached the
       screen: this call site overwrote npcLine with a generic goal line and left
       the `story` variable unused. That is why the quest panel named a chapter
       while the conversation itself had no story in it. */
    const story = (window.Story && node.main) ? window.Story.forNode(node.id) : null;
    dlg.story = story;
    $('npcChapter').textContent = story
      ? window.Story.chapterLabel(node.id) + '  ·  ' + story.role
      : '';
    $('npcChapter').style.display = story ? '' : 'none';
    $('npcLine').className = story ? 'npcLine hasStory' : 'npcLine';
    $('npcLine').textContent = story
      ? story.intro
      : bi('Goal: explain why ' + c.f + ' has this bond type — not just guess its name.',
           '目標：解釋 ' + c.f + ' 點解屬於呢種鍵，而唔只係估名。');
    setState(STATE.DIALOG);
    openModal('dialogModal');
    renderDialogStep();
  }

  /* The question sequence. The F4E brief asks for three questions and then, for a
     COVALENT compound, "___ lone pair(s), ___ bond pair(s)". So a covalent
     compound gets a counting step, and the final node also gets the structure
     question. Ionic and metallic compounds stay at three questions. */
  function dialogKinds(c) {
    const kinds = ['comp', 'ebeh', 'bond'];
    /* Counting pairs only makes sense for a simple molecule. Diamond, graphite and
       C60 are giant covalent structures, so they keep the three-question flow. */
    const GIANT = { diamond: 1, graphite: 1, c60: 1 };
    if (c.pairs && c.bond === 2 && !GIANT[c.id]) kinds.push('pairs');
    return kinds;
  }

  
/* What the LOOK step must actually show. One entry per compound:
   [element symbol, element class]. Single-element substances get exactly one
   card, because there is no second atom to add. */
const ELEMENT_PARTS = {
  nacl: [['Na', 'METAL'], ['Cl', 'NON-METAL']],
  na2o: [['Na', 'METAL'], ['O', 'NON-METAL']],
  mgcl2: [['Mg', 'METAL'], ['Cl', 'NON-METAL']],
  cao: [['Ca', 'METAL'], ['O', 'NON-METAL']],
  mg3n2: [['Mg', 'METAL'], ['N', 'NON-METAL']],
  nh4cl: [['N', 'NON-METAL'], ['H', 'NON-METAL'], ['Cl', 'NON-METAL']],
  h2o: [['O', 'NON-METAL'], ['H', 'NON-METAL']],
  co2: [['C', 'NON-METAL'], ['O', 'NON-METAL']],
  ch4: [['C', 'NON-METAL'], ['H', 'NON-METAL']],
  hcl: [['H', 'NON-METAL'], ['Cl', 'NON-METAL']],
  nh3: [['N', 'NON-METAL'], ['H', 'NON-METAL']],
  bf3: [['B', 'NON-METAL'], ['F', 'NON-METAL']],
  bcl3: [['B', 'NON-METAL'], ['Cl', 'NON-METAL']],
  so2: [['S', 'NON-METAL'], ['O', 'NON-METAL']],
  ph3: [['P', 'NON-METAL'], ['H', 'NON-METAL']],
  al: [['Al', 'METAL']], fe: [['Fe', 'METAL']], na: [['Na', 'METAL']],
  cu: [['Cu', 'METAL']], zn: [['Zn', 'METAL']], au: [['Au', 'METAL']],
  h2: [['H', 'NON-METAL']], o2: [['O', 'NON-METAL']], cl2: [['Cl', 'NON-METAL']],
  diamond: [['C', 'NON-METAL']], graphite: [['C', 'NON-METAL']], c60: [['C', 'NON-METAL']]
};

function chemistryDiagram(c, kind) {
    const f = c.f;
    const formula = '<div class="chemFormula">' + f + '</div>';
    let art = '', caption = '';
    if (kind === 'comp') {
      /* The cards must show the particles that are actually in the formula.
         The old fallback was [f, f], so a single-element metal rendered as
         "Al + Al" - two aluminium atoms of the same element, which is not a
         compound at all and teaches the wrong picture (rubric R1). Elements
         now get ONE card; compounds list their real constituent elements. */
      const parts = ELEMENT_PARTS[c.id] || [[f, c.comp === 3 ? 'METAL' : c.comp === 2 ? 'NON-METAL' : 'METAL']];
      art = '<div class="elementCards p' + parts.length + '">';
      parts.forEach((q, i) => {
        if (i) art += '<i>+</i>';
        art += '<div><b>' + q[0] + '</b><span>' + q[1] + '</span></div>';
      });
      art += '</div>';
      caption = parts.length === 1
        ? bi('One element only: every particle is the same kind of atom.', '只有一種元素：每粒粒子都是同一種原子。')
        : bi('Identify the particles before choosing a bond.', '先認清粒子，再判斷化學鍵。');
    } else if (kind === 'pairs') {
      const p = c.pairs || { sym: '?', lone: 0, bond: 0 };
      /* third field = how many atoms hang off the centre, NOT the bond order.
         O2 has ONE neighbour and TWO bond pairs; the old ['O','O',2] drew a
         central O bonded to two separate O atoms. */
      const links = { h2: ['H', 'H', 1], o2: ['O', 'O', 1], h2o: ['O', 'H', 2], co2: ['C', 'O', 2], ch4: ['C', 'H', 4], cl2: ['Cl', 'Cl', 1], hcl: ['Cl', 'H', 1], nh3: ['N', 'H', 3], bf3: ['B', 'F', 3], bcl3: ['B', 'Cl', 3], ph3: ['P', 'H', 3] }[c.id] || [p.sym, 'X', Math.min(4, p.bond)];
      /* bond pairs per link, so a double bond is drawn as two pairs */
      const perBond = Math.max(1, Math.round((p.bond || 1) / Math.max(1, links[2])));
      const around = [];
      for (let i = 0; i < links[2]; i++) { const a = i * Math.PI * 2 / links[2] - Math.PI / 2; around.push([50 + Math.cos(a) * 31, 51 + Math.sin(a) * 29]); }
      art = '<svg class="moleculeSvg" viewBox="0 0 420 180" role="img" aria-label="Electron pair scaffold"><rect width="420" height="180" rx="16" fill="#0c2026"/>';
      around.forEach((q, i) => {
        const x = 130 + q[0] * 1.1, y = 28 + q[1] * 1.05;
        art += '<line x1="185" y1="82" x2="' + x + '" y2="' + y + '" stroke="#70d8c0" stroke-width="5"/>';
        art += '<circle cx="' + x + '" cy="' + y + '" r="20" fill="#243c54" stroke="#8bded1" stroke-width="2"/><text x="' + x + '" y="' + (y + 6) + '" text-anchor="middle" fill="#efffff" font-size="18">' + links[1] + '</text>';
        const mx = (185 + x) / 2, my = (82 + y) / 2;
        const dx = x - 185, dy = y - 82, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len, px = -uy, py = ux;
        for (let k = 0; k < perBond; k++) {
          const off = (k - (perBond - 1) / 2) * 9;
          art += '<circle cx="' + (mx + ux * 3.2 + px * off) + '" cy="' + (my + uy * 3.2 + py * off) + '" r="3.5" fill="#ffd86a"/>';
          art += '<circle cx="' + (mx - ux * 3.2 + px * off) + '" cy="' + (my - uy * 3.2 + py * off) + '" r="3.5" fill="#77cfff"/>';
        }
      });
      art += '<circle cx="185" cy="82" r="29" fill="#245849" stroke="#a5f5d5" stroke-width="3"/><text x="185" y="89" text-anchor="middle" fill="white" font-weight="700" font-size="24">' + links[0] + '</text>';
      art += '<text x="276" y="48" fill="#ffd86a" font-size="17">● lone pair = 2</text><text x="276" y="82" fill="#a9d9ff" font-size="17">● ● bond pair</text><text x="276" y="119" fill="#a9c9bf" font-size="14">shared between atoms</text><text x="276" y="144" fill="#a9c9bf" font-size="14">double bond = 2 pairs</text></svg>';
      caption = bi('Scaffold only: count every shared region once. A double bond contains TWO bond pairs.', '計數支架：每個共用區域要數；雙鍵含兩對鍵對。');
    } else if (c.bond === 1) {
      art = '<svg class="bondSvg" viewBox="0 0 420 150"><defs><marker id="arrI" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#ffd86a"/></marker></defs><rect width="420" height="150" rx="16" fill="#0c2026"/><circle cx="102" cy="70" r="42" fill="#285276" stroke="#82c8ff" stroke-width="3"/><circle cx="318" cy="70" r="48" fill="#285a47" stroke="#91e9c4" stroke-width="3"/><text x="102" y="78" text-anchor="middle" fill="white" font-size="27">M⁺</text><text x="318" y="78" text-anchor="middle" fill="white" font-size="27">X⁻</text><line x1="157" y1="68" x2="250" y2="68" stroke="#ffd86a" stroke-width="4" marker-end="url(#arrI)"/><text x="204" y="48" text-anchor="middle" fill="#ffd86a" font-size="15">e⁻ transfer</text><text x="210" y="127" text-anchor="middle" fill="#c0d5d0" font-size="14">opposite charges attract in a giant lattice</text></svg>';
      caption = bi('Electrons transfer; the bond is electrostatic attraction between ions.', '電子轉移；離子鍵是正負離子之間的靜電吸引。');
    } else if (c.bond === 3) {
      art = '<svg class="bondSvg" viewBox="0 0 420 150"><rect width="420" height="150" rx="16" fill="#0c2026"/>';
      [[105,48],[210,48],[315,48],[105,105],[210,105],[315,105]].forEach(q => { art += '<circle cx="'+q[0]+'" cy="'+q[1]+'" r="23" fill="#665633" stroke="#ffd86a" stroke-width="2"/><text x="'+q[0]+'" y="'+(q[1]+7)+'" text-anchor="middle" fill="#fff3c2" font-size="20">M⁺</text>'; });
      [[158,48],[263,48],[158,105],[263,105],[60,76],[365,76]].forEach(q => { art += '<circle cx="'+q[0]+'" cy="'+q[1]+'" r="6" fill="#76d9ff"/><text x="'+(q[0]+11)+'" y="'+(q[1]+5)+'" fill="#76d9ff" font-size="13">e⁻</text>'; });
      art += '</svg>'; caption = bi('Positive metal ions sit in a sea of delocalised electrons.', '正金屬離子處於離域電子海中。');
    } else {
      art = '<svg class="bondSvg" viewBox="0 0 420 150"><rect width="420" height="150" rx="16" fill="#0c2026"/><circle cx="128" cy="73" r="45" fill="#244d5a" stroke="#7bdddc" stroke-width="3"/><circle cx="292" cy="73" r="45" fill="#244d5a" stroke="#7bdddc" stroke-width="3"/><text x="128" y="81" text-anchor="middle" fill="white" font-size="24">A</text><text x="292" y="81" text-anchor="middle" fill="white" font-size="24">B</text><ellipse cx="210" cy="73" rx="55" ry="27" fill="#5fd0a833" stroke="#8ff0c8" stroke-width="2"/><circle cx="198" cy="73" r="7" fill="#ffd86a"/><circle cx="222" cy="73" r="7" fill="#76cfff"/><text x="210" y="130" text-anchor="middle" fill="#c0d5d0" font-size="14">one shared pair · one electron from each atom</text></svg>';
      caption = bi('Atoms share pairs; shared electrons are attracted to both nuclei.', '原子共用電子對；共用電子同時受兩個原子核吸引。');
    }
    return '<aside class="chemVisual ' + (kind === 'comp' ? 'isElements' : '') + '">' + formula + '<div class="chemArt">' + art + '</div><div class="chemCaption">' + caption + '</div><div class="chemKey"><span><i class="dotGold"></i> electron</span><span><i class="dotBlue"></i> electron from another atom</span></div></aside>';
  }

  function questionShell(c, kind, content) {
    const total = dlg.kinds.length;
    const objective = { comp: 'LOOK · Identify the elements', ebeh: 'TRACE · Follow the outer electrons', bond: 'CONCLUDE · Name the attraction', pairs: 'COUNT · Account for electron pairs', structure: 'COMPARE · Molecule or giant structure?' }[kind];
    return '<div class="lessonObjective"><span>STEP ' + (dlg.step + 1) + ' / ' + total + '</span><b>' + objective + '</b></div>' +
      '<div class="chemLessonGrid">' + chemistryDiagram(c, kind) + '<section class="chemQuestion">' + content + '</section></div>';
  }

  function renderDialogStep() {
    const _dc = document.querySelector('#dialogModal .modalCard');
    if (_dc) _dc.classList.remove('recapMode');
    const c = dlg.c;
    $('dialogActions').replaceChildren();
    const sets = optionSets(c);
    const kinds = dlg.kinds;
    const kind = kinds[dlg.step];
    const structure = kind === 'structure';
    const pairsStep = kind === 'pairs';
    const total = kinds.length;
    const sym = (c.pairs && c.pairs.sym) || '';
    const stepLabel = isZh() ? ({
      comp: c.f + ' 含有哪類元素？',
      ebeh: c.id === 'nh4cl' ? '固體 NH₄Cl 中的 ions 靠什麼互相吸引？' : c.f + ' 的外層電子 (outer electrons) 會怎樣？',
      bond: '什麼 bond 把 ' + c.f + ' 結合在一起？',
      pairs: '數一數 ' + c.f + ' 一個分子中，' + sym + ' 原子外圍有多少 lone pair(s)、多少 bond pair(s)？',
      structure: 'BF₃ 與 diamond 都有 covalent bonds。兩者結構有何分別？'
    })[kind] : ({
      comp: 'What types of elements are in ' + c.f + '?',
      ebeh: c.id === 'nh4cl' ? 'What holds the ions in solid NH₄Cl together?' : 'What happens to the outer electrons in ' + c.f + '?',
      bond: 'What type of bond holds ' + c.f + ' together?',
      pairs: 'In one molecule of ' + c.f + ', how many lone pairs and bond pairs are around the ' + sym + ' atom?',
      structure: 'BF₃ and diamond both have covalent bonds. What is the difference in structure?'
    })[kind];

    const opts = structure ? [
      { v: 1, en: 'BF₃ forms separate molecules. Diamond is a giant network.', zh: 'BF₃ 形成獨立分子 (separate molecules)；diamond 是 giant covalent network。' },
      { v: 2, en: 'Both form separate molecules because both are covalent.', zh: '兩者都是 covalent，所以都形成獨立分子 (separate molecules)。' },
      { v: 3, en: 'Diamond is a metallic lattice because its structure is giant.', zh: 'Diamond 是 giant structure，所以是 metallic lattice。' }
    ] : pairsStep ? [] : sets[{ comp: 0, ebeh: 1, bond: 2 }[kind]].slice();
    const expected = structure ? 1 : pairsStep ? null : { comp: c.comp, ebeh: c.ebeh, bond: c.bond }[kind];
    if (!pairsStep && c.trap && c.trap.step === dlg.step + 1) {
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

    $('stepDots').innerHTML = kinds.map((k, i) =>
      '<div class="d ' + (i < dlg.step ? 'done' : i === dlg.step ? 'on' : '') + '">' +
      '<i>' + (i + 1) + '</i><span>' + ({ comp: bi('Elements', '元素'), ebeh: bi('Electrons', '電子'), bond: bi('Bond type', '鍵型'), pairs: bi('Electron pairs', '電子對'), structure: bi('Structure', '結構') })[k] + '</span></div>').join('');

    if (pairsStep) {
      /* Electron counting: the player types the two numbers the brief asks for. */
      const pairContent = '<div class="qBlock">' + stepLabel + '</div>' +
        '<div class="qZh">' + bi('Use − / + or type. Then check both counts together.', '用 − / + 或直接輸入，再一次過檢查兩個數目。') + '</div>' +
        '<div class="pairsAsk">' +
        '<label><span>' + bi('LONE PAIRS on ' + sym, sym + ' 的孤對電子') + '<small>not shared</small></span><div class="numberStepper"><button type="button" data-step="pairLone:-1" aria-label="Decrease lone pairs">−</button>' +
        '<input type="number" id="pairLone" min="0" max="8" step="1" inputmode="numeric" autocomplete="off" value="0"><button type="button" data-step="pairLone:1" aria-label="Increase lone pairs">+</button></div></label>' +
        '<label><span>' + bi('BOND PAIRS around ' + sym, sym + ' 周圍的鍵對') + '<small>shared between atoms</small></span><div class="numberStepper"><button type="button" data-step="pairBond:-1" aria-label="Decrease bond pairs">−</button>' +
        '<input type="number" id="pairBond" min="0" max="8" step="1" inputmode="numeric" autocomplete="off" value="0"><button type="button" data-step="pairBond:1" aria-label="Increase bond pairs">+</button></div></label>' +
        '</div><div class="electronTotal" id="electronTotal">0 electrons counted around ' + sym + '</div>' +
        '<button class="primary pairCheck" id="pairGo">' + bi('Check electron count', '檢查電子數目') + '</button>' +
        '<div class="fb" id="dlgFb" role="status" aria-live="polite"></div>';
      $('dialogBody').innerHTML = questionShell(c, kind, pairContent);
      const syncElectronTotal = () => {
        const l = Math.max(0, Number($('pairLone').value) || 0), b = Math.max(0, Number($('pairBond').value) || 0);
        $('electronTotal').textContent = bi((l * 2 + b * 2) + ' electrons around ' + sym + '  =  ' + l + '×2 lone  +  ' + b + '×2 bond', sym + ' 周圍共 ' + (l * 2 + b * 2) + ' 粒電子 ＝ 孤對 ' + l + '×2 ＋ 鍵對 ' + b + '×2');
      };
      $('dialogBody').querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
        const parts = b.dataset.step.split(':'), inp = $(parts[0]);
        inp.value = Math.max(0, Math.min(8, (Number(inp.value) || 0) + Number(parts[1]))); syncElectronTotal();
      }));
      ['pairLone','pairBond'].forEach(id => $(id).addEventListener('input', syncElectronTotal));
      syncElectronTotal();
      const go = $('pairGo');
      go.addEventListener('click', () => checkPairs(c, kinds, total));
      ['pairLone', 'pairBond'].forEach(id => {
        const inp = $(id);
        if (!inp) return;
        inp.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); go.click(); }
        });
      });
      $('dialogBody').insertAdjacentHTML('beforeend', '<div class="kbdHint">' + bi('Tab moves between the boxes · Enter checks', 'Tab 切換輸入格 · Enter 檢查') + '</div>');
      $('dialogHintBtn').style.display = dlg.hintUsed ? 'none' : '';
      $('dialogHintBtn').textContent = bi('Hint', '提示');
      dlg.keyIndex = 0;
      try { $('pairLone').focus({ preventScroll: true }); } catch (e) { }
      $('dialogBody').closest('.modalBody').scrollTop = 0;
      return;
    }

    const questionContent = '<div class="qBlock">' + stepLabel + '</div>' +
      '<div class="qZh">' + bi('Choose the best answer. You will see the reason immediately.', '選最佳答案，之後會即時見到原因。') + '</div>' +
      '<div class="options" id="dlgOpts">' +
      shuffled.map((o, i) =>
        '<button class="opt" data-v="' + o.v + '" data-i="' + i + '"><span class="optLetter">' + String.fromCharCode(65 + i) + '</span><span class="optText">' + textOf(o) + '</span><span class="optArrow">→</span></button>').join('') +
      '</div>' +
      '<div class="fb" id="dlgFb" role="status" aria-live="polite"></div>';
    $('dialogBody').innerHTML = questionShell(c, kind, questionContent);

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
    if (dlg.kinds[dlg.step] === 'pairs' && !dlg.lastAnswer) {
      const go = $('pairGo');
      if (go) { go.click(); return true; }
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
    const c = dlg.c;
    const ok = v === expected;
    const fb = $('dlgFb');
    const optionList = $('dlgOpts');
    optionList.querySelectorAll('.opt').forEach(b => { b.disabled = true; });
    optionList.classList.add('answered');
    optionList.querySelectorAll('.opt').forEach(b => {
      if (Number(b.dataset.v) === expected) b.classList.add('correct');
      else if (b === btn) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    $('dialogBody').querySelector('.qZh').textContent = bi('Answer review · read the reason, then continue.', '答案回顧 · 看懂原因，再繼續。');

    const kind = dlg.kinds[dlg.step];
    const structure = kind === 'structure';
    const ex = structure ? structureExplanation() : explain(c, { comp: 1, ebeh: 2, bond: 3 }[kind]);
    const correctOption = opts.find(o => o.v === expected);
    const chosenOpt = opts.find(o => o.v === v) || { en: '—', zh: '—' };
    const why = structure ? ex : (v === -1 && c.trap) ? c.trap.why : stepWhy(c, { comp: 1, ebeh: 2, bond: 3 }[kind], v);
    if (ok) {
      const reward = awardCorrectStep(REWARD_RULES.stepXp, REWARD_RULES.stepGold);
      SFX.correct();
      answerJuice(btn, reward, false);
      dlg.lastAnswer = { ok, v, expected, opts, ex, why, correctOption, chosenOpt, structure, reward };
    } else {
      SFX.bad();
      dlg.wrongSteps++;
      if (!dlg.practice) breakStreak();
      dlg.lastAnswer = { ok, v, expected, opts, ex, why, correctOption, chosenOpt, structure, reward: null, practice: !!dlg.practice };
    }
    renderDialogFeedback();

    dlg.tries = (dlg.tries || 0) + 1;
    attempts.push({
      type: 'classify', compound: c.f, step: dlg.step + 1, kind,
      chosen: v, correct: ok, hintUsed: dlg.hintUsed, attempt: dlg.tries
    });
    logEvent({ type: 'classify', compound: c.f, step: dlg.step + 1, kind, chosen: v, correct: ok, hintUsed: dlg.hintUsed });

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
    const hasNext = dlg.step < dlg.kinds.length - 1;
    nb.textContent = hasNext ? bi('Next question', '下一題') : bi('Finish challenge', '完成挑戰');
    nb.addEventListener('click', () => {
      if (hasNext) { dlg.step++; dlg.tries = 0; renderDialogStep(); }
      else finishDialog();
    });
    foot.appendChild(nb);
    nb.focus({ preventScroll: true });
  }

  /* Outer-shell electron counts (period 2 and 3 main-group atoms only, which is
     all this game asks about). Used to show the arithmetic in the counting step. */
  const OUTER_SHELL = { H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, Si: 4, P: 5, S: 6, Cl: 7, Br: 7, I: 7, Mg: 2, Na: 1, Ca: 2, Al: 3, Li: 1, K: 1, Be: 2 };

  /* Shared text so the counting question and the dot-and-cross puzzle agree.
     The electron accounting that matters: the central atom's own outer electrons
     split into lone-pair electrons (2 per pair, kept) and bond-pair contributions
     (1 per pair, shared with the other atom). Counting AROUND the atom gives 2 per
     lone pair plus 2 per bond pair. Both numbers are stated so the player can see
     the octet check as well as the accounting. */
  function pairsExplanation(c) {
    const p = c.pairs || { sym: '', lone: 0, bond: 0 };
    const around = p.lone * 2 + p.bond * 2;
    const name = p.sym;
    const outer = OUTER_SHELL[name] === undefined ? null : OUTER_SHELL[name];
    const octet = around === 8 ? ' — a full octet.'
      : around === 6 ? ' — only 6, an incomplete octet. That is why this molecule is unusual.'
        : around === 2 ? ' — a full outer shell for hydrogen, which needs only 2.'
          : '.';
    const en = name + ' has ' + p.lone + ' lone pair(s) and ' + p.bond + ' bond pair(s). ' +
      (outer !== null
        ? 'Account for the ' + outer + ' outer electrons of ' + name + ': ' + (p.lone * 2) + ' stay on ' + name + ' as ' + p.lone + ' lone pair' + (p.lone === 1 ? '' : 's') + ', and ' + p.bond + (p.bond === 1 ? ' electron goes' : ' electrons go') + ' into shared bonds (one per bond) — ' + (p.lone * 2) + ' + ' + p.bond + ' = ' + outer + '. '
        : '') +
      'Counting around ' + name + ': ' + (p.lone * 2) + ' + ' + (p.bond * 2) + ' = ' + around + ' electrons' + octet +
      ' A lone pair is not shared; a bond pair is shared, one dot from each atom.';
    const zh = name + ' 有 ' + p.lone + ' 對 lone pair(s)、' + p.bond + ' 對 bond pair(s)。' +
      (outer !== null
        ? '數一數 ' + name + ' 的 ' + outer + ' 粒外層電子：' + (p.lone * 2) + ' 粒成為 lone-pair 電子，' + p.bond + ' 粒用於共用（每條 bond 出一粒）—— ' + (p.lone * 2) + ' + ' + p.bond + ' = ' + outer + '。'
        : '') +
      '圍繞 ' + name + ' 計算：' + (p.lone * 2) + ' + ' + (p.bond * 2) + ' = ' + around + ' 粒電子' +
      (around === 8 ? '，達到完整 octet。' : around === 6 ? '，只有 6 粒，是 incomplete octet，所以這個分子較特別。' : around === 2 ? '，氫只需 2 粒就滿殼。' : '。') +
      'Lone pair 不共用；bond pair 由兩個原子共用 —— 一邊一點。';
    return { en, zh };
  }

  function checkPairs(c, kinds, total) {
    const p = c.pairs;
    const gotLone = Number(($('pairLone') || {}).value);
    const gotBond = Number(($('pairBond') || {}).value);
    if (!isFinite(gotLone) || !isFinite(gotBond) || ($('pairLone').value === '') || ($('pairBond').value === '')) {
      toast(bi('Type a number in both boxes.', '兩格都要填數字。'), 1800);
      return;
    }
    const ok = gotLone === p.lone && gotBond === p.bond;
    const ex = pairsExplanation(c);
    const correctOption = { en: p.lone + ' lone pair(s) · ' + p.bond + ' bond pair(s)', zh: p.lone + ' 對 lone pair(s) · ' + p.bond + ' 對 bond pair(s)' };
    const chosenOpt = { en: gotLone + ' lone pair(s) · ' + gotBond + ' bond pair(s)', zh: gotLone + ' 對 lone pair(s) · ' + gotBond + ' 對 bond pair(s)' };
    let why;
    if (ok) why = ex;
    else if (gotLone === p.lone) why = { en: 'The lone pairs are right, but re-count the shared pairs: every bond is one shared pair, and each shared pair counts once.', zh: 'Lone pairs 對了，但要重數共用電子對：每條 bond 就是 one shared pair，只計一次。' };
    else if (gotBond === p.bond) why = { en: 'The bond pairs are right, but the lone pairs are not: a lone pair is a pair that is NOT shared — it stays on ' + p.sym + ' only.', zh: 'Bond pairs 對了，但 lone pairs 不對：lone pair 是沒有共用的電子對，只留在 ' + p.sym + ' 上。' };
    else why = { en: 'Count the outer electrons on ' + p.sym + ', then split them: pairs that are shared are bond pairs, the rest are lone pairs. Total must be ' + (p.lone * 2 + p.bond * 2) + '.', zh: '先數 ' + p.sym + ' 的外層電子，再分開：有共用的就是 bond pair，其餘是 lone pair。總數必須是 ' + (p.lone * 2 + p.bond * 2) + '。' };
    const opts = [];
    if (ok) {
      const reward = awardCorrectStep(REWARD_RULES.stepXp, REWARD_RULES.stepGold);
      SFX.correct();
      dlg.lastAnswer = { ok, v: 1, expected: 1, opts, ex, why, correctOption, chosenOpt, structure: false, reward };
    } else {
      SFX.bad();
      dlg.wrongSteps++;
      breakStreak();
      dlg.lastAnswer = { ok, v: 0, expected: 1, opts, ex, why, correctOption, chosenOpt, structure: false, reward: null };
    }
    renderDialogFeedback();
    dlg.tries = (dlg.tries || 0) + 1;
    attempts.push({ type: 'pairs', compound: c.f, step: dlg.step + 1, chosen: gotLone * 10 + gotBond, correct: ok, hintUsed: dlg.hintUsed, attempt: dlg.tries });
    logEvent({ type: 'pairs', compound: c.f, lone: gotLone, bond: gotBond, correct: ok });

    const foot = $('dialogActions');
    foot.replaceChildren();
    $('dialogHintBtn').style.display = 'none';
    if (!ok) {
      const retry = document.createElement('button');
      retry.className = 'ghost';
      retry.textContent = bi('Try again', '再試一次');
      retry.addEventListener('click', () => { renderDialogStep(); });
      foot.appendChild(retry);
    }
    const nb = document.createElement('button');
    nb.className = 'primary';
    nb.style.width = 'auto';
    const hasNext = dlg.step < kinds.length - 1;
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
    fb.innerHTML = a.ok
      ? '<div class="answerKey"><span>' + bi('✓ REASONING LOCKED IN', '✓ 推理正確') + '</span><strong>' + textOf(a.correctOption) + '</strong><p>' + exText + '</p>' + rewardHtml + '</div>'
      : '<div class="answerMiss misconceptionRepair"><span>' + bi('MISCONCEPTION REPAIR', '錯誤觀念修正') + '</span><strong>' + textOf(a.chosenOpt) + '</strong>' + detail + '</div>' +
        '<div class="answerKey"><span>' + bi('✓ THE WORKING RULE', '✓ 正確規則') + '</span><strong>' + textOf(a.correctOption) + '</strong><p>' + exText + '</p></div>';
    if (dlg.c.note && dlg.kinds[dlg.step] === 'bond') {
      fb.innerHTML += '<span class="fbZh" style="margin-top:8px">💡 ' + textOf(dlg.c.note) + '</span>';
    }
  }

  /* The nine main quests are chaptered in story.js but nothing ever announced
     a chapter boundary, so the arc was invisible while playing. When a quest
     closes and the next tracked one opens a new chapter, name it on screen. */
  let lastChapterId = null;
  function chapterForNode(id) {
    if (!window.Story) return null;
    const c = window.Story.chapterFor(id);
    return c ? c : null;
  }
  let pendingChapter = null;
  let announcedChapter = -1;   /* index of the last chapter card the player saw */
  function chapterIndex(ch) { return ch ? window.Story.chapters.indexOf(ch) : -1; }
  /* Announce a chapter card only when the quest tracker moves FORWARD into a
     chapter the player has not been shown yet. Comparing against the last
     announced index (not against the node just finished) stops a side quest
     from replaying a card for a chapter that is already on screen. */
  function chapterTransition() {
    const next = trackedNode();
    if (!next) return;
    const now = chapterForNode(next.id);
    if (!now) return;
    const idx = chapterIndex(now);
    if (idx < 0 || idx <= announcedChapter) return;
    announcedChapter = idx;
    lastChapterId = now.id;
    pendingChapter = now;   /* shown by closeDialog, over the world not the recap */
  }
  /* A chapter card is a world-space announcement: it must never sit on top of a
     question, a recap or the dot-and-cross board. Every modal open clears it. */
  function hideChapter() {
    const el = $('chapterCard');
    if (el) el.classList.remove('show');
  }
  function showChapter(ch) {
    const el = $('chapterCard'); if (!el) return;
    /* A chapter card is an announcement over the world. If the player has a
       question, the recap, the map or the account window open, the moment has
       passed - showing it would just paint text on top of that dialog. */
    if (state !== STATE.WORLD) return;
    if (helpOpen || mapOpen || wpOpen || coachOn) return;
    if (document.querySelector('.modal.show')) return;
    $('chapterKicker').textContent = ch.sub;
    $('chapterTitle').textContent = ch.title;
    $('chapterLine').textContent = ch.line;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 5200);
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
      /* No full-screen banner here: it lands at top:22% and covers the recap
         heading (NaCl = IONIC). The card prints its own PERFECT BOND chip. */
    }
    if (tutStep === 5) tutComplete();   // training: the player finished a whole challenge
    done.add(dlg.node.id); questCelebrate();
    WORLD.setNodeState(dlg.node.id, 'done');
    const bondName = ['', 'IONIC', 'COVALENT', 'METALLIC'][c.bond];
    const pairRecap = dlg.kinds.includes('pairs') && c.pairs ? '<div class="recapStep"><i>4</i><div><b>' + c.pairs.lone + ' lone pair(s) · ' + c.pairs.bond + ' bond pair(s)</b><p>' + textOf(pairsExplanation(c)) + '</p></div></div>' : '';
    $('dialogBody').innerHTML =
      '<div class="challengeComplete' + (perfect ? ' perfect' : '') + '"><span>' + (perfect ? '★ PERFECT BOND' : '✓ CHALLENGE COMPLETE') + '</span><h2>' + c.f + ' = ' + bondName + '</h2><p>' + bi('Here is your full reasoning chain:', '你已完成以下完整推理：') + '</p></div>' +
      (dlg.story && !wasDone ? '<div class="recapStory"><span>' + bi('STORY', '劇情') + ' · ' + dlg.story.client + '</span><p>' + dlg.story.done + '</p><b>✦ ' + dlg.story.reward + '</b></div>' : '') +
      '<div class="recapHead"><span>✓ WHAT YOU LEARNED</span><p>' +
        bi('Four steps, one chain. This is the answer you can reuse on any compound you meet — including ones you have never seen.',
           '四個步驟一條推理鏈。以後遇到任何化合物（包括未見過的）都可以重用。') +
        '</p></div>' +
      '<div class="reasonRecap">' +
      '<div class="recapStep"><i>1</i><div><b>' + textOf(optionSets(c)[0].find(o => o.v === c.comp)) + '</b><p>' + textOf(explain(c, 1)) + '</p></div></div>' +
      '<div class="recapStep"><i>2</i><div><b>' + textOf(optionSets(c)[1].find(o => o.v === c.ebeh)) + '</b><p>' + textOf(explain(c, 2)) + '</p></div></div>' +
      '<div class="recapStep"><i>3</i><div><b>' + bondName + ' BOND</b><p>' + textOf(explain(c, 3)) + '</p></div></div>' + pairRecap + '</div>' +
      (bonus ? '<div class="rewardChip perfect">+' + bonus.xp + ' XP · +' + bonus.gold + ' gold · +' + bonus.crystals + ' crystal</div>' : '') +
      '<div class="recapHandoff"><b>' +
        bi('Copy this chain onto your poster', '把這條推理鏈抄到你的海報') +
        '</b><span>' +
        bi('formula → element types → electron behaviour → bond type → lone / bond pairs',
           '化學式 → 元素類型 → 電子行為 → 鍵型 → 孤對 / 鍵對') +
        '</span></div>' +
      '<div class="recapProgress">' + bi('Main progress: ' + mainDone() + ' / ' + MAIN_TOTAL, '主線進度：' + mainDone() + ' / ' + MAIN_TOTAL) + '</div>';
    $('dialogHintBtn').style.display = 'none';
    /* The recap is the one screen a student photographs for revision, so it gets
       a compact layout: the now-redundant step dots and some breathing room are
       traded for larger type that fits without scrolling. */
    const dialogCard = document.querySelector('#dialogModal .modalCard');
    if (dialogCard) dialogCard.classList.add('recapMode');
    $('dialogActions').replaceChildren();
    $('dialogCloseBtn').textContent = bi('Back to world', '返回世界');
    refreshLocks();
    updateHUD();
    updateCombatHUD();
    if (guided) labCompletionActions($('dialogBody'), closeDialog);
    persist();
    const epilogue = (!wasDone && dlg.node.main && window.Story) ? window.Story.forNode(dlg.node.id) : null;
    if (epilogue) chapterTransition();
    toast(epilogue ? ('✦ ' + epilogue.done + ' <b>' + epilogue.reward + '</b>')
                   : ((dlg.node.main ? '✓ Quest complete! +1 — ' : '✓ Side quest complete — ') + c.f + ' classified'), 3200);
  }

  function closeDialog(next) {
    closeModal('dialogModal');
    if (pendingChapter) { const ch = pendingChapter; pendingChapter = null; setTimeout(function () { if (state === STATE.WORLD) showChapter(ch); }, 420); }
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
    const hk = dlg.kinds[dlg.step];
    const ex = hk === 'structure' ? structureExplanation()
      : hk === 'pairs' ? pairsExplanation(c)
      : explain(c, { comp: 1, ebeh: 2, bond: 3 }[hk]);
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
    hideChapter();
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
      if (tutStep === 5) tutComplete();   // training via a chest works too
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
    const closedId = dcq ? dcq.node.id : null;
    closeModal('dotcrossModal');
    setState(STATE.WORLD);
    $('dcCheckBtn').textContent = bi('Check', '檢查');
    dcq = null;
    updateHUD();
    guided = false;
    if (next === true) return;
    checkAllMainDone();
    if (closedId) chapterTransition();
    if (pendingChapter) { const ch = pendingChapter; pendingChapter = null; setTimeout(function () { if (state === STATE.WORLD) showChapter(ch); }, 420); }
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
    hideChapter();
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
    if (tutStep === 5) tutComplete();   // training via a crystal works too
    WORLD.setNodeState(vocabNode.id, 'done');
    logEvent({ type: 'vocab', term: vocabNode.term });
    closeModal('vocabModal');
    setState(STATE.WORLD);
    chapterTransition();
    if (pendingChapter) { const ch = pendingChapter; pendingChapter = null; setTimeout(function () { if (state === STATE.WORLD) showChapter(ch); }, 420); }
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
    /* Electron accounting is scored separately because it is a different skill:
       counting lone and bond pairs, not naming a bond type. */
    const pairs = { c: 0, t: 0 };
    attempts.forEach(a => {
      const c = COMPOUNDS.find(x => x.f === a.compound);
      if (!c) return;
      if (a.type === 'pairs') { pairs.t++; if (a.correct) pairs.c++; return; }
      const t = c.bond === 1 ? 'ionic' : c.bond === 2 ? 'covalent' : 'metallic';
      byType[t].t++;
      if (a.correct) byType[t].c++;
    });
    byType.pairs = pairs;
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
      ['metallic', 'Metallic', '#c9b36a'],
      ['pairs', 'Lone / bond pairs', '#d6a0e8']
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
    if (by.pairs.t && by.pairs.c / by.pairs.t < 0.75) weak.push('Electron accounting (lone pairs stay on one atom; bond pairs are shared, one electron from each)');
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
      /* The realm's bonds are rewoven — the Rift Tyrant now manifests at the Deep Altar. */
      if (WORLD.bossAlive && !WORLD.bossAlive() && typeof BOSS !== 'undefined') {
        WORLD.spawnBoss();
        showBanner('THE RIFT TYRANT', bi(BOSS.desc + ' It has manifested at the Deep Altar (zone D).', BOSS.zh + '：' + BOSS.desc + '（D 區深晶祭壇）'));
      }
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
    { sel: null, title: '\u2460 What you are playing',
      text: 'Bond Quest is a chemistry game about CHEMICAL BONDING. You are a Bond Smith in a town of glowing spirits. You finish a quest by classifying a compound correctly. That is the whole game.' },
    { sel: '#questPanel', title: '\u2461 ONE goal at a time',
      text: 'This panel is your only instruction: CURRENT OBJECTIVE names the compound, the arrow points where to walk, and the number is the distance in metres. Do what it says and it moves on by itself.' },
    { sel: '#minimap', title: '\u2462 Use the maps',
      text: 'Top right is the mini-map: the white arrow is you, the green ring is your target. Press M for the big map \u2014 drag to pan, scroll to zoom, click any pin to make it your objective.' },
    { sel: null, title: '\u2463 The loop: walk, press E, answer',
      text: 'Walk to a glowing NPC or chest. A prompt appears when you are close \u2014 press E. You then answer three or four questions about the compound: what elements it has, what its electrons do, what bond holds it together, and for molecules how many lone and bond pairs there are. Read the reason after each answer; that is the chemistry lesson.' },
    { sel: '#topbar', title: '\u2464 Every correct answer pays',
      text: 'Correct steps give XP and gold, a clean run pays a PERFECT BOND bonus, and the counter at the top shows how many of the 9 quests you have finished. Spend gold in the Chem Supply Shop (B) on hints and gear.' },
    { sel: '#scorePill', title: '\u2465 Fighting is optional practice',
      text: 'Left-click chains a 4-hit combo (the 4th is a finisher), hold F and release for a charged slam, Shift dashes, K casts your element burst. C swaps character, 1-7 picks one directly. You never have to fight to finish a chemistry quest.' },
    { sel: null, title: '\u2466 Stuck? Press H',
      text: 'H opens the full guide at any time, and it has a button to replay this tour. That is everything \u2014 start walking and the first objective will guide you.' }
  ];
  let coachOn = false, coachIdx = 0, coachAfterStart = null;

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
    /* If the tour was opened by startSession, begin play once it closes. */
    const next = coachAfterStart;
    coachAfterStart = null;
    if (next) setTimeout(next, 120);
  }
  function coachSeen() { try { return !!localStorage.getItem('bq_coach_v2'); } catch (e) { return true; } }

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
  /* The tutorial used to be unreachable once finished: no menu entry, and the
     banner only appeared on a brand-new save. One click brings it back. */
  const helpTutBtn = $('helpTutBtn');
  if (helpTutBtn) helpTutBtn.addEventListener('click', () => {
    closeHelp();
    setTimeout(function () { if (state === STATE.WORLD) { tutStep = 0; tutStart(true); } }, 80);
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
        /* story gate: weapons with quest:'n4' only appear after the Forge Keeper quest is done */
        const questOk = !w.quest || done.has(w.quest);
        const gateOk = questOk && COMBAT.score >= w.scoreReq;
        const afford = COMBAT.gold >= w.gold;
        let label, dis = '';
        if (equipped) { label = 'Equipped'; dis = ' disabled'; }
        else if (owned) { label = 'Equip'; }
        else if (!questOk) { label = '🔒 Clear the Forge quest'; dis = ' disabled'; }
        else if (!gateOk) { label = '🔒 ' + w.scoreReq + ' XP'; dis = ' disabled'; }
        else if (!afford) { label = w.gold + ' gold'; dis = ' disabled'; }
        else { label = 'Buy · ' + w.gold + ' gold'; }
        html += shopCard(w.id, w.name, questOk ? w.desc : 'The Forge Keeper has not yet released this bond-forged arm. Complete their request first.', '⚔ ' + w.damage + ' dmg · ' + w.type.toUpperCase(),
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
      const scrollArt = '<span class="siArt hasImg"><svg viewBox="0 0 48 48" aria-hidden="true">' +
        '<rect x="13" y="9" width="22" height="30" rx="3" fill="#e8dfc6"/>' +
        '<rect x="13" y="9" width="22" height="5" rx="2.4" fill="#c9bda0"/>' +
        '<circle cx="10.5" cy="28" r="4.2" fill="#c9bda0"/><circle cx="37.5" cy="28" r="4.2" fill="#c9bda0"/>' +
        '<path d="M18 20h12M18 25h12M18 30h8" stroke="#8a7c5e" stroke-width="1.6" stroke-linecap="round"/></svg></span>';
      const passArt = '<span class="siArt hasImg"><svg viewBox="0 0 48 48" aria-hidden="true">' +
        '<path d="M9 16h30v16H9z" fill="#8ff0c8"/><path d="M9 16h30v5H9z" fill="#5fd0a8"/>' +
        '<circle cx="33" cy="27" r="4.6" fill="#0b1418" opacity=".35"/>' +
        '<path d="M15 24h9M15 28h6" stroke="#0b1418" stroke-width="1.8" stroke-linecap="round" opacity=".55"/></svg></span>';
      html += '<div class="shopItem">' + scrollArt + '<div class="siBody"><div class="siName">Vocabulary Scroll</div>' +
        '<div class="siDesc">Unlock one random word you have not collected yet (' + left + ' still locked).</div></div>' +
        '<button data-act="term"' + (bal < 1 || left === 0 ? ' disabled' : '') + '>1 shard</button></div>' +
        '<div class="shopItem">' + passArt + '<div class="siBody"><div class="siName">Guild Pass</div>' +
        '<div class="siDesc">Enter the next locked quest location directly, ignoring the requirement.' +
        (freePass > 0 ? ' (You hold ' + freePass + '.)' : '') + '</div></div>' +
        '<button data-act="pass"' + (bal < 2 ? ' disabled' : '') + '>2 shards</button></div>';
    }
    $('shopItems').innerHTML = html;
    $('shopItems').querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => shopAction(btn.dataset.id, btn.dataset.act));
    });
  }

  /* Shop artwork: real 3D renders of the actual weapon mesh or character model,
     produced once by the world and cached. Outfits show their palette instead. */
  function shopArt(id, tab) {
    let thumb = '';
    try { if (WORLD.shopThumb) thumb = WORLD.shopThumb(tab, id) || ''; } catch (e) { thumb = ''; }
    if (thumb) return { cls: ' hasImg', html: '<img class="siImg" alt="" src="' + thumb + '">' };
    let chips = null;
    if (tab === 'skins') {
      try { if (WORLD.skinSwatch) chips = WORLD.skinSwatch(id); } catch (e) { chips = null; }
    }
    if (chips && chips.length) {
      return { cls: ' hasChips', html: '<span class="siChips">' + chips.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>' };
    }
    const glyph = tab === 'gear' ? '⚔' : tab === 'characters' ? '☻' : '✦';
    return { cls: '', html: glyph };
  }

  function shopCard(id, name, desc, meta, gold, scoreReq, owned, equipped, gateOk, label, dis, tab) {
    const gateTag = scoreReq > 0 ? '<span class="siGate' + (gateOk ? ' ok' : '') + '">' + (gateOk ? '✓ ' : '🔒 ') + scoreReq + ' XP</span>' : '';
    const priceTag = gold > 0 ? '<span class="siPrice">' + gold + ' g</span>' : (owned ? '' : '<span class="siPrice free">Free</span>');
    const ownedTag = owned ? '<span class="siOwned">Owned</span>' : '';
    const art = shopArt(id, tab);
    return '<div class="shopItem' + (equipped ? ' equipped' : '') + '" data-kind="' + tab + '">' +
      '<div class="siArt si-' + id + art.cls + '">' + art.html + '</div>' +
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
      if (w.quest && !done.has(w.quest)) { toast('Complete the Forge Keeper\'s quest to release this weapon'); return; }
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
        SFX.unlock(); toast('☻ Unlocked <b>' + c.name + '</b> — ' + c.role + '! They join your party.');
        syncParty();
      }
      COMBAT.character = id;
      /* taking control here counts as "met": leaving later makes them a companion */
      if (COMBAT.metRoster.indexOf(id) < 0) COMBAT.metRoster.push(id);
      WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
      syncParty();
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
    syncParty();
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
    switchToCharacter(next);
  }
  function switchToCharacter(id) {
    const c = CHR[id]; if (!c || COMBAT.characters.indexOf(id) < 0) return;
    const nowMs = performance.now();
    if (nowMs - (COMBAT.lastSwitchMs || 0) < 90) return;
    COMBAT.lastSwitchMs = nowMs;
    COMBAT.character = id;
    if (COMBAT.metRoster.indexOf(id) < 0) COMBAT.metRoster.push(id);
    COMBAT.lightStep = 0;
    WORLD.applyCharacterLook(COMBAT.character, COMBAT.skin);
    syncParty();
    saveCombat(); updateCombatHUD();
    /* visible confirmation: element-coloured burst + ring at the player's feet */
    if (WORLD.characterSwitchFlare) WORLD.characterSwitchFlare(true);
    screenPunch(0.9, (typeof ELEMENTS !== 'undefined' && ELEMENTS[c.element]) ? ELEMENTS[c.element].color : null);
    if (window.SFX && SFX.skill) SFX.skill();
    /* no banner and no toast: switching is meant to be silent and instant —
       the light beam, the element tint and the HUD chip pulse are the feedback */
    const cp = $('charPill');
    if (cp) {
      cp.classList.remove('mo-pop');
      void cp.offsetWidth;
      cp.classList.add('mo-pop');
    }
  }
  /* ---- companion render gate ---------------------------------------------
     Requirement: a character body may only be on screen while the player is
     actively controlling it. Anything else must never be rendered, and that
     has to hold on first load, page refresh, save / cloud-state restoration
     and every background update (shop or gacha unlock, boss respawn, zone
     change).

     WORLD.setParty() is the ONLY thing that puts a non-active character into
     the three.js scene (world.js: setParty -> buildCompanionModel -> scene.add),
     so gating here covers every one of those paths at a single point.

     PARTY_FOLLOW = false is the strict reading of the brief: the world renders
     exactly one body, the one the player switched to. Setting it back to true
     restores the older "the character you left behind follows you" behaviour;
     metRoster still records who has been taken control of, so that switch is a
     one-line change. */
  const PARTY_FOLLOW = false;

  function syncParty() {
    if (!WORLD.setParty || !started) return;
    if (!PARTY_FOLLOW) { WORLD.setParty([]); return; }
    WORLD.setParty(COMBAT.characters.filter(id => id !== COMBAT.character && COMBAT.metRoster.indexOf(id) >= 0));
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
      /* Bond Trial complete: Enter = "Enter Chem Lab" button (#trialContinueBtn) */
      if (introTrial && introTrial.done) {
        const tg = e.target && e.target.tagName;
        if (tg !== 'INPUT' && tg !== 'TEXTAREA') { finishIntroTrial(); e.preventDefault(); return; }
      }
      if (handleDialogEnter() || handleDotCrossEnter()) { e.preventDefault(); return; }
      /* Any other panel: Enter clicks its main button, so no mouse is needed. */
      const tg = e.target && e.target.tagName;
      if (tg !== 'INPUT' && tg !== 'TEXTAREA' && tg !== 'SELECT' && enterPressesPrimary()) {
        e.preventDefault(); return;
      }
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
    if (k === 'f') { COMBAT.heavyAt = performance.now(); return; }
    if (k === 'shift') { WORLD.dashPlayer(); return; }
    if (k === 'k') { playerAttack('burst'); return; }
    if (k === 'c') { cycleCharacter(); return; }
    if (k === 'q') { cycleWeapon(); return; }
    if (k === 'b') { openShop(); return; }
    if (k >= '1' && k <= '7') {
      /* party slot: switch control to the Nth owned character */
      const idx = Number(k) - 1;
      const roster = COMBAT.characters;
      const c = roster[idx];
      /* Switching is silent by design: the beam, the element tint and the HUD
         chip pulse are the feedback. No pop-ups (also no "slot empty" nag). */
      if (c && c !== COMBAT.character) switchToCharacter(c);
    }
  });

  /* release F: a tap is a normal heavy swing, a hold becomes the charged slam */
  window.addEventListener('keyup', e => {
    if (e.key.toLowerCase() !== 'f' || !COMBAT.heavyAt) return;
    const held = (performance.now() - COMBAT.heavyAt) / 1000;
    COMBAT.heavyAt = 0;
    if (!started || paused || state !== STATE.WORLD) return;
    playerAttack(held >= 0.45 ? 'charged' : 'heavy');
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
    /* The chapter card floats above the world at z-index 62, so a card that
       happened to be on screen would sit on top of the account dialog. */
    document.addEventListener('bq:auth-open', () => { hideChapter(); WORLD.setLocked(true); });
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
    window.__bq = { openDialog, openDotCross, openVocab, showSummary, interact, state: () => state, DC, COMP, TERM, NODES, attempts, dialogKinds, openBigMap, openGacha, drawGacha, openDaily, toggleLanguage, startIntroTrial, completeIntroTrial, finishIntroTrial, attack: playerAttack, dash: () => WORLD.dashPlayer(), combat: () => COMBAT, updateBossHUD,
      /* Party-render debugging: the gate in syncParty() must hold on every
         path that can rebuild the scene, so QA can drive those paths. */
      syncParty, applyProgress, switchToCharacter, partyFollow: () => PARTY_FOLLOW,
      tut: { show: tutShow, advance: tutAdvance, complete: tutComplete, step: () => tutStep, hide: tutHide, seen: tutSeen, tick: tickTutorial, look: () => tutLook, moved: () => tutMoved, reset: () => { try { localStorage.removeItem(TUT_KEY); } catch (e) {} } }, getState: () => ({ state, helpOpen, mapOpen, wpOpen }), wp: { list: () => [...unlockedWp], open: openWpList, tp: doTeleport, pop: showTpPop, all: WAYPOINTS, dbg: () => { const c = BM.canvas, r = c.getBoundingClientRect(), wr = $('mapWrap').getBoundingClientRect(); return { cw: c.width, ch: c.height, rw: r.width, rh: r.height, rl: r.left - wr.left, rt: r.top - wr.top, s: bmScale(), zoom: BM.zoom, cx: BM.cx, cz: BM.cz }; } } };
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
      updateBossHUD();
      refreshPrompt();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
