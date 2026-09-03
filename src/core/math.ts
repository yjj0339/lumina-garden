/** 确定性数学工具：全片动画都必须能用 t 的纯函数重算。 */

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const mix = lerp;
export const inv = (a: number, b: number, x: number): number => (x - a) / (b - a);

export function smoothstep(a: number, b: number, x: number): number {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
}
export function smootherstep(a: number, b: number, x: number): number {
  const u = clamp01((x - a) / (b - a));
  return u * u * u * (u * (u * 6 - 15) + 10);
}
export const pulse = (a: number, b: number, x: number): number =>
  smoothstep(a, lerp(a, b, 0.35), x) * (1 - smoothstep(lerp(a, b, 0.62), b, x));

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutCubic = (x: number): number => {
  const u = clamp01(x);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
export function easeOutBack(x: number, s = 1.70158): number {
  const u = clamp01(x) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
export function easeOutElastic(x: number): number {
  const u = clamp01(x);
  if (u <= 0 || u >= 1) return u;
  const p = 0.38;
  return Math.pow(2, -10 * u) * Math.sin(((u - p / 4) * (2 * Math.PI)) / p) + 1;
}

/** 阻尼振动：绽放回弹、水冠余震共用。 */
export function spring(x: number, freq = 2.2, decay = 5.5): number {
  const u = Math.max(0, x);
  return 1 - Math.exp(-decay * u) * Math.cos(2 * Math.PI * freq * u);
}

/** 冲击衰减包络 */
export const hit = (x: number, k = 6): number => {
  const u = Math.max(0, x);
  return u * Math.exp(-k * u) * (k * Math.E);
};

export function hash11(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hash21(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function hash31(n: number): number {
  let s = Math.sin(n * 0.1031) * 33.33;
  s = Math.sin(s * 33.33) * 33.33;
  return s - Math.floor(s);
}

/** CPU 侧平滑值噪声（相机手持微动等） */
export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash11(i), hash11(i + 1), u) * 2 - 1;
}
export function fbm1(x: number, oct = 3): number {
  let a = 0;
  let amp = 0.5;
  let fr = 1;
  for (let i = 0; i < oct; i++) {
    a += noise1(x * fr) * amp;
    amp *= 0.5;
    fr *= 2.17;
  }
  return a;
}

/** 确定性 PRNG（生成器与运行时共用同一种子规则） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom 点采样（closed=true 时首尾环绕） */
export function catmullRom(pts: number[][], closed: boolean, samples: number): number[][] {
  const n = pts.length;
  const get = (i: number): number[] => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[clamp(i, 0, n - 1)];
  };
  const segs = closed ? n : n - 1;
  const out: number[][] = [];
  for (let s = 0; s < segs; s++) {
    const p0 = get(s - 1);
    const p1 = get(s);
    const p2 = get(s + 1);
    const p3 = get(s + 2);
    const steps = Math.max(2, Math.round(samples / segs));
    for (let i = 0; i < steps; i++) {
      const u = i / steps;
      const u2 = u * u;
      const u3 = u2 * u;
      const dim = p0.length;
      const p = new Array<number>(dim);
      for (let d = 0; d < dim; d++) {
        p[d] =
          0.5 *
          (2 * p1[d] +
            (-p0[d] + p2[d]) * u +
            (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u2 +
            (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * u3);
      }
      out.push(p);
    }
  }
  out.push(pts[n - 1].slice());
  return out;
}

/** 折线弧长表 */
export function arcTable(poly: number[][]): { table: number[]; total: number } {
  const table = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    let d = 0;
    for (let k = 0; k < a.length; k++) d += (b[k] - a[k]) * (b[k] - a[k]);
    total += Math.sqrt(d);
    table.push(total);
  }
  return { table, total };
}

/** 按归一化弧长查点（返回插值位置与切线） */
export function sampleArc(
  poly: number[][],
  table: number[],
  total: number,
  s: number
): { pos: number[]; tan: number[] } {
  const target = clamp01(s) * total;
  let lo = 0;
  let hi = table.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = table[hi] - table[lo] || 1;
  const u = (target - table[lo]) / seg;
  const a = poly[lo];
  const b = poly[hi];
  const dim = a.length;
  const pos = new Array<number>(dim);
  const tan = new Array<number>(dim);
  for (let d = 0; d < dim; d++) {
    pos[d] = lerp(a[d], b[d], u);
    tan[d] = b[d] - a[d];
  }
  return { pos, tan };
}
