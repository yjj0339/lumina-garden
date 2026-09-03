/**
 * 开场/终章水珠系统：
 *  - 水滴：自由落体解析轨迹 + 表面张力形变（拉长→扁椭→恢复）+ 内部折光高光
 *  - 水冠：王冠液膜（抛物轮廓 shader）+ 冠状顶缘 + 回落
 *  - 溅珠：初速按事件表种子推演，抛物线 + 二次入水
 *  - 尾滴：水冠柱断裂的细流与顶滴（经典牛奶皇冠美学）
 * 全部为 t 的解析函数，seek 后状态确定。
 */
import * as THREE from 'three';
import { CHUNK_COMMON, CHUNK_FRESNEL } from '../core/shaders';
import type { Events } from '../core/events';
import { clamp, hash21, smoothstep } from '../core/math';
import { PALETTE } from '../core/palette';

const clamp2 = clamp; // 复用

const DROP_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform vec3 uCol; uniform float uGlow; uniform float uTime; uniform vec3 uCamPos;
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld);
  float fres=fresnel(N,V,0.06);
  vec3 R=reflect(-V,N);
  vec3 refr=skyColor(refract(-V,N,0.78));
  vec3 refl=skyColor(normalize(R));
  vec3 col=mix(refr,refl,clamp(fres*1.2,0.0,1.0));
  col=mix(col,uCol,0.45);
  col+=ENV_PEARL*pow(max(dot(R,normalize(vec3(0.4,0.8,0.3))),0.0),90.0)*1.6;
  col+=uCol*uGlow*1.8;
  gl_FragColor=vec4(col,clamp(0.5+fres*0.5+uGlow*0.4,0.0,1.0));
}`;

const DROP_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vN=normalize(mat3(modelMatrix)*normal);
  vec4 w=modelMatrix*vec4(position,1.0);
  vWorld=w.xyz; vUv=uv;
  gl_Position=projectionMatrix*viewMatrix*w;
}`;

