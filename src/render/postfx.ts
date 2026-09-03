/**
 * 后期处理链（手写，不依赖 addons EffectComposer，便于导出时精确控制 RT 尺寸）：
 *  scene(HDR float) → bright → blur H/V ×N (bloom) → dof(可选，一次模糊) → composite(ACES+暗角+颗粒+色散+神光)
 * 所有强度克制，杜绝过曝泛白。
 */
import * as THREE from 'three';
import { BRIGHT_FRAG, COMPOSITE_FRAG, FS_QUAD, GAUSS_FRAG } from '../core/shaders';
import type { QualityProfile } from '../core/quality';

export interface CompositeParams {
  bloom: number;
  dof: number;
  godRay: number;
  sunScreen: THREE.Vector2;
  exposure: number;
  tint: THREE.Vector3;
  vignette: number;
  grain: number;
  chroma: number;
  time: number;
}

export class PostFX {
  private renderer: THREE.WebGLRenderer;
  private sceneRT!: THREE.WebGLRenderTarget;
  private bloomA!: THREE.WebGLRenderTarget;
  private bloomB!: THREE.WebGLRenderTarget;
  private dofRT!: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private brightMat: THREE.ShaderMaterial;
  private gaussMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private q = 0;
  private width = 1; private height = 1;
  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD, fragmentShader: BRIGHT_FRAG,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.72 }, uSoft: { value: 0.35 } },
      depthTest: false, depthWrite: false,
    });
    this.gaussMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD, fragmentShader: GAUSS_FRAG,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tDof: { value: null },
        uBloomAmt: { value: 0.5 }, uDofAmt: { value: 0 }, uTime: { value: 0 },
        uVignette: { value: 0.32 }, uGrain: { value: 0.02 }, uChroma: { value: 0.4 },
        uExposure: { value: 1.0 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
        uGodRay: { value: 0.3 }, uSunScreen: { value: new THREE.Vector2(0.62, 0.72) },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.alloc(1, 1, { name: 'high', dof: true, bloomPasses: 3 } as QualityProfile);
  }
  private alloc(w: number, h: number, q: QualityProfile): void {
    this.q = q.bloomPasses;
    this.width = w; this.height = h;
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
    };
    this.sceneRT?.dispose(); this.bloomA?.dispose(); this.bloomB?.dispose(); this.dofRT?.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...opts, samples: 0 });
    const bw = Math.max(2, Math.floor(w / 2)), bh = Math.max(2, Math.floor(h / 2));
    this.bloomA = new THREE.WebGLRenderTarget(bw, bh, opts);
    this.bloomB = new THREE.WebGLRenderTarget(bw, bh, opts);
    this.dofRT = new THREE.WebGLRenderTarget(Math.max(2, Math.floor(w / 2)), Math.max(2, Math.floor(h / 2)), opts);
  }
  resize(w: number, h: number, q: QualityProfile): void {
    if (w !== this.width || h !== this.height) this.alloc(w, h, q);
  }
  get target(): THREE.WebGLRenderTarget { return this.sceneRT; }

  render(scene: THREE.Scene, camera: THREE.Camera, p: CompositeParams, q: QualityProfile, toScreen: boolean): void {
    const r = this.renderer;
    // 1. scene → HDR RT
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. bright → bloomA
    this.quad.material = this.brightMat;
    this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    r.setRenderTarget(this.bloomA);
    r.render(this.quadScene, this.quadCam);

    // 3. blur ping-pong
    this.quad.material = this.gaussMat;
    let src = this.bloomA;
    for (let i = 0; i < this.q; i++) {
      const rad = 1 + i * 1.6;
      this.gaussMat.uniforms.tDiffuse.value = src.texture;
      this.gaussMat.uniforms.uRadius.value = rad;
      this.gaussMat.uniforms.uDir.value.set(1 / this.bloomA.width, 0);
      r.setRenderTarget(this.bloomB);
      r.render(this.quadScene, this.quadCam);
      this.gaussMat.uniforms.tDiffuse.value = this.bloomB.texture;
      this.gaussMat.uniforms.uDir.value.set(0, 1 / this.bloomA.height);
      r.setRenderTarget(this.bloomA);
      r.render(this.quadScene, this.quadCam);
      src = this.bloomA;
    }

    // 4. DOF（对场景半分辨率做一次较大模糊）
    if (q.dof) {
      this.quad.material = this.gaussMat;
      this.gaussMat.uniforms.tDiffuse.value = this.sceneRT.texture;
      this.gaussMat.uniforms.uRadius.value = 3.2;
      this.gaussMat.uniforms.uDir.value.set(1 / this.dofRT.width, 0);
      r.setRenderTarget(this.dofRT);
      r.render(this.quadScene, this.quadCam);
      this.gaussMat.uniforms.tDiffuse.value = this.dofRT.texture;
      this.gaussMat.uniforms.uDir.value.set(0, 1 / this.dofRT.height);
      r.setRenderTarget(this.dofRT);
      r.render(this.quadScene, this.quadCam);
    }

    // 5. composite
    this.quad.material = this.compMat;
    const u = this.compMat.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.bloomA.texture;
    u.tDof.value = this.dofRT.texture;
    u.uBloomAmt.value = p.bloom;
    u.uDofAmt.value = q.dof ? p.dof : 0;
    u.uGodRay.value = q.godRay ? p.godRay : 0;
    (u.uSunScreen.value as THREE.Vector2).copy(p.sunScreen);
    u.uExposure.value = p.exposure;
    (u.uTint.value as THREE.Vector3).copy(p.tint);
    u.uVignette.value = p.vignette;
    u.uGrain.value = p.grain * (q.name === 'ultra' ? 0.6 : q.name === 'low' ? 0.3 : 0.45);
    u.uChroma.value = p.chroma * q.chroma * 0.01;
    u.uTime.value = p.time;
    r.setRenderTarget(toScreen ? null : this.sceneRT);
    r.render(this.quadScene, this.quadCam);
  }

  /** 导出模式：composite 直接写入 sceneRT（供逐帧读回），返回后可 readRenderTargetPixels */
  renderToSceneRT(scene: THREE.Scene, camera: THREE.Camera, p: CompositeParams, q: QualityProfile): void {
    this.render(scene, camera, p, q, false);
  }

  get sceneTexture(): THREE.Texture { return this.sceneRT.texture; }
}
