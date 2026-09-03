/**
 * 事件总表生成器（Node 侧，构建前执行）。
 * 用固定随机种子 + 真实波速/重力推演，产出“预计算”的编排数据：
 *  - 涟漪链：母波以速度 sp 传播，抵达花朵处即该花的绽放时刻 → 拖动进度后天然正确；
 *  - 弹球：沿轨道弧长积分（重力沿切向分量），到端点抛体落地得到精确的离轨状态与触发时刻；
 *  - 触发音表：所有开花/碰撞/晶体生成时刻合并为一张按时间排序的音频事件表。
 * 输出：src/generated/events.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 兼容非 ASCII 安装路径：输出锚定到 cwd（npm scripts 总在项目根执行）
const ROOT = process.cwd();

// ---------- 确定性 PRNG（与 src/core/math.ts mulberry32 相同） ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20260903;
const rnd = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rnd();
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];

const DUR = 120;
const IMPACT = 2.4;
const G = 9.8;
const events = {
  v: 1,
  dur: DUR,
  seed: SEED,
  drop: { release: 0.5, impact: IMPACT, h: 1.72, g: 0.95, r: 0.115 },
  ripples: [],
  flowers: [],
  ribbons: [],
  rails: [],
  orbs: [],
  crystals: [],
  triggers: [],
  phases: [],
};

// ---------- 涟漪 ----------
function addRipple(x, z, t0, amp, col, opts = {}) {
  const sp = opts.sp ?? 2.6;
  const ev = {
    x, z, t0, amp,
    wl: opts.wl ?? rr(1.5, 2.6),
    sp,
    life: opts.life ?? Math.max(4, amp * 60),
    col,
    wid: opts.wid ?? rr(0.55, 0.95),
  };
  events.ripples.push(ev);
  return ev;
}
const arrival = (r, x, z) => r.t0 + Math.hypot(x - r.x, z - r.z) / r.sp;

// 主波（珊瑚粉）+ 多层跟随彩色波
const mainR = addRipple(0, 0, IMPACT, 0.11, 0, { wl: 2.4, wid: 1.05, life: 16 });
addRipple(0, 0, IMPACT + 0.16, 0.085, 1, { wl: 2.0, sp: 2.56 });
addRipple(0, 0, IMPACT + 0.38, 0.065, 2, { wl: 1.7, sp: 2.52 });
addRipple(0, 0, IMPACT + 0.62, 0.05, 6, { wl: 1.5, sp: 2.48 });
// 水冠回落焦散环
addRipple(0, 0, IMPACT + 1.05, 0.07, 4, { wl: 1.3, sp: 2.66 });
// 飞溅小珠回落入水
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI * 2 + rr(-0.4, 0.4);
  const d = rr(1.1, 2.6);
  addRipple(Math.cos(a) * d, Math.sin(a) * d, IMPACT + rr(0.55, 1.35), rr(0.02, 0.038), ri(0, 7), { sp: 2.4, wl: rr(0.8, 1.3), life: 5 });
}

// ---------- 花朵 ----------
const RIB = 2.7; // 主波起始半径
function spacingFor(t0) {
  // 近处密、外围疏，但保证花海绵延不绝
  return t0 < 7 ? 0.46 : t0 < 9.6 ? 0.52 : 0.62;
}
const flowerPts = [];
function tryAddFlower(x, y, z, kind, t0, opts = {}) {
  for (const p of flowerPts) {
    const dx = p.x - x, dz = p.z - z, dy = (p.y0 - y) * 0.35;
    const min = (opts.min ?? spacingFor(t0)) * (kind === 2 ? 6 : 1);
    if (dx * dx + dz * dz + dy * dy < min * min) return null;
  }
  const f = {
    x, y0: y, z,
    t0: +t0.toFixed(3),
    kind,
    scale: opts.scale ?? (kind === 0 ? rr(0.5, 0.95) : kind === 1 ? rr(0.4, 0.8) : rr(3.4, 5.2)),
    rot: rr(0, Math.PI * 2),
    tilt: kind === 2 ? rr(0.25, 0.75) : rr(-0.12, 0.12),
    hue: kind === 2 ? rr(0, 1) : rr(0, 0.85),
    hue2: rnd(),
    petals: pick([5, 5, 6, 6, 8]),
    sp: ri(0, 2),
    delay: 0,
    seed: ri(0, 9999),
  };
  f.delay = +Math.min(1, Math.hypot(x, z) / 34 + (y || 0) / 60).toFixed(3);
  flowerPts.push({ x, y, z });
  events.flowers.push(f);
  return f;
}

// 主角花（镜头将穿入的那朵，大）
tryAddFlower(4.9, 0, 0.4, 0, 24.6, { scale: 4.2, petals: 6, sp: 1, min: 3.2, hue: 0.12 });

// 水池花海：黄金角螺旋 + 抖动，由主波触达时刻决定绽放
const N1 = 300;
for (let i = 0; i < N1; i++) {
  const rad = RIB + 0.42 * Math.sqrt(i) * 1.9 + rr(-0.12, 0.12);
  const ang = i * 2.39996 + rr(-0.09, 0.09);
  const x = Math.cos(ang) * rad;
  const z = Math.sin(ang) * rad;
  if (rad > 30) continue;
  const t0 = arrival(mainR, x, z) + rr(0.12, 0.55);
  if (t0 > 60) continue;
  tryAddFlower(x, 0, z, 0, t0);
}

// 空中浮花（花瓣峡谷 / 空中花海 / 高潮雕塑区），t0 对应各段编排
const airZones = [
  { n: 26, cx: -14.5, cz: -44, rx: 9, rz: 9, y0: 3.5, y1: 15, ta: 62, tb: 70, col: 'canyon' },
  { n: 30, cx: -6, cz: -60, rx: 14, rz: 12, y0: 5, y1: 19, ta: 72, tb: 84, col: 'sky' },
  { n: 26, cx: 0, cz: -72, rx: 12, rz: 9, y0: 8, y1: 21, ta: 86, tb: 97, col: 'surge' },
];
for (const zn of airZones) {
  for (let i = 0; i < zn.n; i++) {
    const x = zn.cx + rr(-zn.rx, zn.rx);
    const z = zn.cz + rr(-zn.rz, zn.rz);
    const y = rr(zn.y0, zn.y1);
    const t0 = rr(zn.ta, zn.tb);
    tryAddFlower(x, y, z, 1, t0, { min: 1.4 });
  }
}
// 峡谷巨瓣
for (let i = 0; i < 6; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const z = -37 - i * 3.4;
  tryAddFlower(-16.6 + side * rr(2.2, 3.6), rr(0, 2), z, 2, 61.5 + i * 0.55, { min: 6 });
}
// 球触发链式花海（先占位，t0 在弹球段回填）

// ---------- 彩带 ----------
function addRibbon(t0, pts, col, group, opts = {}) {
  const flat = pts.flat().map((v) => +v.toFixed(3));
  events.ribbons.push({
    t0: +t0.toFixed(3), pts: flat,
    col, w: +(opts.w ?? rr(0.26, 0.5)).toFixed(3),
    twist: +(opts.twist ?? rr(0.4, 1.2)).toFixed(3),
    group, seed: ri(0, 9999),
  });
}
// 花冠（环绕主角花上方）
for (let i = 0; i < 7; i++) {
  const a0 = (i / 7) * Math.PI * 2 + rr(-0.25, 0.25);
  const pts = [];
  const seg = 6;
  for (let k = 0; k <= seg; k++) {
    const u = k / seg;
    const a = a0 + u * (1.6 + rr(0, 0.8));
    const rad = 2.2 + u * rr(0.6, 1.8);
    pts.push([4.9 + Math.cos(a) * rad, 2.4 + u * rr(1.2, 3.2) + Math.sin(u * Math.PI) * 0.9, 0.4 + Math.sin(a) * rad]);
  }
  addRibbon(36 + i * 0.5, pts, i % 8, 0);
}
// 拱门（沿走廊 XZ 排列，XY 立起）
for (let i = 0; i < 12; i++) {
  const cx = 2.4 - i * 0.5 + rr(-0.35, 0.35);
  const cz = -3 - i * 3.0 + rr(-0.5, 0.5);
  const h = rr(4.5, 7);
  const wdt = rr(2.6, 3.8);
  const pts = [];
  const seg = 8;
  for (let k = 0; k <= seg; k++) {
    const u = k / seg;
    const ang = Math.PI * u;
    pts.push([cx + Math.cos(ang) * wdt * rr(0.98, 1.02), rr(0.3, 0.6) + Math.sin(ang) * h, cz + rr(-0.06, 0.06) * k]);
  }
  addRibbon(37.2 + i * 0.5, pts, pick([0, 1, 3, 4, 5, 7]), 1, { w: rr(0.62, 1.05) });
}
// 流动隧道（螺旋管，沿相机走廊）
for (let i = 0; i < 16; i++) {
  const ph = (i / 16) * Math.PI * 2;
  const pts = [];
  const seg = 10;
  for (let k = 0; k <= seg; k++) {
    const u = k / seg;
    const z = -6 - u * 28;
    const a = ph + u * (5 + rr(-0.3, 0.3));
    const rad = 2.1 + Math.sin(u * Math.PI) * 0.9;
    pts.push([Math.cos(a) * rad * rr(0.95, 1.05), 5 + u * 2.5 + Math.sin(a) * rad * 0.7, z]);
  }
  addRibbon(44 + i * 0.3, pts, i % 8, 2, { w: rr(0.5, 0.85) });
}
// 高潮流动雕塑（大螺旋带）
for (let i = 0; i < 6; i++) {
  const pts = [];
  const seg = 12;
  const ph = rr(0, 6.28);
  for (let k = 0; k <= seg; k++) {
    const u = k / seg;
    const a = ph + u * (Math.PI * 3 + rr(0, 1.5));
    const rad = 3 + u * 7 + Math.sin(u * 5) * 1.4;
    pts.push([Math.cos(a) * rad, 12 + u * 9 + Math.sin(u * Math.PI * 2) * 2.2, -72 + Math.sin(a) * rad]);
  }
  addRibbon(88 + i * 1.1, pts, pick([0, 1, 4, 5, 7]), 2, { w: rr(0.5, 0.8), twist: rr(1, 2) });
}

// ---------- 轨道与弹球 ----------
function railPoly(i) {
  const pts = [];
  const seg = 26;
  const z0 = -30 - i * 2.4;
  const yBase = 6.2 - i * 1.3;
  for (let k = 0; k <= seg; k++) {
    const u = k / seg;
    const x = -12 - u * (13 + i * 2.2) + Math.sin(u * Math.PI * (2 + i)) * rr(1.2, 2.4);
    const y = yBase + Math.sin(u * Math.PI * (1.5 + i * 0.5) + i) * 2.6 - u * (2.4 + i * 0.8);
    const z = z0 - u * 12 + Math.cos(u * Math.PI * (2 + i * 0.7)) * 3.2;
    pts.push([+x.toFixed(3), +Math.max(1.2, y).toFixed(3), +z.toFixed(3)]);
  }
  return pts;
}
function arcLen(poly) {
  const table = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += (poly[i][k] - poly[i - 1][k]) ** 2;
    total += Math.sqrt(d);
    table.push(total);
  }
  return { table, total };
}
function sampleAt(poly, table, total, s) {
  const target = s * total;
  let lo = 0, hi = table.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= target) lo = mid; else hi = mid;
  }
  const segLen = table[hi] - table[lo] || 1e-6;
  const u = (target - table[lo]) / segLen;
  const pos = [0, 1, 2].map((d) => poly[lo][d] + (poly[hi][d] - poly[lo][d]) * u);
  const tan = [0, 1, 2].map((d) => poly[hi][d] - poly[lo][d]);
  const tl = Math.hypot(...tan) || 1e-6;
  return { pos, tan: tan.map((v) => v / tl) };
}

for (let i = 0; i < 3; i++) {
  const poly = railPoly(i);
  const { table, total } = arcLen(poly);
  const open = 49.5 + i * 1.8;
  const rail = { pts: poly.flat(), r: 0.09, open, close: 66 + i * 2.5, col: pick([2, 3, 5, 7]), seed: ri(0, 9999) };
  events.rails.push(rail);

  for (let j = 0; j < 3; j++) {
    const s0 = 0.02 + j * 0.3 + rr(0, 0.06);
    const t0 = open + 0.35 + j * 1.9 + rr(0, 0.5);
    let u = s0, v = 1.6, t = t0;
    const dt = 1 / 120;
    let exitT = t, exit = null;
    const keys = [[+t.toFixed(3), +u.toFixed(4)]];
    let lastKey = t;
    while (u < 1 && t < t0 + 24) {
      const { pos, tan } = sampleAt(poly, table, total, u);
      const a = -G * tan[1]; // 切向指向下(tan[1]<0)时加速
      v = Math.max(0.8, Math.min(12, v + a * dt));
      u += (v / total) * dt;
      t += dt;
      if (t - lastKey > 0.1) {
        keys.push([+Math.min(t, exitT + 99).toFixed(3), +Math.min(u, 1).toFixed(4)]);
        lastKey = t;
      }
      if (u >= 1) {
        exitT = t;
        const vel = [tan[0], tan[1], tan[2]].map((c) => c * v);
        exit = [...pos, ...vel];
      }
    }
    if (exit) keys.push([+exitT.toFixed(3), 1]);
    if (!exit) continue;
    // 落地与弹跳序列（解析式： restitution e，逐次衰减）
    const [ex, ey, ez, evx, evy, evz] = exit;
    const disc = Math.max(0, evy * evy + 2 * G * ey);
    const tf = (-evy + Math.sqrt(disc)) / G;
    const landT = exitT + tf;
    const vyImp = Math.abs(evy - G * tf);
    const e = 0.52;
    const lx = ex + evx * tf, lz = ez + evz * tf;
    events.orbs.push({
      rail: i, t0: +t0.toFixed(3), speed: 0, r: +rr(0.16, 0.26).toFixed(3),
      col: (i + j + ri(0, 2)) % 8,
      exitT: +exitT.toFixed(3),
      exit: exit.map((n) => +n.toFixed(3)),
      keys,
      landT: +landT.toFixed(3),
      vy0: +vyImp.toFixed(3),
      e,
    });
    // 抛物落地 → 水花 + 链式涟漪 + 触发音
    if (landT < 66 && events.flowers.length > 0) {
      const r2 = addRipple(lx, lz, landT + 0.02, 0.05, (i + j + 2) % 8, { sp: 2.6, wl: 1.6, life: 7 });
      // 链式小花：波前覆盖圈上的 3 朵
      for (let k = 0; k < 3; k++) {
        const a = rr(0, Math.PI * 2);
        const d = rr(1.2, 2.8);
        tryAddFlower(lx + Math.cos(a) * d, 0, lz + Math.sin(a) * d, 0, arrival(r2, lx + Math.cos(a) * d, lz + Math.sin(a) * d) + rr(0.1, 0.3));
      }
      events.triggers.push({ t: +landT.toFixed(3), kind: 2, x: +lx.toFixed(2), y: 0, z: +lz.toFixed(2), col: (i + j + 2) % 8, gain: 0.75 });
      // 弹跳序列触发音（第2次起落在原轨迹外推点附近）
      let bvy = e * vyImp, bt = landT, bx = lx, bz = lz;
      const bvx = evx * 0.94, bvz = evz * 0.94;
      for (let b = 0; b < 4; b++) {
        const airT = (2 * bvy) / G;
        if (airT < 0.05) break;
        bt += airT;
        bvy *= e;
        bx += bvx * airT * 0.7;
        bz += bvz * airT * 0.7;
        if (bt < 67) events.triggers.push({ t: +bt.toFixed(3), kind: 1, x: +bx.toFixed(2), y: 0, z: +bz.toFixed(2), col: (i + j + b) % 8, gain: +(0.34 * Math.pow(0.6, b) + 0.08).toFixed(2) });
      }
    }
  }
}
// 轨道中途弹跳（两球相向轻碰的编排音）
for (let i = 0; i < 6; i++) {
  events.triggers.push({ t: +(50.8 + i * 1.85 + rr(0, 0.4)).toFixed(3), kind: 1, x: 0, y: 0, z: 0, col: ri(0, 7), gain: 0.3 });
}

// ---------- 晶体 ----------
for (let i = 0; i < 150; i++) {
  const zone = i < 40 ? 0 : i < 100 ? 1 : 2;
  const [cx, cz, r, y0, y1, ta, tb] = zone === 0
    ? [-15, -48, 11, 3, 16, 66, 76]
    : zone === 1
      ? [-2, -66, 15, 6, 24, 76, 88]
      : [-2, -74, 14, 8, 26, 87, 99];
  events.crystals.push({
    t0: +rr(ta, tb).toFixed(3),
    x: +(cx + rr(-r, r)).toFixed(2),
    y: +rr(y0, y1).toFixed(2),
    z: +(cz + rr(-r * 0.8, r * 0.8)).toFixed(2),
    s: +rr(0.35, 1.25).toFixed(3),
    ax: +rr(-1, 1).toFixed(3), ay: +rr(-1, 1).toFixed(3), az: +rr(-1, 1).toFixed(3),
    spin: +rr(0.2, 1.4).toFixed(3),
    col: pick([2, 3, 4, 5, 7]),
  });
}
// 终章主角水晶（收拢后悬浮于原点，承托水滴）
events.crystals.push({ t0: 110.4, x: 0, y: 1.35, z: 0, s: 0.5, ax: 0, ay: 1, az: 0, spin: 0.4, col: 0 });

// ---------- 触发音总表 ----------
// 开花铃音（采样，避免过密）
for (const f of events.flowers) {
  if (f.t0 > 58) continue;
  if (rnd() < 0.16) {
    events.triggers.push({
      t: +(f.t0 + 0.35).toFixed(3), kind: 0,
      x: +f.x.toFixed(2), y: +f.y0.toFixed(2), z: +f.z.toFixed(2),
      col: ri(0, 7), gain: f.kind === 2 ? 0.5 : 0.24,
    });
  }
}
for (const rb of events.ribbons) events.triggers.push({ t: +(rb.t0 + 0.2).toFixed(3), kind: 3, x: 0, y: 0, z: 0, col: rb.col, gain: 0.3 });
for (const c of events.crystals) events.triggers.push({ t: +(c.t0 + 0.15).toFixed(3), kind: 4, x: c.x, y: c.y, z: c.z, col: c.col, gain: c.t0 > 100 ? 0.85 : 0.26 });
// 结构拍点（低频强调）
for (const p of [[2.4, 2, 1], [11, 0, 0.6], [26, 4, 0.5], [50, 1, 0.5], [63, 3, 0.6], [76, 4, 0.6], [90, 0, 0.7], [102, 3, 0.55], [113.6, 2, 0.9]]) {
  events.triggers.push({ t: p[0], kind: p[1], x: 0, y: 0, z: 0, col: ri(0, 7), gain: p[2] });
}
events.triggers.sort((a, b) => a.t - b.t);

// ---------- 输出 ----------
const out = resolve(ROOT, 'src/generated/events.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(events));
const n = (a) => a.length;
console.log(
  `[gen-events] ripples=${n(events.ripples)} flowers=${n(events.flowers)} ribbons=${n(events.ribbons)} rails=${n(events.rails)} orbs=${n(events.orbs)} crystals=${n(events.crystals)} triggers=${n(events.triggers)} → src/generated/events.json`
);
