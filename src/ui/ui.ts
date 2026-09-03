/**
 * 简洁精致的播放 UI：进度条（可拖动 seek）、播放/暂停、重播、音量、全屏、画质切换、阶段字幕。
 * 拖动进度 → 调用 App.seek(t)，所有元素（视觉 + 音频排程）随之确定重算。
 * 桌面与竖屏自适应布局。
 */
import type { App } from '../main';
import type { QualityName } from '../core/quality';
import { clamp } from '../core/math';

const QUALITIES: QualityName[] = ['low', 'medium', 'high', 'ultra'];
const QLABEL: Record<QualityName, string> = { low: '流畅', medium: '均衡', high: '高清', ultra: '极致' };

export class UI {
  private app: App;
  private root: HTMLElement;
  private bar: HTMLElement;
  private scrub: HTMLElement;
  private fill!: HTMLElement;
  private knob!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private volSlider!: HTMLInputElement;
  private qBtn!: HTMLButtonElement;
  private caption!: HTMLElement;
  private dragging = false;

  constructor(app: App) {
    this.app = app;
    this.root = document.getElementById('ui') as HTMLElement;
    this.bar = document.getElementById('bar') as HTMLElement;
    this.scrub = document.getElementById('scrub') as HTMLElement;
    this.build();
    this.bind();
  }

  private build(): void {
    this.scrub.innerHTML = `<div class="track"><div class="buf"></div><div class="fill"></div>${
      this.phaseMarksHTML()
    }<div class="knob"></div></div>`;
    this.fill = this.scrub.querySelector('.fill') as HTMLElement;
    this.knob = this.scrub.querySelector('.knob') as HTMLElement;

    this.root.querySelector('#controls')!.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest('button')?.id;
      if (!id) return;
      switch (id) {
        case 'b-play': this.app.toggle(); break;
        case 'b-replay': this.app.restart(); break;
        case 'b-full': this.app.toggleFullscreen(); break;
        case 'b-mute': this.onMute(); break;
        case 'b-quality': this.cycleQuality(); break;
      }
    });

    this.volSlider = document.getElementById('vol') as HTMLInputElement;
    this.volSlider.addEventListener('input', () => this.app.setVolume(parseFloat(this.volSlider.value)));
    this.playBtn = document.getElementById('b-play') as HTMLButtonElement;
    this.qBtn = document.getElementById('b-quality') as HTMLButtonElement;
    this.caption = document.getElementById('caption') as HTMLElement;
    this.syncQuality(this.app.currentState.quality);
  }

  private phaseMarksHTML(): string {
    const d = this.app.duration;
    const marks = this.app.phasesData.map((p) => `<span style="left:${((p.t0 / d) * 100).toFixed(2)}%"></span>`).join('');
    return `<div class="marks">${marks}</div>`;
  }

  private bind(): void {
    const tOf = (clientX: number): number => {
      const r = this.scrub.getBoundingClientRect();
      return clamp((clientX - r.left) / r.width, 0, 1) * this.app.duration;
    };
    const down = (e: PointerEvent): void => {
      this.dragging = true;
      this.scrub.setPointerCapture(e.pointerId);
      this.app.seek(tOf(e.clientX));
    };
    const move = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.app.seek(tOf(e.clientX));
    };
    const up = (e: PointerEvent): void => {
      this.dragging = false;
      try { this.scrub.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };
    this.scrub.addEventListener('pointerdown', down);
    this.scrub.addEventListener('pointermove', move);
    this.scrub.addEventListener('pointerup', up);
    this.scrub.addEventListener('pointercancel', up);

    // 键盘：空格播放/暂停，左右 ±5s，上下音量，f 全屏，r 重播
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const t = this.app.currentState.t;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.app.toggle(); break;
        case 'ArrowRight': this.app.seek(t + 5); break;
        case 'ArrowLeft': this.app.seek(t - 5); break;
        case 'ArrowUp': this.volSlider.value = String(clamp(parseFloat(this.volSlider.value) + 0.1, 0, 1)); this.app.setVolume(parseFloat(this.volSlider.value)); break;
        case 'ArrowDown': this.volSlider.value = String(clamp(parseFloat(this.volSlider.value) - 0.1, 0, 1)); this.app.setVolume(parseFloat(this.volSlider.value)); break;
        case 'KeyF': this.app.toggleFullscreen(); break;
        case 'KeyR': this.app.restart(); break;
      }
    });
    // 点击画面区切换播放
    document.getElementById('gl')!.addEventListener('click', () => this.app.toggle());
    this.root.addEventListener('pointermove', () => this.wake());
    this.wake();
  }

  private onMute(): void {
    const m = this.app.toggleMute();
    const btn = document.getElementById('b-mute') as HTMLButtonElement;
    btn.classList.toggle('muted', m);
  }
  private cycleQuality(): void {
    const cur = this.app.currentState.quality;
    const next = QUALITIES[(QUALITIES.indexOf(cur) + 1) % QUALITIES.length];
    this.app.setQuality(next);
  }

  syncQuality(q: QualityName): void { if (this.qBtn) this.qBtn.textContent = QLABEL[q]; }
  syncPlay(playing: boolean): void {
    if (!this.playBtn) return;
    this.playBtn.classList.toggle('playing', playing);
    this.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
  }
  syncProgress(t: number): void {
    const p = (t / this.app.duration) * 100;
    if (this.fill) this.fill.style.width = p + '%';
    if (this.knob) this.knob.style.left = p + '%';
    const el = document.getElementById('timecode') as HTMLElement;
    if (el) el.textContent = `${fmt(t)} / ${fmt(this.app.duration)}`;
  }
  syncCaption(t: number): void {
    if (!this.caption) return;
    const ph = this.app.phasesData.find((p) => t >= p.t0 && t < p.t1) ?? this.app.phasesData[0];
    if (this.caption.dataset.name !== ph.name) {
      this.caption.dataset.name = ph.name;
      this.caption.textContent = ph.caption;
      this.caption.classList.remove('show');
      void this.caption.offsetWidth;
      this.caption.classList.add('show');
    }
  }
  onResize(portrait: boolean): void {
    this.root.classList.toggle('portrait', portrait);
  }
  private hideTimer = 0;
  private wake(): void {
    this.bar.classList.add('active');
    this.root.classList.add('active');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.app.currentState.playing) { this.bar.classList.remove('active'); this.root.classList.remove('active'); }
    }, 3600);
  }
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
