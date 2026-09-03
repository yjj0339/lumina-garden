/** 在 JS 复算花瓣实例包围盒，找出 t=15 时塌缩成异常三角形的实例。 */
import { launch, navigate, sleep } from './cdp.mjs';

const { cdp, kill } = await launch({ port: 9344, width: 800, height: 450 });
try {
  await navigate(cdp, 'http://127.0.0.1:4178/', { width: 800, height: 450 });
  await sleep(1500);
  const res = await cdp.evaluate(`(()=>{
    const app=window.__LG__; const t=15;
    const sc=app.dbgScene(); let m=null;
    sc.traverse(o=>{ if(o.isMesh && o.geometry.type==='InstancedBufferGeometry' && o.geometry.attributes.iData1) m=o; });
    const g=m.geometry, N=g.instanceCount;
    const d1=g.attributes.iData1.array, d2=g.attributes.iData2.array, p4=g.attributes.iPos4.array, pr=g.attributes.iParams.array;
    const uv=g.attributes.uv.array, posN=g.attributes.position.count;
    const TAU=Math.PI*2;
    const springG=(x,f,d)=> x<=0?0:1-Math.exp(-d*x)*Math.cos(TAU*f*x);
    const surf=(ux,uy,open,seed,layer)=>{
      const v=uy, u=ux*2-1;
      const o=Math.max(0,Math.min(1,open));
      const w=(0.30+0.70*Math.sin(Math.pow(v,0.78)*Math.PI*0.60))*(1-0.30*Math.pow(v,5));
      const wrap=2.3+(0.30-2.3)*o;
      const ang=u*w*wrap;
      const rad=w/Math.max(wrap,0.02)*0.5;
      const xr=Math.sin(ang)*rad, zr=(1-Math.cos(ang))*rad*0.55;
      const xf=u*w*0.55, zf=0.16*u*u*w*(1-o*0.55);
      let x=xr+(xf-xr)*o, z=zr+(zf-zr)*o;
      let y=v*(0.95+0.10*Math.sin(seed*5));
      y+=Math.sin(v*Math.PI*0.5)*0.10*(1-o);
      y-=Math.pow(v,3)*0.22*o;
      x+=Math.sign(u)*Math.pow(Math.abs(u)*w,3)*0.10*o;
      z+=Math.sin(v*8+seed*9)*0.018*Math.abs(u)*w*o;
      return [x,y,z];
    };
    const out=[];
    for(let i=0;i<N;i++){
      const t0=d1[i*4], scale=d1[i*4+1], rotY0=d1[i*4+2], seed=d1[i*4+3];
      const petalIdx=d2[i*4], petals=d2[i*4+1], layerIdx=d2[i*4+2], layerCount=d2[i*4+3];
      const delay=p4[i*4+3];
      const tiltX=pr[i*4], kind=pr[i*4+1], openDur=Math.max(pr[i*4+3],0.4);
      const raw=Math.max(t-t0,0)/openDur;
      let open=Math.max(0,Math.min(1.25,springG(raw,2,4.2)));
      const layerT=layerIdx/Math.max(layerCount,1);
      open*=raw>0?Math.min(1,raw/0.35):0; open=Math.min(1,open*(1-0.14*layerT));
      const born=(t-t0>=0?1:0)*Math.max(0,Math.min(1,raw/0.12));
      let gd=Math.max(0,Math.min(1,(0*(1)-delay*0.45-layerT*0.12)/0.42));
      const gg=gd*gd*(3-2*gd);
      const shrink=(1-gg)*born;
      if(shrink<0.004) continue;
      let minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9,minz=1e9,maxz=-1e9,nan=0;
      for(let k=0;k<posN;k+=7){
        const ux=uv[k*2], uy=uv[k*2+1];
        const P=surf(ux,uy,open,seed,layerT);
        if(!isFinite(P[0])||!isFinite(P[1])||!isFinite(P[2])){nan++;continue;}
        minx=Math.min(minx,P[0]);maxx=Math.max(maxx,P[0]);
        miny=Math.min(miny,P[1]);maxy=Math.max(maxy,P[1]);
        minz=Math.min(minz,P[2]);maxz=Math.max(maxz,P[2]);
      }
      const ex=(maxx-minx)*scale*shrink, ey=(maxy-miny)*scale*shrink, ez=(maxz-minz)*scale*shrink;
      out.push({i,t0:+t0.toFixed(1),kind,scale:+scale.toFixed(2),shrink:+shrink.toFixed(2),nan,
        ex:+ex.toFixed(2),ey:+ey.toFixed(2),ez:+ez.toFixed(2),
        pos:[+p4[i*4].toFixed(1),+p4[i*4+1].toFixed(1),+p4[i*4+2].toFixed(1)]});
    }
    out.sort((a,b)=>Math.max(b.ex,b.ey,b.ez)-Math.max(a.ex,a.ey,a.ez));
    return {total:N, visible:out.length, top:out.slice(0,10), worstNan:out.filter(o=>o.nan>0).slice(0,5)};
  })()`);
  console.log(JSON.stringify(res, null, 1));
} finally {
  cdp.close(); kill(); process.exit(0);
}
