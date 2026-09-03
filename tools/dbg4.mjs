/** 定位 t=15 画面里的橙色金字塔：分别隐藏 splash / 花朵层。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9338, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  await cdp.evaluate('window.__LG__.seek(15); window.__LG__.dbgSet("splash", false)');
  await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/d4_nosplash.png');
  await cdp.evaluate('window.__LG__.dbgSet("splash", true); window.__LG__.dbgSet("flowers", false); window.__LG__.dbgSet("stems", false); window.__LG__.dbgSet("centers", false); window.__LG__.seek(15)');
  await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/d4_onlysplash.png');
  console.log('done');
} finally {
  cdp.close(); kill(); process.exit(0);
}
