/**
 * 琉璃轨道 + 弹跳彩球：
 *  - 轨道：TubeGeometry 玻璃材质（半透 + 虹彩边缘），按 open/close 淡入淡出。
 *  - 彩球：位置由 keys 表插值（轨道段）+ 解析弹跳公式（落地段），
 *    挤压/拉伸/回弹/余震全部用阻尼振子表达，seek 后精确重现。
 */
import * as THREE from 'three';
import { CHUNK_COMMON, CHUNK_FRESNEL } from '../core/shaders';
import type { Events, OrbEv } from '../core/events';
import { RIPPLE_COLORS } from '../core/palette';
import { catmullRom, arcTable, sampleArc, clamp, smoothstep } from '../core/math';

const G = 9.8;

const GLASS_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){ vN=normalize(mat3(modelMatrix)*normal);
 vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; vUv=uv;
 gl_Position=projectionMatrix*viewMatrix*w; }`;
const GLASS_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform vec3 uCol; uniform float uFade; uniform vec3 uCamPos; uniform float uTime;
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld);
  float fres=fresnel(N,V,0.04);
  vec3 refr=skyColor(refract(-V,N,0.9));
  vec3 refl=skyColor(reflect(-V,N));
  vec3 col=mix(refr,refl,clamp(fres*1.15,0.0,1.0));
  col=mix(col,uCol,0.3);
  vec3 iridCol=0.5+0.5*cos(fres*9.0+uTime*0.6+vec3(0.0,2.1,4.2)*0.6);
  col+=iridCol*0.1*smoothstep(0.3,0.9,fres);
  col+=ENV_PEARL*pow(max(dot(reflect(-V,N),normalize(vec3(0.4,0.8,0.3))),0.0),60.0)*0.8;
  gl_FragColor=vec4(col,(0.3+fres*0.5)*uFade);
}`;

interface OrbRuntime {
  ev: OrbEv;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  poly: number[][];
  table: number[];
  total: number;
}

