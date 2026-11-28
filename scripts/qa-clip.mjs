// Record a short screencast of the running game so UI motion can be reviewed.
// usage: node scripts/qa-clip.mjs <url> <.clip dir> [ms] [--pre=js]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const url = args[0];
const outDir = args[1];
const clipMs = Number(args[2] || 2600);
const flags = {};
for (const a of args.slice(3)) {
  const kv = a.match(/^--([^=]+)=(.*)$/s);
  if (kv) flags[kv[1]] = kv[2];
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = join(process.env.TEMP || '.', 'qa-clip-' + PORT);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--disable-gpu-vsync',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--enable-unsafe-swiftshader',
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome debug port never came up');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const frames = [];
let streaming = false;

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Page.screencastFrame') {
    const n = String(frames.length + 1).padStart(4, '0');
    frames.push(n);
    writeFileSync(join(outDir, n + '.jpg'), Buffer.from(msg.params.data, 'base64'));
    pending['ack'] = send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
}

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 45000) {
    if (flags.ready === 'no') { await sleep(1800); ready = true; break; }
    await sleep(250);
    const r = await send('Runtime.evaluate', {
      expression: "JSON.stringify({title:document.title,dbg:(document.getElementById('dbg')||{}).textContent})",
      returnByValue: true,
    });
    const st = JSON.parse(r.result.value || '{}');
    if (st.title === 'READY') { ready = true; break; }
  }
  if (!ready) throw new Error('page never became READY');

  await send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 960, maxHeight: 600, everyNthFrame: 2 });
  streaming = true;
  await sleep(220);
  if (flags.pre) await send('Runtime.evaluate', { expression: flags.pre, returnByValue: true, awaitPromise: true });
  await sleep(clipMs);
  await send('Page.stopScreencast');
  streaming = false;
  console.log('frames', frames.length);
} finally {
  ws.close();
  chrome.kill();
}
