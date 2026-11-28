// QA screenshot driver: opens a staged URL, waits until the page sets
// document.title = 'READY', then captures one or more frames over CDP.
//
// Usage:
//   node scripts/qa-shot.mjs <url> <out.png> [w] [h] [--burst=N] [--gap=MS]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from './lib.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (const a of args) {
  const m = /^--([\w-]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2]; else pos.push(a);
}
const [url, out = 'qa-shot.png', w = '1440', h = '900'] = pos;
const burst = Number(flags.burst || 1);
const gap = Number(flags.gap || 90);
const waitTitle = Number(flags.timeout || 30000);
const PROFILE = path.join(os.tmpdir(), 'bq-qa-' + Date.now());
const PORT = 9500 + Math.floor(Math.random() * 300);

const chrome = spawn(CHROME, [
  `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
  '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--window-size=${w},${h}`, 'about:blank',
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
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ');
    logs.push(text);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  const t0 = Date.now();
  let ready = false, dbg = '';
  while (Date.now() - t0 < waitTitle) {
    await sleep(250);
    const r = await send('Runtime.evaluate', {
      expression: "JSON.stringify({title:document.title,dbg:(document.getElementById('dbg')||{}).textContent})",
      returnByValue: true,
    });
    const st = JSON.parse(r.result.value || '{}');
    dbg = st.dbg || '';
    if (st.title === 'READY' || st.title.includes('Bond Quest')) { ready = true; break; }
  }
  if (!ready) {
    console.error('NOT READY\n' + dbg);
  } else {
    console.log(dbg);
  }

  if (flags.pre || flags.jsfile) {
    const expr = flags.jsfile ? readFileSync(path.join(ROOT, flags.jsfile), 'utf8') : flags.pre;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    console.log('pre:', JSON.stringify(r.result && r.result.value));
    await sleep(120);
  }

  for (let i = 0; i < burst; i++) {
    if (i) await sleep(gap);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = burst > 1 ? out.replace(/\.png$/i, '') + '-' + i + '.png' : out;
    writeFileSync(path.join(ROOT, file), Buffer.from(data, 'base64'));
    console.log('shot ' + file);
  }

  if (flags.eval) {
    const r = await send('Runtime.evaluate', {
      expression: flags.eval, returnByValue: true, awaitPromise: true,
    });
    console.log('eval:', JSON.stringify(r.result && r.result.value));
  }

  if (logs.length) {
    console.log('--- console ---');
    for (const l of logs) console.log(l);
  }
} finally {
  ws.close();
  chrome.kill();
}
