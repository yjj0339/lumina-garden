/**
 * 主程序：装配全部模块、播放器状态机、渲染循环、竖屏适配、导出接口。
 * 单一事实来源 = masterTimeline 的时间 t；一切视觉/音频都以 t 为纯函数。
 */
import * as THREE from 'three';
import { createStage } from './core/renderer';
import { clamp, hash21, mix, smoothstep } from './core/math';
import { DURATION, PHASES, buildMasterTimeline, cameraWobble, createCamState, createPhaseState, lerpPortraitFix, type CamState, type PhaseState } from './core/timeline';
import { tintAt, lin } from './core/palette';
import { PALETTE } from './core/palette';
import { PROFILES, detectQuality, isMobileDevice, PerfGovernor, type QualityName, type QualityProfile } from './core/quality';
import { Sky } from './world/sky';
import { Water } from './world/water';
import { Flowers } from './world/flowers';
import { Splash } from './world/splash';
import { Ribbons } from './world/ribbons';
import { Marbles } from './world/marbles';
import { Crystals } from './world/crystals';
import { Particles } from './world/particles';
import { Atmosphere } from './world/atmosphere';
import { MicroWorld } from './world/microworld';
import { PostFX } from './render/postfx';
import { AudioEngine } from './audio/engine';
import { UI } from './ui/ui';
import eventsJson from './generated/events.json';
import type { Events } from './core/events';

const EVENTS = eventsJson as unknown as Events;

export interface PlayerState {
  t: number;
  playing: boolean;
  speed: number;
  quality: QualityName;
  volume: number;
  muted: boolean;
}

export class App {
  private stage = createStage(document.getElementById('gl') as HTMLCanvasElement);
  private cam = createCamState();
  private ph = createPhaseState();
  private master = buildMasterTimeline(this.cam, this.ph);
  private post: PostFX;
  private audio = new AudioEngine(EVENTS);
  private ui: UI;
  private governor: PerfGovernor;
  private q: QualityProfile;
  private world: {
    sky: Sky; water: Water; flowers: Flowers; splash: Splash; ribbons: Ribbons;
    marbles: Marbles; crystals: Crystals; particles: Particles; atmo: Atmosphere; micro: MicroWorld;
    pollens: THREE.Points;
  };
  private state: PlayerState;
  private clock = new THREE.Clock();
  private isPortrait = false;
  private exportMode = false;
  private raf = 0;
  private sunDir = new THREE.Vector3(0.42, 0.62, 0.35).normalize();

  constructor() {
    const mobile = isMobileDevice();
    const forced = new URLSearchParams(location.search).get('q') as QualityName | null;
    const qName = (forced && PROFILES[forced] ? forced : null)
      || (localStorage.getItem('lg-quality') as QualityName) || detectQuality(mobile);
    this.q = PROFILES[qName];
    this.governor = new PerfGovernor(qName);
    this.governor.onDowngrade = (n) => { this.setQuality(n, true); };
    this.state = { t: 0, playing: false, speed: 1, quality: qName, volume: 0.8, muted: false };
    this.post = new PostFX(this.stage.renderer);
    this.world = this.buildWorld();
    this.ui = new UI(this);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderFrame(0, true);
    this.loop();
  }

  private buildWorld(): App['world'] {
    const { scene, camera } = this.stage;
    const sky = new Sky();
    const water = new Water(EVENTS, camera, this.q.petalSeg < 14 ? 120 : 200);
    const flowers = new Flowers(EVENTS, camera, this.q.flowers, this.q.petalSeg);
    const splash = new Splash(EVENTS, camera);
    const ribbons = new Ribbons(EVENTS, camera);
    const marbles = new Marbles(EVENTS, camera);
    const crystals = new Crystals(EVENTS, camera);
    const particles = new Particles(EVENTS, this.q.particles);
    const atmo = new Atmosphere(this.q.fogLayers > 10 ? 9 : 6, tintAt(4));
    const micro = new MicroWorld(camera);
    // 花粉细粒（独立于大粒子，近花区高密度）
    const pollens = this.buildPollens();
    scene.add(
      sky.mesh, water.bed, water.mesh, splash.group, flowers.stems, flowers.petals, flowers.centers,
      ribbons.group, marbles.group, crystals.mesh, micro.group, particles.group, atmo.group, pollens
    );
    return { sky, water, flowers, splash, ribbons, marbles, crystals, particles, atmo, micro, pollens };
  }

