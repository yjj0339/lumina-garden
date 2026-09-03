/** 黑方块逐层精确定位（post 模式，每次只关一层）。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9337, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(2000);
  const shot = async (name) => { await cdp.evaluate(`window.__LG__.seek(15)`); await waitForFrames(cdp, 5); await screenshot(cdp, `tools/shots/${name}.png`); console.log(name); };
  await shot('d3_all');
  await cdp.evaluate('window.__LG__.dbgSet("flowers", false)');
  await shot('d3_noflowers');
  await cdp.evaluate('window.__LG__.dbgSet("flowers", true); window.__LG__.dbgSet("stems", false)');
  await shot('d3_nostems');
  await cdp.evaluate('window.__LG__.dbgSet("stems", true); window.__LG__.dbgSet("centers", false)');
  await shot('d3_nocenters');
  // 只留花朵（其他全关）
  await cdp.evaluate('window.__LG__.dbgHideAll(); window.__LG__.dbgSet("sky", true); window.__LG__.dbgSet("flowers", true)');
  await shot('d3_onlyflowers');
  // 只留花朵 + 水面
  await cdp.evaluate('window.__LG__.dbgSet("water", true); window.__LG__.dbgSet("bed", true)');
  await shot('d3_flowers_water');
} finally {
  cdp.close(); kill(); process.exit(0);
}
