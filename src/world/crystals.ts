/** 悬浮晶体群：八面体实例，生成→自旋漂浮→收拢。 */
import * as THREE from 'three';
import { CRYSTAL_FRAG, CRYSTAL_VERT } from '../core/shaders';
import type { Events } from '../core/events';
import { RIPPLE_COLORS } from '../core/palette';
import { clamp, smoothstep } from '../core/math';

export class Crystals {
  mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private events: Events;
  private camU: { value: THREE.Vector3 };
  private dummy = new THREE.Object3D();
  constructor(events: Events, _camera: THREE.Camera) {
    this.events = events;
    this.camU = { value: new THREE.Vector3() };
    const geo = new THREE.OctahedronGeometry(1, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: CRYSTAL_VERT,
      fragmentShader: CRYSTAL_FRAG,
      uniforms: {
        uTime: { value: 0 }, uGrow: { value: 1 }, uGlow: { value: 0.1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) }, uCamPos: this.camU,
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, Math.max(1, events.crystals.length));
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 逐实例颜色（自定义 aCol 实例属性）
    const n = events.crystals.length;
    const aCol = new Float32Array(Math.max(1, n) * 3);
    for (let i = 0; i < n; i++) {
      const c = RIPPLE_COLORS[events.crystals[i].col % RIPPLE_COLORS.length];
      aCol[i * 3] = c[0]; aCol[i * 3 + 1] = c[1]; aCol[i * 3 + 2] = c[2];
    }
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
    this.dummy.matrixAutoUpdate = false;
  }
  update(t: number, gather: number, energy: number, camera: THREE.Camera): void {
    this.camU.value.setFromMatrixPosition(camera.matrixWorld);
    const w = TAUwrap();
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uGrow.value = 1;
    this.mat.uniforms.uGlow.value = 0.08 + energy * 0.25;
    let idx = 0;
    for (const c of this.events.crystals) {
      const age = t - c.t0;
      let grow = 0;
      if (age >= 0) grow = smoothstep(0, 0.8, age);
      const vis = 1 - clamp((gather - 0.05) / 0.6, 0, 1);
      if (grow <= 0.001 || vis <= 0.001) {
        this.dummy.position.set(0, -9999, 0);
        this.dummy.scale.setScalar(0.0001);
      } else {
        const w1 = Math.sin(t * w(0.4) + c.x) * 0.4;
        const px = gather > 0 ? c.x * (1 - gather) : c.x;
        const pz = gather > 0 ? c.z * (1 - gather) : c.z;
        const py = gather > 0 ? THREE.MathUtils.lerp(c.y, 1.5, gather) + w1 : c.y + w1;
        this.dummy.position.set(px, py, pz);
        const sp = t * c.spin;
        this.dummy.rotation.set(c.ax + sp, c.ay + sp * 0.7, c.az + sp * 0.5);
        const s = c.s * grow * vis * (1 + energy * 0.2);
        this.dummy.scale.setScalar(Math.max(0.0001, s));
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(idx++, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = gather < 0.995;
  }
}
function TAUwrap(): (f: number) => number {
  // 使漂浮频率为 120s 整数倍，保证循环闭环
  const T = (2 * Math.PI) / 120;
  return (f: number) => Math.max(1, Math.round((f * 120) / (2 * Math.PI))) * T;
}
