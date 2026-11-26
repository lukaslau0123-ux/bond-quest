// 角色特寫：把遊戲相機換成固定機位，拍正面／四分之三側／背面，用於美術評審。
//
// 用法：node scripts/portrait.mjs <前綴名> [port|mobile]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(os.tmpdir(), 'bq-chrome-' + Date.now());
const prefix = process.argv[2] || 'portrait';
const mode = process.argv[3] || 'port';
const PORT = 9800 + Math.floor(Math.random() * 150);
const url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

const W = mode === 'mobile' ? 390 : 900;
const H = mode === 'mobile' ? 844 : 1000;

const chrome = spawn(CHROME, [`--user-data-dir=${PROFILE}`,
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p;
    } catch { }
    await sleep(250);
  }
  throw new Error('no chrome');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res } = pend.get(m.id); pend.delete(m.id); res(m.result); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; };

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: mode === 'mobile' });
  await send('Page.navigate', { url });
  await sleep(3200);
  await ev("document.getElementById('startBtn').click()");
  await sleep(1200);
  await ev("document.getElementById('coachSkip') && document.getElementById('coachSkip').click()");
  await sleep(1200);

  // 固定機位覆寫（HUD 會被角色擋住，這是刻意的：只拍人）
  await ev(`(() => {
    const cam = WORLD.camera.clone();
    cam.fov = 26; cam.updateProjectionMatrix();
    cam.position.set(0, 2.05, 9.6);
    cam.lookAt(0, 1.72, 0);
    const r = WORLD.renderer;
    if (!r.__origRender) r.__origRender = r.render.bind(r);
    r.render = (scene) => r.__origRender(scene, cam);
    document.getElementById('hud').style.display = 'none';
    WORLD.player.rotation.y = 0;
    return true;
  })()`);
  await sleep(500);

  const shots = [
    ['front', 0, '正面 front'],
    ['three', -0.9, '四分之三 three-quarter'],
    ['side', -Math.PI / 2, '側面 side'],
    ['back', Math.PI, '背面 back'],
  ];

  for (const [suffix, rot] of shots) {
    await ev(`WORLD.player.rotation.y = ${rot}`);
    await sleep(350);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${prefix}-${suffix}.png`;
    writeFileSync(path.join(ROOT, file), Buffer.from(data, 'base64'));
    console.log('已輸出', file);
  }
} finally {
  ws.close(); chrome.kill();
}
