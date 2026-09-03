/**
 * 主时间线：120 秒演出 = 一个 paused 的 GSAP master timeline。
 * 播放 = master.time(t)；拖动 = master.seek(t)。GSAP 的 tween 对 time 是纯函数，
 * 因此任意时刻 seek 后所有被驱动的状态（相机、曝光、阶段色、标题）都精确可重算。
 */
import gsap from 'gsap';
import type { PhaseEv } from './events';

export const DURATION = 120;

export const PHASES: PhaseEv[] = [
  { t0: 0, t1: 2.4, name: 'drop', caption: '一滴珊瑚粉的光' },
  { t0: 2.4, t1: 11, name: 'crown', caption: '水冠 · 焦散 · 多层涟漪' },
  { t0: 11, t1: 26, name: 'bloom', caption: '玻璃花海绽放' },
  { t0: 26, t1: 36, name: 'micro', caption: '花心微观 · 露珠世界' },
  { t0: 36, t1: 50, name: 'ribbon', caption: '花瓣化带 · 花冠拱门' },
  { t0: 50, t1: 63, name: 'marbles', caption: '琉璃轨道 · 弹跳序曲' },
  { t0: 63, t1: 76, name: 'canyon', caption: '花瓣峡谷 · 空中花海' },
  { t0: 76, t1: 90, name: 'crystals', caption: '悬浮晶体 · 光丝薄雾' },
  { t0: 90, t1: 102, name: 'surge', caption: '流动雕塑 · 高潮' },
  { t0: 102, t1: 111, name: 'gather', caption: '花园收拢' },
  { t0: 111, t1: 120, name: 'return', caption: '重归一滴光' },
];

export interface CamState {
  px: number; py: number; pz: number;
  lx: number; ly: number; lz: number;
  fov: number; roll: number;
  /** 曝光微调（阶段呼吸感） */
  exposure: number;
  /** 0..1 体积光强度 */
  god: number;
  /** 0..1 景深强度 */
  dof: number;
}

export interface PhaseState {
  /** 收拢总控：0 展开 1 收拢回水滴（花/带/晶/球隐藏） */
  gather: number;
  /** 粒子汇聚度：102→112 升、112→120 降回 0，使循环点花粉散布与开场一致 */
  gatherP: number;
  /** 微观段进入深度 0..1 */
  micro: number;
  /** 高潮能量 0..1 */
  energy: number;
}

interface Key {
  t: number;
  ease?: string;
  v: Partial<CamState>;
}

/**
 * 相机关键帧：微距→水冠→贴水掠过→环绕→入花→穿越隧道→追逐小球→
 * 俯冲峡谷→升腾高潮→拉远收拢→回到开场微距机位（与首帧完全一致）。
 */
