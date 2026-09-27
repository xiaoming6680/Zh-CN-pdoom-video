// The render's language. The Chinese version (?zh=1; render.ts --zh) sets the translation of every sung line
// inside the plates beside the English (zh.ts) and prints everything else the plates say (labels, forms, UI,
// footnotes, stamps) in Chinese: scenes wrap their display strings in T(). Code listings, maths, numbers and
// names stay as they are.

/** On when the page URL has ?zh (preview: http://localhost:5173/?zh=1). */
export const ZH = typeof location !== 'undefined' && new URLSearchParams(location.search).has('zh');

/** A display string in the render's language: `zh` in the Chinese version, `en` otherwise. */
export const tr = (en: string, zh: string): string => (ZH ? zh : en);
export const T = tr;

/**
 * The Chinese face standing in for a Latin family's missing glyphs (Canvas2D falls back to it glyph by glyph):
 * 思源黑体 for Archivo and Plex Mono at the nearest weight, 思源宋体 for Cormorant. The faces are subsets of Noto
 * Sans SC / Noto Serif SC holding every Chinese character the video prints (analysis/make_fonts_zh.py).
 */
export function cjkFor(family: string): string {
  if (family.startsWith('Noto')) return family;
  const wt = +(/-(\d+)$/.exec(family)?.[1] ?? 400);
  if (family.startsWith('Cormorant')) return wt < 500 ? 'NotoSerifSC-400' : 'NotoSerifSC-600';
  // Archivo 300/500/700/900, its italics 400/800, Plex 300–700
  const w = wt < 350 ? 300 : wt < 450 ? 400 : wt < 650 ? 500 : wt < 800 ? 700 : 900;
  return `NotoSansSC-${w}`;
}

/** Every Chinese face (file = public/fonts/<family>.ttf). */
export const CJK_FAMILIES = ['NotoSansSC-300', 'NotoSansSC-400', 'NotoSansSC-500', 'NotoSansSC-700', 'NotoSansSC-900', 'NotoSerifSC-400', 'NotoSerifSC-600'];
