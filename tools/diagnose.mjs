/**
 * 运行诊断：加载页面 → 捕获错误 → 在关键时刻 seek 并截图（含桌面横屏 + 竖屏）。
 * 用法: node tools/diagnose.mjs [--url http://127.0.0.1:4178/]
 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:4178/';
const moments = [0.5, 2.9, 5.5, 15, 22, 30, 33, 42, 47, 54, 58, 68, 73, 80, 88, 94, 99, 105, 109, 114, 118, 119.6];
const portraitMoments = [1.5, 15, 31, 47, 94, 114];

const { cdp, kill } = await launch({ port: 9333, width: 1280, height: 720 });
let exitCode = 0;
try {
  const { errors, logs } = await navigate(cdp, url, { width: 1280, height: 720 });
  await sleep(2500);
  const glInfo = await cdp.evaluate(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');return g?{renderer:(g.getExtension('WEBGL_debug_renderer_info')&&g.getParameter(37446))||'?',maxTex:g.getParameter(3379)}:null})()`);
  console.log('WebGL2:', JSON.stringify(glInfo));
  for (const t of moments) {
    await cdp.evaluate(`window.__LG__.seek(${t})`);
    await waitForFrames(cdp, 4);
    const f = await screenshot(cdp, `tools/shots/t${String(t).replace('.', '_')}.png`);
    console.log('shot', f);
  }
  // 竖屏 390×844
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  for (const t of portraitMoments) {
    await cdp.evaluate(`window.__LG__.seek(${t})`);
    await waitForFrames(cdp, 4);
    const f = await screenshot(cdp, `tools/shots/p${String(t).replace('.', '_')}.png`);
    console.log('shot', f);
  }
  await cdp.evaluate(`window.__LG__.seek(0)`);
  await sleep(500);
  const state = await cdp.evaluate(`({t:window.__LG__.currentState.t, q:window.__LG__.currentState.quality, flowers:window.__LG__.eventsData.flowers.length})`);
  console.log('state:', JSON.stringify(state));
  const uniq = [...new Set(errors)];
  if (uniq.length) { console.log('--- ERRORS(' + uniq.length + ') ---'); uniq.slice(0, 24).forEach((e) => console.log(e.slice(0, 500))); exitCode = 1; }
  else console.log('--- NO RUNTIME/CONSOLE ERRORS ---');
  const warns = logs.filter((l) => l.startsWith('warning'));
  if (warns.length) { console.log('--- warnings(' + warns.length + ') ---'); warns.slice(0, 8).forEach((w) => console.log(w.slice(0, 300))); }
} catch (e) {
  console.error('DIAG FAILED:', e.message);
  exitCode = 2;
} finally {
  cdp.close();
  kill();
  process.exit(exitCode);
}
