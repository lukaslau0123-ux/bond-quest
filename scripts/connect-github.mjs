// 一次過接上 GitHub：設定 remote → 首次推送（會彈出瀏覽器授權）→ 印出 Pages 設定指引。
//
// 用法：
//   npm run connect -- <你的GitHub用戶名>
//   npm run connect -- <用戶名> <repo名>      # repo 名預設 bond-quest
//   npm run connect -- <用戶名> --dry-run     # 只設定 remote，不推送
//
// 前提：你必須先在 https://github.com/new 建立一個同名空 repo（不要勾 README / .gitignore）。
import { spawnSync } from 'node:child_process';
import { git, gitCmd, hasRemote, isRepo, log, ROOT } from './lib.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const DRY = flags.includes('--dry-run');

const user = args[0];
const repo = args[1] || 'bond-quest';

if (!user) {
  console.error('');
  console.error('缺少 GitHub 用戶名。');
  console.error('');
  console.error('正確寫法（注意 -- 後面有一個空格，不能連著寫）：');
  console.error('  npm run connect -- lukaslau0123-ux');
  console.error('                    ^ 這個空格不能省');
  console.error('');
  console.error('或者繞過 npm 直接執行：');
  console.error('  node scripts/connect-github.mjs lukaslau0123-ux');
  console.error('');
  console.error('如果 remote 已經設定好（git remote -v 有 origin），其實只需：');
  console.error('  git push -u origin main');
  process.exit(1);
}
if (!/^[A-Za-z0-9-]{1,39}$/.test(user)) {
  console.error(`用戶名格式不正確：「${user}」`);
  console.error('GitHub 用戶名只含英文、數字與連字號，例如 lukaslau0123-ux');
  process.exit(1);
}
if (!isRepo()) {
  console.error('這個目錄不是 git repo，請先 git init');
  process.exit(1);
}

const url = `https://github.com/${user}/${repo}.git`;
log(`目標 repo：${url}`);

// 設定或更新 remote
if (hasRemote()) {
  const r = git('remote', 'set-url', 'origin', url);
  if (r.status !== 0) { log(`設定 remote 失敗：${r.stderr}`, 'error'); process.exit(1); }
  log('已更新 origin');
} else {
  const r = git('remote', 'add', 'origin', url);
  if (r.status !== 0) { log(`新增 remote 失敗：${r.stderr}`, 'error'); process.exit(1); }
  log('已新增 origin');
}

if (DRY) {
  log('--dry-run：已停止，未推送');
  process.exit(0);
}

// 確認分支為 main
const branch = (git('branch', '--show-current').stdout || '').trim();
if (branch !== 'main') {
  const r = git('branch', '-M', 'main');
  if (r.status !== 0) { log(`切換分支失敗：${r.stderr}`, 'error'); process.exit(1); }
  log('已將分支重新命名為 main');
}

log('開始首次推送 — 瀏覽器會彈出，請按「Authorize Git Credential Manager」完成授權');
const push = spawnSync(gitCmd(), ['push', '-u', 'origin', 'main'], {
  cwd: ROOT,
  stdio: 'inherit', // 保留互動，GCM 才能在你的終端機彈出授權
});

if (push.status !== 0) {
  console.error('');
  console.error('✗ 推送失敗。常見原因：');
  console.error(`  · repo 未建立 → 先到 https://github.com/new 建一個名為 ${repo} 的空 repo（不要勾 README）`);
  console.error('  · 未完成瀏覽器授權 → 重新執行同一條指令，再按一次 Authorize');
  console.error('  · 帳號或 repo 名打錯 → 檢查網址是否正確');
  console.error('  · 公司/學校網絡阻擋 → 換網絡或用手機熱點');
  process.exit(1);
}

console.log('');
console.log('✓ 已推送，Git Credential Manager 已記住憑證（之後 push 不用再授權）');
console.log('');
console.log('最後一步（只需一次）：');
console.log(`  開 https://github.com/${user}/${repo}/settings/pages`);
console.log('  Build and deployment → Source 選「GitHub Actions」');
console.log('');
console.log('完成後 CI 會自動建置並部署，網址：');
console.log(`  https://${user}.github.io/${repo}/`);
console.log('');
console.log('之後每次更新：npm run watch:push（存檔即上線）');
