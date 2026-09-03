/** 枚举 splash 子对象 + 逐个开关截图，锁定 t=15 的橙色锥体。 */
import { launch, navigate, screenshot, waitForFrames, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9341, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  const info = await cdp.evaluate(`(()=>{
    const app=window.__LG__; app.seek(15);
    const sc=app.dbgScene(); let g=null;
    sc.traverse(o=>{ if(o.isGroup && o.children.some(c=>c.geometry&&c.geometry.type==='CylinderGeometry')) g=o; });
    if(!g) return 'no splash group';
    return g.children.map((c,i)=>({i, geo:c.geometry.type, vis:c.visible,
      pos:[+c.position.x.toFixed(2),+c.position.y.toFixed(2),+c.position.z.toFixed(2)],
      scale:[+c.scale.x.toFixed(3),+c.scale.y.toFixed(3),+c.scale.z.toFixed(3)]}));
  })()`);
  console.log(JSON.stringify(info));
  // 只关水冠
  await cdp.evaluate(`(()=>{const app=window.__LG__;const sc=app.dbgScene();let g=null;sc.traverse(o=>{if(o.isGroup&&o.children.some(c=>c.geometry&&c.geometry.type==='CylinderGeometry'))g=o;});g.children.forEach(c=>{if(c.geometry.type==='CylinderGeometry')c.visible=false;});app.seek(15);})()`);
  await waitForFrames(cdp, 5);
  await screenshot(cdp, 'tools/shots/d5_nocyl.png');
} finally {
  cdp.close(); kill(); process.exit(0);
}
