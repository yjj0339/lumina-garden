/**
 * 玻璃花海：全部花瓣合并为一次 instanced draw。
 *  - 每花 = petals × layers 个花瓣实例；绽放/收拢/风颤在顶点着色器内按 t 解析。
 *  - 水面花带玻璃茎，花心带自发光花蕊（instance 球集合）。
 *  - 按画质截断花朵数量（近场优先，保证主体区完整）。
 */
import * as THREE from 'three';
import { PETAL_FRAG, PETAL_VERT } from '../core/shaders';
import type { Events, FlowerEv } from '../core/events';
import { PALETTE, lin } from '../core/palette';
import { clamp, hash21, mix } from '../core/math';

type V3 = [number, number, number];
const COL = {
  coral: lin(PALETTE.coral), apricot: lin(PALETTE.apricot), rose: lin(PALETTE.rose),
  lake: lin(PALETTE.lake), mint: lin(PALETTE.mint), lilac: lin(PALETTE.lilac),
  lemon: lin(PALETTE.lemon), pearl: lin(PALETTE.pearl), sky: lin(PALETTE.sky),
  coralDeep: lin(PALETTE.coralDeep), apricotPale: lin(PALETTE.apricotPale),
} as const;

function flowerColors(f: FlowerEv): { a: V3; b: V3; e: V3 } {
  // 主色：珊瑚粉↔杏橙（hue），受位置轻微染色（远处偏湖蓝/薄荷，制造空气透视与阶段主色）
  const dist = Math.hypot(f.x, f.z + 22);
  const far = clamp(dist / 30, 0, 1);
  const a: V3 = [mix(COL.pearl[0], COL.apricot[0], 0.6), mix(0.98, 0.72, f.hue), mix(0.95, 0.55, f.hue)];
  const base: V3 = [
    mix(COL.coral[0], COL.apricot[0], f.hue),
    mix(COL.coral[1], COL.apricot[1], f.hue),
    mix(COL.coral[2], COL.apricot[2], f.hue),
  ];
  const b: V3 = [
    mix(mix(base[0], COL.rose[0], 0.25), COL.rose[0], far * 0.5),
    mix(mix(base[1], COL.apricotPale[1], 0.2), COL.lake[1], far * 0.4),
    mix(mix(base[2], COL.coralDeep[2], 0.15), COL.lake[2], far * 0.4),
  ];
  a[0] = mix(a[0], COL.apricotPale[0], 0.5); a[1] = mix(a[1], 0.9, 0.4); a[2] = mix(a[2], 0.78, 0.4);
  // 副色边缘：湖蓝/薄荷/淡紫/柠檬轮转
  const sec: V3[] = [COL.lake, COL.mint, COL.lilac, COL.lemon, COL.sky];
  const idx = Math.floor(f.hue2 * sec.length) % sec.length;
  const nxt = sec[(idx + 1) % sec.length];
  const u = f.hue2 * sec.length - idx;
  const e: V3 = [mix(sec[idx][0], nxt[0], u), mix(sec[idx][1], nxt[1], u), mix(sec[idx][2], nxt[2], u)];
  return { a, b, e };
}

