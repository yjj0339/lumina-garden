# 光色花园 · Lumina Garden

> 一场两分钟、无缝循环的高品质 3D 视觉演出。
> 一滴珊瑚粉水珠坠入浅水 → 水冠飞溅 → 玻璃花海绽放 → 穿入花心露珠微观 → 花瓣化带组成花冠拱门隧道 → 琉璃轨道弹跳彩球 → 花瓣峡谷 / 悬浮晶体 / 流动雕塑高潮 → 整座花园有序收拢，万物重新汇聚成开场那一滴光。

技术栈：**Three.js + TypeScript + GSAP + 自定义 GLSL 着色器 + 手写后期处理链**，纯程序化生成（无外部美术资源、无外部音频素材），可一键构建并部署。

---

## 目录

- [快速开始](#快速开始)
- [部署到公开链接](#部署到公开链接)
- [导出 4K 视频](#导出-4k-视频)
- [设计与技术要点](#设计与技术要点)
- [性能与适配](#性能与适配)
- [项目结构](#项目结构)

---

## 快速开始

需要 Node.js ≥ 18（推荐 20+）。

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（自动打开 http://localhost:5178）
npm run build      # 生成事件表 + 类型检查 + 生产构建 → dist/
npm run preview    # 预览生产构建
```

构建产物在 `dist/`，是纯静态文件，可直接丢到任意静态托管。

---

## 部署到公开链接

三种主流平台任选其一，产物都用相对路径（`base: './'`），子路径 / 根路径都能正确加载。

### 方案 A · GitHub Pages（推荐，全球最大开源托管）

1. 把本目录推到一个 GitHub 仓库：
   ```bash
   git init
   git add -A
   git commit -m "光色花园 Lumina Garden"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 已内置 `.github/workflows/deploy.yml`，push 后自动构建并发布。
4. 约 1–2 分钟后，Actions 页面会显示部署地址：
   `https://<用户名>.github.io/<仓库名>/`

也可用本地脚本一步提交（需先配好 `origin`）：
```bash
npm run deploy:gh
```

### 方案 B · Vercel

- 直接 Import 该 GitHub 仓库，框架识别为 Vite，或本地：
  ```bash
  npm i -g vercel && vercel --prod
  ```
- 已内置 `vercel.json`。

### 方案 C · Cloudflare Pages

- 连接仓库，Build command `npm run build`，Output directory `dist`；或：
  ```bash
  npx wrangler pages deploy dist --project-name lumina-garden
  ```
- 已内置 `wrangler.json`。

### 手机直接体验

部署完成后，用手机任意浏览器（Safari / Chrome）打开上面的 **HTTPS 链接**即可，无需安装 App。竖屏会自动切换到重新构图的机位与画质档位。

---

## 导出 4K 视频

前置：本机安装 **ffmpeg**（在 PATH 中）与 Chrome/Edge。项目会用无头浏览器逐帧渲染、并用同一份事件表离线合成音轨，保证音画精确对齐。

```bash
npm run build                                   # 先构建
node tools/export/run.mjs --orientation landscape --fps 30   # 3840×2160 横屏全片
node tools/export/run.mjs --orientation portrait  --fps 30   # 2160×3840 竖屏全片
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--orientation landscape\|portrait` | 横屏 3840×2160 / 竖屏 2160×3840 |
| `--fps <n>` | 帧率，成片用 30 或 60 |
| `--seconds <n>` / `--start <s>` | 只导出片段（快速预览，如 `--seconds 8`） |
| `--quality ultra\|high\|medium\|low` | 导出画质档（默认 ultra） |
| `--no-audio` | 只出画面不带音轨 |
| `--keep-frames` | 保留逐帧图片 |

成片输出到 `tools/export/out/光色花园-横屏3840x2160.mp4` 与 `…竖屏2160x3840.mp4`（H.264 / yuv420p / bt709，通用可播）。
> 全片 120s@30fps = 3600 帧，逐帧渲染耗时取决于 GPU，可先跑 `--seconds 8` 验证链路。

---

## 设计与技术要点

- **确定性时间线**：整场演出是一个 paused 的 GSAP master timeline，所有视觉/音频状态都是主时间线时刻 `t` 的纯函数（物理用解析式而非有状态模拟）。因此**拖动进度条后所有元素状态绝对正确**，也能做到**看不出断点的无缝循环**（`t=120` 与 `t=0` 帧精确一致）。
- **事件总表**：`tools/gen-events.mjs` 用固定随机种子预计算涟漪链、花朵绽放时刻（按真实波速推算）、弹球沿轨道的重力积分与抛体落地弹跳、晶体生成、以及一张按时间排序的音频触发表。运行时只做插值，不跑实时物理。
- **自定义着色器**：水面（涟漪叠加 + 焦散 + 菲涅尔反射天穹 + 折射水体 + 池底焦散）、玻璃花瓣（卷曲绽放 + 层间错峰 + 弹性余振 + 叶脉 + 薄透边缘 + 虹彩 + 露珠 + 次表面透光 + 风颤）、丝绸彩带、玻璃晶体、GPU 粒子（花粉/光丝/薄雾，运动频率对 120s 闭环）。
- **花海性能**：数百朵玻璃花、每朵多层多瓣，全部合并为**一次 instanced draw call**，绽放/收拢/风颤都在顶点着色器内按 `t` 解析计算。
- **后期链**（手写，非 addons，便于 4K 导出精确控制 RT 尺寸）：亮部提取 → 可分离高斯 Bloom（多档迭代）→ 可选景深 → 合成（ACES 色调映射 + 屏幕空间体积光 + 暗角 + 胶片颗粒 + 轻微色散），强度克制，杜绝过曝泛白。
- **程序化音频**：`src/audio/engine.ts`（WebAudio）与环境垫音/水滴/玻璃轻碰/清脆铃音/风掠/辉光全部实时合成；导出时 `tools/export/audio.mjs` 用同一事件表离线合成 44.1kHz 立体声 WAV，与画面天然同步。
- **色彩**：奶油白 / 极浅天蓝为环境基调，珊瑚粉 / 杏橙为主角，湖蓝 / 薄荷绿为配角，柠檬黄 / 珍珠白 / 淡紫点缀；各阶段有清晰主色并自然过渡，无深色背景、无廉价霓虹。

---

## 性能与适配

- **画质自动分档**：`low / medium / high / ultra` 四档，按设备内存、核心数、是否移动端自动选择；运行中有 `PerfGovernor` 监测 FPS，低于阈值自动降一档（只降不升，避免抖动）。
- **桌面 / 竖屏手机**：竖屏不是简单裁切，而是用 `lerpPortraitFix` 重排机位（拉近、抬高、加大纵向 FOV、注视点上移、环绕半径内收），并重新优化构图。
- **手动切换**：控制条「画质」按钮可循环切换档位，选择记入 `localStorage`。
- **操作**：轻触画面播放/暂停；进度条拖动 seek；键盘 空格=播放、← →=±5s、↑ ↓=音量、F=全屏、R=重播。
- **控制条**：播放、暂停、重播、音量、静音、全屏、画质切换、进度拖动，以及阶段字幕。

---

## 项目结构

```
lumina-garden/
├─ index.html                 # 页面骨架 + 控制条样式 + 启动动画
├─ vite.config.ts             # base:'./' 适配子路径 / 根路径
├─ .github/workflows/deploy.yml   # GitHub Pages 自动部署
├─ vercel.json / wrangler.json    # Vercel / Cloudflare Pages
├─ tools/
│  ├─ gen-events.mjs          # 事件总表生成器（构建前自动执行）
│  ├─ cdp.mjs                 # 零依赖 Chrome DevTools Protocol 客户端
│  ├─ diagnose.mjs            # 无头浏览器运行诊断 + 关键时刻截图
│  ├─ deploy-gh.mjs           # 本地一键提交部署 GitHub Pages
│  └─ export/
│     ├─ run.mjs              # 4K 逐帧导出 + ffmpeg 合成
│     └─ audio.mjs            # 离线音轨合成器
└─ src/
   ├─ core/                   # 事件类型、确定性数学、色板、时间线、画质、渲染器、着色器库
   ├─ world/                  # 天穹 / 水面 / 花海 / 水花 / 彩带 / 弹球 / 晶体 / 粒子 / 大气 / 微观
   ├─ render/postfx.ts        # 手写后期处理链
   ├─ audio/engine.ts         # WebAudio 程序化音频
   ├─ ui/ui.ts                # 播放控制层
   ├─ main.ts                 # 装配 + 播放器状态机 + 渲染循环 + 导出接口
   └─ generated/events.json   # 由 gen-events 生成
```

---

## 许可

演示性质项目。字体、色板与代码均为原创程序化生成，不含第三方美术/音频素材。
