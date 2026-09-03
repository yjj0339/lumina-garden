/** 画质分级：自动探测 + 手动切换。所有差异只影响密度/分辨率/后期强度，不改构图。 */
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  name: QualityName;
  dpr: number;
  /** 花海渲染数量上限 */
  flowers: number;
  /** 粒子总数 */
  particles: number;
  /** 雾片数 */
  fogLayers: number;
  /** bloom 迭代次数 */
  bloomPasses: number;
  /** 后期链路开关 */
  dof: boolean;
  godRay: boolean;
  chroma: number;
  /** 花瓣网格分段 */
  petalSeg: number;
  shadowMap: number; // 0 = off
  /** 导出时覆盖的倍帧渲染质量 */
  exportScale: number;
}

export const PROFILES: Record<QualityName, QualityProfile> = {
  low: {
    name: 'low', dpr: 1.0, flowers: 90, particles: 900, fogLayers: 4,
    bloomPasses: 1, dof: false, godRay: false, chroma: 0.0,
    petalSeg: 10, shadowMap: 0, exportScale: 1,
  },
  medium: {
    name: 'medium', dpr: 1.25, flowers: 180, particles: 2200, fogLayers: 8,
    bloomPasses: 2, dof: false, godRay: true, chroma: 0.6,
    petalSeg: 14, shadowMap: 1024, exportScale: 1,
  },
  high: {
    name: 'high', dpr: 1.75, flowers: 300, particles: 4500, fogLayers: 14,
    bloomPasses: 3, dof: true, godRay: true, chroma: 1.0,
    petalSeg: 18, shadowMap: 2048, exportScale: 1,
  },
  ultra: {
    name: 'ultra', dpr: 2.0, flowers: 420, particles: 8000, fogLayers: 20,
    bloomPasses: 4, dof: true, godRay: true, chroma: 1.2,
    petalSeg: 24, shadowMap: 2048, exportScale: 1,
  },
};

export function detectQuality(isMobile: boolean): QualityName {
  if (isMobile) return 'medium';
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (mem >= 16 && cores >= 8) return 'ultra';
  if (mem >= 8 && cores >= 6) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}

export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && matchMedia('(pointer:coarse)').matches);
}

/** 运行时 FPS 监测自动降档（只降不升，避免抖动） */
export class PerfGovernor {
  private frames = 0;
  private acc = 0;
  private cooldown = 4;
  onDowngrade?: (q: QualityName) => void;
  private order: QualityName[] = ['ultra', 'high', 'medium', 'low'];
  constructor(private current: QualityName) {}
  get name(): QualityName { return this.current; }
  set(name: QualityName) { this.current = name; }
  sample(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc < 2) return;
    const fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.cooldown > 0) { this.cooldown -= 2; return; }
    if (fps < 24) {
      const i = this.order.indexOf(this.current);
      if (i < this.order.length - 1) {
        this.current = this.order[i + 1];
        this.cooldown = 12;
        this.onDowngrade?.(this.current);
      }
    }
  }
}
