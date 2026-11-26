// 視覺檢查：用 Chrome 無頭模式截圖，可模擬手機視窗並自動按「開始探索」。
//
// 用法：
//   node scripts/screenshot.mjs out.png                      桌面 1280x800
//   node scripts/screenshot.mjs out.png 390 844 mobile       手機（含觸控模擬）
//   node scripts/screenshot.mjs out.png 390 844 mobile "?touch=1"
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(os.tmpdir(), 'bq-chrome-' + Date.now());
const [out = 'shot.png', w = '1280', h = '800', mode = 'desktop', query = ''] = process.argv.slice(2);
const PORT = 9333 + Math.floor(Math.random() * 200);
const url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + (query ? query : mode === 'mobile' ? '?touch=1' : '');

const chrome = spawn(CHROME, [
  `--user-data-dir=${PROFILE}`,
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--window-size=${w},${h}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* 未就緒 */ }
    await sleep(250);
  }
  throw new Error('連不上 Chrome 除錯埠');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => {
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(w), height: Number(h), deviceScaleFactor: mode === 'mobile' ? 2 : 1, mobile: mode === 'mobile',
  });
  if (mode === 'mobile') await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  await send('Page.navigate', { url });
  await sleep(2500);

  // 按「開始探索」，跳過開場畫面與教練卡
  await send('Runtime.evaluate', { expression: "document.getElementById('startBtn') && document.getElementById('startBtn').click()" });
  await sleep(1500);
  await send('Runtime.evaluate', { expression: "document.getElementById('coachSkip') && document.getElementById('coachSkip').click()" });
  await sleep(2000);

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, out), Buffer.from(data, 'base64'));
  console.log(`已截圖 ${out}（${w}x${h}${mode === 'mobile' ? ' 手機模式' : ''}）`);
} finally {
  ws.close();
  chrome.kill();
}
