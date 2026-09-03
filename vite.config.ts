import { defineConfig } from 'vite';

/**
 * base: './' → 产物内所有资源都用相对路径引用，
 * 因此同一份 dist/ 既可以直接放在 GitHub Pages 项目站的子路径
 * （https://<user>.github.io/<repo>/），也可以放在 Vercel / Cloudflare Pages 的根路径。
 */
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5178,
    // 导出管线需要一个不受限的调试端口，见 tools/export/run.mjs
    headers: { 'Cache-Control': 'no-store' },
  },
  preview: { host: true, port: 4178 },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // three 体积大但不常变，单独分包便于 CDN 缓存
        manualChunks: { three: ['three'], gsap: ['gsap'] },
      },
    },
  },
});
