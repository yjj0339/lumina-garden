/** 决定性测试：t=15 分别隐藏水面/池底/晶体，看金字塔归属。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9342, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  const shot = async (name, expr) => {
    await cdp.evaluate(expr + '; window.__LG__.seek(15)');
    await waitForFrames(cdp, 5);
    await screenshot(cdp, `tools/shots/${name}.png`);
    console.log(name);
  };
  await shot('d6_nowater', 'window.__LG__.dbgSet("water", false)');
  await shot('d6_nobed', 'window.__LG__.dbgSet("water", true); window.__LG__.dbgSet("bed", false)');
  await shot('d6_nocrystal', 'window.__LG__.dbgSet("bed", true); window.__LG__.dbgSet("crystals", false)');
  // 检查水面顶点是否含 NaN/Inf（读回 CPU 侧 uniform 与网格）
  const probe = await cdp.evaluate(`(()=>{
    const app=window.__LG__; const sc=app.dbgScene(); let w=null;
    sc.traverse(o=>{ if(o.isMesh && o.geometry.type==='PlaneGeometry' && o.position.y===0 && !w) w=o;});
    const pos=w.geometry.attributes.position.array;
    let bad=0, maxy=0;
    for(let i=1;i<pos.length;i+=3){ if(!isFinite(pos[i])) bad++; else maxy=Math.max(maxy,Math.abs(pos[i])); }
    return {bad, maxy:+maxy.toFixed(3), count:pos.length/3};
  })()`);
  console.log('waterCPU:', JSON.stringify(probe));
} finally {
  cdp.close(); kill(); process.exit(0);
}
