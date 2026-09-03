/** 精确定位黑方块：raw vs post，逐粒子层开关，花朵近景。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9336, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(2000);
  const shot = async (name) => { await waitForFrames(cdp, 4); await screenshot(cdp, `tools/shots/${name}.png`); console.log(name); };
  await cdp.evaluate('window.__LG__.seek(15)');
  await cdp.evaluate('window.__LG__.dbgNoPost = true');
  await shot('d2_raw15');
  await cdp.evaluate('window.__LG__.dbgNoPost = false');
  await shot('d2_post15');
  // post + 关 pollens
  await cdp.evaluate('window.__LG__.dbgSet("pollens", false); window.__LG__.seek(15)');
  await shot('d2_post15_nopollen');
  // 再关 dust
  await cdp.evaluate('window.__LG__.dbgSet("particles", true); window.__LG__.seek(15)');
  const g = await cdp.evaluate('(()=>{const p=window.__LG__.dbgScene();let r=null;p.traverse(o=>{if(o.isPoints)r=r||o;});return r?r.name||"pt":"none"})()');
  void g;
  await cdp.evaluate('window.__LG__.dbgSet("centers", false); window.__LG__.seek(15)');
  await shot('d2_post15_nocenter');
  await cdp.evaluate('window.__LG__.dbgSet("centers", true); window.__LG__.dbgSet("flowers", false); window.__LG__.dbgSet("stems", false); window.__LG__.seek(15)');
  await shot('d2_post15_noflower');
  // 近景花朵（t=23 相机在主角花旁）
  await cdp.evaluate('window.__LG__.dbgSet("flowers", true); window.__LG__.dbgSet("stems", true); window.__LG__.seek(23)');
  await shot('d2_hero23');
  await cdp.evaluate('window.__LG__.seek(20)');
  await shot('d2_hero20');
} finally {
  cdp.close(); kill(); process.exit(0);
}
