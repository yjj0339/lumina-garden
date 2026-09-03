/**
 * 程序化音频引擎（WebAudio，纯合成，无外部素材 → 零体积、可离线导出）：
 *  - 环境垫音：多层失谐正弦 + 缓慢滤波扫动，随阶段主色换音色。
 *  - 音效：清脆铃(kind0)、玻璃轻碰(kind1)、水滴/入水(kind2)、风掠 whoosh(kind3)、辉光 shimmer(kind4)。
 *  - 与事件表同步：schedule(时间窗口内事件) 提前排程；seek 时清空重排 → 拖动后声音状态正确。
 *  音量总控 + 静音。所有节点图在 resume 后惰性构建。
 */
import type { Events, TriggerEv } from '../core/events';

type Kind = 0 | 1 | 2 | 3 | 4;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private padGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private events: Events;
  private volume = 0.8;
  private muted = false;
  private started = false;
  private scheduled = new Set<number>();
  private lookahead = 0.6;

  constructor(events: Events) {
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.started) { await this.ctx?.resume(); return; }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 3.2;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    master.connect(comp); comp.connect(ctx.destination);
    this.master = master;
    // 合成混响（噪声衰减脉冲）
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 2.4, 2.6);
    const rg = ctx.createGain(); rg.gain.value = 0.32;
    reverb.connect(rg); rg.connect(master);
    this.reverb = reverb;
    // 环境垫音
    const pad = ctx.createGain(); pad.gain.value = 0.0;
    const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 700; pf.Q.value = 0.8;
    pad.connect(pf); pf.connect(master);
    const sendPad = ctx.createGain(); sendPad.gain.value = 0.6;
    pf.connect(sendPad); sendPad.connect(reverb);
    const roots = [110, 164.81, 220, 329.63];
    for (const f of roots) {
      for (const det of [-5, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f; o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.09;
        o.connect(g); g.connect(pad); o.start();
        this.padOscs.push(o);
      }
    }
    this.padGain = pad; this.padFilter = pf;
    await ctx.resume();
    this.started = true;
  }

  private makeImpulse(ctx: AudioContext, dur: number, decay: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  get ready(): boolean { return this.started; }
  get isMuted(): boolean { return this.muted; }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }
  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }
  suspend(): void { this.ctx?.suspend(); }
  resume(): void { if (this.started) this.ctx?.resume(); }

  /** 时间线跳到 t：清空已排程标记，重新排布 [t, t+lookahead] 的事件 */
  seek(t: number): void {
    this.scheduled.clear();
    void t;
    // 下一次 sync 会按新 t 重新排程；这里先静音垫音避免拖尾串音
    if (this.padGain && this.ctx) this.padGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.15);
  }

  /** 每帧：随主时间线推进排程音效 + 调节垫音 */
  sync(t: number, dt: number, energy: number): void {
    if (!this.started || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    // 垫音：随能量与阶段渐入，结尾渐出
    if (this.padGain && this.padFilter) {
      const intro = Math.min(1, t / 4);
      const outro = 1 - Math.max(0, (t - 112) / 8);
      this.padGain.gain.setTargetAtTime(0.14 * intro * outro * (0.7 + energy * 0.6), now, 0.4);
      this.padFilter.frequency.setTargetAtTime(520 + energy * 900 + Math.sin(t * 0.2) * 120, now, 0.6);
    }
    for (let i = 0; i < this.events.triggers.length; i++) {
      const ev = this.events.triggers[i];
      if (ev.t < t - 0.05) continue;
      if (ev.t > t + this.lookahead) break;
      if (this.scheduled.has(i)) continue;
      this.scheduled.add(i);
      const when = now + (ev.t - t);
      if (when < now - 0.02) continue;
      this.playTrigger(ev, when);
    }
    void dt;
  }

  private playTrigger(ev: TriggerEv, when: number): void {
    const ctx = this.ctx!;
    const kind = ev.kind as Kind;
    const out = this.master!;
    const g = ctx.createGain();
    g.connect(out);
    const send = ctx.createGain();
    if (this.reverb) { send.connect(this.reverb); }
    send.connect(g);
    const vol = ev.gain;
    switch (kind) {
      case 0: this.bell(g, send, when, 520 + (ev.col % 8) * 60, vol); break;
      case 1: this.glass(g, send, when, 900 + (ev.col % 8) * 180, vol); break;
      case 2: this.drop(g, send, when, vol); break;
      case 3: this.whoosh(g, when, vol); break;
      case 4: this.shimmer(g, send, when, vol, ev.col); break;
    }
  }

  /** 清脆铃音：基频 + 泛音，指数衰减 */
  private bell(g: GainNode, send: GainNode, t: number, f: number, v: number): void {
    const ctx = this.ctx!;
    const partials = [1, 2.02, 2.94, 4.4];
    partials.forEach((p, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * p;
      const gg = ctx.createGain();
      const amp = v * 0.5 / (i + 1);
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(amp, t + 0.005);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3 - i * 0.2);
      o.connect(gg); gg.connect(g); gg.connect(send);
      o.start(t); o.stop(t + 1.4);
    });
  }

  /** 玻璃轻碰：短促高频 + 噪声起音 */
  private glass(g: GainNode, send: GainNode, t: number, f: number, v: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.25);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0, t);
    gg.gain.linearRampToValueAtTime(v * 0.4, t + 0.004);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(gg); gg.connect(g); gg.connect(send);
    o.start(t); o.stop(t + 0.45);
    const n = this.noiseSource(t, 0.03);
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(v * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(nf); nf.connect(ng); ng.connect(g);
  }

  /** 水滴/入水：下滑正弦 + 短splash噪声 */
  private drop(g: GainNode, send: GainNode, t: number, v: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0, t);
    gg.gain.linearRampToValueAtTime(v * 0.6, t + 0.008);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(gg); gg.connect(g); gg.connect(send);
    o.start(t); o.stop(t + 0.25);
    const n = this.noiseSource(t + 0.02, 0.16);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1600; nf.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(v * 0.28, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(nf); nf.connect(ng); ng.connect(g); ng.connect(send);
  }

  /** 风掠 whoosh：滤波噪声扫频 */
  private whoosh(g: GainNode, t: number, v: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSource(t, 0.7);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.7);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0, t);
    gg.gain.linearRampToValueAtTime(v * 0.22, t + 0.18);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(f); f.connect(gg); gg.connect(g);
  }

  /** 辉光 shimmer：上行琶音细粒 */
  private shimmer(g: GainNode, send: GainNode, t: number, v: number, col: number): void {
    const ctx = this.ctx!;
    const base = 660 + (col % 8) * 55;
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.05;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * Math.pow(1.2, i), tt);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0, tt);
      gg.gain.linearRampToValueAtTime(v * 0.18, tt + 0.02);
      gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.6);
      o.connect(gg); gg.connect(g); gg.connect(send);
      o.start(tt); o.stop(tt + 0.65);
    }
  }

  private noiseSource(t: number, dur: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.start(t);
    return src;
  }
}