export class Marbles {
  group = new THREE.Group();
  private rails: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; open: number; close: number }[] = [];
  private orbs: OrbRuntime[] = [];
  private camU: { value: THREE.Vector3 };
  private bounceRipples: { x: number; z: number; t0: number; amp: number }[] = [];

  constructor(events: Events, camera: THREE.Camera) {
    this.camU = { value: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld) };
    // 轨道
    for (const rail of events.rails) {
      const pts: number[][] = [];
      for (let i = 0; i < rail.pts.length; i += 3) pts.push(rail.pts.slice(i, i + 3));
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      const geo = new THREE.TubeGeometry(curve, 90, rail.r, 8, false);
      const c = RIPPLE_COLORS[rail.col % RIPPLE_COLORS.length];
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
        uniforms: { uCol: { value: new THREE.Vector3(c[0], c[1], c[2]) }, uFade: { value: 0 }, uCamPos: this.camU, uTime: { value: 0 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.group.add(mesh);
      this.rails.push({ mesh, mat, open: rail.open, close: rail.close });
    }
    // 小球
    const sphere = new THREE.SphereGeometry(1, 24, 18);
    for (const ev of events.orbs) {
      const rail = events.rails[ev.rail];
      const pts: number[][] = [];
      for (let i = 0; i < rail.pts.length; i += 3) pts.push(rail.pts.slice(i, i + 3));
      const poly = catmullRom(pts, false, 220);
      const { table, total } = arcTable(poly);
      const c = RIPPLE_COLORS[ev.col % RIPPLE_COLORS.length];
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: /* glsl */ `
          ${CHUNK_COMMON}
          ${CHUNK_FRESNEL}
          uniform vec3 uCol; uniform vec3 uCamPos; uniform float uTime;
          varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
          void main(){
            vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld);
            float fres=fresnel(N,V,0.05);
            vec3 refl=skyColor(reflect(-V,N));
            vec3 refr=skyColor(refract(-V,N,0.7));
            vec3 col=mix(refr*0.9+uCol*0.5,refl,clamp(fres*1.2,0.0,1.0));
            col=mix(col,uCol,0.55);
            float spec=pow(max(dot(reflect(-V,N),normalize(vec3(0.4,0.8,0.3))),0.0),80.0);
            col+=ENV_PEARL*spec*1.6;
            float ring=smoothstep(0.86,0.98,vUv.y)*0.35;
            col+=vec3(1.0,0.98,0.95)*ring;
            gl_FragColor=vec4(col,0.92);
          }`,
        uniforms: { uCol: { value: new THREE.Vector3(c[0], c[1], c[2]) }, uCamPos: this.camU, uTime: { value: 0 } },
        transparent: true,
      });
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.orbs.push({ ev, mesh, mat, poly, table, total });
      if (ev.landT > 0) {
        // 预登记落地涟漪（运行时在 update 里注入水面的替代：直接由 water 读 events 完成，这里只做音效同步用）
        this.bounceRipples.push({ x: 0, z: 0, t0: ev.landT, amp: 0 });
      }
    }
  }

  /** 落地弹跳高度解析式：返回 [y, squash] */
  private bounceY(o: OrbEv, t: number): { y: number; sq: number; vy: number } {
    const dt = t - o.landT;
    if (dt < 0) return { y: -999, sq: 1, vy: 0 };
    let bvy = o.vy0 * o.e, bt = 0;
    const e = o.e;
    for (let b = 0; b < 6; b++) {
      const airT = (2 * bvy) / G;
      if (airT < 0.06) break;
      if (dt <= bt + airT) {
        const a = dt - bt;
        const y = bvy * a - 0.5 * G * a * a;
        const phase = a / airT;
        const sq = 1 - 0.28 * Math.exp(-phase * 9) * Math.sin(phase * 14) * (b === 0 ? 1 : 0.6) * Math.exp(-b);
        return { y: Math.max(0.02, y), sq, vy: bvy - G * a };
      }
      bt += airT;
      bvy *= e;
    }
    return { y: -999, sq: 1, vy: 0 };
  }

  update(t: number, gather: number, camera: THREE.Camera): void {
    this.camU.value.setFromMatrixPosition(camera.matrixWorld);
    for (const r of this.rails) {
      const fade = smoothstep(r.open - 1.2, r.open + 0.4, t) * (1 - smoothstep(r.close - 2, r.close, t)) * (1 - gather);
      r.mesh.visible = fade > 0.01;
      r.mat.uniforms.uFade.value = fade;
      r.mat.uniforms.uTime.value = t;
    }
    for (const o of this.orbs) {
      const ev = o.ev;
      let pos: THREE.Vector3 | null = null;
      let squash = 1;
      if (t >= ev.t0 && t <= ev.exitT) {
        // 轨道段：keys 插值
        const ks = ev.keys;
        let s = 0;
        if (ks && ks.length > 1) {
          let i = 0;
          while (i < ks.length - 2 && ks[i + 1][0] <= t) i++;
          const a = ks[i], b = ks[i + 1];
          const u = b[0] === a[0] ? 0 : clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
          s = a[1] + (b[1] - a[1]) * u;
        } else s = clamp((t - ev.t0) / (ev.exitT - ev.t0), 0, 1);
        const { pos: p } = sampleArc(o.poly, o.table, o.total, s);
        pos = new THREE.Vector3(p[0], p[1] + ev.r + 0.02, p[2]);
        // 高速滚动轻微纵向挤压观感
        squash = 1 + Math.sin(t * 18 + ev.exitT) * 0.02;
      } else if (t > ev.exitT && ev.landT > 0) {
        const b = this.bounceY(ev, t);
        if (b.y > -900) {
          const [ex, , ez, evx, , evz] = ev.exit;
          const dtb = t - ev.exitT;
          const tf = dtb;
          const x = ex + evx * tf, z = ez + evz * tf;
          pos = new THREE.Vector3(x, b.y + ev.r, z);
          squash = b.sq;
        }
      }
      const visible = pos !== null && gather < 0.6;
      o.mesh.visible = visible;
      if (pos && visible) {
        const sy = ev.r * squash;
        const sxz = ev.r / Math.sqrt(Math.max(0.3, squash));
        o.mesh.position.copy(pos);
        o.mesh.scale.set(sxz, sy, sxz);
        o.mat.uniforms.uTime.value = t;
      }
    }
  }
}
