/**
 * 《光色花园》色板 —— 明亮清透梦幻风：
 * 奶油白 / 极浅天蓝为环境基调，珊瑚粉 / 杏橙为主角，
 * 湖蓝 / 薄荷绿为配角，柠檬黄 / 珍珠白 / 淡紫点缀。禁止深色与霓虹感。
 * 0x 值经过 sRGB→线性转换后供 shader 直接使用。
 */
import * as THREE from 'three';
import { Color } from 'three';

/** 十六进制 sRGB → 线性三分量数组（shader uniform 用） */
export function lin(hex: number): [number, number, number] {
  const c = new Color(hex);
  c.convertSRGBToLinear();
  return [c.r, c.g, c.b];
}

export const PALETTE = {
  cream: 0xfff4ea,
  sky: 0xd8eefb,
  skyDeep: 0xbfe3f5,
  coral: 0xff8e76,
  coralDeep: 0xf76f58,
  apricot: 0xffb367,
  apricotPale: 0xffd9a8,
  lake: 0x4fc3d9,
  lakeDeep: 0x2fa8c4,
  mint: 0x9fe8c5,
  mintPale: 0xcdf5de,
  lemon: 0xffe98a,
  pearl: 0xfdfbf4,
  lilac: 0xcdb9f0,
  lilacPale: 0xe4d9f8,
  rose: 0xffc2b4,
} as const;

/** GLSL 内 skyColor() 与 JS 侧保持一致的关键色（线性空间） */
export const ENV = {
  zenith: lin(0xc8e6f8),
  horizon: lin(0xfff1e4),
  floor: lin(0xf3e2d4),
  sun: lin(0xfff6da),
  sunTint: lin(0xffd9b8),
  coral: lin(PALETTE.coral),
  apricot: lin(PALETTE.apricot),
  lake: lin(PALETTE.lake),
  mint: lin(PALETTE.mint),
  lemon: lin(PALETTE.lemon),
  pearl: lin(PALETTE.pearl),
  lilac: lin(PALETTE.lilac),
  rose: lin(PALETTE.rose),
  fog: lin(0xf7ecdf),
} as const;

/** 涟漪/彩带/小球/晶体共用色序（线性 RGB 三元组） */
export const RIPPLE_COLORS: [number, number, number][] = [
  lin(PALETTE.coral),
  lin(PALETTE.apricot),
  lin(PALETTE.lake),
  lin(PALETTE.mint),
  lin(PALETTE.lemon),
  lin(PALETTE.lilac),
  lin(PALETTE.pearl),
  lin(PALETTE.rose),
];

export const THREE_COLOR = {
  coral: new Color(PALETTE.coral).convertSRGBToLinear(),
  apricot: new Color(PALETTE.apricot).convertSRGBToLinear(),
  lake: new Color(PALETTE.lake).convertSRGBToLinear(),
  mint: new Color(PALETTE.mint).convertSRGBToLinear(),
  lemon: new Color(PALETTE.lemon).convertSRGBToLinear(),
  lilac: new Color(PALETTE.lilac).convertSRGBToLinear(),
  pearl: new Color(PALETTE.pearl).convertSRGBToLinear(),
};

/** 阶段主色（相机分级/雾/音乐床共用），t 关键帧插值 */
export const PHASE_TINT: { t: number; c: [number, number, number] }[] = [
  { t: 0, c: lin(PALETTE.pearl) },
  { t: 2.6, c: lin(PALETTE.coral) },
  { t: 11, c: lin(PALETTE.apricot) },
  { t: 26, c: lin(PALETTE.rose) },
  { t: 36, c: lin(PALETTE.coral) },
  { t: 50, c: lin(PALETTE.mint) },
  { t: 62, c: lin(PALETTE.lemon) },
  { t: 74, c: lin(PALETTE.apricot) },
  { t: 88, c: lin(PALETTE.lake) },
  { t: 101, c: lin(PALETTE.lilac) },
  { t: 110, c: lin(PALETTE.pearl) },
  { t: 120, c: lin(PALETTE.pearl) },
];

export function tintAt(t: number): [number, number, number] {
  const a = PHASE_TINT;
  let i = 0;
  while (i < a.length - 2 && a[i + 1].t <= t) i++;
  const p = a[i];
  const q = a[i + 1];
  const u = THREE.MathUtils.smoothstep(t, p.t, q.t);
  return [
    p.c[0] + (q.c[0] - p.c[0]) * u,
    p.c[1] + (q.c[1] - p.c[1]) * u,
    p.c[2] + (q.c[2] - p.c[2]) * u,
  ];
}
