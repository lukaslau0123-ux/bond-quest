// 一次性發佈：建置 → 驗證 → 提交 → 推送（推送後由 CI 部署）。
// 用法：npm run ship       或       npm run ship -- "更新任務面板"
import { runBuild, runVerify, commitAndPush, log, stamp, builtSizeKB, preserveLastGood, restoreLastGood } from './lib.mjs';

const msg = process.argv.slice(2).join(' ').trim() || `chore: rebuild ${stamp()}`;

log('開始發佈流程');
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
  log('已中止，未提交、未推送，線上版本不受影響', 'warn');
  process.exit(1);
}

preserveLastGood();
log(`建置 + 驗證通過 · ${builtSizeKB()} KB`);

const r = commitAndPush(msg);
log(r.message, r.ok ? 'info' : 'error');
process.exit(r.ok ? 0 : 1);