const CAM_KEYS: Key[] = [
  { t: 0, v: { px: 0.9, py: 2.35, pz: 2.7, lx: 0, ly: 1.62, lz: 0, fov: 34, roll: 0, exposure: 1.02, god: 0.28, dof: 0.62 } },
  { t: 1.4, v: { px: 0.62, py: 2.05, pz: 2.35, lx: 0, ly: 1.5, lz: 0, fov: 36, exposure: 1.04, god: 0.3 }, ease: 'sine.inOut' },
  { t: 2.4, v: { px: 0.5, py: 1.35, pz: 2.1, lx: 0, ly: 1.05, lz: 0, fov: 40, exposure: 1.06 }, ease: 'sine.in' },
  // 水冠爆发：低机位贴水，随冲击轻震
  { t: 2.75, v: { px: 0.9, py: 0.52, pz: 3.4, lx: 0, ly: 0.55, lz: 0, fov: 46, exposure: 1.12, god: 0.42 }, ease: 'power2.out' },
  { t: 4.6, v: { px: 2.6, py: 0.62, pz: 4.6, lx: 0, ly: 0.3, lz: 0, fov: 44, exposure: 1.08 }, ease: 'sine.inOut' },
  // 贴水掠过花海（环绕+前推）
  { t: 8, v: { px: -4.2, py: 0.75, pz: 6.4, lx: 1.5, ly: 0.6, lz: -2, fov: 48, exposure: 1.05, god: 0.36 }, ease: 'sine.inOut' },
  { t: 13, v: { px: -7.4, py: 1.4, pz: 3.2, lx: 0, ly: 1.1, lz: -4, fov: 50, exposure: 1.06 }, ease: 'sine.inOut' },
  { t: 18.5, v: { px: -1.8, py: 2.1, pz: 7.8, lx: 1.2, ly: 1.6, lz: 0, fov: 47, exposure: 1.07, dof: 0.55 }, ease: 'sine.inOut' },
  { t: 23, v: { px: 3.2, py: 1.55, pz: 4.2, lx: 4.6, ly: 1.7, lz: 0.4, fov: 42, exposure: 1.08, dof: 0.66 }, ease: 'power1.inOut' },
  // 推入花心
  { t: 27.6, v: { px: 4.75, py: 1.86, pz: 1.35, lx: 4.9, ly: 1.9, lz: 0.4, fov: 38, exposure: 1.1, god: 0.5, dof: 0.85 }, ease: 'power2.inOut' },
  { t: 31.5, v: { px: 4.92, py: 1.93, pz: 0.52, lx: 5.0, ly: 1.95, lz: -0.4, fov: 34, exposure: 1.12, dof: 0.95 }, ease: 'sine.inOut' },
  // 穿出花瓣 → 彩带隧道入口
  { t: 35.2, v: { px: 5.0, py: 2.2, pz: -2.6, lx: 4.4, ly: 2.6, lz: -6.5, fov: 44, exposure: 1.1, god: 0.45, dof: 0.5 }, ease: 'power2.inOut' },
  { t: 40, v: { px: 3.1, py: 3.4, pz: -8.2, lx: 2.2, ly: 3.8, lz: -13, fov: 52, exposure: 1.08 }, ease: 'sine.inOut' },
  // 拱门内穿行，仰视
  { t: 45.5, v: { px: 0.6, py: 4.6, pz: -14.5, lx: -1.2, ly: 6.4, lz: -19, fov: 55, exposure: 1.07, god: 0.5 }, ease: 'sine.inOut' },
  { t: 50, v: { px: -2.6, py: 6.8, pz: -20.5, lx: -4.4, ly: 6.2, lz: -25.5, fov: 50, exposure: 1.08 }, ease: 'power1.inOut' },
  // 追逐弹球：快速跟拍 + 甩镜
  { t: 53.5, v: { px: -6.8, py: 5.2, pz: -24.2, lx: -8.6, ly: 4.1, lz: -27.6, fov: 58, exposure: 1.1, god: 0.42 }, ease: 'power2.in' },
  { t: 56.2, v: { px: -9.8, py: 3.6, pz: -27.4, lx: -12.2, ly: 3.0, lz: -30.6, fov: 60, exposure: 1.11 }, ease: 'sine.out' },
  { t: 59.4, v: { px: -12.6, py: 4.9, pz: -30.2, lx: -14.4, ly: 6.4, lz: -34.5, fov: 52, exposure: 1.08, dof: 0.5 }, ease: 'power1.inOut' },
  { t: 63, v: { px: -14.2, py: 7.8, pz: -33.6, lx: -15.5, ly: 6.6, lz: -38.8, fov: 48, exposure: 1.07, god: 0.48 }, ease: 'sine.inOut' },
  // 俯冲花瓣峡谷
  { t: 66.4, v: { px: -15.8, py: 12.4, pz: -38.2, lx: -16.2, ly: 2.2, lz: -45, fov: 54, exposure: 1.09 }, ease: 'power2.in' },
  { t: 70, v: { px: -16.4, py: 2.6, pz: -45.6, lx: -15.2, ly: 3.4, lz: -52.5, fov: 62, exposure: 1.1 }, ease: 'power1.out' },
  { t: 73.5, v: { px: -13.8, py: 4.2, pz: -53.2, lx: -10.4, ly: 5.8, lz: -58.5, fov: 55, exposure: 1.08 }, ease: 'sine.inOut' },
  // 拉升进入晶体云海
  { t: 78, v: { px: -8.2, py: 9.6, pz: -57.6, lx: -4, ly: 10.5, lz: -63, fov: 52, exposure: 1.07, god: 0.55, dof: 0.52 }, ease: 'sine.inOut' },
  { t: 83.5, v: { px: -1.6, py: 13.2, pz: -62.5, lx: 2.6, ly: 12.4, lz: -68, fov: 56, exposure: 1.08 }, ease: 'sine.inOut' },
  // 高潮：流动雕塑环绕拉升
  { t: 88, v: { px: 6.8, py: 14.6, pz: -66.8, lx: 0, ly: 13.2, lz: -72, fov: 60, exposure: 1.1, god: 0.62 }, ease: 'sine.inOut' },
  { t: 92.5, v: { px: 1.2, py: 18.2, pz: -68.5, lx: -2.4, ly: 15.6, lz: -73.5, fov: 62, exposure: 1.12 }, ease: 'sine.inOut' },
  { t: 97.5, v: { px: -7.4, py: 16.4, pz: -71.5, lx: -1, ly: 14.8, lz: -74.5, fov: 58, exposure: 1.1, god: 0.58 }, ease: 'sine.inOut' },
  // 收拢：拉远俯瞰万物归心
  { t: 103, v: { px: -3.8, py: 21.6, pz: -60.5, lx: 0, ly: 12, lz: -68, fov: 50, exposure: 1.08, god: 0.5, dof: 0.5 }, ease: 'power1.inOut' },
  { t: 108, v: { px: 0.6, py: 14.5, pz: -34.5, lx: 0, ly: 6.4, lz: -30, fov: 44, exposure: 1.06 }, ease: 'power1.inOut' },
  { t: 112.5, v: { px: 0.8, py: 4.4, pz: -6.2, lx: 0, ly: 1.8, lz: -2.5, fov: 38, exposure: 1.04, god: 0.34, dof: 0.6 }, ease: 'power2.inOut' },
  // 回到开场机位：水滴悬于原点上空，与 t=0 帧完全一致
  { t: 116.6, v: { px: 0.9, py: 2.35, pz: 2.7, lx: 0, ly: 1.62, lz: 0, fov: 34, roll: 0, exposure: 1.02, god: 0.28, dof: 0.62 }, ease: 'power2.out' },
  { t: 120, v: { px: 0.9, py: 2.35, pz: 2.7, lx: 0, ly: 1.62, lz: 0, fov: 34, roll: 0, exposure: 1.02, god: 0.28, dof: 0.62 } },
];

