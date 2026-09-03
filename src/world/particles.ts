/**
 * 粒子群：花粉 / 飞沫 / 气泡 / 光丝 / 薄雾，两组 Points（常规 + additive 光丝）。
 * 运动全部在顶点着色器内用整周期三角函数 → t=0 与 t=120 完全一致（无缝循环）。
 * 收拢时所有粒子向原点光滴汇聚。
 */
import * as THREE from 'three';
import { PARTICLE_FRAG, PARTICLE_VERT } from '../core/shaders';
import type { Events } from '../core/events';
import { RIPPLE_COLORS } from '../core/palette';
import { hash31 } from '../core/math';

function buildPoints(n: number, spread: (i: number) => { pos: [number, number, number]; col: [number, number, number]; size: number; freq: number; phase: number }, additive: boolean): THREE.Points {
  const off = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = spread(i);
    off.set(s.pos, i * 3);
    rand.set([s.phase, s.freq, s.size, 0.5 + hash31(i) * 0.5], i * 4);
    col.set(s.col, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aOffset', new THREE.BufferAttribute(off, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: {
      uTime: { value: 0 }, uGather: { value: 0 }, uSize: { value: 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

export class Particles {
  group = new THREE.Group();
  dust: THREE.Points;   // 花粉/气泡/飞沫（normal blending）
  glow: THREE.Points;   // 光丝/辉尘（additive）
  constructor(events: Events, count: number) {
    void events;
    const nd = Math.floor(count * 0.78);
    const ng = count - nd;
    const T = (Math.PI * 2) / 120;
    const wfreq = (base: number): number => Math.max(1, Math.round(base * 120 / (Math.PI * 2))) * T;
    this.dust = buildPoints(nd, (i) => {
      const zone = i % 7; // 0-4 花海区，5 轨道落水区，6 高潮区
      let px: number, py: number, pz: number;
      if (zone < 5) {
        const a = hash31(i * 3 + 1) * Math.PI * 2;
        const r = 2 + Math.sqrt(hash31(i * 7 + 2)) * 26;
        px = Math.cos(a) * r; pz = Math.sin(a) * r - 6; py = 0.2 + hash31(i * 11 + 3) * 3.4;
      } else if (zone === 5) {
        px = -14 - hash31(i * 13) * 16; pz = -30 - hash31(i * 17) * 22; py = 0.2 + hash31(i * 19) * 6;
      } else {
        const a = hash31(i * 23 + 5) * Math.PI * 2;
        const r = Math.sqrt(hash31(i * 29 + 7)) * 15;
        px = Math.cos(a) * r - 2; pz = Math.sin(a) * r - 68; py = 3 + hash31(i * 31 + 9) * 19;
      }
      const c = RIPPLE_COLORS[Math.floor(hash31(i * 37) * 8) % 8];
      const pearl = 0.3 + hash31(i * 41) * 0.35;
      return {
        pos: [px, py, pz],
        col: [c[0] * 0.5 + pearl, c[1] * 0.5 + pearl, c[2] * 0.48 + pearl],
        size: 0.16 + hash31(i * 43) * 0.3,
        freq: wfreq(0.2 + hash31(i * 47) * 0.35),
        phase: hash31(i * 53) * 10,
      };
    }, false);
    this.glow = buildPoints(ng, (i) => {
      const a = hash31(i * 61 + 3) * Math.PI * 2;
      const r = 1.5 + Math.sqrt(hash31(i * 67 + 1)) * 30;
      const high = hash31(i * 71) > 0.45;
      const px = Math.cos(a) * r * (high ? 0.7 : 1) - (high ? 2 : 0);
      const pz = Math.sin(a) * r * (high ? 0.7 : 1) - (high ? 66 : 4);
      const py = high ? 5 + hash31(i * 73) * 18 : 0.3 + hash31(i * 79) * 5;
      const c = RIPPLE_COLORS[Math.floor(hash31(i * 83) * 8) % 8];
      return {
        pos: [px, py, pz],
        col: [c[0] * 0.45 + 0.05, c[1] * 0.45 + 0.06, c[2] * 0.45 + 0.04],
        size: 0.14 + hash31(i * 89) * 0.24,
        freq: wfreq(0.12 + hash31(i * 97) * 0.3),
        phase: hash31(i * 101) * 10,
      };
    }, true);
    this.dust.renderOrder = 14;
    this.glow.renderOrder = 15;
    this.group.add(this.dust, this.glow);
  }
  update(t: number, gather: number, res: THREE.Vector2, camera: THREE.Camera): void {
    void camera;
    for (const p of [this.dust, this.glow]) {
      const m = p.material as THREE.ShaderMaterial;
      m.uniforms.uTime.value = t;
      m.uniforms.uGather.value = gather;
      (m.uniforms.uRes.value as THREE.Vector2).copy(res);
    }
    // 高潮与微观段光丝增亮（通过 size 通道近似）
    const energyPhase = Math.max(0, Math.sin(((t - 50) / 46) * Math.PI)) * (t > 48 && t < 100 ? 1 : 0);
    (this.glow.material as THREE.ShaderMaterial).uniforms.uSize.value = 1 + energyPhase * 0.5;
  }
}
