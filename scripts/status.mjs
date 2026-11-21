// 檢查部署狀態：GitHub Actions 最新一次結果 + Pages 實際線上版本 vs 本地版本。
//
// 用法：npm run status
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, git } from './lib.mjs';

function sh(cmd, args) {
  const r = git(cmd, ...args);
  return r.status === 0 ? String(r.stdout).trim() : '';
}

const remote = sh('remote', ['get-url', 'origin']);
const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
if (!m) {
  console.error('找不到 GitHub remote，請先執行：npm run connect -- <用戶名>');
  process.exit(1);
}
const [, owner, repo] = m;

const api = (p) =>
  fetch(`https://api.github.com/repos/${owner}/${repo}${p}`, {
    headers: { 'User-Agent': 'bond-quest-status', Accept: 'application/vnd.github+json' },
  });

const pad = (s, n) => String(s).padEnd(n, ' ');
const state = (ok, text) => `${ok ? '✓' : '✗'} ${text}`;

const info = await api('');
if (!info.ok) {
  console.error(`查不到 repo ${owner}/${repo}（HTTP ${info.status}）`);
  process.exit(1);
}
const meta = await info.json();

console.log(`repo      ${owner}/${repo}  ${meta.private ? '(private)' : '(public)'}`);
console.log(`分支      ${meta.default_branch}`);
console.log(`Pages     ${meta.has_pages ? state(true, '已啟用') : state(false, '未啟用 → Settings → Pages → Source 選 GitHub Actions')}`);

const runsRes = await api('/actions/runs?per_page=1');
if (runsRes.ok) {
  const { workflow_runs: runs = [] } = await runsRes.json();
  if (!runs.length) {
    console.log(`CI        ${state(false, '尚未有執行紀錄（未推送或 workflow 未觸發）')}`);
  } else {
    const r = runs[0];
    const ok = r.conclusion === 'success';
    console.log(`CI        ${state(ok, `${r.status}/${r.conclusion || '進行中'} · ${r.head_branch} · ${r.created_at}`)}`);
    if (!ok) console.log(`          查看：${r.html_url}`);
  }
} else {
  console.log('CI        查詢失敗（可能未登入或 API 限流）');
}

const live = `https://${owner}.github.io/${repo}/`;
let local = null;
const distMeta = path.join(ROOT, 'dist', 'version.json');
if (existsSync(distMeta)) {
  try { local = JSON.parse(readFileSync(distMeta, 'utf8')).version; } catch { /* ignore */ }
}

try {
  const res = await fetch(live, { headers: { 'Cache-Control': 'no-cache' } });
  const html = await res.text();
  const stamp = (html.match(/<!-- build: ([^|]+)\|/) || [])[1];
  console.log(`線上      ${state(res.ok, `${live} · HTTP ${res.status} · ${(html.length / 1024).toFixed(0)} KB`)}`);
  console.log(`線上戳記  ${stamp ? stamp.trim() : '（找不到，可能尚未部署）'}`);
  if (local) console.log(`本地版本  ${local}（執行 npm run upload 可更新）`);
} catch (e) {
  console.log(`線上      ✗ 無法連線：${e.message}`);
}
