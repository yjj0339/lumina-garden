/**
 * 离线音轨合成器（纯 Node，无依赖）：读取 src/generated/events.json，
 * 用与浏览器 AudioEngine 相同的编排合成整段 120s WAV（44.1k / 16bit / 立体声）。
 * 画面与声音共用同一事件表 → 导出视频时天然同步。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SR = 44100;
const ROOT = process.cwd();
const events = JSON.parse(readFileSync(resolve(ROOT, 'src/generated/events.json'), 'utf8'));
const DUR = events.dur;

const N = Math.floor(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// —— 环境垫音：A 小调色彩和弦，随阶段能量渐入渐出 ——
function renderPad() {
  const roots = [110, 164.81, 220, 277.18, 329.63];
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const intro = clamp(t / 4, 0, 1);
    const outro = 1 - clamp((t - 112) / 8, 0, 1);
    const energy = clamp(Math.sin(clamp((t - 50) / 46, 0, 1) * Math.PI) * (t > 48 && t < 100 ? 1 : 0), 0, 1);
    const g = 0.05 * intro * outro * (0.7 + energy * 0.7);
    let s = 0;
    for (let k = 0; k < roots.length; k++) {
      const f = roots[k];
      const det = 1 + (k % 2 ? 0.003 : -0.003);
      // 缓慢颤动 + 轻微低通感（用二次谐波衰减近似）
      s += Math.sin(2 * Math.PI * f * det * t) * (0.6 / (1 + k * 0.5));
      s += Math.sin(2 * Math.PI * f * 2 * det * t + k) * (0.12 / (1 + k));
    }
    // 立体声微差
    const pan = 0.15 * Math.sin(2 * Math.PI * 0.05 * t);
    add(i, s * g * (1 - pan), s * g * (1 + pan));
  }
}

// —— 触发音 ——
function bell(i0, f, v) {
  const dur = 1.3;
  const parts = [1, 2.02, 2.94, 4.4];
  const n0 = Math.floor(i0);
  for (let p = 0; p < parts.length; p++) {
    const amp = (v * 0.16) / (p + 1);
    const decay = 1.3 - p * 0.2;
    const fr = f * parts[p];
    const end = n0 + Math.floor(SR * decay);
    for (let i = n0; i < end && i < N; i++) {
      const tt = (i - n0) / SR;
      const env = Math.exp(-tt * (6 / decay)) * clamp(tt / 0.005, 0, 1);
      const s = Math.sin(2 * Math.PI * fr * tt) * env * amp;
      add(i, s, s * 0.9);
    }
  }
}
function glass(i0, f, v) {
  const n0 = Math.floor(i0);
  const end = n0 + Math.floor(SR * 0.4);
  for (let i = n0; i < end && i < N; i++) {
    const tt = (i - n0) / SR;
    const fr = f * Math.exp(-tt * 1.1);
    const env = Math.exp(-tt * 10) * clamp(tt / 0.004, 0, 1);
    const s = (Math.sin(2 * Math.PI * fr * tt) + 0.3 * Math.sin(4 * Math.PI * fr * tt)) * env * v * 0.12;
    const nz = (hash(i * 1.7) * 2 - 1) * Math.exp(-tt * 60) * v * 0.06;
    add(i, s + nz, s + nz * 0.8);
  }
}
function drop(i0, v) {
  const n0 = Math.floor(i0);
  const end = n0 + Math.floor(SR * 0.25);
  for (let i = n0; i < end && i < N; i++) {
    const tt = (i - n0) / SR;
    const fr = 1100 * Math.exp(-tt * 15) + 180;
    const env = Math.exp(-tt * 14) * clamp(tt / 0.008, 0, 1);
    const s = Math.sin(2 * Math.PI * fr * tt) * env * v * 0.22;
    const nz = (hash(i * 2.3 + 5) * 2 - 1) * Math.exp(-Math.max(0, tt - 0.02) * 20) * v * 0.05 * (tt > 0.02 ? 1 : 0);
    add(i, s + nz, s + nz);
  }
}
function whoosh(i0, v) {
  const n0 = Math.floor(i0);
  const end = n0 + Math.floor(SR * 0.7);
  let lp = 0;
  for (let i = n0; i < end && i < N; i++) {
    const tt = (i - n0) / SR;
    const nz = hash(i * 0.9 + 11) * 2 - 1;
    lp += (nz - lp) * 0.08; // 简易低通
    const env = Math.sin(clamp(tt / 0.7, 0, 1) * Math.PI) * v * 0.05;
    add(i, lp * env, lp * env);
  }
}
function shimmer(i0, v, col) {
  const base = 660 + (col % 8) * 55;
  for (let g = 0; g < 4; g++) {
    const n0 = Math.floor(i0 + g * 0.05 * SR);
    const end = n0 + Math.floor(SR * 0.6);
    const fr = base * Math.pow(1.2, g);
    for (let i = n0; i < end && i < N; i++) {
      const tt = (i - n0) / SR;
      const env = Math.exp(-tt * 6) * clamp(tt / 0.02, 0, 1);
      const s = Math.sin(2 * Math.PI * fr * tt) * env * v * 0.05;
      add(i, s, s * 0.85);
    }
  }
}

function renderTriggers() {
  for (const ev of events.triggers) {
    const i0 = ev.t * SR;
    const v = ev.gain;
    switch (ev.kind) {
      case 0: bell(i0, 520 + (ev.col % 8) * 60, v); break;
      case 1: glass(i0, 900 + (ev.col % 8) * 180, v); break;
      case 2: drop(i0, v); break;
      case 3: whoosh(i0, v); break;
      case 4: shimmer(i0, v, ev.col); break;
    }
  }
}

// —— 主渲染 ——
renderPad();
renderTriggers();

// —— 软限幅 + 归一 ——
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const soft = (x) => Math.tanh(x * 1.2);

// —— 写 WAV ——
function encodeWav() {
  const bytes = Buffer.alloc(44 + N * 2 * 2);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  const u32 = (o, v) => bytes.writeUInt32LE(v, o);
  const u16 = (o, v) => bytes.writeUInt16LE(v, o);
  ws(0, 'RIFF'); u32(4, 36 + N * 4); ws(8, 'WAVE'); ws(12, 'fmt ');
  u32(16, 16); u16(20, 1); u16(22, 2); u32(24, SR); u32(28, SR * 4); u16(32, 4); u16(34, 16);
  ws(36, 'data'); u32(40, N * 4);
  let o = 44;
  for (let i = 0; i < N; i++) {
    const l = clamp(soft(L[i] * norm), -1, 1);
    const r = clamp(soft(R[i] * norm), -1, 1);
    bytes.writeInt16LE(Math.floor(l * 32767), o); o += 2;
    bytes.writeInt16LE(Math.floor(r * 32767), o); o += 2;
  }
  return bytes;
}
const out = process.argv[2] || resolve(ROOT, 'tools/export/out/audio.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodeWav());
console.log('[audio] wrote', out, (bytes2mb(44 + N * 4)).toFixed(1) + 'MB', 'peak=' + peak.toFixed(2));
function bytes2mb(b) { return b / 1048576; }
