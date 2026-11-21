// 上傳包產生器：建置 → 驗證 → 產出可直接部署的 dist/（含版本戳與快取標頭）。
//
// 用法：
//   npm run upload            產生 dist/
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, runBuild, runVerify, log, stamp, preserveLastGood, restoreLastGood } from './lib.mjs';

const DIST = path.join(ROOT, 'dist');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

log('開始打包上傳版本');
const b = runBuild();
if (!b.ok) {
  log(`建置失敗：${b.output}`, 'error');
  restoreLastGood();
  process.exit(1);
}

const v = runVerify();
if (!v.ok) {
  log(`驗證失敗：\n${v.output}`, 'error');
  if (restoreLastGood()) log('已還原本機產物到上一個良好版本', 'warn');
  log('已中止：不會產生上傳包，線上版本不受影響', 'warn');
  process.exit(1);
}
preserveLastGood();

// ---- 組裝 dist/ ----
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const siteIndex = path.join(ROOT, 'site', 'index.html');
copyFileSync(siteIndex, path.join(DIST, 'index.html'));

const bytes = statSync(siteIndex).size;
const version = sha256(siteIndex).slice(0, 12);
const meta = { version, builtAt: new Date().toISOString(), bytes, sizeKB: +(bytes / 1024).toFixed(1) };

writeFileSync(path.join(DIST, 'version.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

// 單頁應用：任何路徑都回首頁
writeFileSync(
  path.join(DIST, '404.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>導向中</title><a href="/">回到 鍵界 Bond Quest</a>\n',
  'utf8'
);

// Netlify / Cloudflare Pages 會讀這個檔：HTML 不快取，確保打開就看到最新版
writeFileSync(
  path.join(DIST, '_headers'),
  [
    '/*',
    '  Cache-Control: no-cache, must-revalidate',
    '',
    '/version.json',
    '  Cache-Control: no-store',
    '',
  ].join('\n'),
  'utf8'
);

// GitHub Pages 用
writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');

// site/ 同步一份，方便直接以 site 為目錄發佈
writeFileSync(path.join(ROOT, 'site', 'version.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
copyFileSync(path.join(DIST, '_headers'), path.join(ROOT, 'site', '_headers'));

log(`上傳包就緒 · 版本 ${version} · ${meta.sizeKB} KB · ${stamp()}`);

console.log('');
console.log(`  目錄   ${DIST}`);
console.log('  檔案   index.html / version.json / 404.html / _headers / .nojekyll');
console.log(`  版本   ${version}`);
console.log(`  體積   ${meta.sizeKB} KB`);
console.log('');
console.log('  下一步：重新發佈同一個應用即可更新線上內容（連結不變）。');
console.log('  或把 dist/ 整個上傳到任何靜態主機（Netlify Drop / Cloudflare Pages / GitHub Pages）。');
