/**
 * 本地一键部署到 GitHub Pages：构建 → 提交 → 推送到远端 main（触发 Actions 自动发布）。
 * 前提：已 `git remote add origin https://github.com/<user>/<repo>.git`，
 *      并在仓库 Settings → Pages 把 Source 设为 GitHub Actions。
 * 若未配置 origin，脚本只完成构建并打印后续指引，不会外发。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  return r.status ?? 1;
};
const cap = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
};

console.log('[deploy] 构建…');
if (run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']) !== 0) {
  console.error('[deploy] 构建失败（若缺依赖，先运行 npm install）');
  process.exit(1);
}

if (!existsSync(resolve(ROOT, '.git'))) {
  console.log('[deploy] 初始化 git 仓库…');
  run('git', ['init']);
  run('git', ['branch', '-M', 'main']);
}
const hasOrigin = cap('git', ['remote']).includes('origin');
if (!hasOrigin) {
  console.log('\n[deploy] 已构建，但尚未配置 GitHub 远端。后续三步：');
  console.log('  1) 在 GitHub 新建一个空仓库');
  console.log('  2) git remote add origin https://github.com/<用户名>/<仓库名>.git');
  console.log('  3) 再次运行 npm run deploy:gh');
  console.log('  并在仓库 Settings → Pages → Source 选择 GitHub Actions。');
  process.exit(0);
}

run('git', ['add', '-A']);
const msg = '光色花园 · Lumina Garden — ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
const committed = run('git', ['commit', '-m', msg]);
if (committed !== 0) console.log('[deploy] 无新改动可提交，继续推送…');
const branch = cap('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
console.log(`[deploy] 推送 ${branch} → origin …`);
if (run('git', ['push', '-u', 'origin', branch]) === 0) {
  console.log('[deploy] 已推送。GitHub Actions 正在构建发布，约 1–2 分钟后访问：');
  console.log('  https://<用户名>.github.io/<仓库名>/');
} else {
  console.error('[deploy] 推送失败，请检查远端权限/分支保护。');
  process.exit(1);
}
