/* ============================================================
   Bond Quest — 本機帳號系統 (local account system)

   設計要點
   - 密碼：PBKDF2-SHA256（180,000 次）→ 32 bytes verifier 儲存，永不存明文
   - 進度：同一條 PBKDF2 派生 32 bytes AES-GCM key，資料以 AES-256-GCM 加密後才寫入
   - 會話：預設存 sessionStorage（重新整理仍登入，關閉瀏覽器即登出）
           勾「保持登入」才寫 localStorage
   - 訪客：未登入時用獨立 slot，同帳號資料完全分開

   限制（會在 UI 明講）：只在同一個瀏覽器、同一部裝置有效，不會跨裝置同步。
   ============================================================ */

const AUTH = (function () {
  'use strict';

  const STORE_KEY = 'bq_accounts_v1';
  const SESS_KEY = 'bq_session_v1';
  const KEEP_KEY = 'bq_session_keep_v1';
  const GUEST_KEY = 'bq_guest_v1';
  const ITERS = 180000;

  let hook = null;        // { snapshot, apply }
  let user = null;        // { email, name, id }
  let aesKey = null;      // CryptoKey
  let rawKey = null;      // Uint8Array(32)
  let saveTimer = null;
  let mode = 'login';
  let busy = false;
  let ready = null;

  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------------- encoding ---------------- */
  function b64(buf) {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  /* ---------------- crypto ---------------- */
  async function derive(pw, salt, iters) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt, iterations: iters, hash: 'SHA-256' }, base, 512
    );
    const u = new Uint8Array(bits);
    return { verifier: u.slice(0, 32), keyRaw: u.slice(32, 64) };
  }
  function importAes(raw) {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(key, data) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(data.iv) }, key, unb64(data.ct)
    );
    return JSON.parse(dec.decode(new Uint8Array(pt)));
  }

  /* ---------------- store ---------------- */
  function readStore() {
    try {
      const j = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (j && j.accounts) return j;
    } catch (e) { }
    return { v: 1, accounts: {} };
  }
  function writeStore(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }

  /* ---------------- validation ---------------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

  function checkEmail(v) {
    if (!v) return '請輸入電郵';
    if (v.length > 120) return '電郵太長';
    if (!EMAIL_RE.test(v)) return '電郵格式唔啱，例如 you@example.com';
    return '';
  }
  function checkPw(v) {
    if (!v) return '請輸入密碼';
    if (v.length < 8) return '密碼至少要 8 個字元';
    if (v.length > 72) return '密碼唔可以超過 72 個字元';
    if (!/[A-Za-z]/.test(v)) return '密碼要包含英文字母';
    if (!/[0-9]/.test(v)) return '密碼要包含數字';
    return '';
  }
  function checkName(v) {
    const n = (v || '').trim();
    if (!n) return '請輸入顯示名稱';
    if (n.length < 2) return '名稱最少 2 個字';
    if (n.length > 12) return '名稱最多 12 個字';
    if (/[<>]/.test(n)) return '名稱唔可以有 < 或 >';
    return '';
  }

  /* ---------------- session ---------------- */
  function saveSession(remember) {
    const payload = JSON.stringify({ email: user.email, k: b64(rawKey), at: Date.now() });
    try {
      if (remember) {
        localStorage.setItem(KEEP_KEY, payload);
        sessionStorage.removeItem(SESS_KEY);
      } else {
        sessionStorage.setItem(SESS_KEY, payload);
        localStorage.removeItem(KEEP_KEY);
      }
    } catch (e) { /* 私隱模式下可能失敗，不影響本次使用 */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESS_KEY); } catch (e) { }
    try { localStorage.removeItem(KEEP_KEY); } catch (e) { }
  }
  function readSession() {
    const raw = (function () {
      try { return sessionStorage.getItem(SESS_KEY) || localStorage.getItem(KEEP_KEY); }
      catch (e) { return null; }
    })();
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      if (!j || !j.email || !j.k) return null;
      if (Date.now() - (j.at || 0) > 90 * 24 * 3600 * 1000) return null; // 90 日後失效
      return j;
    } catch (e) { return null; }
  }

  /* ---------------- account ops ---------------- */
  function pub(acc) { return { email: acc.email, name: acc.name, id: acc.id }; }

  async function register(emailIn, pw, nameIn) {
    const email = emailIn.trim().toLowerCase();
    const store = readStore();
    if (store.accounts[email]) {
      const err = new Error('呢個電郵已經註冊咗');
      err.field = 'email';
      throw err;
    }
    const salt = rand(16);
    const { verifier, keyRaw: kr } = await derive(pw, salt, ITERS);
    const acc = {
      id: 'u_' + b64(rand(8)).replace(/[+/=]/g, '').slice(0, 10),
      email: email,
      name: nameIn.trim(),
      salt: b64(salt),
      verifier: b64(verifier),
      iters: ITERS,
      createdAt: Date.now(),
      lastLogin: Date.now(),
      data: null,
    };
    store.accounts[email] = acc;
    writeStore(store);

    user = pub(acc);
    rawKey = kr;
    aesKey = await importAes(kr);
    return { account: acc, hasData: false };
  }

  async function login(emailIn, pw, remember) {
    const email = emailIn.trim().toLowerCase();
    const store = readStore();
    const acc = store.accounts[email];
    if (!acc) {
      const err = new Error('搵唔到呢個帳號');
      err.field = 'email';
      throw err;
    }
    const { verifier, keyRaw: kr } = await derive(pw, unb64(acc.salt), acc.iters || ITERS);
    if (!sameBytes(verifier, unb64(acc.verifier))) {
      const err = new Error('密碼唔正確');
      err.field = 'pw';
      throw err;
    }
    user = pub(acc);
    rawKey = kr;
    aesKey = await importAes(kr);
    saveSession(!!remember);

    acc.lastLogin = Date.now();
    writeStore(store);

    let data = null;
    if (acc.data) {
      try { data = await unseal(aesKey, acc.data); }
      catch (e) { data = null; }
    }
    return { account: acc, hasData: !!data, data: data };
  }

  function logout() {
    flushSave();
    clearSessionCache();
    clearSession();
    user = null; aesKey = null; rawKey = null;
    render();
  }

  /* ---------------- progress ---------------- */
  function emptyGuest() { return null; }

  async function loadForCurrent() {
    if (user) {
      const store = readStore();
      const acc = store.accounts[user.email];
      if (!acc || !acc.data) return null;
      try { return await unseal(aesKey, acc.data); } catch (e) { return null; }
    }
    try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { return null; }
  }

  async function saveNow() {
    if (!hook) return;
    let payload;
    try { payload = hook.snapshot(); } catch (e) { return; }
    if (!payload) return;
    payload.savedAt = Date.now();
    if (user && aesKey) {
      try {
        const sealed = await seal(aesKey, payload);
        const store = readStore();
        const acc = store.accounts[user.email];
        if (!acc) return;
        acc.data = sealed;
        acc.updatedAt = Date.now();
        writeStore(store);
      } catch (e) { /* 加密失敗不應阻塞遊戲 */ }
    } else {
      try { localStorage.setItem(GUEST_KEY, JSON.stringify(payload)); } catch (e) { }
    }
  }

  function queueSave() {
    if (!hook) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, 700);
  }
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveNow();
  }
  function clearSessionCache() {
    clearTimeout(saveTimer); saveTimer = null;
  }

  /* ---------------- UI ---------------- */
  function toast(msg) {
    document.dispatchEvent(new CustomEvent('bq:toast', { detail: { msg: msg } }));
  }
  function setErr(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }
  function clearErrs() {
    ['errName', 'errEmail', 'errPw', 'errPw2'].forEach(function (id) { setErr(id, ''); });
    const m = $('authMsg');
    if (m) { m.textContent = ''; m.className = 'authMsg'; }
  }
  function msg(text, kind) {
    const m = $('authMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'authMsg' + (text ? ' show ' + (kind || 'err') : '');
  }
  function setMode(next) {
    mode = next;
    document.querySelectorAll('#authTabs .authTab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const reg = mode === 'register';
    $('rowName').style.display = reg ? '' : 'none';
    $('rowPw2').style.display = reg ? '' : 'none';
    $('rowKeep').style.display = reg ? 'none' : '';
    $('authPw').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    $('authSubmit').textContent = reg ? '建立帳號' : '登入';
    clearErrs();
  }

  function render() {
    const guest = !user;
    const gv = $('authGuestView'), uv = $('authUserView');
    if (gv) gv.style.display = guest ? '' : 'none';
    if (uv) uv.style.display = guest ? 'none' : '';
    const btn = $('authBtn');
    if (btn) {
      btn.textContent = guest ? '登' : (user.name || '我').slice(0, 1);
      btn.title = guest ? '登入 / 註冊帳號' : ('已登入：' + user.name + '（撳一下睇帳號）');
      btn.classList.toggle('signed', !guest);
    }
    if (!guest && uv) {
      $('authAvatar').textContent = (user.name || '?').slice(0, 1).toUpperCase();
      $('authNameBig').textContent = user.name;
      $('authEmailBig').textContent = user.email;
      updateStats();
    }
  }

  async function updateStats() {
    const box = $('authStats');
    if (!box) return;
    const p = await loadForCurrent();
    const done = (p && p.done) ? p.done.length : 0;
    const correct = (p && p.correct) ? p.correct : 0;
    const wp = (p && p.wp) ? p.wp.length : 0;
    const saved = (p && p.savedAt) ? new Date(p.savedAt).toLocaleString() : '未保存';
    box.innerHTML =
      '<div class="authStat"><b>' + done + '</b><span>完成節點</span></div>' +
      '<div class="authStat"><b>' + correct + '</b><span>答對題數</span></div>' +
      '<div class="authStat"><b>' + wp + '</b><span>傳送錨點</span></div>' +
      '<div class="authStat wide"><b>' + saved + '</b><span>最後保存</span></div>';
  }

  function open() {
    const m = $('authModal');
    if (!m) return;
    clearErrs();
    render();
    setMode('login');
    m.classList.add('show');
    document.dispatchEvent(new CustomEvent('bq:auth-open'));
    if (!user) setTimeout(function () { const e = $('authEmail'); if (e) e.focus(); }, 50);
  }
  function close() {
    const m = $('authModal');
    if (!m) return;
    if (!m.classList.contains('show')) return;
    m.classList.remove('show');
    document.dispatchEvent(new CustomEvent('bq:auth-close'));
  }
  function isOpen() {
    const m = $('authModal');
    return !!(m && m.classList.contains('show'));
  }

  async function importPrompt(guestPayload) {
    return new Promise(function (resolve) {
      const alt = $('authAlt');
      if (!alt) return resolve(false);
      const n = (guestPayload && guestPayload.done) ? guestPayload.done.length : 0;
      alt.innerHTML =
        '<div class="authImport"><b>呢部裝置有訪客進度（完成 ' + n + ' 個節點）</b>' +
        '<span>要匯入呢個帳號嗎？匯入後訪客進度會搬過去。</span>' +
        '<div class="authImportBtns">' +
        '<button type="button" class="primary" id="authImportYes">匯入</button>' +
        '<button type="button" class="ghost" id="authImportNo">唔需要</button></div></div>';
      $('authImportYes').onclick = function () { alt.innerHTML = ''; resolve(true); };
      $('authImportNo').onclick = function () { alt.innerHTML = ''; resolve(false); };
    });
  }

  async function afterAuth(isNew, hasData, result) {
    const guestPayload = (function () {
      try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { return null; }
    })();

    if (!hasData && guestPayload && (guestPayload.done || []).length) {
      const yes = await importPrompt(guestPayload);
      if (yes) {
        if (hook) hook.apply(guestPayload);
        await saveNow();
      }
    } else if (isNew && hook) {
      // 新帳號：套用目前遊戲狀態（可能是空進度）
      await saveNow();
    }

    close();
    render();
    if (result && result.data && hasData && hook) hook.apply(result.data);
    toast(isNew ? '帳號已建立，進度會保存喺呢個帳號' : '已登入：' + user.name);
    document.dispatchEvent(new CustomEvent('bq:auth', { detail: { user: user } }));
  }

  function wire() {
    const form = $('authForm');
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';

    document.querySelectorAll('#authTabs .authTab').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busy) return;
      clearErrs();

      const email = $('authEmail').value.trim();
      const pw = $('authPw').value;
      const name = $('authName').value;
      const reg = mode === 'register';

      let ok = true;
      const eEmail = checkEmail(email);
      const ePw = checkPw(pw);
      if (eEmail) { setErr('errEmail', eEmail); ok = false; }
      if (ePw) { setErr('errPw', ePw); ok = false; }
      if (reg) {
        const eName = checkName(name);
        if (eName) { setErr('errName', eName); ok = false; }
        if ($('authPw2').value !== pw) { setErr('errPw2', '兩次輸入嘅密碼唔一樣'); ok = false; }
      }
      if (!ok) return;

      busy = true;
      $('authSubmit').disabled = true;
      $('authSubmit').textContent = reg ? '建立中…' : '登入中…';
      try {
        if (reg) {
          await register(email, pw, name);
          saveSession(false); // 新註冊預設只用 sessionStorage（較安全）
          await afterAuth(true, false, { data: null });
        } else {
          const r = await login(email, pw, $('authKeep').checked);
          await afterAuth(false, r.hasData, { data: r.data });
        }
      } catch (err) {
        if (err && err.field === 'email') setErr('errEmail', err.message);
        else if (err && err.field === 'pw') setErr('errPw', err.message);
        else msg((err && err.message) || '發生錯誤，請再試一次', 'err');
      } finally {
        busy = false;
        const sb = $('authSubmit');
        if (sb) { sb.disabled = false; sb.textContent = mode === 'register' ? '建立帳號' : '登入'; }
      }
    });

    const bind = function (id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); };
    bind('authClose', close);
    bind('authLogout', function () {
      if (!confirm('登出後會返到訪客進度（帳號進度已保存）。確定登出？')) return;
      logout();
      close();
      toast('已登出');
      document.dispatchEvent(new CustomEvent('bq:auth', { detail: { user: null } }));
      setTimeout(function () { location.reload(); }, 400);
    });
    bind('authDelete', function () {
      if (!user) return;
      if (!confirm('刪除帳號會永久移除呢個帳號同所有進度，無法復原。確定？')) return;
      const store = readStore();
      delete store.accounts[user.email];
      writeStore(store);
      logout();
      close();
      toast('帳號已刪除');
      setTimeout(function () { location.reload(); }, 400);
    });
    bind('authExport', function () {
      if (!hook) return;
      const p = hook.snapshot();
      const blob = new Blob([JSON.stringify({ account: user && user.email, progress: p }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bond-quest-progress.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  /* ---------------- boot ---------------- */
  async function init(gameHook) {
    hook = gameHook || hook;
    if (!ready) {
      ready = (async function () {
        wire();
        const sess = readSession();
        let payload = null;
        if (sess) {
          const store = readStore();
          const acc = store.accounts[sess.email];
          if (acc) {
            try {
              rawKey = unb64(sess.k);
              aesKey = await importAes(rawKey);
              user = pub(acc);
              payload = acc.data ? await unseal(aesKey, acc.data) : null;
            } catch (e) {
              user = null; aesKey = null; rawKey = null;
              clearSession();
            }
          }
        }
        render();
        if (!payload) payload = await loadForCurrent();
        return payload;
      })();
    }
    const payload = await ready;
    if (hook && payload) hook.apply(payload);
    return { user: user, payload: payload };
  }

  return {
    init: init,
    bind: function (h) { hook = h; },
    open: open,
    close: close,
    isOpen: isOpen,
    user: function () { return user; },
    save: queueSave,
    saveNow: saveNow,
    load: loadForCurrent,
    toast: toast,
    _check: { checkEmail: checkEmail, checkPw: checkPw, checkName: checkName },
  };
})();
