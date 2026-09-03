/** 中后段隔离：分别只开 ribbons / marbles / crystals，确认非空屏。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9345, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  const shot = async (name, keep, t) => {
    await cdp.evaluate(`(()=>{const K=${JSON.stringify(keep)};['sky','water','bed','splash','flowers','centers','stems','ribbons','marbles','crystals','micro','particles','atmo','pollens'].forEach(n=>window.__LG__.dbgSet(n,K.includes(n)));window.__LG__.seek(${t});})()`);
    await waitForFrames(cdp, 5);
    await screenshot(cdp, `tools/shots/${name}.png`);
    console.log(name);
  };
  await shot('mid_ribbons', ['sky', 'water', 'bed', 'ribbons'], 44);
  await shot('mid_marbles', ['sky', 'water', 'bed', 'marbles'], 56);
  await shot('mid_crystals', ['sky', 'water', 'bed', 'crystals'], 85);
  await shot('mid_all44', ['sky', 'water', 'bed', 'flowers', 'centers', 'stems', 'ribbons', 'particles', 'pollens', 'atmo'], 44);
} finally {
  cdp.close(); kill(); process.exit(0);
}