const PHASE_KEYS: { t: number; v: Partial<PhaseState>; ease?: string }[] = [
  { t: 0, v: { gather: 0, gatherP: 0, micro: 0, energy: 0 } },
  { t: 26, v: { micro: 0 }, ease: 'sine.inOut' },
  { t: 30, v: { micro: 1 }, ease: 'sine.inOut' },
  { t: 35, v: { micro: 0 }, ease: 'sine.inOut' },
  { t: 50, v: { energy: 0.3 }, ease: 'power1.inOut' },
  { t: 76, v: { energy: 0.55 }, ease: 'sine.inOut' },
  { t: 88, v: { energy: 1 }, ease: 'power1.inOut' },
  { t: 96, v: { energy: 1 } },
  // 收拢：全场景向原点水滴汇聚（各模块可见性 ∝ (1-gather)）
  { t: 102, v: { gather: 0, gatherP: 0, energy: 0.9 }, ease: 'power1.inOut' },
  { t: 112, v: { gather: 1, gatherP: 1, energy: 0.12 }, ease: 'power2.inOut' },
  // 粒子从光滴缓缓散回散布位（112→120），t=120 与 t=0 花粉分布精确一致
  { t: 120, v: { gather: 1, gatherP: 0, energy: 0 }, ease: 'sine.inOut' },
];

/**
 * 竖屏构图修正系数（非裁切，而是重排机位）：
 *  portrait 权重 p∈[0,1]：拉高视角/拉近距离/加大 fov 纵向视野、目标上移。
 */
