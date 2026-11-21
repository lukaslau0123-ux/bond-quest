// 共用工具：建置、驗證、git 提交推送、日誌。
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let _py = null;

/** 找出可用的 python 指令（python / python3 / py / PYTHON 環境變數） */
export function pythonCmd() {
  if (_py) return _py;
  const candidates = [process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (r.status === 0) { _py = c; return c; }
  }
  return null;
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 同時輸出到終端與 logs/deploy.log */
export function log(msg, level = 'info') {
  const line = `[${stamp()}] ${level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN ' : 'INFO '} ${msg}`;
  console.log(line);
  try {
    const dir = path.join(ROOT, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'deploy.log'), line + '\n', 'utf8');
  } catch {
    // 寫日誌失敗不影響主流程
  }
}

/** 執行 build.py，回傳 { ok, output } */
export function runBuild() {
  const py = pythonCmd();
  if (!py) return { ok: false, output: '找不到 Python，請安裝或在 PYTHON 環境變數指定路徑' };
  const r = spawnSync(py, ['build.py'], { cwd: ROOT, encoding: 'utf8' });
  const output = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, output };
}

/** 執行 scripts/verify.mjs，回傳 { ok, output } */
export function runVerify() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

export function git(...args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

export function isRepo() {
  const r = git('rev-parse', '--is-inside-work-tree');
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

export function hasRemote() {
  const r = git('remote');
  return r.status === 0 && String(r.stdout).trim().length > 0;
}

export function builtSizeKB() {
  try {
    return (statSync(path.join(ROOT, 'index.html')).size / 1024).toFixed(0);
  } catch {
    return '?';
  }
}

/** git add -A → 有改動才 commit → push。回傳 { ok, message } */
export function commitAndPush(message) {
  if (!isRepo()) return { ok: false, message: '尚未 git init，略過提交' };

  const add = git('add', '-A');
  if (add.status !== 0) return { ok: false, message: `git add 失敗：${add.stderr}` };

  // 暫存區無改動就唔需要 commit
  const diff = git('diff', '--cached', '--quiet');
  if (diff.status === 0) return { ok: true, message: '無檔案改動，略過提交' };

  const commit = git('commit', '-m', message);
  if (commit.status !== 0) {
    return { ok: false, message: `git commit 失敗：${(commit.stderr || commit.stdout).trim()}` };
  }

  if (!hasRemote()) return { ok: true, message: '已提交（本機），未設定 remote，未推送' };

  const push = git('push');
  if (push.status !== 0) {
    return { ok: false, message: `git push 失敗：${(push.stderr || push.stdout).trim()}` };
  }
  return { ok: true, message: '已推送，CI 將自動建置與部署' };
}
