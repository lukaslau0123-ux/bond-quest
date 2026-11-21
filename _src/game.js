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
      <div>
        <div class="qsBox">
          <div class="qsHead">目標 GOAL</div>
          <p class="qsGoal">行遍 4 個地方，完成 <b>9 個任務</b>，你就溫完「離子鍵、共價鍵、金屬鍵」同「點叉圖」。</p>
        </div>

        <div class="qsBox">
          <div class="qsHead">基本規則（只有 3 條）</div>
          <div class="ruleRow"><span class="rn">1</span><span>行到<b>發光嘅人／寶箱／晶石</b>旁邊</span></div>
          <div class="ruleRow"><span class="rn">2</span><span>按鍵盤 <kbd>E</kbd></span></div>
          <div class="ruleRow"><span class="rn">3</span><span>答問題／畫圖 → 完成，左邊進度 +1</span></div>
        </div>
      </div>

      <div class="qsBox">
        <div class="qsHead">最短上手 5 步</div>
        <ol class="qsOl">
          <li>按下面「開始探索」</li>
          <li>睇<b>左邊面板</b>：寫住「分類 NaCl · 26 米 · 西北」</li>
          <li>跟<b>白色箭頭</b>行過去（唔想行就按 <kbd>M</kbd> 睇地圖）</li>
          <li>行到去，畫面中間會出「按 <kbd>E</kbd> 互動」→ 按 E</li>
          <li>答完三步 → 左下角分數 +1，左邊自動轉下一個任務</li>
        </ol>
        <p class="qsGoal" style="margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.09);font-size:12px;color:#9fbcb1">
          <b style="color:#8ff0c8">想快啲？</b>行到藍色錨點按 <kbd>E</kbd> 啟動，之後按 <kbd>M</kbd> 撳錨點或按 <kbd>T</kbd> 傳送。唔識就撳「提示 Hint」。</p>
      </div>
    </div>

    <div class="qsBox">
      <div class="qsHead">兩個實例</div>
      <div class="exRow"><b>① 答問題（搵人）</b>：NaCl 由咩組成？→ 揀「金屬 + 非金屬」→ 電子點做？→「電子轉移」→ 咩鍵？→「離子鍵」</div>
      <div class="exRow"><b>② 畫點叉圖（開寶箱）</b>：揀 <b>•</b> → 點 Cl 旁邊 4 個小點，每個點 2 下 → 按「[ ] 方括號」→ 揀 Na <b>+</b>、Cl <b>−</b> → 按「檢查」</div>
    </div>

    <div class="ctrlRow">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 行</span>
      <span><kbd>空白鍵</kbd> 跳</span>
      <span><kbd>滑鼠</kbd> 轉視角</span>
      <span><kbd>E</kbd> 互動</span>
      <span><kbd>M</kbd> 地圖</span>
      <span><kbd>T</kbd> 傳送</span>
      <span><kbd>H</kbd> 說明</span>
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
    if (n.type === 'npc') return '分類 ' + COMP[n.compound].f;
    if (n.type === 'chest') return '點叉圖 ' + DC[n.dc].compound;
    if (n.type === 'guild') return '冒險者公會';
    if (n.type === 'shop') return '化學商店';
    return '詞彙 ' + TERM[n.term].en;
  }
  function nodeDesc(n) {
    if (n.type === 'npc') return '同「' + n.label.zh + '」對話，答三個步驟：元素組合 → 電子行為 → 鍵型。';
    if (n.type === 'chest') return '打開「' + n.label.zh + '」，畫出 ' + DC[n.dc].compound + ' 的點叉圖。';
    if (n.type === 'guild') return '接受委託、睇晒全部任務同位置，揀下一個目標。';
    if (n.type === 'shop') return '用結晶換提示同解鎖。';
    return '採集晶體，解鎖詞彙「' + TERM[n.term].zh + '」。';
  }
  function shortLabel(n) {
    if (n.type === 'guild') return '公會';
    if (n.type === 'shop') return '商店';
    return nodeTitle(n);
  }
  const BEAR = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
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
    const sub = (n.type === 'crystal' ? '詞彙晶體' : (n.label ? n.label.zh : '')) + (isDone ? ' · 已完成' : '');
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

    let html = '<div class="qpSect">主線 MAIN</div>';
    mains.forEach((n, i) => { html += qpItem(n, i + 1, current); });
    html += '<div class="qpSect">支線 SIDE</div>';
    sides.forEach(n => { html += qpItem(n, '·', current); });
    html += '<div class="qpSect">詞彙 GLOSSARY</div>';
    crys.forEach(n => { html += qpItem(n, '·', current); });
    $('qpList').innerHTML = html;

    $('qpList').querySelectorAll('.qpItem').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (done.has(id)) return;
        trackedId = id;
        lastListSig = '';
        renderQuestPanel();
        toast('已設為目標：' + nodeTitle(NODES.find(x => x.id === id)));
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
      $('qpTag').textContent = '主線完成 · ALL DONE';
      $('qpName').textContent = '所有主線任務完成！';
      $('qpDesc').textContent = '可以繼續探索支線、收集詞彙，或按「↓」匯出數據交功課。';
      $('qpDist').textContent = '—';
      $('qpBear').textContent = '';
      $('qpStep').textContent = '';
      $('qpArrow').style.transform = 'rotate(0deg)';
    } else {
      const p = WORLD.player.position;
      const dx = t.x - p.x, dz = t.z - p.z;
      const dist = Math.hypot(dx, dz);
      const lock = isLockedNode(t);
      $('qpTag').textContent = t.main ? '目前目標 · CURRENT' : '支線目標 · SIDE QUEST';
      $('qpName').textContent = nodeTitle(t);
      $('qpDesc').textContent = nodeDesc(t);
      $('qpDist').textContent = Math.round(dist) + ' m';
      $('qpBear').textContent = '· ' + bearingText(dx, dz);

      const fx = -Math.sin(WORLD.yaw), fz = -Math.cos(WORLD.yaw);
      const rx = Math.cos(WORLD.yaw), rz = -Math.sin(WORLD.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      $('qpArrow').style.transform = 'rotate(' + (ang * 180 / Math.PI) + 'deg)';

      if (lock.locked && freePass > 0) {
        $('qpStep').textContent = '你有公會推薦信 — 可以直接進入';
      } else if (lock.locked) {
        $('qpStep').textContent = '未解鎖：要完成 ' + lock.need + ' 題（目前 ' + correctCount + '）';
      } else if (dist <= (t.ir || 3.6)) {
        $('qpStep').textContent = '已到達 — 按 E ' +
          (t.type === 'npc' ? '對話' : t.type === 'chest' ? '開寶箱' : '採集');
      } else {
        $('qpStep').textContent = '跟住箭頭行，或按 M 睇大地圖路線';
      }
    }
    renderQuestList(t);
  }

  function updateHUD() {
    const Z = ZONES[WORLD.zoneNow];
    $('zoneLabel').textContent = Z.en + ' · ' + Z.zh;
    $('counterNum').textContent = mainDone();
    $('counterTotal').textContent = MAIN_TOTAL;
    const tDone = $('qpTabDone'), tTotal = $('qpTabTotal');
    if (tDone) tDone.textContent = mainDone();
    if (tTotal) tTotal.textContent = MAIN_TOTAL;

    const m = Math.floor(activeTime / 60), s = Math.floor(activeTime % 60);
    $('timerPill').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

    renderQuestPanel();
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
        ? '按 <kbd>E</kbd> 使用傳送錨點 · ' + wpNear.wp.name.zh
        : '按 <kbd>E</kbd> 啟動傳送錨點 · ' + wpNear.wp.name.zh;
      p.classList.add('show');
      return;
    }
    if (!n) { p.classList.remove('show'); return; }
    const lock = isLockedNode(n);
    if (lock.locked) {
      p.innerHTML = '🔒 完成 ' + lock.need + ' 題後解鎖（目前 ' + correctCount + '）';
    } else if (n.type === 'npc') {
      p.innerHTML = '按 <kbd>E</kbd> 與 ' + n.label.zh + ' 對話';
    } else if (n.type === 'chest') {
      p.innerHTML = '按 <kbd>E</kbd> 開啟 ' + n.label.zh;
    } else if (n.type === 'guild') {
      p.innerHTML = '按 <kbd>E</kbd> 進入冒險者公會';
    } else if (n.type === 'shop') {
      p.innerHTML = '按 <kbd>E</kbd> 行入化學商店';
    } else {
      p.innerHTML = '按 <kbd>E</kbd> 採集詞彙晶體';
    }
    p.classList.add('show');
  }

  /* ---------------- modal helpers ---------------- */
  function syncPaused() {
    paused = (state !== STATE.WORLD) || helpOpen || mapOpen || coachOn || shopOpen || guildOpen || beaconOpen || wpOpen || $('glossaryDrawer').classList.contains('show');
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
      { v: 1, en: 'A metal + a non-metal', zh: '金屬 + 非金屬' },
      { v: 2, en: 'Non-metal atoms only', zh: '只有非金屬原子' },
      { v: 3, en: 'Metal atoms only', zh: '只有金屬原子' }
    ];
    const s2 = [
      { v: 1, en: 'Electron transfer', zh: '電子轉移' },
      { v: 2, en: 'Electron sharing', zh: '電子共用' },
      { v: 3, en: 'Delocalised electrons', zh: '電子離域' }
    ];
    const s3 = [
      { v: 1, en: 'Ionic bond', zh: '離子鍵' },
      { v: 2, en: 'Covalent bond', zh: '共價鍵' },
      { v: 3, en: 'Metallic bond', zh: '金屬鍵' }
    ];
    return [s1, s2, s3];
  }

  function explain(c, step) {
    if (step === 1) {
      if (c.comp === 1) return { en: 'One metal + one non-metal: the metal will lose electrons and the non-metal will gain them.', zh: '一種金屬 + 一種非金屬：金屬會失去電子，非金屬會得到電子。' };
      if (c.comp === 2) return { en: 'All the atoms are non-metals, so no atom easily loses electrons — they share electrons instead.', zh: '全部都係非金屬原子，冇一粒會輕易失去電子，所以改為共用電子。' };
      return { en: 'Only metal atoms are present: their valence electrons are free to move through the whole structure.', zh: '只有金屬原子：佢哋嘅價電子可以喺整個結構中自由移動。' };
    }
    if (step === 2) {
      if (c.ebeh === 1) return { en: 'Electrons are transferred from the metal to the non-metal, forming positive and negative ions.', zh: '電子由金屬轉移到非金屬，形成正離子同負離子。' };
      if (c.ebeh === 2) return { en: 'Each atom shares pairs of electrons so both reach a full outer shell.', zh: '每粒原子共用電子對，令雙方都達到完整最外層。' };
      return { en: 'Valence electrons are delocalised into a "sea of electrons" shared by all the metal ions.', zh: '價電子離域成「電子海」，由所有金屬離子共享。' };
    }
    if (c.bond === 1) return { en: 'Oppositely charged ions attract each other electrostatically — that is the ionic bond.', zh: '帶相反電荷嘅離子互相靜電吸引 — 呢個就係離子鍵。' };
    if (c.bond === 2) return { en: 'The shared electron pairs are attracted to both nuclei — that is the covalent bond.', zh: '共用電子對同時被兩個原子核吸引 — 呢個就係共價鍵。' };
    return { en: 'The positive metal ions are held by the delocalised electrons around them — that is the metallic bond.', zh: '正金屬離子被周圍嘅離域電子吸引住 — 呢個就係金屬鍵。' };
  }

  /* ---------------- three-part error feedback ---------------- */
  const NUMC = ['①', '②', '③', '④', '⑤'];

  function wxCard(you, why, rule, title) {
    return '<div class="wx">' +
      (title ? '<div class="wxTitle">' + title + '</div>' : '') +
      '<div class="wxRow"><div class="wxTag you">你的答案<em>YOUR ANSWER</em></div>' +
        '<div class="wxTxt"><span class="wxEn">' + you.en + '</span><span class="wxZh">' + you.zh + '</span></div></div>' +
      '<div class="wxRow"><div class="wxTag why">為何不成立<em>WHY IT FAILS</em></div>' +
        '<div class="wxTxt"><span class="wxEn">' + why.en + '</span><span class="wxZh">' + why.zh + '</span></div></div>' +
      '<div class="wxRow"><div class="wxTag rule">正確規則<em>THE RULE</em></div>' +
        '<div class="wxTxt"><span class="wxEn">' + rule.en + '</span><span class="wxZh">' + rule.zh + '</span></div></div>' +
      '</div>';
  }

  function stepRule(step) {
    if (step === 1) return {
      en: 'Read the formula first: metal + non-metal → electrons are transferred; non-metals only → electrons are shared; metal only → electrons are delocalised.',
      zh: '先看化學式：金屬＋非金屬 → 電子轉移；只有非金屬 → 電子共用；只有金屬 → 電子離域。'
    };
    if (step === 2) return {
      en: 'Electron behaviour follows the composition: transfer for metal + non-metal, sharing for non-metals only, delocalised for metals only.',
      zh: '電子行為由組合決定：金屬＋非金屬＝轉移；非金屬＋非金屬＝共用；只有金屬＝離域。'
    };
    return {
      en: 'The bond type follows the electron behaviour: transfer → ionic bond; sharing → covalent bond; delocalised → metallic bond.',
      zh: '鍵的類型跟隨電子行為：轉移 → 離子鍵；共用 → 共價鍵；離域 → 金屬鍵。'
    };
  }

  function stepWhy(c, step, chosen) {
    const f = c.f;
    if (step === 1) {
      if (c.comp === 1) {
        if (chosen === 2) return {
          en: f + ' contains a metal as well as a non-metal, so "non-metals only" cannot be right.',
          zh: f + ' 入面有金屬，亦有非金屬，所以唔可能係「只有非金屬原子」。'
        };
        return {
          en: f + ' contains a non-metal as well as a metal, so it is not "metal atoms only".',
          zh: f + ' 入面有非金屬，所以唔可能係「只有金屬原子」。'
        };
      }
      if (c.comp === 2) {
        if (chosen === 1) return {
          en: 'There is no metal in ' + f + ' — every atom is a non-metal, so it cannot be metal + non-metal.',
          zh: f + ' 冇金屬，全部原子都係非金屬，所以唔係「金屬＋非金屬」。'
        };
        return {
          en: 'There is no metal atom in ' + f + '; all the atoms are non-metals.',
          zh: f + ' 冇金屬原子，全部都係非金屬。'
        };
      }
      if (chosen === 1) return {
        en: f + ' is a single metal — there is no non-metal in the formula.',
        zh: f + ' 只有一種金屬，化學式入面冇非金屬。'
      };
      return {
        en: 'The atom in ' + f + ' is a metal, not a non-metal.',
        zh: f + ' 係金屬原子，唔係非金屬。'
      };
    }

    if (step === 2) {
      if (c.ebeh === 1) {
        if (chosen === 2) return {
          en: 'In ' + f + ' the metal loses its outer electron(s) and the non-metal gains them. The electron moves completely from one atom to the other — that is transfer, not sharing.',
          zh: f + ' 中金屬失去最外層電子，非金屬得到。電子由一粒原子完全走去另一粒 — 呢個係轉移，唔係共用。'
        };
        return {
          en: 'Delocalisation only happens in a metal lattice. In ' + f + ' the electrons stay with a particular ion, so they are not free to move around.',
          zh: '離域只出現在金屬晶格。' + f + ' 嘅電子固定在某一粒離子身上，唔可以自由走動。'
        };
      }
      if (c.ebeh === 2) {
        if (chosen === 1) return {
          en: 'Both atoms in ' + f + ' are non-metals; neither loses electrons easily, so no complete transfer happens.',
          zh: f + ' 兩邊都係非金屬，冇一粒會輕易失去電子，所以唔會出現完整轉移。'
        };
        return {
          en: 'There is no metal lattice in ' + f + ', so there is no "sea" of delocalised electrons.',
          zh: f + ' 唔係金屬晶格，冇「電子海」，所以冇離域電子。'
        };
      }
      if (chosen === 1) return {
        en: 'The outer electrons in ' + f + ' do not move to a particular atom — they leave their atoms and move through the whole structure.',
        zh: f + ' 嘅最外層電子唔係轉移去某一粒原子，而係離開原子、喺整個結構中自由移動。'
      };
      return {
        en: 'Metals do not form fixed shared pairs; their valence electrons are delocalised.',
        zh: '金屬冇固定嘅共用電子對；佢哋嘅價電子係離域。'
      };
    }

    if (c.bond === 1) {
      if (chosen === 2) return {
        en: 'A covalent bond comes from a shared pair. In ' + f + ' the electrons were transferred to make ions, so the attraction is between ions — not a shared pair.',
        zh: '共價鍵來自共用電子對。' + f + ' 嘅電子係完全轉移，形成離子，所以係離子之間嘅吸引，唔係共用電子對。'
      };
      return {
        en: 'A metallic bond needs a metal lattice with delocalised electrons. ' + f + ' is an ionic lattice.',
        zh: '金屬鍵要有金屬晶格同離域電子。' + f + ' 係離子晶格。'
      };
    }
    if (c.bond === 2) {
      if (chosen === 1) return {
        en: 'An ionic bond needs positive and negative ions. ' + f + ' has no ions — only shared electron pairs.',
        zh: '離子鍵要有正負離子。' + f + ' 冇離子，只有共用電子對。'
      };
      return {
        en: f + ' is not a metal, so there is no electron sea and no metallic bond.',
        zh: f + ' 唔係金屬，冇電子海，所以唔係金屬鍵。'
      };
    }
    if (chosen === 1) return {
      en: 'There are no positive and negative ions in ' + f + '; it is positive metal ions surrounded by delocalised electrons.',
      zh: f + ' 冇正負離子；佢係正金屬離子被離域電子包圍。'
    };
    return {
      en: 'There are no shared pairs in ' + f + '; the valence electrons are delocalised.',
      zh: f + ' 冇共用電子對；價電子係離域。'
    };
  }

  function openDialog(node) {
    const c = COMP[node.compound];
    dlg = { node, c, step: 0, picks: [], hintUsed: false, wrongSteps: 0 };
    $('npcName').textContent = node.label.zh + ' · ' + node.label.en;
    $('npcAvatar').textContent = c.f.replace(/[₀-₉]/g, '').slice(0, 2);
    $('npcLine').textContent = '幫我分類 ' + c.f + '（' + c.zh + '）— 答三個步驟。 Classify ' + c.f + ' in three steps.';
    setState(STATE.DIALOG);
    openModal('dialogModal');
    renderDialogStep();
  }

  function renderDialogStep() {
    const c = dlg.c;
    const sets = optionSets(c);
    const stepLabel = [
      { en: 'Step 1 · Composition', zh: '步驟 1 · 元素組合' },
      { en: 'Step 2 · Electron behaviour', zh: '步驟 2 · 電子行為' },
      { en: 'Step 3 · Bond type', zh: '步驟 3 · 鍵的類型' }
    ][dlg.step];

    let opts = sets[dlg.step].slice();
    const expected = [c.comp, c.ebeh, c.bond][dlg.step];
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

    $('stepDots').innerHTML = [0, 1, 2].map(i =>
      '<div class="d ' + (i < dlg.step ? 'done' : i === dlg.step ? 'on' : '') + '"></div>').join('');

    $('dialogBody').innerHTML =
      '<div class="qBlock">' + stepLabel.en + '</div>' +
      '<div class="qZh">' + stepLabel.zh + '</div>' +
      '<div class="options" id="dlgOpts">' +
      shuffled.map((o, i) =>
        '<button class="opt" data-v="' + o.v + '" data-i="' + i + '">' + o.en +
        '<span class="optZh">' + o.zh + '</span></button>').join('') +
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
      const chosenOpt = opts.find(o => o.v === v) || { en: '—', zh: '—' };
      const why = (v === -1 && c.trap) ? c.trap.why : stepWhy(c, dlg.step + 1, v);
      const rule = stepRule(dlg.step + 1);
      fb.className = 'fb show no';
      fb.innerHTML = '<div class="fbHead">✗ 答錯了 · Not quite — 睇下三個部分</div>' +
        wxCard(chosenOpt, why, rule, '');
      setTimeout(() => { try { fb.scrollIntoView({ block: 'start' }); } catch (e) { } }, 30);
    } else {
      fb.className = 'fb show ok';
      fb.innerHTML = '✓ ' + ex.en + '<span class="fbZh">' + ex.zh + '</span>';
    }
    if (c.note && dlg.step === 2) {
      fb.innerHTML += '<span class="fbZh" style="margin-top:8px">💡 ' + c.note.zh + '</span>';
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
    nb.textContent = dlg.step < 2 ? '下一步 Next' : '完成 Finish';
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
      (perfect ? '★ 完美！你完全掌握咗 ' + c.f + ' 嘅分類。'
               : clean ? '✓ 完成 ' + c.f + '（' + c.zh + '）。用咗提示，記得自己再講一次個理由。'
                       : '✓ 完成 ' + c.f + '（' + c.zh + '）。有步驟答錯過，記得溫習上面嘅解釋。') +
      '<span class="fbZh">已計入主線進度 ' + mainDone() + ' / ' + MAIN_TOTAL + '</span></div>';
    $('dialogHintBtn').style.display = 'none';
    $('dialogCloseBtn').textContent = '返回世界 Back to world';
    refreshLocks();
  }

  function closeDialog() {
    closeModal('dialogModal');
    setState(STATE.WORLD);
    $('dialogCloseBtn').textContent = '離開 Leave';
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
    fb.innerHTML = '提示 Hint：' + ex.en + '<span class="fbZh">' + ex.zh + '（用提示後此題不計完美）</span>';
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
      tool: 'dot', tries: 0, hintUsed: false, hintSlot: null, solved: false
    };
    const q = dcq.q;
    $('dcTitle').textContent = q.compound + ' — Dot-and-cross diagram';
    $('dcSub').textContent = q.type === 'ionic'
      ? '離子化合物：畫出離子嘅最外層電子，加方括號同電荷'
      : '共價化合物：畫出共用電子對（一點一叉）同孤對電子';
    $('dcFeedback').className = 'dcFeedback';
    $('dcFeedback').innerHTML = '';
    $('dcCheckBtn').textContent = '檢查 Check';
    $('dcHow').innerHTML = q.type === 'ionic'
      ? '做法：① 揀 <b>•</b> ② 逐個小點點 <b>2 下</b>（一對電子）③ 按 <b>[ ]</b> 加方括號 ④ 揀電荷（Na<b>+</b>、Cl<b>−</b>）⑤ 按「檢查」'
      : '做法：① 揀 <b>•</b> ② 孤對：同一個小點點 <b>2 下</b> ③ 鍵對：先點 <b>•</b> 再點 <b>×</b> ④ 按「檢查」';
    $('dcToolbar').className = 'dcToolbar' + (q.type === 'ionic' ? ' ionic' : '');
    $('dcToolbar').innerHTML =
      '<button class="toolBtn active" data-tool="dot">• Dot</button>' +
      '<button class="toolBtn" data-tool="cross">× Cross</button>' +
      '<button class="toolBtn" data-tool="erase">⌫ Erase</button>' +
      '<span class="toolSep"></span>' +
      '<span style="font-size:12px;color:#8fb2a6">每對電子要放 2 粒（孤對：同款；鍵對：一•一×）</span>' +
      '<button class="toolBtn ionOnly" id="dcBracketBtn">[ ] 方括號</button>';
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
    });

    slots.forEach((s, si) => {
      const marks = dcq.marks[si] || [];
      svg += '<circle class="slot ' + (dcq.hintSlot === si ? 'slotHint' : '') + '" data-si="' + si + '" data-kind="' + s.kind + '" data-atom="' + (s.atom !== undefined ? s.atom : '') + '" cx="' + s.x + '" cy="' + s.y + '" r="' + (s.kind === 'bond' ? 23 : 18) + '" stroke="rgba(255,255,255,.18)" stroke-width="1"/>';
      if (marks.length === 0) {
        svg += '<circle cx="' + s.x + '" cy="' + s.y + '" r="1.8" fill="rgba(255,255,255,.25)"/>';
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
      extra = '<div style="margin-top:12px;display:flex;gap:18px;flex-wrap:wrap">' +
        atoms.map((a, i) =>
          '<div style="display:flex;align-items:center;gap:5px"><span style="font-size:12.5px;color:#9fc0b6">' + a.sym + ' 電荷:</span>' +
          list.map(v =>
            '<button class="toolBtn" data-ch="' + i + ':' + v + '" style="min-width:34px;height:30px;padding:0 7px;font-size:12.5px' +
            ((dcq.charges[i] || 0) === v ? ';background:rgba(95,208,168,.25);border-color:#5fd0a8;color:#c9ffe8' : '') + '">' +
            (v === 0 ? '0' : v === 1 ? '+' : v === -1 ? '−' : v === 2 ? '2+' : '2−') + '</button>').join('') +
          '</div>').join('') + '</div>';
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
        renderDC();
      });
    });
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
          title: a.sym + ' 的孤對電子 · Lone pairs',
          you: { en: a.sym + ' currently has ' + loneCount[i] + ' lone-pair electron(s) drawn.',
                 zh: a.sym + ' 而家畫咗 ' + loneCount[i] + ' 粒孤對電子。' },
          why: { en: a.sym + ' needs ' + a.lonePairs + ' lone pair' + (a.lonePairs > 1 ? 's' : '') + ' = ' + need + ' electrons' +
                   (a.bondPairs ? ', plus ' + a.bondPairs + ' shared pair' + (a.bondPairs > 1 ? 's' : '') + ' in the bond' + (a.bondPairs > 1 ? 's' : '') : '') +
                   '. Its outer shell therefore holds ' + (need + a.bondPairs * 2) + ' electrons in total.',
                 zh: a.sym + ' 要有 ' + a.lonePairs + ' 對孤對 = ' + need + ' 粒孤對電子' +
                   (a.bondPairs ? '，另外 ' + a.bondPairs + ' 對共用電子對喺鍵上' : '') +
                   '，最外層合共 ' + (need + a.bondPairs * 2) + ' 粒。' },
          rule: { en: 'Only outer-shell electrons are drawn; the number of lone pairs follows from the outer-shell electron count.',
                  zh: '只畫最外層電子；孤對數目由最外層電子數決定，唔可以多畫或少畫。' }
        });
      }
    });

    if (loneMix) errs.push({
      title: '孤對樣式 · Lone-pair symbols',
      you: { en: loneMix + ' lone pair(s) use one dot and one cross.',
             zh: '有 ' + loneMix + ' 對孤對用咗「一點一叉」。' },
      why: { en: 'A lone pair is supplied by ONE atom, so its two electrons are drawn with the same symbol (both dots or both crosses). Only a shared pair mixes the symbols.',
             zh: '孤對由同一粒原子提供，所以兩粒電子用同一種符號（兩點或兩叉）。只有共用電子對才會一點一叉。' },
      rule: { en: 'Lone pair = same symbol. Bond pair = 1 dot + 1 cross.',
              zh: '孤對＝同款符號；鍵對＝1 點＋1 叉。' }
    });

    if (bondShort) errs.push({
      title: '鍵對數目 · Bond pairs',
      you: { en: bondShort + ' shared pair(s) have fewer than 2 electrons.',
             zh: '有 ' + bondShort + ' 對共用電子未畫齊 2 粒。' },
      why: { en: 'A shared pair is made of one electron from each atom — so it always contains 2 electrons.',
             zh: '共用電子對由兩粒原子各出一粒，所以一定有 2 粒電子。' },
      rule: { en: 'Every bond pair must be drawn as 1 dot + 1 cross.',
              zh: '每個鍵對都要畫成 1 點＋1 叉。' }
    });

    if (bondMix) errs.push({
      title: '鍵對樣式 · Bond-pair symbols',
      you: { en: bondMix + ' shared pair(s) use two symbols of the same kind.',
             zh: '有 ' + bondMix + ' 對鍵對用咗兩粒同款符號。' },
      why: { en: 'Two dots would mean one atom supplied both electrons — then it is not a shared pair.',
             zh: '兩粒都係點代表同一粒原子出晒兩粒電子，咁就唔係共用。' },
      rule: { en: 'Every bond pair must be drawn as 1 dot + 1 cross.',
              zh: '每個鍵對都要畫成 1 點＋1 叉。' }
    });

    if (q.type === 'ionic') {
      if (!dcq.bracket) errs.push({
        title: '方括號 · Square brackets',
        you: { en: 'No square brackets are drawn around the ions.',
               zh: '離子未加上方括號。' },
        why: { en: 'In an ionic lattice each ion owns a fixed set of electrons; the brackets show which electrons belong to that ion.',
               zh: '離子晶格中每粒離子有固定嘅電子；方括號表示「呢啲電子屬於呢粒離子」。' },
        rule: { en: 'Draw [ ] around every ion and write its charge at the top right.',
                zh: '每個離子都要用 [ ] 包住，電荷寫在括號右上角。' }
      });
      atoms.forEach((a, i) => {
        const ch = dcq.charges[i] || 0;
        if (ch !== a.charge) {
          errs.push({
            title: a.sym + ' 的電荷 · Charge',
            you: { en: a.sym + ' is labelled ' + fmtC(ch) + '.', zh: a.sym + ' 標成 ' + fmtC(ch) + '。' },
            why: { en: a.sym + ' must be ' + fmtC(a.charge) + ': it has ' +
                     (a.charge > 0 ? 'lost ' + a.charge + ' electron' + (a.charge > 1 ? 's' : '')
                                   : 'gained ' + Math.abs(a.charge) + ' electron' + (Math.abs(a.charge) > 1 ? 's' : '')) + '.',
                   zh: a.sym + ' 應該係 ' + fmtC(a.charge) + '：佢' +
                     (a.charge > 0 ? '失去咗 ' + a.charge + ' 粒電子' : '得到咗 ' + Math.abs(a.charge) + ' 粒電子') + '。' },
            rule: { en: 'Charge = protons − electrons; write it at the top right of the ion.',
                    zh: '電荷＝質子數 − 電子數，寫在離子右上角。' }
          });
        }
      });
      const total = atoms.reduce((sum, a, i) => sum + (dcq.charges[i] || 0), 0);
      if (total !== 0) errs.push({
        title: '整體電荷 · Overall charge',
        you: { en: 'All the ion charges add up to ' + (total > 0 ? '+' : '') + total + '.',
               zh: '所有離子電荷加起來係 ' + (total > 0 ? '+' : '') + total + '。' },
        why: { en: 'A compound is electrically neutral overall, so the positive and negative charges must cancel exactly.',
               zh: '化合物整體唔帶電，所以正負電荷一定要完全抵消。' },
        rule: { en: 'The sum of all ion charges must equal 0.',
                zh: '所有離子電荷相加必須等於 0。' }
      });
    }

    dcq.tries++;
    const ok = errs.length === 0;
    const fb = $('dcFeedback');
    fb.className = 'dcFeedback show';
    setTimeout(() => { try { fb.scrollIntoView({ block: 'start' }); } catch (e) { } }, 30);

    if (ok) {
      dcq.solved = true;
      fb.innerHTML = '<div class="ok">✓ 完全正確！電子數目、位置同電荷全部啱。</div>' +
        '<div style="color:#8fb2a6;font-size:12px;margin-top:6px">' +
        (q.type === 'ionic'
          ? '離子化合物：電子完全轉移，陽離子失去電子、陰離子達到完整最外層，離子有方括號同電荷。'
          : '共價化合物：每對共用電子都係 1 點 + 1 叉；孤對電子留喺所屬原子，唔係共用。') +
        '</div>';
      correctCount++;
      nodeCorrect.set(dcq.node.id, true);
      done.add(dcq.node.id);
      WORLD.setNodeState(dcq.node.id, 'done');
      $('dcCheckBtn').textContent = '返回世界 Done';
      logEvent({ type: 'dotcross', compound: q.compound, correct: true, attempt: dcq.tries, hintUsed: dcq.hintUsed });
      refreshLocks();
      updateHUD();
    } else {
      const MAXW = 2;
      fb.innerHTML = '<div class="bad">✗ 仲有 ' + errs.length + ' 個問題 · ' + errs.length + ' issue' + (errs.length > 1 ? 's' : '') + '</div>' +
        errs.slice(0, MAXW).map((e, i) => wxCard(e.you, e.why, e.rule, NUMC[i] + ' ' + e.title)).join('') +
        (errs.length > MAXW ? '<div class="wxRest"><b>另外 ' + (errs.length - MAXW) + ' 項要改：</b>' +
          errs.slice(MAXW).map(e => e.title.split(' · ')[0]).join('、') + '</div>' : '') +
        (dcq.tries >= 3 ? '<div style="color:#ffb0a0;margin-top:10px">已到 3 次上限 — 撳「提示」睇正確做法，或者離開去問 NPC 溫習概念。</div>' : '');
      setTimeout(() => { try { fb.scrollIntoView({ block: 'start' }); } catch (e) { } }, 30);
      logEvent({ type: 'dotcross', compound: q.compound, correct: false, attempt: dcq.tries, errors: errs.length, hintUsed: dcq.hintUsed });
    }
    attempts.push({ type: 'dotcross', compound: q.compound, correct: ok, attempt: dcq.tries, hintUsed: dcq.hintUsed });
  }

  function closeDC() {
    closeModal('dotcrossModal');
    setState(STATE.WORLD);
    $('dcCheckBtn').textContent = '檢查 Check';
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
    $('dcCheckBtn').textContent = '檢查 Check';
    renderDC();
    $('dcFeedback').className = 'dcFeedback';
  });
  $('dcHintBtn').addEventListener('click', () => {
    if (!dcq) return;
    dcq.hintUsed = true;
    const q = dcq.q;
    let target = -1;
    dcq.slots.forEach((s, si) => {
      if (target === -1 && (dcq.marks[si] || []).length < 2) target = si;
    });
    dcq.hintSlot = target;
    renderDC();
    const fb = $('dcFeedback');
    fb.className = 'dcFeedback show';
    fb.innerHTML = '<div style="color:#ffdc78">提示：' + q.hint.en + '</div>' +
      '<div style="color:#8fb2a6;font-size:12px;margin-top:4px">' + q.hint.zh + '</div>';
  });

  /* ================= VOCAB ================= */
  let vocabNode = null;
  function openVocab(node) {
    vocabNode = node;
    const t = TERM[node.term];
    $('vocabTerm').textContent = t.en;
    $('vocabZh').textContent = t.zh;
    $('vocabDef').innerHTML = t.def.en + '<br><span style="color:#8fb2a6;font-size:13px">' + t.def.zh + '</span>';
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
    toast('已收集詞彙：<b>' + TERM[vocabNode.term].en + '</b>');
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
      stat('完成題目 Objectives', mainDone() + ' / ' + MAIN_TOTAL) +
      stat('總正確率 Accuracy', pct + '%') +
      stat('用時 Time', Math.floor(activeTime / 60) + ' 分 ' + Math.floor(activeTime % 60) + ' 秒') +
      stat('詞彙收集 Glossary', done.size >= 0 ? countCollected() + ' 個' : '0') +
      stat('傳送錨點 Waypoints', unlockedWp.size + ' / ' + WAYPOINTS.length);

    const rows = [
      ['ionic', '離子鍵 Ionic', '#6fb8e8'],
      ['covalent', '共價鍵 Covalent', '#5fd0a8'],
      ['metallic', '金屬鍵 Metallic', '#c9b36a']
    ];
    $('sumBars').innerHTML = rows.map(([k, label, col]) => {
      const d = by[k];
      const p = d.t ? Math.round(d.c / d.t * 100) : 0;
      return '<div class="barRow"><div class="barTop"><span>' + label + '</span><span>' + d.c + '/' + d.t + ' · ' + p + '%</span></div>' +
        '<div class="barTrack"><div class="barFill" style="width:' + p + '%;background:' + col + '"></div></div></div>';
    }).join('');

    const weak = [];
    if (by.ionic.t && by.ionic.c / by.ionic.t < 0.75) weak.push('離子鍵（記得加方括號同電荷，電子要完全轉移）');
    if (by.covalent.t && by.covalent.c / by.covalent.t < 0.75) weak.push('共價鍵（鍵對要 1 點 + 1 叉，孤對唔係共用）');
    if (by.metallic.t && by.metallic.c / by.metallic.t < 0.75) weak.push('金屬鍵（電子係離域，唔係轉移）');
    $('sumWeak').innerHTML = weak.length
      ? '<b>建議再溫：</b> ' + weak.join('；') + '。可以開詞彙表睇定義。'
      : '<b>做得好！</b> 三種鍵都掌握得唔錯。可以挑戰晶體洞窟嘅陌生化合物。';

    const mins = activeTime / 60;
    $('sumFootNote').textContent = '建議遊玩時間 6–10 分鐘：你用咗 ' + mins.toFixed(1) +
      ' 分鐘' + (mins < 6 ? '，可以再慢慢睇多啲解釋。' : mins > 10 ? '，唔使急，可以分幾次溫。' : '，節奏好好。') +
      '　數據只存喺你部機，唔會上傳。';

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
    toast('已重設標記設定');
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
    { sel: '#questPanel', title: '① 左邊係你嘅任務', text: '話你知而家要做乜、距離幾遠、邊個方向。跟住佢做就得。' },
    { sel: '#minimap', title: '② 右上係小地圖', text: '白色箭頭係你，綠圈係目標，虛線就係路線。' },
    { sel: '#topbar', title: '③ 上面係進度', text: '「0 / 9」代表完成咗幾多個任務。按 M 開大地圖，按 ? 再睇說明。' },
    { sel: null, title: '④ 行到目標，按 E', text: '行近發光嘅人／寶箱／晶石，畫面中間會出現「按 E 互動」，跟住按鍵盤 E。' },
    { sel: '#qpWpBtn', title: '⑤ 傳送錨點', text: '行到藍色錨點按 E 啟動。之後按 T 或者呢個掣，就可以喺已啟動嘅錨點之間快速移動。' }
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
    $('coachNext').textContent = coachIdx === COACH_STEPS.length - 1 ? '開始玩' : '下一步';

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
    try { localStorage.setItem('bq_coach_v1', '1'); } catch (e) { }
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
    toast('⟡ 傳送錨點已啟動：' + w.name.zh + '<br><span style="font-size:11.5px;color:#8fb2a6">之後按 M 開地圖，撳藍色錨點就可以傳送</span>', 3600);
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
        '<div class="wpBody"><div class="wpName">' + w.name.zh + '<em>' + w.name.en + '</em></div>' +
        '<div class="wpSub">' + Z.zh + ' · ' + (here ? '你而家喺呢度' : on ? '已啟動' : '未啟動 — 行到現場按 E') + '</div></div>' +
        '<div class="wpDist">' + d + ' m</div>' +
        (here ? '<button disabled>此處</button>'
          : '<button data-go="' + w.id + '"' + (on ? '' : ' disabled') + '>傳送</button>') +
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
    if (!unlockedWp.has(w.id)) { toast('呢個錨點仲未啟動 — 要行到現場按 E'); return; }
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
        toast('⟡ 已傳送到 ' + w.name.zh + ' · ' + ZONES[w.zone].zh, 2600);
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
        mapLabel(ctx, w.name.zh, bmX(w.x), bmY(w.z) - 26, false, boxes);
      });
    }

    if (t && tLabel) mapLabel(ctx, nodeTitle(t), tLabel.x, tLabel.y, true, null);
    mapLabel(ctx, '你 YOU', bmX(p.x), bmY(p.z) + 34, false, boxes);

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
    $('tpName').textContent = w.name.zh;
    $('tpMeta').className = 'tpMeta' + (on ? ' on' : '');
    $('tpMeta').textContent = ZONES[w.zone].zh + ' · ' + d + ' m · ' +
      (on ? '已啟動，可以傳送' : '未啟動 · 要行到現場按 E');
    const go = $('tpGo');
    go.disabled = !on;
    go.textContent = on ? '傳送' : '未啟動';

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
      if (done.has(hit.id)) { toast('呢個點已經完成咗'); return; }
      trackedId = hit.id;
      lastListSig = '';
      renderQuestPanel();
      drawBigMap();
      toast('已設為目標：' + nodeTitle(hit));
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
        '<div><span class="t">' + g.en + '</span><span class="z">' + g.zh + '</span></div>' +
        '<div class="d">' + (unlocked ? g.def.en : '🔒 去世界搵晶體解鎖') + '</div>' +
        (unlocked ? '<div class="d zh">' + g.def.zh + '</div>' : '') + '</div>';
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
    const bal = shardBalance();
    const left = GLOSSARY.filter(g => !termUnlocked(g.id)).length;
    $('shopShards').textContent = bal;
    $('shopItems').innerHTML =
      '<div class="shopItem"><div class="siBody">' +
        '<div class="siName">詞彙卷軸</div>' +
        '<div class="siDesc">隨機解鎖一個未收集嘅詞彙（仲有 ' + left + ' 個未解鎖）。</div></div>' +
        '<button id="buyTerm"' + (bal < 1 || left === 0 ? ' disabled' : '') + '>1 結晶</button></div>' +
      '<div class="shopItem"><div class="siBody">' +
        '<div class="siName">公會推薦信</div>' +
        '<div class="siDesc">可以直接進入下一個「未解鎖」嘅任務點，無視門檻。' +
        (freePass > 0 ? '（持有 ' + freePass + ' 張）' : '') + '</div></div>' +
        '<button id="buyPass"' + (bal < 2 ? ' disabled' : '') + '>2 結晶</button></div>';
    const b1 = $('buyTerm'); if (b1) b1.addEventListener('click', buyTerm);
    const b2 = $('buyPass'); if (b2) b2.addEventListener('click', buyPass);
  }

  function buyTerm() {
    if (shardBalance() < 1) { toast('結晶不足'); return; }
    const pool = GLOSSARY.filter(g => !termUnlocked(g.id));
    if (!pool.length) { toast('全部詞彙已解鎖'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    boughtTerms.add(pick.id);
    shardsSpent += 1;
    refreshGlossary();
    renderShop();
    updateHUD();
    toast('解鎖詞彙：' + pick.en + ' ' + pick.zh);
  }

  function buyPass() {
    if (shardBalance() < 2) { toast('結晶不足'); return; }
    shardsSpent += 2;
    freePass += 1;
    renderShop();
    toast('已購買公會推薦信（' + freePass + ' 張）');
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

  function renderGuild() {
    const p = WORLD.player.position;
    const cur = trackedNode();
    let html = '';
    ['A', 'B', 'C', 'D'].forEach(k => {
      const Z = ZONES[k];
      const list = NODES.filter(n => n.zone === k && n.type !== 'crystal');
      if (!list.length) return;
      html += '<div class="guildZone">' + Z.zh + ' · ' + Z.en + '</div>';
      list.forEach(n => {
        const isDone = done.has(n.id);
        const lock = isLockedNode(n);
        const d = Math.round(Math.hypot(n.x - p.x, n.z - p.z));
        const cls = 'guildRow' + (isDone ? ' done' : '') + (lock.locked && !isDone ? ' lock' : '') + (cur && cur.id === n.id ? ' cur' : '');
        html += '<div class="' + cls + '" data-id="' + n.id + '">' +
          '<div class="grIcon">' + (isDone ? '✓' : lock.locked ? '!' : '›') + '</div>' +
          '<div class="grBody"><div class="grName">' + nodeTitle(n) + '</div>' +
          '<div class="grSub">' + (n.label ? n.label.zh : '') +
          (isDone ? ' · 已完成' : lock.locked ? ' · 需完成 ' + lock.need + ' 題' : '') + '</div></div>' +
          '<div class="grDist">' + d + ' m</div></div>';
      });
    });
    $('guildBody').innerHTML = html;
    $('guildBody').querySelectorAll('.guildRow').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (done.has(id)) { toast('呢個委託已完成'); return; }
        trackedId = id;
        lastListSig = '';
        renderQuestPanel();
        closeGuild();
        toast('已接受委託：' + nodeTitle(NODES.find(x => x.id === id)));
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
    persist();
    download('bondquest_session.json', JSON.stringify(SESSION, null, 2), 'application/json');
    const rows = [['type', 'compound', 'step', 'chosen', 'correct', 'hintUsed', 'attempt']];
    attempts.forEach(a => rows.push([a.type, a.compound, a.step || '', a.chosen !== undefined ? a.chosen : '', a.correct ? 1 : 0, a.hintUsed ? 1 : 0, a.attempt || 1]));
    const csv = rows.map(r => r.join(',')).join('\n');
    setTimeout(() => download('bondquest_attempts.csv', '\ufeff' + csv, 'text/csv'), 500);
    toast('已匯出 JSON + CSV — 交功課時可作 pilot record 證據');
  }
  function download(name, text, mime) {
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
    } catch (e) { toast('匯出失敗：' + e.message); }
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
    if (done.has(n.id)) { toast('呢個點已經完成咗'); return; }
    const lock = isLockedNode(n);
    if (lock.locked) {
      if (freePass > 0) {
        freePass--;
        toast('使用公會推薦信 — 直接進入');
      } else {
        toast('🔒 完成 ' + lock.need + ' 題先解鎖（目前 ' + correctCount + '）');
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
      if (coachOn) { coachEnd(); return; }
      if (wpOpen) { closeWpList(); return; }
      if (beaconOpen) { closeBeacon(); return; }
      if (shopOpen) { closeShop(); return; }
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
  });

  /* ================= BOOT / LOOP ================= */
  function boot() {
    loadBeaconCfg();
    WORLD.init($('scene'));
    // 觸控「E 互動」按鈕：與鍵盤 E 走同一個入口
    WORLD.setInteractHandler(function () {
      if (helpOpen || mapOpen || wpOpen || shopOpen || guildOpen || beaconOpen) return;
      interact();
    });
    loadWaypoints();
    WORLD.onZoneChange = k => {
      const Z = ZONES[k];
      toast('進入 ' + Z.zh + ' · ' + Z.en);
      if (!SESSION.exploration.zonesVisited.includes(k)) SESSION.exploration.zonesVisited.push(k);
      persist();
    };
    initBigMap();
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

    $('startBtn').addEventListener('click', () => {
      $('startScreen').classList.remove('show');
      started = true;
      lastFrame = performance.now();
      SESSION.startTime = Date.now();
      logEvent({ type: 'start' });
      WORLD.requestLock();
      let seenCoach = false;
      try { seenCoach = !!localStorage.getItem('bq_coach_v1'); } catch (e) { }
      if (!seenCoach) setTimeout(() => coachShow(0), 500);
      if (!storeOk) setTimeout(() => toast('⚠️ 瀏覽器封鎖咗本機儲存，進度唔會自動保存 — 記得用「↓」匯出數據。', 5000), 1200);
      toast('跟住左邊任務面板嘅箭頭行，到咗按 E 互動');
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
