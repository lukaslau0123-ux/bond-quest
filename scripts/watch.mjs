// 檔案監看器：儲存即建置 → 驗證 →（可選）自動提交推送。
//
// 用法：
//   npm run watch          只建置 + 驗證（本機預覽用）
//   npm run watch:push     建置 + 驗證 + git push（觸發雲端部署）
//   DEBOUNCE_MS=800        自訂防抖延遲（預設 500ms）
import { watch, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, runBuild, runVerify, commitAndPush, log, stamp, builtSizeKB, preserveLastGood, restoreLastGood } from './lib.mjs';
import { notify } from './notify.mjs';

const WATCH_DIRS = ['_src', '_vendor'];
const EXT = new Set(['.js', '.css', '.html']);
const IGNORE = /(^~\$|\.tmp$|\.swp$|\.crswap$|\.log$|^\.DS_Store$)/;

const AUTO_PUSH = process.argv.includes('--push') || process.env.AUTO_PUSH === '1';
const DEBOUNCE = Number(process.env.DEBOUNCE_MS || 500);

let timer = null;
let busy = false;
let queued = null;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.test(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
}

/** 用「路徑 + mtime + size」快照，用來偵測建置期間是否有漏掉的新存檔 */
function snapshot() {
  const parts = [];
  for (const d of WATCH_DIRS) {
    const abs = path.join(ROOT, d);
    try {
      for (const f of walk(abs)) {
        const s = statSync(f);
        parts.push(`${f}:${s.mtimeMs}:${s.size}`);
      }
    } catch { /* 目錄可能暫時不存在 */ }
  }
  return parts.sort().join('|');
}

function cycle(reason) {
  const before = snapshot();
  const t0 = Date.now();

  log(`偵測到變更（${reason}），開始建置…`);
  const b = runBuild();
  if (!b.ok) {
    log(`建置失敗：${b.output}`, 'error');
    notify('Bond Quest 建置失敗', '產物未更新，線上版本保持不變');
    return;
  }

  const v = runVerify();
  if (!v.ok) {
    log(`驗證失敗：\n${v.output}`, 'error');
    if (restoreLastGood()) log('已還原本機產物到上一個通過驗證的版本', 'warn');
    else log('沒有可還原的良好版本（首次建置就失敗）', 'warn');
    notify('Bond Quest 驗證失敗', '產物未通過守門檢查，已阻止部署');
    return;
  }

  preserveLastGood();
  log(`建置通過 · ${builtSizeKB()} KB · ${Date.now() - t0} ms`);

  if (AUTO_PUSH) {
    const r = commitAndPush(`auto: rebuild ${stamp()}`);
    log(r.message, r.ok ? 'info' : 'error');
    if (!r.ok) notify('Bond Quest 推送失敗', r.message);
  }

  // 建置阻塞期間可能又存了一次檔，補跑一輪
  if (snapshot() !== before) schedule('建置期間有新存檔');
}

function flush() {
  if (busy) return;
  busy = true;
  const reason = queued || 'file change';
  queued = null;
  try { cycle(reason); }
  catch (e) { log(`未預期錯誤：${e.stack || e.message}`, 'error'); notify('Bond Quest 監看器出錯', e.message); }
  finally {
    busy = false;
    if (queued) schedule(queued);
  }
}

function schedule(reason) {
  queued = reason;
  if (busy) return;
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE);
}

// ---- 啟動 ----
log(`監看模式啟動 · 目錄 ${WATCH_DIRS.join(', ')} · 自動推送 ${AUTO_PUSH ? '開' : '關'}`);
for (const d of WATCH_DIRS) {
  const abs = path.join(ROOT, d);
  try {
    watch(abs, { recursive: true }, (_evt, filename) => {
      if (!filename) return schedule('file change');
      if (IGNORE.test(path.basename(filename))) return;
      if (!EXT.has(path.extname(filename).toLowerCase())) return;
      schedule(filename);
    });
    log(`已監看 ${d}/`);
  } catch (e) {
    log(`無法監看 ${d}/：${e.message}`, 'error');
  }
}

cycle('啟動時完整建置');

process.on('SIGINT', () => {
  log('監看模式結束');
  process.exit(0);
});