export class Flowers {
  petals: THREE.Mesh;
  centers: THREE.InstancedMesh;
  stems: THREE.Mesh;
  private petalMat: THREE.ShaderMaterial;
  private centerMat: THREE.MeshBasicMaterial;
  private stemMat: THREE.ShaderMaterial;
  constructor(events: Events, _camera: THREE.Camera, maxFlowers: number, seg: number) {
    const camU = { value: new THREE.Vector3() };
    // —— 选取花朵：近场优先 + 主角花必选 + 保留部分远景作花海纵深
    const fs = [...events.flowers].sort((a, b) => {
      const da = Math.hypot(a.x, a.z) + a.y0 * 0.3;
      const db = Math.hypot(b.x, b.z) + b.y0 * 0.3;
      return da - db;
    });
    const hero = events.flowers.find((f) => Math.abs(f.x - 4.9) < 0.2 && Math.abs(f.z - 0.4) < 0.6);
    const chosen: FlowerEv[] = [];
    const chosenSet = new Set<FlowerEv>();
    const push = (f: FlowerEv | undefined): void => {
      if (f && !chosenSet.has(f) && chosen.length < maxFlowers) { chosen.push(f); chosenSet.add(f); }
    };
    push(hero);
    for (const f of fs) {
      if (chosen.length >= maxFlowers) break;
      // 交错：近场为主，但每 5 朵留 1 朵远处的撑纵深
      if (chosen.length % 5 === 4) {
        const far = fs.find((g) => !chosenSet.has(g) && Math.hypot(g.x, g.z) > 16);
        push(far);
      }
      push(f);
    }

    // —— 花瓣实例属性
    const layersFor = (f: FlowerEv): number => (f.kind === 2 ? 2 : 3);
    let total = 0;
    for (const f of chosen) total += f.petals * layersFor(f);
    // total = 花瓣实例总数（下面缓冲区尺寸使用）
    const iData1 = new Float32Array(total * 4);
    const iData2 = new Float32Array(total * 4);
    const iColA = new Float32Array(total * 3);
    const iColB = new Float32Array(total * 3);
    const iEdge = new Float32Array(total * 3);
    const iPos4 = new Float32Array(total * 4);
    const iParams = new Float32Array(total * 4);
    let p = 0;
    for (const f of chosen) {
      const layers = layersFor(f);
      const { a, b, e } = flowerColors(f);
      const openDur = f.kind === 2 ? 3.8 : f.kind === 1 ? 2.2 : 1.7;
      for (let L = 0; L < layers; L++) {
        for (let i = 0; i < f.petals; i++) {
          const jitter = hash21(f.seed + i, L) * 0.12 - 0.06;
          iData1.set([f.t0 + L * 0.09 + jitter * 0.2, f.scale * (1 - L * 0.16), f.rot, f.seed + i * 0.131 + L * 0.77], p * 4);
          iData2.set([i, f.petals, L, layers], p * 4);
          iColA.set(a, p * 3); iColB.set(b, p * 3); iEdge.set(e, p * 3);
          iPos4.set([f.x, f.y0, f.z, f.delay], p * 4);
          iParams.set([f.tilt, f.kind, 0, openDur], p * 4);
          p++;
        }
      }
    }
    const geo = new THREE.PlaneGeometry(1, 1, seg, seg);
    const bg = new THREE.InstancedBufferGeometry();
    bg.index = geo.index;
    bg.setAttribute('position', geo.getAttribute('position'));
    bg.setAttribute('uv', geo.getAttribute('uv'));
    bg.setAttribute('normal', geo.getAttribute('normal'));
    bg.setAttribute('iData1', new THREE.InstancedBufferAttribute(iData1, 4));
    bg.setAttribute('iData2', new THREE.InstancedBufferAttribute(iData2, 4));
    bg.setAttribute('iColA', new THREE.InstancedBufferAttribute(iColA, 3));
    bg.setAttribute('iColB', new THREE.InstancedBufferAttribute(iColB, 3));
    bg.setAttribute('iEdge', new THREE.InstancedBufferAttribute(iEdge, 3));
    bg.setAttribute('iPos4', new THREE.InstancedBufferAttribute(iPos4, 4));
    bg.setAttribute('iParams', new THREE.InstancedBufferAttribute(iParams, 4));
    bg.instanceCount = total;
    this.petalMat = new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT,
      fragmentShader: PETAL_FRAG,
      uniforms: {
        uTime: { value: 0 }, uGather: { value: 0 }, uWind: { value: 1 }, uMicro: { value: 0 },
        uCamPos: camU,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.petals = new THREE.Mesh(bg, this.petalMat);
    this.petals.frustumCulled = false;
    this.petals.renderOrder = 10;

    // —— 花蕊（暖色小蕊球，克制亮度避免过曝）
    const nCenters = chosen.length;
    const cg = new THREE.SphereGeometry(0.05, 8, 6);
    this.centerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.centers = new THREE.InstancedMesh(cg, this.centerMat, Math.max(1, nCenters));
    this.centers.frustumCulled = false;
    this.centers.renderOrder = 11;
    const m4 = new THREE.Matrix4();
    const cCol = new THREE.Color();
    for (let i2 = 0; i2 < nCenters; i2++) {
      const f = chosen[i2];
      m4.makeTranslation(f.x, f.y0 + f.scale * 0.16, f.z);
      m4.scale(new THREE.Vector3(f.scale * 0.8, f.scale * 0.8, f.scale * 0.8));
      this.centers.setMatrixAt(i2, m4);
      const { e } = flowerColors(f);
      // 暖柠檬/杏色花蕊，亮度克制
      cCol.setRGB(1.0, mix(0.82, 0.95, e[0]), mix(0.55, 0.8, e[2]));
      this.centers.setColorAt(i2, cCol);
    }
    this.centers.instanceMatrix.needsUpdate = true;
    if (this.centers.instanceColor) this.centers.instanceColor.needsUpdate = true;
    (this.centers.userData as { chosen: FlowerEv[] }).chosen = chosen;

    // —— 玻璃茎（仅水中花）：半透明渐变细管
    const waterN = chosen.filter((f) => f.kind === 0).length;
    this.stemMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        uniform float uTime; varying float vY; varying vec3 vN2; varying vec3 vW;
        attribute vec3 iS; attribute float iH, iPh;
        void main(){
          float h=iH;
          vec3 P=vec3(position.x, position.y*h, position.z);
          float k=clamp(position.y+0.5,0.0,1.0);
          P.x+=sin(uTime*1.3+iPh+P.y*1.2)*0.06*k;
          P.z+=cos(uTime*1.1+iPh)*0.05*k;
          vY=k;
          vW=iS+P;
          vN2=normal;
          gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vY; varying vec3 vN2; varying vec3 vW;
        uniform vec3 uCamPos; uniform float uTime;
        void main(){
          vec3 N=normalize(vN2); vec3 V=normalize(uCamPos-vW);
          float fres=0.05+0.95*pow(1.0-abs(dot(N,V)),3.0);
          vec3 col=mix(vec3(0.62,0.9,0.7),vec3(0.75,0.94,0.85),vY);
          col=col*0.7+fres*vec3(0.5,0.55,0.5)*0.8;
          col+=vec3(1.0,0.97,0.9)*pow(max(dot(reflect(-V,N),normalize(vec3(0.4,0.7,0.3))),0.0),40.0)*0.5;
          gl_FragColor=vec4(col,clamp(0.35+fres*0.5,0.0,0.8));
        }`,
      uniforms: { uTime: { value: 0 }, uCamPos: camU },
      transparent: true, depthWrite: false,
    });
    const sg = new THREE.CylinderGeometry(0.02, 0.035, 1, 6, 1, true);
    const sbg = new THREE.InstancedBufferGeometry();
    sbg.index = sg.index;
    sbg.setAttribute('position', sg.getAttribute('position'));
    sbg.setAttribute('normal', sg.getAttribute('normal'));
    sbg.setAttribute('uv', sg.getAttribute('uv'));
    const iS = new Float32Array(Math.max(1, waterN) * 3);
    const iH = new Float32Array(Math.max(1, waterN));
    const iPh = new Float32Array(Math.max(1, waterN));
    let wi = 0;
    for (const f of chosen) {
      if (f.kind !== 0) continue;
      iS.set([f.x, -1.05, f.z], wi * 3);
      iH[wi] = f.y0 + 1.05 + f.scale * 0.1;
      iPh[wi] = f.seed;
      wi++;
    }
    sbg.setAttribute('iS', new THREE.InstancedBufferAttribute(iS, 3));
    sbg.setAttribute('iH', new THREE.InstancedBufferAttribute(iH, 1));
    sbg.setAttribute('iPh', new THREE.InstancedBufferAttribute(iPh, 1));
    sbg.instanceCount = Math.max(1, waterN);
    const stemMesh = new THREE.Mesh(sbg, this.stemMat);
    stemMesh.frustumCulled = false;
    stemMesh.renderOrder = 9;
    this.stems = stemMesh;
    this._camU = camU;
    this._chosen = chosen;
  }
  private _camU: { value: THREE.Vector3 };
  private _chosen: FlowerEv[];
  get flowerCount(): number { return this._chosen.length; }
  update(t: number, gather: number, micro: number, wind: number, camera: THREE.Camera): void {
    this._camU.value.setFromMatrixPosition(camera.matrixWorld);
    const u = this.petalMat.uniforms;
    u.uTime.value = t; u.uGather.value = gather; u.uMicro.value = micro; u.uWind.value = wind;
    this.stemMat.uniforms.uTime.value = t;
    // 花蕊随绽放淡入 + 收拢提亮后熄灭
    const g = this.centerMat;
    g.opacity = 0.95 * (1 - gather);
    this.centers.visible = gather < 0.99;
    this.stems.visible = gather < 0.99;
  }
}
