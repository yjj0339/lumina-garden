/**
 * 4K 逐帧导出管线（无头 Chrome + CDP + ffmpeg）。
 * 画面由 stepForExport(t) 同步渲染，声音由 tools/export/audio.mjs 用同一事件表离线合成 → 音画天然同步。
 *
 * 用法：
 *   node tools/export/run.mjs --orientation landscape --fps 30            # 完整 3840×2160 / 120s
 *   node tools/export/run.mjs --orientation portrait  --fps 30            # 完整 2160×3840 / 120s
 *   node tools/export/run.mjs --seconds 8 --fps 30                        # 快速预览片段
 * 选项：--start <s> --seconds <s> --fps <n> --quality ultra|high|medium|low
 *       --port <n> --jpeg <0-100> --no-audio --keep-frames
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, navigate, sleep } from '../cdp.mjs';

const ROOT = process.cwd();
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes('--' + name) ? true : def);
};

const orientation = arg('orientation', 'landscape');
const fps = Number(arg('fps', 30));
const start = Number(arg('start', 0));
const seconds = Number(arg('seconds', 120));
const quality = arg('quality', 'ultra');
const port = Number(arg('port', orientation === 'portrait' ? 9421 : 9420));
const jpegQ = Number(arg('jpeg', 96));
const keepFrames = !!arg('keep-frames', false);
const noAudio = !!arg('no-audio', false);
const fmt = 'jpeg';

const [W, H] = orientation === 'portrait' ? [2160, 3840] : [3840, 2160];
const outDir = resolve(ROOT, 'tools/export/out');
const framesDir = resolve(outDir, `frames-${orientation}`);
const videoFile = resolve(outDir, `光色花园-${orientation === 'portrait' ? '竖屏2160x3840' : '横屏3840x2160'}.mp4`);
const audioFile = resolve(outDir, `audio-${orientation}.wav`);

mkdirSync(framesDir, { recursive: true });
console.log(`[export] ${orientation} ${W}×${H} @${fps}fps  t=${start}..${start + seconds}s  quality=${quality}`);

// 1) 音轨（整段 120s，后期按窗口裁剪，保证音画对齐）
if (!noAudio) {
  const r = spawnSync(process.execPath, ['tools/export/audio.mjs', audioFile], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('音轨合成失败');
}

// 2) 预览服务器
const serverUrl = process.env.LG_URL || 'http://127.0.0.1:4178/';
async function serverUp() {
  try { const r = await fetch(serverUrl, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
}
let serverProc = null;
if (!(await serverUp())) {
  console.log('[export] 启动预览服务器…');
  serverProc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4178', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await sleep(400);
  if (!(await serverUp())) throw new Error('预览服务器未能启动（请先 npm run build）');
}

// 3) 逐帧渲染
const { cdp, kill } = await launch({ port, width: W, height: H, dpr: 1 });
let frames = 0;
const t0 = Date.now();
try {
  const url = `${serverUrl}?nogui=1&autoplay=0&q=${quality}`;
  const { errors } = await navigate(cdp, url, { width: W, height: H, dpr: 1 });
  await sleep(2500);
  const ready = await cdp.evaluate('!!(window.__LG__ && window.__LG__.eventsData)');
  if (!ready) throw new Error('页面未就绪：' + (errors[0] || ''));
  await cdp.evaluate('window.__LG__.setExportMode(true)');
  // 关闭自动降档，锁定导出画质
  await cdp.evaluate(`window.__LG__.setQuality(${JSON.stringify(quality)}, true)`);

  const total = Math.round(seconds * fps);
  for (let f = 0; f < total; f++) {
    const t = start + f / fps;
    await cdp.evaluate(`window.__LG__.stepForExport(${t})`);
    // 等一次合成，确保 WebGL 结果进入帧缓冲
    await cdp.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))', true);
    const shot = await cdp.send('Page.captureScreenshot', { format: fmt, quality: fmt === 'jpeg' ? jpegQ : undefined, captureBeyondViewport: false });
    writeFileSync(`${framesDir}/f${String(f).padStart(5, '0')}.${fmt}`, Buffer.from(shot.data, 'base64'));
    frames++;
    if (f % 30 === 0 || f === total - 1) {
      const el = (Date.now() - t0) / 1000;
      const eta = f > 0 ? (el / f) * (total - f) : 0;
      console.log(`[export] ${f + 1}/${total}  ${el.toFixed(0)}s 剩余≈${eta.toFixed(0)}s`);
    }
  }
} finally {
  cdp.close();
  kill();
  if (serverProc) { try { serverProc.kill(); } catch { /* noop */ } }
}

// 4) ffmpeg 合成
const pattern = `${framesDir}/f%05d.${fmt}`;
if (!existsSync(pattern.replace('%05d', '00000'))) throw new Error('未生成任何帧');
const enc = [
  '-y', '-framerate', String(fps), '-i', pattern,
];
if (!noAudio) enc.push('-i', audioFile, '-ss', String(start), '-t', String(seconds), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
else enc.push('-an');
enc.push(
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-level', '5.2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-movflags', '+faststart', videoFile
);
console.log('[export] ffmpeg 合成中…');
const ff = spawnSync('ffmpeg', !noAudio
  ? ['-y', '-framerate', String(fps), '-i', pattern, '-ss', String(start), '-t', String(seconds), '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '5.2', '-c:a', 'aac', '-b:a', '192k', '-shortest',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', videoFile]
  : [...enc, videoFile], { stdio: 'inherit' });
if (ff.status !== 0) throw new Error('ffmpeg 合成失败（确认 ffmpeg 在 PATH 中）');
if (!keepFrames) rmSync(framesDir, { recursive: true, force: true });
console.log('[export] 完成 →', videoFile);
