/** 逐层隔离：每次只显示一个图层，锁定 t=15 橙色三角来源。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const LAYERS = ['sky', 'water', 'bed', 'splash', 'flowers', 'centers', 'stems', 'ribbons', 'marbles', 'crystals', 'micro', 'particles', 'atmo', 'pollens'];
const { cdp, kill } = await launch({ port: 9343, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  for (const only of LAYERS) {
    const expr = `(()=>{const L=${JSON.stringify(LAYERS)};L.forEach(n=>window.__LG__.dbgSet(n,false));window.__LG__.dbgSet(${JSON.stringify(only)},true);window.__LG__.seek(15);})()`;
    await cdp.evaluate(expr);
    await waitForFrames(cdp, 5);
    await screenshot(cdp, `tools/shots/iso_${only}.png`);
    console.log('iso', only);
  }
} finally {
  cdp.close(); kill(); process.exit(0);
}