  private buildPollens(): THREE.Points {
    const n = Math.floor(this.q.particles * 0.5);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    const seed = new Float32Array(n);
    const T = (Math.PI * 2) / 120;
    for (let i = 0; i < n; i++) {
      const a = hash21(i, 1) * Math.PI * 2;
      const r = 1.2 + Math.sqrt(hash21(i, 2)) * 20;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.2 + hash21(i, 3) * 2.4;
      pos[i * 3 + 2] = Math.sin(a) * r - 3;
      const c = lin(PALETTE.lemon);
      const c2 = lin(PALETTE.pearl);
      const u = hash21(i, 5);
      col[i * 3] = mix(c[0], c2[0], u); col[i * 3 + 1] = mix(c[1], c2[1], u); col[i * 3 + 2] = mix(c[2], c2[2], u);
      sz[i] = 0.5 + hash21(i, 7) * 1.1;
      seed[i] = Math.round((0.3 + hash21(i, 9) * 0.9) * 120 / (2 * Math.PI)) * T; // 闭环频率
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uGather; uniform vec2 uRes; uniform float uBloom;
        attribute vec3 aColor; attribute float aSize, aSeed;
        varying vec3 vC; varying float vA;
        void main(){
          vec3 P=position;
          float w=aSeed;
          P.x+=sin(uTime*w+P.z)*0.5; P.z+=cos(uTime*w*0.8+P.x)*0.5;
          P.y+=sin(uTime*w*1.3+P.x*0.3)*0.35+0.25;
          P=mix(P,vec3(0.0,1.55,0.0),uGather*uGather);
          vec4 mv=modelViewMatrix*vec4(P,1.0);
          gl_Position=projectionMatrix*mv;
          float d=-mv.z;
          gl_PointSize=clamp(aSize*uBloom*34.0/max(d,0.6)*uRes.y/900.0,1.0,7.0);
          vC=aColor; vA=clamp(1.4-d*0.035,0.05,0.7)*(1.0-uGather*0.2);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){
          vec2 c=gl_PointCoord-0.5; float d=length(c);
          if(d>0.5) discard;
          float a=1.0-smoothstep(0.0,0.5,d);
          a=pow(a,1.6);
          gl_FragColor=vec4(vC*1.5,a*vA*0.9);
        }`,
      uniforms: {
        uTime: { value: 0 }, uGather: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
        uBloom: { value: 1 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; p.renderOrder = 16;
    this.pollenMat = m;
    return p;
  }
  private pollenMat: THREE.ShaderMaterial | null = null;

  // ---------------- 视口 / 画质 ----------------
  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.isPortrait = h > w * 1.05;
    const { renderer, camera } = this.stage;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr * (this.isPortrait ? 1.0 : 1.05)));
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    const rw = Math.round(w * dpr), rh = Math.round(h * dpr);
    renderer.setSize(w, h, false);
    this.post.resize(rw, rh, this.q);
    camera.aspect = w / h;
    if (this.pollenMat) (this.pollenMat.uniforms.uRes.value as THREE.Vector2).set(rw, rh);
    (this.world.particles.dust.material as THREE.ShaderMaterial).uniforms.uRes.value.set(rw, rh);
    (this.world.particles.glow.material as THREE.ShaderMaterial).uniforms.uRes.value.set(rw, rh);
    camera.updateProjectionMatrix();
    this.ui?.onResize(this.isPortrait);
  }

  setQuality(n: QualityName, fromGovernor = false): void {
    this.q = PROFILES[n];
    this.state.quality = n;
    if (!fromGovernor) localStorage.setItem('lg-quality', n);
    this.governor.set(n);
    // 重建密度相关资源
    const { scene } = this.stage;
    scene.remove(this.world.flowers.petals, this.world.flowers.stems, this.world.particles.group, this.world.pollens, this.world.atmo.group);
    this.world.flowers.petals.geometry.dispose();
    this.world.particles = new Particles(EVENTS, this.q.particles);
    this.world.flowers = new Flowers(EVENTS, this.stage.camera, this.q.flowers, this.q.petalSeg);
    this.world.pollens = this.buildPollens();
    this.world.atmo = new Atmosphere(this.q.fogLayers > 10 ? 9 : 6, tintAt(4));
    scene.add(this.world.flowers.stems, this.world.flowers.petals, this.world.particles.group, this.world.pollens, this.world.atmo.group);
    this.resize();
    this.ui?.syncQuality(n);
  }

  // ---------------- 播放控制 ----------------
  play(): void {
    this.state.playing = true;
    this.audio.start().then(() => this.audio.resume());
    this.ui.syncPlay(true);
  }
  pause(): void {
    this.state.playing = false;
    this.audio.suspend();
    this.ui.syncPlay(false);
  }
  toggle(): void { this.state.playing ? this.pause() : this.play(); }
  seek(t: number): void {
    this.state.t = clamp(t, 0, DURATION);
    this.master.time(this.state.t);
    this.audio.seek(this.state.t);
    this.renderFrame(0, false);
    this.ui.syncProgress(this.state.t);
  }
  restart(): void { this.seek(0); this.play(); }
  setVolume(v: number): void { this.state.volume = v; this.audio.setVolume(v); }
  toggleMute(): boolean { this.state.muted = !this.state.muted; this.audio.setMuted(this.state.muted); return this.state.muted; }
  toggleFullscreen(): void {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => { /* iOS Safari 不支持 */ });
    else document.exitFullscreen?.();
  }

  // ---------------- 帧 ----------------
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.exportMode) return;
    if (this.state.playing) {
      this.state.t += dt * this.state.speed;
      if (this.state.t >= DURATION) this.state.t -= DURATION; // 无缝循环
      this.master.time(this.state.t);
      this.audio.sync(this.state.t, dt, this.ph.energy);
      this.ui.syncProgress(this.state.t);
    }
    if (!this.dbgFreezeGov) this.governor.sample(dt);
    this.renderFrame(dt, false);
  };

  private applyCamera(): void {
    const { camera } = this.stage;
    const c = this.cam;
    const pfb = this.isPortrait ? lerpPortraitFix(this.state.t / DURATION) : null;
    let px = c.px, py = c.py, pz = c.pz, lx = c.lx, ly = c.ly, lz = c.lz;
    if (pfb) {
      // 沿完整 3D 视线方向把机位推远到至少 minD（微距段小、大场面段大）→ 竖屏构图有序
      let vx = px - lx, vy = py - ly, vz = pz - lz;
      const d = Math.hypot(vx, vy, vz) || 1e-4;
      const nd = Math.max(d, pfb.minD);
      const k = nd / d;
      vx *= k; vy *= k; vz *= k;
      px = lx + vx; py = ly + vy + pfb.dy; pz = lz + vz;
      ly += pfb.lookUp;
    }
    const wb = cameraWobble(this.state.t, 1);
    camera.position.set(px + wb.dz * 0.4, py + wb.dy, pz);
    camera.lookAt(lx, ly, lz);
    camera.rotateZ(c.roll + wb.droll);
    const fov = c.fov + (pfb ? pfb.fovAdd : 0);
    if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  private sunScreen(): THREE.Vector2 {
    const v = this.sunDir.clone().multiplyScalar(80).project(this.stage.camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  private renderFrame(_dt: number, _first: boolean): void {
    const t = this.state.t;
    const { renderer, scene, camera } = this.stage;
    this.applyCamera();
    if (this.dbgNoPost) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    const gather = this.ph.gather;
    const gatherP = this.ph.gatherP;
    const micro = this.ph.micro;
    const energy = this.ph.energy;
    // 阶段主色 → 雾/光柱
    const tint = tintAt(t);
    const wind = 0.55 + 0.45 * Math.sin(t * (Math.PI * 2 / 120) * 3) + energy * 0.5;
    this.world.sky.update(t);
    this.world.water.update(t, gather, camera);
    this.world.splash.update(t, camera);
    this.world.flowers.update(t, gather, micro, wind, camera);
    this.world.ribbons.update(t, gather, camera);
    this.world.marbles.update(t, gather, camera);
    this.world.crystals.update(t, gather, energy, camera);
    this.world.micro.update(t, micro, gather, camera);
    const res = new THREE.Vector2(renderer.domElement.width, renderer.domElement.height);
    this.world.particles.update(t, gatherP, res, camera);
    this.world.atmo.update(t, this.cam.god, gather, energy, camera.position, micro);
    if (this.pollenMat) {
      this.pollenMat.uniforms.uTime.value = t;
      this.pollenMat.uniforms.uGather.value = gatherP;
      const bloomPulse = smoothstep(8, 20, t) * (1 - smoothstep(100, 110, t)) + micro * 0.6;
      this.pollenMat.uniforms.uBloom.value = 0.6 + bloomPulse * 0.8;
    }
    this.post.render(scene, camera, {
      bloom: 0.3 + energy * 0.1,
      dof: this.cam.dof * 0.6,
      godRay: this.cam.god * 0.32,
      sunScreen: this.sunScreen(),
      exposure: c1(this.cam.exposure),
      tint: new THREE.Vector3(tint[0], tint[1], tint[2]),
      vignette: 0.24,
      grain: 0.01,
      chroma: 1,
      time: t,
    }, this.q, true);
    this.ui?.syncCaption(t);
  }

  /** 逐帧推进（导出用，外部驱动，不依赖 rAF） */
  stepForExport(t: number): void {
    this.state.t = t;
    this.master.time(t);
    this.renderFrame(0, false);
  }
  setExportMode(on: boolean): void { this.exportMode = on; if (on) this.pause(); }

  /** 调试：冻结自动降档（确定性验证用，避免画质漂移干扰截图比对） */
  dbgFreezeGov = false;
  /** 调试：导出当前内部状态快照（相机/阶段/水滴），用于确定性验证 */
  dbgState(): { cam: CamState; ph: PhaseState; drop: { glow: number; y: number; vis: number } } {
    const c = this.cam;
    return {
      cam: { px: c.px, py: c.py, pz: c.pz, lx: c.lx, ly: c.ly, lz: c.lz, fov: c.fov, roll: c.roll, exposure: c.exposure, god: c.god, dof: c.dof },
      ph: { gather: this.ph.gather, gatherP: this.ph.gatherP, micro: this.ph.micro, energy: this.ph.energy },
      drop: { glow: this.world.splash.glow(), y: this.world.splash.dropY(), vis: this.world.splash.dropVisible() ? 1 : 0 },
    };
  }

  /** 调试：按名切换顶层对象可见性（定位异常几何） */
  dbgNoPost = false;
  dbgHideAll(): void {
    for (const n of ['water', 'bed', 'splash', 'flowers', 'centers', 'stems', 'ribbons', 'marbles', 'crystals', 'micro', 'particles', 'atmo', 'pollens', 'sky']) {
      this.dbgSet(n, false);
    }
  }
  /** 调试：按名切换顶层对象可见性（定位异常几何） */
  dbgSet(name: string, on: boolean): boolean {
    const map: Record<string, THREE.Object3D | undefined> = {
      sky: this.world.sky.mesh, water: this.world.water.mesh, bed: this.world.water.bed,
      splash: this.world.splash.group, flowers: this.world.flowers.petals,
      centers: this.world.flowers.centers, stems: this.world.flowers.stems,
      ribbons: this.world.ribbons.group, marbles: this.world.marbles.group,
      crystals: this.world.crystals.mesh, micro: this.world.micro.group,
      particles: this.world.particles.group, atmo: this.world.atmo.group,
      pollens: this.world.pollens,
    };
    const o = map[name];
    if (!o) return false;
    o.visible = on;
    return true;
  }
  dbgScene(): THREE.Scene { return this.stage.scene; }

  get eventsData(): Events { return EVENTS; }
  get phasesData(): typeof PHASES { return PHASES; }
  get duration(): number { return DURATION; }
  get currentState(): PlayerState { return this.state; }
  destroy(): void { cancelAnimationFrame(this.raf); }
}

function c1(x: number): number { return x; }

// 供导出/调试挂载
declare global { interface Window { __LG__: App | undefined; __LG_EXPORT__?: boolean } }

function boot(): void {
  const q = new URLSearchParams(location.search);
  if (q.get('nogui') === '1') {
    const ui = document.getElementById('ui');
    if (ui) ui.style.display = 'none';
  }
  const app = new App();
  window.__LG__ = app;
  const splash = document.getElementById('boot');
  if (splash) {
    splash.classList.add('go');
    setTimeout(() => splash.remove(), 900);
  }
  // 首次交互自动开播（浏览器音频策略）
  const startOnce = (): void => {
    app.play();
    window.removeEventListener('pointerdown', startOnce);
    window.removeEventListener('keydown', startOnce);
  };
  if (q.get('autoplay') !== '0') {
    window.addEventListener('pointerdown', startOnce, { passive: true });
    window.addEventListener('keydown', startOnce);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
