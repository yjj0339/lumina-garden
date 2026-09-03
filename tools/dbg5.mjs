/** 枚举 splash 子对象在 t=15 的可见性/变换，锁定异常几何。 */
import { launch, navigate, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9339, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  const info = await cdp.evaluate(`(()=>{
    const app=window.__LG__; app.seek(15);
    const sc=app.dbgScene(); let splash=null; sc.traverse(o=>{ if(o.children && o.children.length>20 && o.type==='Group' && !splash) splash=o; });
    // 更可靠：按名字找
    const out=[];
    sc.traverse(o=>{ if(o.isMesh && o.geometry && o.geometry.type && /Cylinder|Sphere|Cone|Plane/.test(o.geometry.type)){
      const p=o.position, s=o.scale;
      if(Math.abs(p.x)<3 && Math.abs(p.z)<3 && Math.abs(p.y)<3)
        out.push({geo:o.geometry.type, vis:o.visible, mat:o.material.type, pos:[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)], scale:[+s.x.toFixed(3),+s.y.toFixed(3),+s.z.toFixed(3)], rc:o.renderOrder});
    }});
    return out;
  })()`);
  console.log(JSON.stringify(info, null, 1));
} finally {
  cdp.close(); kill(); process.exit(0);
}
