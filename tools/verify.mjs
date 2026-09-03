/** 最终验证：FPS、无缝循环接缝、进度拖动确定性。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const { cdp, kill } = await launch({ port: 9350, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/?autoplay=0', { width: 1280, height: 720 });
  await sleep(2000);
  await cdp.evaluate('window.__LG__.dbgFreezeGov = true');

  // 1) 实测 FPS（连续渲染 3 秒）
  const fps = await cdp.evaluate(`(async()=>{
    window.__LG__.setExportMode(false);
    const t0=performance.now(); let f=0;
    await new Promise(res=>{const l=()=>{f++; if(performance.now()-t0<3000)requestAnimationFrame(l); else res();};requestAnimationFrame(l);});
    return +(f/((performance.now()-t0)/1000)).toFixed(1);
  })()`, true);
  console.log('FPS(ultra 1280x720):', fps);

  // 2) 进度拖动确定性：seek 到 60 → 截图 A；乱跳 → 再 seek 回 60 → 截图 B；应逐像素一致
  await cdp.evaluate('window.__LG__.seek(60)'); await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/v_seek60a.png');
  await cdp.evaluate('window.__LG__.seek(3); window.__LG__.seek(101); window.__LG__.seek(48); window.__LG__.seek(60)');
  await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/v_seek60b.png');
  const a = readFileSync('tools/shots/v_seek60a.png'), b = readFileSync('tools/shots/v_seek60b.png');
  console.log('seek 确定性：两次 t=60 截图字节相同 =', a.length === b.length && a.equals(b));

  // 3) 无缝循环接缝：t=0 与 t=120（=119.999）画面应一致
  await cdp.evaluate('window.__LG__.seek(0)'); await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/v_loop0.png');
  await cdp.evaluate('window.__LG__.seek(119.999)'); await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/v_loop120.png');
  const l0 = readFileSync('tools/shots/v_loop0.png'), l1 = readFileSync('tools/shots/v_loop120.png');
  console.log('循环接缝：t=0 与 t=120 截图字节相同 =', l0.length === l1.length && l0.equals(l1));

  // 4) 内部状态确定性：seek 60 两次，读取相机/阶段/水滴/晶体等关键状态，应完全一致
  const snap = async () => cdp.evaluate(`(()=>{const a=window.__LG__.dbgState();return JSON.stringify(a)})()`);
  await cdp.evaluate('window.__LG__.seek(60)'); const s1 = await snap();
  await cdp.evaluate('window.__LG__.seek(3); window.__LG__.seek(101); window.__LG__.seek(48); window.__LG__.seek(60)'); const s2 = await snap();
  console.log('状态确定性：seek(60) 两次快照一致 =', s1 === s2);
  if (s1 !== s2) { console.log('A:', s1); console.log('B:', s2); }

  // 5) 循环接缝状态：t=0 与 t=119.999 的相机/阶段/水滴应几乎一致
  await cdp.evaluate('window.__LG__.seek(0)'); const s0 = await snap();
  await cdp.evaluate('window.__LG__.seek(119.999)'); const sEnd = await snap();
  const j0 = JSON.parse(s0), jE = JSON.parse(sEnd);
  const near = (x, y) => Math.abs(x - y) < 0.02;
  const loopOK = near(j0.cam.px, jE.cam.px) && near(j0.cam.py, jE.cam.py) && near(j0.cam.pz, jE.cam.pz)
    && near(j0.ph.gatherP, jE.ph.gatherP) && near(j0.drop.glow, jE.drop.glow);
  // 注：gather 在 t=0(=0,花未出生) 与 t=120(=1,花收拢) 不同，但两者都使花完全隐藏 → 视觉等价
  console.log('循环接缝状态一致(相机/粒子汇聚/水滴) =', loopOK);
  if (!loopOK) { console.log('t0 :', s0); console.log('t120:', sEnd); }
} catch (e) {
  console.error('VERIFY FAILED:', e.message);
} finally {
  cdp.close(); kill(); process.exit(0);
}
