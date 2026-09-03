/** 二分定位黑条：后期 vs 直出 vs 单层可见性。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9335, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(2000);
  // 1) 正常后期
  await cdp.evaluate('window.__LG__.seek(2.9)');
  await waitForFrames(cdp, 4);
  await screenshot(cdp, 'tools/shots/dbg_1_post.png');
  // 2) 绕过后期直出
  await cdp.evaluate('window.__LG__.dbgNoPost = true; window.__LG__.seek(2.9)');
  await waitForFrames(cdp, 4);
  await screenshot(cdp, 'tools/shots/dbg_2_raw.png');
  // 3) 直出 + 只留天空
  await cdp.evaluate('window.__LG__.dbgHideAll(); window.__LG__.dbgSet("sky", true); window.__LG__.seek(2.9)');
  await waitForFrames(cdp, 4);
  await screenshot(cdp, 'tools/shots/dbg_3_skies.png');
  // 4) 直出 + 天空 + 水面
  await cdp.evaluate('window.__LG__.dbgSet("water", true); window.__LG__.seek(2.9)');
  await waitForFrames(cdp, 4);
  await screenshot(cdp, 'tools/shots/dbg_4_water.png');
  // 5) 直出 + 天空 + 水面 + splash
  await cdp.evaluate('window.__LG__.dbgSet("splash", true); window.__LG__.seek(2.9)');
  await waitForFrames(cdp, 4);
  await screenshot(cdp, 'tools/shots/dbg_5_splash.png');
  // 6) 全部 + 直出
  await cdp.evaluate('window.__LG__.dbgHideAll(); ["sky","water","bed","splash","flowers","centers","stems","ribbons","marbles","crystals","micro","particles","atmo","pollens"].forEach(n=>window.__LG__.dbgSet(n,true)); window.__LG__.seek(2.9)');
  await waitForFrames(cdp, 4);
  await screenshot(cdp, 'tools/shots/dbg_6_allraw.png');
  console.log('done');
} finally {
  cdp.close(); kill(); process.exit(0);
}
