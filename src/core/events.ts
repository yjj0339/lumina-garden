/**
 * 事件总表：整场 2 分钟演出里所有“何时、何地、发生什么”的确定性数据。
 * 所有视觉/音频模块都以这些事件 + 主时间线时刻 t 为纯函数驱动，
 * 因此进度条拖动到任意时刻，画面状态都能被精确重算，无缝循环也由此保证。
 * 文件由 tools/gen-events.mjs 以固定随机种子生成。
 */

export interface RippleEv {
  /** 涟漪中心 x/z */
  x: number;
  z: number;
  /** 起始时刻 */
  t0: number;
  /** 振幅 */
  amp: number;
  /** 波长 */
  wl: number;
  /** 波前速度 */
  sp: number;
  /** 寿命 */
  life: number;
  /** 调色板色号（见 palette.RIPPLE_COLORS） */
  col: number;
  /** 波前环带宽度 */
  wid: number;
}

export interface FlowerEv {
  x: number;
  z: number;
  /** 基座高度（水中为 0，空中花为 y） */
  y0: number;
  /** 绽放起始时刻（= 涟漪波前抵达时刻，由生成器按波速推算） */
  t0: number;
  /** 0 水池花 1 空中浮花 2 峡谷巨瓣 */
  kind: number;
  scale: number;
  rot: number;
  tilt: number;
  /** 主色混合 0..1（珊瑚粉↔杏橙） */
  hue: number;
  /** 副色混合 0..1（湖蓝↔薄荷绿↔淡紫） */
  hue2: number;
  /** 花瓣数 */
  petals: number;
  /** 物种 0/1/2，决定花瓣曲率与层数 */
  sp: number;
  /** 收拢延迟（finale 汇聚时的错峰 0..1） */
  delay: number;
  seed: number;
}

export interface RibbonEv {
  t0: number;
  /** Catmull-Rom 控制点 [x,y,z,...] */
  pts: number[];
  col: number;
  w: number;
  twist: number;
  /** 0 花冠 1 拱门 2 隧道 */
  group: number;
  seed: number;
}

export interface RailEv {
  pts: number[];
  col: number;
  /** 管半径 */
  r: number;
  open: number;
  close: number;
  seed: number;
}

export interface OrbEv {
  rail: number;
  /** 入轨时刻 */
  t0: number;
  /** 弧长速度 u/s */
  speed: number;
  r: number;
  col: number;
  /** 离轨时刻与状态（由生成器沿弧长积分得到） */
  exitT: number;
  exit: number[]; // [x,y,z, vx,vy,vz]
  /** 时间→归一化弧长采样表 [[t,u],...] */
  keys: number[][];
  /** 首次触水时刻 */
  landT: number;
  /** 触水垂直速度 */
  vy0: number;
  /** 恢复系数 */
  e: number;
}

export interface CrystalEv {
  t0: number;
  x: number;
  y: number;
  z: number;
  s: number;
  ax: number;
  ay: number;
  az: number;
  spin: number;
  col: number;
}

/** kind: 0 清脆铃音 1 玻璃轻碰 2 水滴/入水 3 风掠 whoosh 4 闪光 shimmer */
export interface TriggerEv {
  t: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  col: number;
  gain: number;
}

export interface PhaseEv {
  t0: number;
  t1: number;
  name: string;
  caption: string;
}

export interface Events {
  v: number;
  dur: number;
  seed: number;
  drop: { release: number; impact: number; h: number; g: number; r: number };
  ripples: RippleEv[];
  flowers: FlowerEv[];
  ribbons: RibbonEv[];
  rails: RailEv[];
  orbs: OrbEv[];
  crystals: CrystalEv[];
  triggers: TriggerEv[];
  phases: PhaseEv[];
}