const CROWN_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform float uH; uniform float uAge; uniform vec3 uCol; uniform float uTime; uniform vec3 uCamPos;
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld);
  if(!gl_FrontFacing) N=-N;
  float fres=fresnel(N,V,0.04);
  vec3 R=reflect(-V,N);
  vec3 refr=skyColor(refract(-V,N,0.85));
  vec3 refl=skyColor(normalize(R));
  vec3 col=mix(refr,refl,clamp(fres*1.1,0.0,1.0));
  col=mix(col,uCol,0.22);
  // 底部更厚更色，顶部变薄发白（水膜厚度感）
  col=mix(col,uCol*1.05,smoothstep(0.9,0.15,vUv.y)*0.35);
  // 冠尖彩光
  float tip=pow(vUv.y,6.0);
  col+=ENV_PEARL*tip*0.8;
  float alpha=clamp(0.3+fres*0.55+tip*0.2,0.0,0.8)*(1.0-uAge*uAge);
  gl_FragColor=vec4(col,alpha);
}`;

export class Splash {
  group = new THREE.Group();
  private events: Events;
  private dropMesh: THREE.Mesh;
  private dropMat: THREE.ShaderMaterial;
  private crownMesh: THREE.Mesh;
  private crownMat: THREE.ShaderMaterial;
  private sheetMat: THREE.ShaderMaterial; // 尾滴薄液膜
  private dropGeoBase: THREE.SphereGeometry;
  private drops: { m: THREE.Mesh; t0: number; v0: THREE.Vector3; p0: THREE.Vector3; r: number }[] = [];
  private film: THREE.Mesh;
  private camU: { value: THREE.Vector3 };
  private colCoral = new THREE.Color();
  constructor(events: Events, camera: THREE.Camera) {
    this.events = events;
    this.colCoral.copy(new THREE.Color(PALETTE.coral)).convertSRGBToLinear();
    this.camU = { value: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld) };
    // —— 主水滴
    this.dropGeoBase = new THREE.SphereGeometry(1, 32, 24);
    this.dropMat = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT, fragmentShader: DROP_FRAG,
      uniforms: { uCol: { value: this.colCoral.toArray() }, uGlow: { value: 0 }, uTime: { value: 0 }, uCamPos: this.camU },
      transparent: true, depthWrite: false,
    });
    this.dropMesh = new THREE.Mesh(this.dropGeoBase, this.dropMat);
    this.dropMesh.frustumCulled = false;
    this.group.add(this.dropMesh);
    // —— 水冠（抛物膜）
    this.crownMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        uniform float uH; uniform float uR0; varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
        void main(){
          // position 来自圆柱面参数，uv.y 0底→1顶缘
          float t=uv.y;
          float ang=uv.x*6.2831853;
          // 王冠轮廓：底收、口张、顶缘尖齿
          float prongs=1.0+0.22*smoothstep(0.55,1.0,t)*pow(abs(sin(ang*7.0)),3.0);
          float rad=uR0*(0.42+t*t*0.72)*prongs;
          float y=uH*(t*0.92+0.05*sin(t*3.14159));
          vec3 P=vec3(cos(ang)*rad,y,sin(ang)*rad);
          // 法线近似
          vec3 dA=vec3(-sin(ang)*rad,0.0,cos(ang)*rad);
          vec3 dT=vec3(cos(ang)*rad*0.75,uH*0.95,sin(ang)*rad*0.75);
          vN=normalize(cross(dT,dA));
          vec4 w=modelMatrix*vec4(P,1.0);
          vWorld=w.xyz; vUv=uv;
          gl_Position=projectionMatrix*viewMatrix*w;
        }`,
      fragmentShader: CROWN_FRAG,
      uniforms: {
        uH: { value: 1 }, uAge: { value: 0 }, uCol: { value: this.colCoral.toArray() },
        uTime: { value: 0 }, uCamPos: this.camU, uR0: { value: 0.22 },
      },
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.crownMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 24, true), this.crownMat);
    this.crownMesh.frustumCulled = false;
    this.group.add(this.crownMesh);
    // —— 尾滴液膜（drop→crown 之间的细流）
    this.sheetMat = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT,
      fragmentShader: /* glsl */ `
        ${CHUNK_COMMON}
        uniform vec3 uCol; uniform float uFade; varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
        void main(){ gl_FragColor=vec4(uCol*1.2+ENV_PEARL*0.3,uFade*(1.0-abs(vUv.y-0.5)*1.2)); }`,
      uniforms: { uCol: { value: this.colCoral.toArray() }, uFade: { value: 0 } },
      transparent: true, depthWrite: false,
    });
    this.film = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), this.sheetMat);
    this.film.frustumCulled = false;
    this.group.add(this.film);
    // —— 溅珠
    const dg = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(dg, this.dropMat);
      m.frustumCulled = false;
      this.group.add(m);
      const a = (i / 26) * Math.PI * 2 + hash21(i, 3) * 0.5;
      const sp = 0.7 + hash21(i, 7) * 1.5;
      const up = 1.1 + hash21(i, 11) * 2.1;
      this.drops.push({
        m, t0: events.drop.impact + hash21(i, 13) * 0.08,
        v0: new THREE.Vector3(Math.cos(a) * sp, up, Math.sin(a) * sp),
        p0: new THREE.Vector3(Math.cos(a) * 0.1, 0.12, Math.sin(a) * 0.1),
        r: 0.012 + hash21(i, 17) * 0.02,
      });
    }
  }

  glow(): number { return this.dropMat.uniforms.uGlow.value as number; }
  dropY(): number { return this.dropMesh.position.y; }
  dropVisible(): boolean { return this.dropMesh.visible; }

  update(t: number, camera: THREE.Camera): void {
    this.camU.value.setFromMatrixPosition(camera.matrixWorld);
    const d = this.events.drop;
    const imp = d.impact;
    this.dropMat.uniforms.uTime.value = t;
    this.crownMat.uniforms.uTime.value = t;

    // —— 主水滴（解析状态机，两端一致以保证无缝循环）
    const yTop = d.h + 0.115; // 悬停底缘高度
    const gt = 116.9;         // 终章水滴凝现起点
    const setHang = (): void => {
      this.dropMesh.visible = true;
      this.dropMesh.position.set(0, yTop, 0);
      this.dropMesh.scale.set(d.r, d.r, d.r);
      this.dropMat.uniforms.uGlow.value = 0.15;
      this.film.visible = false;
      this.sheetMat.uniforms.uFade.value = 0;
    };
    if (t < d.release) {
      setHang(); // 循环首端：悬停待放
    } else if (t < imp) {
      const age = t - d.release;
      const drop = 0.5 * d.g * age * age;
      const y = yTop - drop;
      this.dropMesh.visible = true;
      this.dropMesh.position.set(0, y, 0);
      const near = smoothstep(0.35, 1.0, clamp2(drop / d.h, 0, 1));
      const sy = 1 + near * 0.55;
      const sxz = 1 / Math.sqrt(sy);
      this.dropMesh.scale.set(d.r * sxz, d.r * sy, d.r * sxz);
      this.dropMat.uniforms.uGlow.value = 0.1;
      // 尾滴液膜：从释放点垂到水滴
      const len = Math.max(0.001, yTop - (y + d.r * sy));
      this.film.visible = len > 0.015;
      this.film.position.set(0, y + d.r * sy + len / 2, 0);
      this.film.scale.set(0.012 * (1 - near * 0.6), len, 0.012 * (1 - near * 0.6));
      this.sheetMat.uniforms.uFade.value = 0.55 * (1 - near);
    } else if (t < gt) {
      this.dropMesh.visible = false;
      this.film.visible = false;
      this.sheetMat.uniforms.uFade.value = 0;
    } else {
      // 终章：光芒汇聚成水滴，凝现并归位悬停 → 与 t<release 精确一致
      const age = clamp2((t - gt) / 3.1, 0, 1);
      this.dropMesh.visible = true;
      const s = d.r * (0.25 + 0.75 * easeOutBackLocal(age));
      this.dropMesh.position.set(0, yTop - (1 - age) * 0.02, 0);
      this.dropMesh.scale.set(s, s * (1 + (1 - age) * 0.5), s);
      this.dropMat.uniforms.uGlow.value = 0.15 + (1 - age) * 1.2; // 收敛到悬停态 0.15
      this.film.visible = false;
      this.sheetMat.uniforms.uFade.value = 0;
    }

    // —— 水冠
    const ca = t - imp;
    if (ca >= 0 && ca < 1.6) {
      this.crownMesh.visible = true;
      const up = Math.sin(clamp2(ca / 1.5, 0, 1) * Math.PI * 0.62);
      const H = 0.34 * up * (1 - ca * 0.25);
      this.crownMat.uniforms.uH.value = Math.max(0.02, H);
      this.crownMat.uniforms.uR0.value = 0.1 + ca * 0.3;
      this.crownMat.uniforms.uAge.value = clamp2(ca / 1.6, 0, 1);
    } else {
      this.crownMesh.visible = false;
    }

    // —— 溅珠
    for (const sp2 of this.drops) {
      const a = t - sp2.t0;
      if (a < 0 || a > 2.4) { sp2.m.visible = false; continue; }
      const y = sp2.p0.y + sp2.v0.y * a - 0.5 * 9.8 * a * a;
      if (y < -0.02) { sp2.m.visible = false; continue; }
      sp2.m.visible = true;
      sp2.m.position.set(sp2.p0.x + sp2.v0.x * a, y, sp2.p0.z + sp2.v0.z * a);
      const st = clamp2(1 - a * 0.45, 0.3, 1);
      sp2.m.scale.set(sp2.r * st, sp2.r / st, sp2.r * st);
    }
  }
}

function easeOutBackLocal(x: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
