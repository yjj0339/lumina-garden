/**
 * 大气：柔和体积光柱（billboard 锥片）+ 薄雾层（相机跟随的软平面）。
 * 全部低 alpha、加法/正常混合，禁止过曝；运动频率为 120s 整数倍保证闭环。
 */
import * as THREE from 'three';
import { CHUNK_COMMON } from '../core/shaders';
import { clamp, smoothstep } from '../core/math';

const SHAFT_FRAG = /* glsl */ `
${CHUNK_COMMON}
uniform float uOpacity; uniform float uTime; uniform vec3 uTint;
varying vec2 vUv;
void main(){
  float x=abs(vUv.x-0.5)*2.0;
  float shaft=pow(1.0-x,2.2);
  float fadeY=pow(vUv.y,0.6)*(1.0-smoothstep(0.75,1.0,vUv.y)*0.6);
  float flick=0.85+0.15*sin(uTime*0.21*TAU+vUv.x*7.0);
  float a=shaft*fadeY*uOpacity*flick*0.16;
  vec3 col=mix(ENV_SUN,uTint,0.4);
  gl_FragColor=vec4(col,a);
}`;

const FOG_FRAG = /* glsl */ `
${CHUNK_COMMON}
uniform float uOpacity; uniform float uTime; uniform vec3 uTint;
varying vec2 vUv;
void main(){
  vec2 p=vUv*6.0;
  float n=fbm(p+vec2(uTime*0.03*TAU,-uTime*0.02*TAU));
  float a=smoothstep(0.35,0.9,n)*uOpacity*0.2*(1.0-abs(vUv.x-0.5)*1.1);
  gl_FragColor=vec4(mix(ENV_PEARL,uTint,0.4),clamp(a,0.0,0.28));
}`;

export class Atmosphere {
  group = new THREE.Group();
  private shafts: THREE.Mesh[] = [];
  private fogs: THREE.Mesh[] = [];
  private shaftMats: THREE.ShaderMaterial[] = [];
  private fogMats: THREE.ShaderMaterial[] = [];
  constructor(count: number, tint: [number, number, number]) {
    const T = (Math.PI * 2) / 120;
    void T;
    // 光柱：沿走廊分布
    for (let i = 0; i < count; i++) {
      const g = new THREE.PlaneGeometry(7 + (i % 3) * 2.4, 30);
      const m = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: SHAFT_FRAG,
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(...tint) } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m);
      const zc = [-2, -14, -30, -46, -62, -72][i % 6];
      const xc = [3, -5, 6, -12, -1, 8][i % 6] + (i % 2 ? 2 : -2);
      mesh.position.set(xc, 9, zc - (i % 3) * 5);
      mesh.rotation.y = (i / count) * Math.PI;
      mesh.renderOrder = 20;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shafts.push(mesh);
      this.shaftMats.push(m);
    }
    // 薄雾层
    for (let i = 0; i < 6; i++) {
      const g = new THREE.PlaneGeometry(60, 60);
      const m = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: FOG_FRAG,
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(...tint) } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2 + 0.06 * (i - 3);
      mesh.position.set(i % 2 ? 4 : -4, 0.6 + i * 1.1, -10 - i * 12);
      mesh.renderOrder = 18;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.fogs.push(mesh);
      this.fogMats.push(m);
    }
  }
  update(t: number, god: number, gather: number, energy: number, camPos: THREE.Vector3, micro = 0): void {
    const TAU = Math.PI * 2;
    for (let i = 0; i < this.shaftMats.length; i++) {
      const m = this.shaftMats[i];
      m.uniforms.uTime.value = t;
      const phase = smoothstep(0, 8, t) * (1 - smoothstep(112, 120, t));
      const breath = 0.5 + 0.5 * Math.sin(t * TAU / 120 * 6 + i * 2.1);
      // 相机贴近光柱时淡出（避免穿脸变成满屏竖线），微观段整体淡出
      const dxy = Math.hypot(camPos.x - this.shafts[i].position.x, camPos.z - this.shafts[i].position.z);
      const prox = smoothstep(3.5, 12, dxy);
      m.uniforms.uOpacity.value = god * phase * (0.4 + 0.6 * breath) * (1 + energy * 0.4) * (1 - gather * 0.8) * prox * (1 - micro * 0.9);
      this.shafts[i].rotation.z = Math.sin(t * TAU / 120 * 2 + i) * 0.06;
    }
    for (let i = 0; i < this.fogMats.length; i++) {
      const m = this.fogMats[i];
      m.uniforms.uTime.value = t;
      const near = clamp(1 - Math.abs(camPos.z - this.fogs[i].position.z) / 26, 0, 1);
      // 相机远高于该雾片时淡出（避免高空俯视把画面蒙成灰白）
      const above = clamp(1 - Math.max(0, camPos.y - this.fogs[i].position.y - 6) / 10, 0, 1);
      m.uniforms.uOpacity.value = near * above * (0.16 + energy * 0.28) * (1 - gather * 0.7) * smoothstep(2, 8, t);
    }
  }
}
