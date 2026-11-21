/* ============================================================
   Bond Quest — 雲端帳號（WorkBuddy Cloud Service）

   認證方式：Email 一次性驗證碼（OTP）
   - 唔存密碼：冇密碼就冇外洩風險，亦冇重設流程要維護
   - 驗證碼由平台寄出、一次性、有時效
   - 會話由 SDK 管理（access token + refresh handle 都唔會經過我哋嘅程式碼）

   進度：存喺雲端 `progress` 表，一行一個用戶
   - owner_id 由 DB 的 DEFAULT auth.uid() 填入，前端永遠唔會送
   - RLS：SELECT/INSERT/UPDATE/DELETE 全部 owner_id = auth.uid()
   - 未登入（anon）冇 GRANT，所以未登入讀唔到任何人的資料

   注意：雲端認證綁定已發佈網域（Origin 必須完全一致），
   所以 file:// 或 localhost 打不開帳號功能，會顯示明確提示。
   ============================================================ */

const CLOUD = (function () {
  'use strict';

  // publicConfig（由 workbuddy_cloud_service 提供，可安全放在前端）
  const CFG = {
    endpoint: 'https://bond-quest.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_TgQ6cTAiyoqwbKTyZMQz4R_kEGINiDWp7HiZFCblz0S4TThhfHg5G3E'
  };

  const GUEST_KEY = 'bq_guest_v1';
  const TABLE = 'progress';

  let sdk = null;
  let hook = null;
  let session = null;
  let pending = null;          // { email, verificationId, isExistingUser }
  let saveTimer = null;
  let countdownTimer = null;
  let busy = false;
  let ready = null;

  const $ = (id) => document.getElementById(id);

  /* ---------------- helpers ---------------- */
  function toast(msg) {
    document.dispatchEvent(new CustomEvent('bq:toast', { detail: { msg: msg } }));
  }
  function onPublishedOrigin() {
    try { return location.origin === new URL(CFG.endpoint).origin; }
    catch (e) { return false; }
  }
  function setErr(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }
  function msg(text, kind) {
    const m = $('clMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'authMsg' + (text ? ' show ' + (kind || 'err') : '');
  }
  // 後端訊息可能夾住 gRPC 細節（例如 %!(EXTRA ...)），一律唔直接顯示
  function clean(text) {
    const s = String(text || '');
    const cut = s.split('%!(')[0].split('rpc error')[0].trim();
    return cut;
  }
  function errText(error, fallback) {
    if (!error) return fallback;
    const raw = clean(error.message);
    const kind = error.kind || error.code || '';
    if (/验证码|驗證碼|verification code|code does not match|invalid.*code/i.test(raw)) {
      return '驗證碼唔正確或已過期，請重新輸入或重新發送';
    }
    if (/rate|429|too many|frequent/i.test(raw) || kind === 'rate_limited') {
      return '發送太頻繁，請稍等一分鐘再試';
    }
    if (/not enabled|未打开|disabled/i.test(raw)) return '此登入方式暫時停用，請聯絡管理員';
    if (kind === 'network' || kind === 'backend-unavailable') return '網絡或伺服器暫時不可用，請稍後再試';
    if (kind === 'unauthenticated' || kind === 'invalid_grant') return '登入已失效，請重新登入';
    return raw || fallback;
  }

  /* ---------------- session ---------------- */
  function userOf(s) {
    const u = (s && s.user) || null;
    if (!u) return null;
    return {
      id: u.id || u.uid || '',
      email: u.email || '',
      name: u.name || u.email || '玩家'
    };
  }
  function render() {
    const guest = !session;
    const g = $('clGuest'), u = $('clUser');
    if (g) g.style.display = guest ? '' : 'none';
    if (u) u.style.display = guest ? 'none' : '';
    const btn = $('authBtn');
    if (btn) {
      const me = userOf(session);
      btn.textContent = me ? (me.name || '我').slice(0, 1) : '登';
      btn.title = me ? ('已登入：' + me.name) : '登入 / 註冊帳號';
      btn.classList.toggle('signed', !!me);
    }
    if (!guest) {
      const me = userOf(session);
      if ($('clAvatar')) $('clAvatar').textContent = (me.name || '?').slice(0, 1).toUpperCase();
      if ($('clName')) $('clName').textContent = me.name;
      if ($('clEmailView')) $('clEmailView').textContent = me.email || '（此登入方式未提供電郵）';
      updateStats();
    }
  }
  function setSession(s) {
    session = s || null;
    render();
  }

  /* ---------------- progress ---------------- */
  async function loadProgress() {
    if (!session) {
      try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { return null; }
    }
    const { data, error } = await sdk.database.from(TABLE).select('data').maybeSingle();
    if (error) return { __error: errText(error, '讀取進度失敗') };
    return data ? data.data : null;
  }
  async function saveNow() {
    if (!hook) return;
    let payload;
    try { payload = hook.snapshot(); } catch (e) { return; }
    if (!payload) return;
    payload.savedAt = Date.now();

    if (!session) {
      try { localStorage.setItem(GUEST_KEY, JSON.stringify(payload)); } catch (e) { }
      return;
    }
    const me = userOf(session);
    const { error } = await sdk.database
      .from(TABLE)
      .upsert({ data: payload, owner_name: me && me.name, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
    if (error) {
      // 靜默失敗會令玩家以為進度已存 —— 至少留在 log 並在下次開窗提示
      console.warn('[cloud] progress save failed:', error.code || error.kind || 'unknown');
      lastSaveError = errText(error, '進度未能同步到雲端');
    } else {
      lastSaveError = '';
      lastSavedAt = Date.now();
    }
  }
  let lastSaveError = '';
  let lastSavedAt = 0;
  function save() {
    if (!hook) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, 900);
  }
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return saveNow();
  }

  /* ---------------- UI: form ---------------- */
  function resetForm() {
    ['clErrEmail', 'clErrCode'].forEach(function (id) { setErr(id, ''); });
    msg('');
    const code = $('clCodeRow');
    if (code) code.style.display = 'none';
    const sub = $('clVerify');
    if (sub) sub.style.display = 'none';
    const send = $('clSend');
    if (send) { send.textContent = '取得驗證碼 Get code'; send.disabled = false; }
    stopCountdown();
  }
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const r = $('clResend');
    if (r) r.textContent = '';
  }
  function startCountdown(sec) {
    stopCountdown();
    let left = sec;
    const r = $('clResend');
    const tick = function () {
      if (!r) return;
      r.textContent = left > 0 ? ('重新發送喺 ' + left + ' 秒後') : '可以重新發送';
      if (left <= 0) { clearInterval(countdownTimer); countdownTimer = null; }
      left--;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
  function checkEmail(v) {
    if (!v) return '請輸入電郵';
    if (v.length > 120) return '電郵太長';
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v)) return '電郵格式唔啱，例如 you@example.com';
    return '';
  }

  async function sendCode() {
    if (busy) return;
    const email = ($('clEmail').value || '').trim();
    const bad = checkEmail(email);
    setErr('clErrEmail', bad);
    if (bad) { $('clEmail').focus(); return; }
    if (!sdk) { msg('雲端功能未能載入，請檢查網絡後重新整理', 'err'); return; }

    busy = true;
    const btn = $('clSend');
    if (btn) { btn.disabled = true; btn.textContent = '發送中…'; }
    msg('');
    try {
      const { data, error } = await sdk.auth.sendOtp({ email: email });
      if (error) {
        msg(errText(error, '驗證碼發送失敗'), 'err');
        if (btn) { btn.disabled = false; btn.textContent = '取得驗證碼 Get code'; }
        return;
      }
      pending = {
        email: email,
        verificationId: data.verificationId,
        isExistingUser: !!data.isExistingUser
      };
      $('clCodeRow').style.display = '';
      $('clVerify').style.display = '';
      // 唔揭露該電郵是否已註冊（避免帳號探測）
      msg('驗證碼已寄到 ' + email + '，請檢查收件箱（包括垃圾郵件）', 'ok');
      $('clCode').value = '';
      $('clCode').focus();
      startCountdown(60);
      if (btn) { btn.disabled = false; btn.textContent = '重新發送 Resend'; }
    } catch (e) {
      msg('驗證碼發送失敗，請稍後再試', 'err');
      if (btn) { btn.disabled = false; btn.textContent = '取得驗證碼 Get code'; }
    } finally {
      busy = false;
    }
  }

  async function submitCode() {
    if (busy) return;
    const email = ($('clEmail').value || '').trim();
    const token = ($('clCode').value || '').trim();
    setErr('clErrCode', '');

    if (!pending || pending.email !== email) {
      setErr('clErrCode', '請先為呢個電郵取得驗證碼');
      return;
    }
    if (!/^\d{6}$/.test(token)) {
      setErr('clErrCode', '請輸入 6 位數字驗證碼');
      return;
    }
    if (!sdk) { msg('雲端功能未能載入', 'err'); return; }

    busy = true;
    const btn = $('clVerify');
    if (btn) { btn.disabled = true; btn.textContent = '驗證中…'; }
    try {
      const { data, error } = await sdk.auth.verifyOtp({
        email: pending.email,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: token
      });
      if (error) {
        setErr('clErrCode', errText(error, '驗證碼唔正確或已過期'));
        return;
      }
      setSession(data && data.session ? data.session : data);
      pending = null;
      resetForm();
      await afterSignIn();
    } catch (e) {
      setErr('clErrCode', '驗證失敗，請再試一次');
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '登入 / 註冊'; }
    }
  }

  async function afterSignIn() {
    const guest = (function () {
      try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { return null; }
    })();
    let payload = await loadProgress();
    if (payload && payload.__error) payload = null;

    if (!payload && guest && (guest.done || []).length) {
      const yes = await importPrompt(guest);
      if (yes && hook) { hook.apply(guest); await flush(); payload = guest; }
    }
    if (payload && hook) hook.apply(payload);

    close();
    render();
    const me = userOf(session);
    toast('已登入：' + (me ? me.name : '玩家') + '，進度會同步到雲端');
    document.dispatchEvent(new CustomEvent('bq:auth', { detail: { user: me } }));
  }

  function importPrompt(guest) {
    return new Promise(function (resolve) {
      const alt = $('clAlt');
      if (!alt) return resolve(false);
      const n = (guest.done || []).length;
      alt.innerHTML =
        '<div class="authImport"><b>呢部裝置有訪客進度（完成 ' + n + ' 個節點）</b>' +
        '<span>要上傳到呢個帳號嗎？上傳後會覆蓋雲端現有進度。</span>' +
        '<div class="authImportBtns">' +
        '<button type="button" class="primary" id="clImportYes">上傳</button>' +
        '<button type="button" class="ghost" id="clImportNo">唔需要</button></div></div>';
      $('clImportYes').onclick = function () { alt.innerHTML = ''; resolve(true); };
      $('clImportNo').onclick = function () { alt.innerHTML = ''; resolve(false); };
    });
  }

  async function updateStats() {
    const box = $('clStats');
    if (!box || !session) return;
    const p = await loadProgress();
    if (p && p.__error) {
      box.innerHTML = '<div class="clStatNote">' + p.__error + '</div>';
      return;
    }
    const done = (p && p.done) ? p.done.length : 0;
    const correct = (p && p.correct) ? p.correct : 0;
    const wp = (p && p.wp) ? p.wp.length : 0;
    const when = lastSavedAt || (p && p.savedAt) || 0;
    const saved = when ? new Date(when).toLocaleString() : '未有記錄';
    box.innerHTML =
      '<div class="authStat"><b>' + done + '</b><span>完成節點</span></div>' +
      '<div class="authStat"><b>' + correct + '</b><span>答對題數</span></div>' +
      '<div class="authStat"><b>' + wp + '</b><span>傳送錨點</span></div>' +
      '<div class="authStat wide"><b>' + saved + '</b><span>最後同步</span></div>' +
      (lastSaveError ? '<div class="clStatNote">⚠ ' + lastSaveError + '</div>' : '');
  }

  /* ---------------- open / close ---------------- */
  function open() {
    const m = $('clModal');
    if (!m) return;
    resetForm();
    render();
    m.classList.add('show');
    document.dispatchEvent(new CustomEvent('bq:auth-open'));

    if (!onPublishedOrigin()) {
      msg('雲端帳號只可以在已發佈網址使用（' + CFG.endpoint + '）。用 file:// 或本機預覽打開時，帳號功能會停用。', 'err');
    } else if (sdk && !session && pending) {
      // 已經寄出驗證碼：回復輸入框，唔需要玩家重新發送
      if ($('clEmail')) $('clEmail').value = pending.email;
      $('clCodeRow').style.display = '';
      $('clVerify').style.display = '';
      if ($('clSend')) $('clSend').textContent = '重新發送 Resend';
      msg('驗證碼已寄到 ' + pending.email + '，請輸入 6 位數字', 'ok');
      setTimeout(function () { const c = $('clCode'); if (c) c.focus(); }, 60);
    } else if (!sdk) {
      msg('雲端 SDK 未載入，請檢查網絡後重新整理', 'err');
    } else if (!session) {
      setTimeout(function () { const e = $('clEmail'); if (e) e.focus(); }, 60);
    }
  }
  function close() {
    const m = $('clModal');
    if (!m || !m.classList.contains('show')) return;
    m.classList.remove('show');
    stopCountdown();
    document.dispatchEvent(new CustomEvent('bq:auth-close'));
  }
  function isOpen() {
    const m = $('clModal');
    return !!(m && m.classList.contains('show'));
  }

  /* ---------------- sign out ---------------- */
  async function signOut() {
    if (!session) return;
    await flush();                       // 先將最後進度寫上雲端
    try { await sdk.auth.signOut(); } catch (e) { }
    setSession(null);
    pending = null;
    close();
    toast('已登出');
    document.dispatchEvent(new CustomEvent('bq:auth', { detail: { user: null } }));
    setTimeout(function () { location.reload(); }, 350);
  }

  /* ---------------- wire ---------------- */
  function wire() {
    const form = $('clForm');
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    const bind = function (id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); };
    bind('clSend', sendCode);
    bind('clVerify', submitCode);
    bind('clClose', close);
    bind('clSignOut', function () {
      if (!confirm('登出後會返到訪客進度（雲端進度已保存）。確定登出？')) return;
      signOut();
    });
    bind('clExport', async function () {
      const p = await loadProgress();
      const blob = new Blob([JSON.stringify({ progress: p }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bond-quest-progress.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });

    // 輸入時即時清除該欄錯誤
    const email = $('clEmail');
    if (email) email.addEventListener('input', function () { setErr('clErrEmail', ''); });
    const code = $('clCode');
    if (code) {
      code.addEventListener('input', function () {
        code.value = code.value.replace(/\D/g, '').slice(0, 6);
        setErr('clErrCode', '');
      });
      code.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitCode(); });
    }
  }

  /* ---------------- init ---------------- */
  async function init(gameHook) {
    hook = gameHook || hook;
    wire();
    if (ready) return ready;

    ready = (async function () {
      if (!onPublishedOrigin()) {
        return { user: null, payload: null, blocked: 'origin' };
      }
      const lib = (typeof WorkBuddyCloud !== 'undefined') ? WorkBuddyCloud : null;
      if (!lib || typeof lib.createWorkBuddyCloud !== 'function') {
        return { user: null, payload: null, blocked: 'sdk' };
      }
      try {
        sdk = lib.createWorkBuddyCloud({
          endpoint: CFG.endpoint,
          oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
          publishableKey: CFG.publishableKey
        });
      } catch (e) {
        return { user: null, payload: null, blocked: 'init' };
      }

      const { data, error } = await sdk.auth.getSession();
      if (error) return { user: null, payload: null, blocked: 'session' };

      if (data) {
        setSession(data);
        sdk.auth.onAuthStateChange(function (event, s) {
          if (event === 'SIGNED_OUT') setSession(null);
          else if (s) setSession(s);
        });
        let payload = await loadProgress();
        if (payload && payload.__error) payload = null;
        return { user: userOf(data), payload: payload };
      }

      // 訪客：載入本機進度
      let guest = null;
      try { guest = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { }
      return { user: null, payload: guest };
    })();

    const r = await ready;
    if (hook && r && r.payload) hook.apply(r.payload);
    render();
    return r;
  }

  return {
    init: init,
    bind: function (h) { hook = h; },
    open: open,
    close: close,
    isOpen: isOpen,
    user: function () { return userOf(session); },
    save: save,
    saveNow: flush,
    load: loadProgress,
    toast: toast,
    status: function () {
      return { onPublishedOrigin: onPublishedOrigin(), hasSdk: !!sdk, signedIn: !!session };
    },
    // 診斷用：確認未登入時資料庫是否真的攔截（應為 permission denied）
    probe: async function () {
      if (!sdk) return { ok: false, reason: 'no-sdk' };
      const { data, error } = await sdk.database.from(TABLE).select('id').limit(1);
      return {
        ok: !error,
        rows: Array.isArray(data) ? data.length : 0,
        code: error ? (error.code || error.kind || null) : null
      };
    }
  };
})();
