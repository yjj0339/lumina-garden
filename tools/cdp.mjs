/**
 * 极简 Chrome DevTools Protocol 客户端（零依赖：Node 内置 fetch + WebSocket）。
 * 用于：① 诊断——捕获 console/异常 + 关键时刻截图；② 4K 逐帧导出。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findBrowser(pref) {
  if (pref && existsSync(pref)) return pref;
  for (const b of BROWSERS) if (existsSync(b)) return b;
  throw new Error('未找到 Chrome/Edge 可执行文件');
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { res, rej } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      } else if (msg.method) {
        for (const h of cdp.handlers) h(msg.method, msg.params);
      }
    };
    ws.onclose = () => { /* 关闭竞态：忽略 */ };
    ws.onerror = () => { /* 忽略 */ };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 600000);
    });
  }
  on(fn) { this.handlers.push(fn); }
  async evaluate(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('JS eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

/**
 * 启动一个 headless Chrome，返回 { cdp, kill, browser }。
 * opts: { port, width, height, gpu:'swiftshader'|'angle', window:false, log }
 */
export async function launch(opts = {}) {
  const {
    browser: bpref, port = 9222, width = 1280, height = 720,
    gpu = 'angle', dpr = 1, log = false,
  } = opts;
  const exe = findBrowser(bpref);
  const profile = join(process.env.TEMP || '/tmp', 'lg-cdp-' + port);
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--force-device-scale-factor=' + dpr,
    '--window-size=' + width + ',' + height,
    '--hide-scrollbars',
  ];
  if (gpu === 'swiftshader') args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  else args.push('--use-gl=angle', '--use-angle=d3d11', '--enable-gpu-rasterization');
  const proc = spawn(exe, args, { stdio: log ? 'inherit' : 'ignore' });
  // 等待调试端点
  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (res.ok) { await sleep(200); targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); break; }
    } catch { /* retry */ }
  }
  if (!targets) { proc.kill(); throw new Error('Chrome 未能启动调试端点'); }
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    const t2 = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank')).json();
    page = t2;
  }
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  const kill = () => { try { proc.kill(); } catch { /* noop */ } if (existsSync(profile)) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ } } };
  return { cdp, kill, exe, url: page.url };
}

export async function navigate(cdp, url, { width, height, dpr = 1 } = {}) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  if (width) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  }
  const errors = [];
  const logs = [];
  cdp.on((method, params) => {
    if (method === 'Runtime.consoleAPICalled') {
      const txt = (params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push((params.type || 'log') + ': ' + txt);
      if (params.type === 'error' || params.type === 'warning') errors.push('console.' + params.type + ': ' + txt);
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      errors.push('exception: ' + (d.exception?.description || d.text || JSON.stringify(d)));
    } else if (method === 'Log.entryAdded') {
      const e = params.entry;
      if (e.level === 'error') errors.push('log.error: ' + e.text);
    }
  });
  await cdp.send('Page.navigate', { url });
  // 等待 __LG__ 就绪
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    try {
      const ok = await cdp.evaluate('!!(window.__LG__ && window.__LG__.eventsData)');
      if (ok) return { errors, logs };
    } catch { /* eval 可能因导航中断 */ }
  }
  return { errors, logs };
}

export async function screenshot(cdp, file, format = 'png') {
  const r = await cdp.send('Page.captureScreenshot', { format, captureBeyondViewport: false });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

/** 等待 N 帧渲染（用双 rAF + 时间） */
export async function waitForFrames(cdp, n = 3) {
  await cdp.evaluate(`new Promise(r=>{let i=0;const l=()=>{if(++i>= ${n})r();else requestAnimationFrame(l)};requestAnimationFrame(l)})`, true);
}
