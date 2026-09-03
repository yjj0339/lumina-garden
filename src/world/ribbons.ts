/**
 * 彩带：每条 CatmullRom → 带状 BufferGeometry（uv.x = 归一化弧长）。
 * 生长：顶点按 s>uGrow 缩回起点；收拢：整体卷回。翻卷波动在顶点着色器。
 */
import * as THREE from 'three';
import { RIBBON_FRAG, RIBBON_VERT } from '../core/shaders';
import type { Events } from '../core/events';
import { RIPPLE_COLORS } from '../core/palette';
import { catmullRom, clamp, mix, smoothstep } from '../core/math';

interface RibbonUni {
  mat: THREE.ShaderMaterial;
  growAt: number;
  gather: number;
}

export class Ribbons {
  group = new THREE.Group();
  private mats: RibbonUni[] = [];
  private camU: { value: THREE.Vector3 };
  constructor(events: Events, camera: THREE.Camera) {
    this.camU = { value: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld) };
    for (const rb of events.ribbons) {
      const pts: number[][] = [];
      for (let i = 0; i < rb.pts.length; i += 3) pts.push(rb.pts.slice(i, i + 3));
      const poly = catmullRom(pts, false, 70);
      // 带状网格：沿曲线给宽度（垂直于切向和 up 的近似）
      const N = poly.length;
      const pos = new Float32Array(N * 2 * 3);
      const nor = new Float32Array(N * 2 * 3);
      const uv = new Float32Array(N * 2 * 2);
      const idx: number[] = [];
      const up = new THREE.Vector3(0, 1, 0);
      const t = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const p = poly[i];
        const a = poly[Math.max(0, i - 1)];
        const b = poly[Math.min(N - 1, i + 1)];
        t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        n.crossVectors(t, up).normalize().multiplyScalar(rb.w * 0.5);
        // 扭转：宽度方向绕切向旋转
        const tw = rb.twist * (i / N) * Math.PI * 2;
        const ca = Math.cos(tw), sa = Math.sin(tw);
        const nn = new THREE.Vector3(n.x * ca, n.y * ca + sa * 0.2, n.z * ca);
        for (let s2 = 0; s2 < 2; s2++) {
          const o = i * 2 + s2;
          const sgn = s2 === 0 ? 1 : -1;
          pos[o * 3] = p[0] + nn.x * sgn;
          pos[o * 3 + 1] = p[1] + nn.y * sgn;
          pos[o * 3 + 2] = p[2] + nn.z * sgn;
          const nz = new THREE.Vector3(-t.y * sa, 0.6 + 0.4 * ca, t.x * sa).normalize();
          nor[o * 3] = nz.x; nor[o * 3 + 1] = nz.y; nor[o * 3 + 2] = nz.z;
          uv[o * 2] = i / (N - 1);
          uv[o * 2 + 1] = s2;
        }
        if (i < N - 1) {
          const o = i * 2;
          idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const c = RIPPLE_COLORS[rb.col % RIPPLE_COLORS.length];
      const cB: [number, number, number] = [
        mix(c[0], 1, 0.35), mix(c[1], 0.97, 0.3), mix(c[2], 0.92, 0.3),
      ];
      const mat = new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERT,
        fragmentShader: RIBBON_FRAG,
        uniforms: {
          uTime: { value: 0 }, uGrow: { value: 0 }, uGather: { value: 0 },
          uTwist: { value: rb.twist }, uSeed: { value: rb.seed * 0.01 },
          uColA: { value: new THREE.Vector3(cB[0], cB[1], cB[2]) },
          uColB: { value: new THREE.Vector3(c[0], c[1], c[2]) },
          uCamPos: this.camU,
        },
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 12;
      mesh.visible = false;
      this.group.add(mesh);
      this.mats.push({ mat, growAt: rb.t0, gather: 0 });
      (mesh.userData as { growDur: number; startPt: THREE.Vector3 }).growDur = 2.6;
      const sp = pts[0];
      (mesh.userData as { growDur: number; startPt: THREE.Vector3 }).startPt = new THREE.Vector3(sp[0], sp[1], sp[2]);
    }
  }
  update(t: number, gather: number, camera: THREE.Camera): void {
    this.camU.value.setFromMatrixPosition(camera.matrixWorld);
    const children = this.group.children as THREE.Mesh[];
    for (let i = 0; i < children.length; i++) {
      const m = children[i];
      const uni = this.mats[i];
      const ud = m.userData as { growDur: number };
      const age = t - uni.growAt;
      if (age < 0) { m.visible = false; continue; }
      m.visible = gather < 0.995;
      const grow = clamp(age / ud.growDur, 0, 1);
      uni.mat.uniforms.uTime.value = t;
      uni.mat.uniforms.uGrow.value = smoothstep(0, 1, grow);
      uni.mat.uniforms.uGather.value = gather;
    }
  }
}