export interface PortraitFix {
  dist: number; // 机位到目标距离整体缩放
  dy: number; // 机位抬高
  lookUp: number; // 注视点上移
  fovAdd: number;
  minD: number; // 竖屏最小观察距离（微距段小、大场面段大）
}
const PF: { t: number; v: PortraitFix }[] = [
  { t: 0, v: { dist: 1.0, dy: 0.25, lookUp: 0.1, fovAdd: 10, minD: 3.0 } },
  { t: 8, v: { dist: 1.0, dy: 0.5, lookUp: 0.35, fovAdd: 12, minD: 5.5 } },
  { t: 26, v: { dist: 1.0, dy: 0.15, lookUp: 0.12, fovAdd: 8, minD: 2.0 } },
  { t: 31, v: { dist: 1.0, dy: 0.0, lookUp: 0.0, fovAdd: 6, minD: 1.1 } }, // 花心微观：贴脸
  { t: 40, v: { dist: 1.0, dy: 0.4, lookUp: 0.5, fovAdd: 10, minD: 6.5 } },
  { t: 56, v: { dist: 1.0, dy: 0.8, lookUp: 0.6, fovAdd: 12, minD: 9.0 } },
  { t: 76, v: { dist: 1.0, dy: 3.2, lookUp: 0.4, fovAdd: 8, minD: 15.0 } },
  { t: 96, v: { dist: 1.0, dy: 4.0, lookUp: 0.5, fovAdd: 7, minD: 17.0 } },
  { t: 110, v: { dist: 1.0, dy: 1.0, lookUp: 0.3, fovAdd: 9, minD: 10.0 } },
  { t: 120, v: { dist: 1.0, dy: 0.25, lookUp: 0.1, fovAdd: 10, minD: 3.0 } },
];

export function lerpPortraitFix(p: number): PortraitFix {
  let i = 0;
  while (i < PF.length - 2 && PF[i + 1].t <= p * DURATION) i++;
  const a = PF[i];
  const b = PF[i + 1];
  const u = Math.min(1, Math.max(0, (p * DURATION - a.t) / (b.t - a.t)));
  const k = u * u * (3 - 2 * u);
  const r: PortraitFix = { dist: 0, dy: 0, lookUp: 0, fovAdd: 0, minD: 0 };
  for (const key of ['dist', 'dy', 'lookUp', 'fovAdd', 'minD'] as const) {
    r[key] = a.v[key] + (b.v[key] - a.v[key]) * k;
  }
  return r;
}

export function createCamState(): CamState {
  const k0 = CAM_KEYS[0].v;
  return {
    px: k0.px!, py: k0.py!, pz: k0.pz!,
    lx: k0.lx!, ly: k0.ly!, lz: k0.lz!,
    fov: k0.fov!, roll: k0.roll ?? 0,
    exposure: k0.exposure!, god: k0.god!, dof: k0.dof!,
  };
}

export function createPhaseState(): PhaseState {
  return { gather: 0, gatherP: 0, micro: 0, energy: 0 };
}

/** 把相机与阶段关键帧装进 master timeline（可 seek、确定）。 */
export function buildMasterTimeline(cam: CamState, ph: PhaseState): gsap.core.Timeline {
  const master = gsap.timeline({ paused: true });
  // 全部使用 fromTo：起始值显式声明，不依赖首次渲染顺序 → seek 绝对确定
  for (let i = 0; i < CAM_KEYS.length - 1; i++) {
    const from = CAM_KEYS[i];
    const to = CAM_KEYS[i + 1];
    const dur = to.t - from.t;
    master.fromTo(
      cam,
      { ...from.v },
      { ...to.v, duration: dur, ease: to.ease ?? 'none' },
      from.t
    );
  }
  for (let i = 0; i < PHASE_KEYS.length - 1; i++) {
    const from = PHASE_KEYS[i];
    const to = PHASE_KEYS[i + 1];
    const dur = to.t - from.t;
    master.fromTo(
      ph,
      { ...from.v },
      { ...to.v, duration: dur, ease: to.ease ?? 'none' },
      from.t
    );
  }
  master.set(ph, {}, DURATION); // 钉住总时长 120s
  return master;
}

/** 手持微动（确定性，不依赖历史）：极低频噪声叠加 */
export function cameraWobble(t: number, intensity: number): { dy: number; dz: number; droll: number } {
  return {
    dy: (Math.sin(t * 0.71) * 0.016 + Math.sin(t * 0.23 + 1.7) * 0.01) * intensity,
    dz: Math.sin(t * 0.53 + 0.6) * 0.012 * intensity,
    droll: Math.sin(t * 0.31 + 2.1) * 0.0028 * intensity,
  };
}
