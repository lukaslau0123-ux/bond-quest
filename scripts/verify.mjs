// 建置後的守門檢查。任何一項失敗即 exit 1，阻止壞版本上線。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const MIN_KB = 600;                 // 正常約 810 KB，太細代表組裝不完整
const FILES = ['data.js', 'cloud.js', 'world.js', 'game.js'];
const PLACEHOLDERS = ['/*__CSS__*/', '/*__THREE__*/', '/*__DATA__*/', '/*__CLOUD__*/', '/*__WORLD__*/', '/*__GAME__*/'];
const REQUIRED = ['id="questPanel"', 'id="bigMapModal"', 'id="wpModal"', 'id="guildModal"', 'id="shopModal"', 'id="coachCard"', 'id="clModal"', 'id="authBtn"'];

const rootHtml = path.join(ROOT, 'index.html');
const siteHtml = path.join(ROOT, 'site', 'index.html');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ ok: true, name }); }
  catch (e) { results.push({ ok: false, name, err: e.message }); }
}
function must(cond, msg) { if (!cond) throw new Error(msg); }

let html = '';
test('根目錄 index.html 存在', () => {
  must(existsSync(rootHtml), '找不到 index.html，請先執行 build');
  html = readFileSync(rootHtml, 'utf8');
});

test(`檔案體積 >= ${MIN_KB} KB`, () => {
  const kb = statSync(rootHtml).size / 1024;
  must(kb >= MIN_KB, `只有 ${kb.toFixed(0)} KB，疑似組裝不完整`);
});

test('site/index.html 與根目錄一致', () => {
  must(existsSync(siteHtml), '找不到 site/index.html');
  const a = statSync(rootHtml).size;
  const b = statSync(siteHtml).size;
  must(a === b, `大小不一致（${a} vs ${b} bytes），Deploy 目錄未同步`);
});

test('沒有殘留佔位符', () => {
  const found = PLACEHOLDERS.filter((p) => html.includes(p));
  must(found.length === 0, `殘留 ${found.join(', ')}`);
});

test('script 標籤數量平衡', () => {
  const open = (html.match(/<script\b/gi) || []).length;
  const close = (html.match(/<\/script>/gi) || []).length;
  must(open === close, `<script> ${open} 個 vs </script> ${close} 個`);
});

test('HTML 結構完整', () => {
  must(/<\/html>\s*$/i.test(html), '結尾缺少 </html>');
});

test('關鍵 UI 節點存在', () => {
  const miss = REQUIRED.filter((id) => !html.includes(id));
  must(miss.length === 0, `缺少 ${miss.join(', ')}`);
});

test('原始 JS 語法正確', () => {
  for (const f of FILES) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, '_src', f)], { encoding: 'utf8' });
    must(r.status === 0, `${f}：${(r.stderr || '').split('\n').filter(Boolean).slice(0, 2).join(' ')}`);
  }
});

// 全英文介面守門：語言標記生效，且标志性的舊中文 UI 文案不得殘留。
// 只檢查 UI 標記串，不檢查 data.js 的 zh 雙語數據（那些是資料，不會渲染）。
const UI_EN_MARKERS = [
  '<html lang="en">',
];
const UI_ZH_LEGACY = [
  '開始探索', '任務 MISSION', '按 E 互動', '遊戲說明', '目前目標',
  '化學鍵 3D 開放世界', '取得驗證碼 Get code', '重看新手引導',
];
test('介面已全英文化', () => {
  const miss = UI_EN_MARKERS.filter((s) => !html.includes(s));
  must(miss.length === 0, `缺少英文標記：${miss.join(', ')}`);
  const legacy = UI_ZH_LEGACY.filter((s) => html.includes(s));
  must(legacy.length === 0, `仍殘留舊中文文案：${legacy.join(', ')}`);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name}${r.ok ? '' : ` → ${r.err}`}`);
}
const size = existsSync(rootHtml) ? (statSync(rootHtml).size / 1024).toFixed(0) : '?';
console.log(`\n${results.length - failed.length}/${results.length} 通過 · 產物 ${size} KB`);
process.exit(failed.length ? 1 : 0);
