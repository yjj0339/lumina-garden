/** 列出 t=15 所有可见对象（含材质色/几何类型/包围盒尺寸），锁定异常金字塔。 */
import { launch, navigate, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9340, width: 1280, height: 720 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 1280, height: 720 });
  await sleep(1800);
  const info = await cdp.evaluate(`(()=>{
    const app=window.__LG__; app.seek(15);
    const sc=app.dbgScene(); const out=[];
    sc.traverse(o=>{
      if(!o.visible) return;
      if(o.isMesh||o.isPoints||o.isLine){
        let bb=null;
        try{ o.geometry.computeBoundingBox(); const b=o.geometry.boundingBox; bb=[+(b.max.x-b.min.x).toFixed(1),+(b.max.y-b.min.y).toFixed(1),+(b.max.z-b.min.z).toFixed(1)];}catch(e){}
        const col = o.material && o.material.color ? o.material.color.getHexString() : (o.material&&o.material.uniforms&&o.material.uniforms.uCol? 'uCol':'');
        out.push({type:o.type, geo:(o.geometry&&o.geometry.type)||'', bb, col, rc:o.renderOrder,
          pos:[+o.position.x.toFixed(1),+o.position.y.toFixed(1),+o.position.z.toFixed(1)],
          scale:[+o.scale.x.toFixed(2),+o.scale.y.toFixed(2),+o.scale.z.toFixed(2)]});
      }
    });
    return out;
  })()`);
  console.log(JSON.stringify(info));
} finally {
  cdp.close(); kill(); process.exit(0);
}
