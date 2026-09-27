// The Chinese version's lyrics (?zh=1; render.ts --zh): the translation of every sung line (data/lyrics.zh.json),
// set in the video's type system and synced to the English vocal. A line is split into segments, each tied to the
// English words it translates; a segment lights glyph by glyph while those words are sung, so the Chinese never
// runs ahead of the voice.
//
// The plates set their lines themselves, inside their own layers and camera moves, beside the English: a plate
// claims its lines in init() and draws them where its English lyric is (zhLayer()?.draw(ctx, line, t, x, y, opts)),
// or builds its own treatment from the per-glyph state (set(), glyphState()). A line no plate claims falls back to
// this layer's fixed placement, drawn once per frame like the HUD and composited in post before the tone shoulder
// (so it takes the frame's grain, vignette, fades and flashes). The layer also carries the subtitle credit.
import type * as THREE from 'three';
import { Layer2D, W } from './gl';
import { Lyrics, type Line } from './lyrics';
import { HEX, type PaletteKey } from './palette';
import { F, font, layout, loadCjkFonts } from './type';
import type { TimelineEntry } from './engine';
import type { PostParams } from './post';
import { clamp, ease, lerp, prog, smoothstep } from './util';
import { ZH } from './lang';

export { ZH };

type Fx = 'rtl' | 'mirror' | 'askew' | 'mask';
interface ZhDoc { i: number; en: string; zh: string[]; to: number[]; gloss?: string; fx?: Record<string, Fx> }
interface ZhJSON { lines: ZhDoc[] }

/** A voice: the CJK face beside the Latin family of the matching register; `latin` scales Latin runs to sit with the ideographs. */
export interface Voice { cjk: string; latin: string; size: number; latinScale: number; typed?: boolean }
export const VOICES = {
  /** the lyric voice: 思源黑体 beside Archivo */
  sans: { cjk: 'NotoSansSC-700', latin: F.archivo(100, 700), size: 44, latinScale: 1 },
  /** a light lyric voice (hairline plates): 思源黑体 Light beside Archivo 300 */
  light: { cjk: 'NotoSansSC-300', latin: F.archivo(100, 300), size: 44, latinScale: 1 },
  /** the sacred/prophetic register (Omega Point, Loom, Ilya): 思源宋体 beside Cormorant */
  serif: { cjk: 'NotoSerifSC-600', latin: F.serif(600), size: 46, latinScale: 1.16 },
  /** the machine: typed into the prompt plates, 思源黑体 Regular beside Plex Mono */
  mono: { cjk: 'NotoSansSC-400', latin: F.mono(400), size: 40, latinScale: 1, typed: true },
  /** the machine, set rather than typed (forms, labels, readouts) */
  plex: { cjk: 'NotoSansSC-500', latin: F.mono(500), size: 40, latinScale: 1 },
  /** the hook */
  hook: { cjk: 'NotoSansSC-900', latin: F.archivo(100, 900), size: 58, latinScale: 1 },
} satisfies Record<string, Voice>;
export type VoiceKey = keyof typeof VOICES;
/** Footnotes: the mono voice, small. */
const GLOSS: Voice = { cjk: 'NotoSansSC-400', latin: F.mono(400), size: 17, latinScale: 1 };

/** Register the Chinese faces (see lang.ts CJK_FAMILIES and analysis/make_fonts_zh.py). */
export const loadZhFonts = loadCjkFonts;

/** Where a line sits: its left (or right/centre) end of the baseline, in logical px. */
interface Place { x: number; y: number; align: 'left' | 'right' | 'center'; voice: VoiceKey; band: boolean }
type Anchor = Pick<Place, 'x' | 'y' | 'align'>;
/** Candidate anchors for the fixed placement, all inside title safe (render.ts zhplace scores them against the plates). */
export const SLOTS = {
  bl: { x: 128, y: 930, align: 'left' },
  br: { x: 1792, y: 930, align: 'right' },
  bc: { x: 960, y: 930, align: 'center' },
  tl: { x: 128, y: 168, align: 'left' },
  tr: { x: 1792, y: 168, align: 'right' },
  tc: { x: 960, y: 168, align: 'center' },
  mr: { x: 1792, y: 700, align: 'right' },
} satisfies Record<string, Anchor>;
const BASE: Place = { ...SLOTS.bl, voice: 'sans', band: false };
/**
 * Fixed placement per plate (timeline id of the entry the line starts in), for lines no plate claims. Slots from
 * `render.ts zhplace` (the emptiest part of the plate over its lines); `band` (a flat ink plate under the line)
 * where no part of the plate stays clear. The voice also serves as the line's default voice in the plates.
 */
const PLATE: Record<string, Partial<Place>> = {
  open: SLOTS.br,
  loss: SLOTS.tr,
  prompt1: { voice: 'mono' }, prompt2: { voice: 'mono' }, prompt3: { voice: 'mono' },
  hook1: { voice: 'hook', band: true }, hook2: { voice: 'hook', band: true }, hook3: { voice: 'hook', band: true }, hook4: { voice: 'hook', band: true },
  shoggoth: SLOTS.br,
  ascent: SLOTS.br,
  bureau: { ...SLOTS.bl, band: true },
  fuse: SLOTS.tr,
  loom: { ...SLOTS.tr, voice: 'serif' },
  ilya: { voice: 'serif' },
};
/** Per line (index in data/lyrics.json), over the plate's. */
const LINE: Record<number, Partial<Place>> = {
  0: SLOTS.mr,
  7: { ...SLOTS.br, band: true }, 8: SLOTS.tr, 9: SLOTS.tl,
  10: { band: true },
  19: SLOTS.bl,
  20: { voice: 'serif' },
  30: { band: true },
  31: SLOTS.tl,
  36: { ...SLOTS.bc, band: true }, 37: { ...SLOTS.bc, band: true },
  38: { band: true }, 39: SLOTS.bc,
  43: { ...SLOTS.tc, band: true },
};

/** Glyphs lit less than this far into a typed (mono) line are not drawn yet. */
const TYPE_ON = 0.3;

export interface Glyph { ch: string; x: number; w: number; family: string; size: number; seg: number; tLit: number }
export interface Seg { a: number; b: number; x0: number; x1: number; fx?: Fx; text: string }
/** A line set in one voice: glyphs (x from the left end, at the voice's size), segments, footnote. */
export interface ZSet {
  voice: Voice; glyphs: Glyph[]; segs: Seg[]; width: number;
  gloss: { glyphs: Glyph[]; width: number; split: number } | null;
}
export interface ZLine {
  i: number; line: Line; doc: ZhDoc; plate: string; place: Place;
  /** each segment's stretch of the sung position (in words) */
  spans: [number, number][];
  /** on screen (fixed placement): tIn..tOut; cutIn/cutOut: a back-to-back switch with no fade */
  tIn: number; tOut: number; cutIn: boolean; cutOut: boolean;
  sets: Map<string, ZSet>;
}

const isCJK = (ch: string) => ch.codePointAt(0)! >= 0x2000; // the Noto subsets hold U+2000 and up (see analysis/make_fonts_zh.py)
const isHan = (ch: string) => /\p{Script=Han}/u.test(ch);
const isAlnum = (ch: string) => /[\p{L}\p{N}]/u.test(ch) && !isCJK(ch);
/** Space between a Han character and a Latin letter or digit (em of the CJK size); it replaces a typed space. */
const MIXED_GAP = 0.2;

const OPEN = '“‘（《「『', CLOSE = '，。、：；！？”’）》」』';
const isPunct = (ch: string) => OPEN.includes(ch) || CLOSE.includes(ch);

/**
 * Glyphs of `text` in a voice: CJK and Latin runs, each laid out with its font's kerning, one after the other.
 * Where a Han character meets a Latin letter or digit the runs are set MIXED_GAP apart (a space typed there is
 * dropped). Full-width punctuation carries half an em of space: where two meet (！” ，“) one half goes, an
 * opening mark at the start hangs its half outside the margin, and a closing mark at the end doesn't count it.
 */
export function setText(text: string, v: Voice, segOf: (i: number) => number = () => 0) {
  const { glyphs, width } = setRuns(text, v, segOf);
  let shift = 0;
  glyphs.forEach((g, k) => {
    if (k === 0 && OPEN.includes(g.ch)) shift -= 0.5 * g.size;
    g.x += shift;
    if (CLOSE.includes(g.ch) && isPunct(glyphs[k + 1]?.ch ?? '')) shift -= 0.5 * g.size;
  });
  const last = glyphs[glyphs.length - 1];
  if (last && CLOSE.includes(last.ch)) shift -= 0.5 * last.size;
  return { glyphs, width: width + shift };
}

function setRuns(text: string, v: Voice, segOf: (i: number) => number) {
  const chars = Array.from(text);
  const glyphs: Glyph[] = [];
  let x = 0, prev = '';
  for (let i = 0; i < chars.length;) {
    const cjk = isCJK(chars[i]!);
    let j = i;
    while (j < chars.length && isCJK(chars[j]!) === cjk) j++;
    let a = i, b = j;
    if (!cjk) {
      if (i > 0) while (a < b && chars[a] === ' ') a++;
      if (j < chars.length) while (b > a && chars[b - 1] === ' ') b--;
    }
    if (a < b) {
      const first = chars[a]!;
      if ((isHan(prev) && isAlnum(first)) || (isAlnum(prev) && isHan(first))) x += MIXED_GAP * v.size;
      const family = cjk ? v.cjk : v.latin, size = cjk ? v.size : v.size * v.latinScale;
      const lay = layout(chars.slice(a, b).join(''), family, size);
      lay.glyphs.forEach((g, k) => glyphs.push({ ch: g.ch, x: x + g.x, w: g.w, family, size, seg: segOf(a + k), tLit: 0 }));
      x += lay.width;
      prev = chars[b - 1]!;
    }
    i = j;
  }
  return { glyphs, width: x };
}

type RGB = number[];
const rgb = (k: PaletteKey) => { const n = parseInt(HEX[k].slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const BONE = rgb('bone'), INK = rgb('ink'), INK2 = rgb('ink2'), SIGNAL = rgb('signal');
const mix = (a: RGB, b: RGB, k: number) => a.map((x, i) => x + (b[i]! - x) * k);
const css = (c: RGB, a: number) => `rgba(${c.map((x) => Math.round(x)).join(',')},${clamp(a).toFixed(3)})`;
const col = (c: PaletteKey | RGB | undefined, d: RGB) => (c === undefined ? d : typeof c === 'string' ? rgb(c) : c);

/** Sung position of a line at t, in words (0..words.length): the sum of the words' sung progress. */
const posAt = (l: Line, t: number) => l.words.reduce((s, w) => s + Lyrics.wordProgress(w, t), 0);
/** First time the line's sung position reaches p (it only grows). */
function timeAtPos(l: Line, p: number) {
  let lo = l.words[0]!.start - 0.01, hi = l.words[l.words.length - 1]!.end + 0.01;
  for (let k = 0; k < 28; k++) { const m = (lo + hi) / 2; if (posAt(l, m) >= p - 1e-6) hi = m; else lo = m; }
  return hi;
}

/** How a plate sets a line (zhLayer().draw). Colours are palette keys or sRGB [r, g, b] 0..255. */
export interface ZhDraw {
  /** size of the ideographs in px (the voice's own size by default) */
  size?: number;
  /** register (default: the line's voice: mono in the prompts, serif in Loom/Ilya, the hook's in the hooks, else sans) */
  voice?: VoiceKey;
  /** which end of the line (x, y) is: its left end, right end or middle (default left) */
  align?: 'left' | 'right' | 'center';
  /** colour of glyphs not yet sung and of sung ones once they have cooled (default bone; ink on paper) */
  base?: PaletteKey | RGB;
  /** colour of the glyph being sung, cooling to `sung` over ~0.45 s (default signal orange) */
  hot?: PaletteKey | RGB;
  /** colour sung glyphs cool to (default `base`; e.g. signal where the plate keeps its sung words hot) */
  sung?: PaletteKey | RGB;
  /** a glow (canvas shadow blur, px) in the hot colour around glyphs being or already sung */
  glow?: number;
  /** opacity multiplier */
  alpha?: number;
  /** opacity of glyphs not yet sung (default 0.3; a typed voice doesn't draw them) */
  dim?: number;
  /** a flat plate under the line (true: ink2) */
  band?: boolean | PaletteKey | RGB;
  /** the footnote under the line (default true); its size (default 0.4 of the line's, at least 15 px) */
  gloss?: boolean;
  glossSize?: number;
  /** 'line' (default): on screen over the line's own window with its fades (see window()); 'always': the plate decides */
  env?: 'line' | 'always';
  /** typed (glyphs appear as sung, with a caret): default from the voice */
  typed?: boolean;
  /** keep each glyph upright/mirrored effects (the line's fx: mirror, rtl, askew, mask); default true */
  fx?: boolean;
}

/** The box a set line covers, in the coordinates it was drawn in (y down). */
export interface ZhBox { x0: number; y0: number; x1: number; y1: number }

let current: ZhLayer | null = null;
/** The Chinese lyric layer in the Chinese version (null otherwise). Plates reach it from init() on. */
export const zhLayer = () => current;

export class ZhLayer {
  layer = new Layer2D();
  lines: ZLine[] = [];
  private byIndex = new Map<number, ZLine>();
  /** lines a plate sets itself: the fixed placement leaves them out */
  private claimed = new Set<number>();

  static async load(lyrics: Lyrics, timeline: TimelineEntry[]) {
    const [doc] = await Promise.all([fetch('data/lyrics.zh.json').then((r) => r.json() as Promise<ZhJSON>), loadCjkFonts()]);
    return (current = new ZhLayer(lyrics, timeline, doc));
  }

  constructor(lyrics: Lyrics, timeline: TimelineEntry[], doc: ZhJSON) {
    for (const d of doc.lines) {
      const line = lyrics.lines[d.i];
      if (!line) { console.warn(`zh: no lyric line ${d.i}`); continue; }
      const fold = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
      if (fold(line.text) !== fold(d.en)) console.warn(`zh: line ${d.i} is "${line.text}", the translation is of "${d.en}"`);
      const n = line.words.length;
      if (d.to.length !== d.zh.length || d.to.some((x, k) => x < (d.to[k - 1] ?? 0) || x >= n) || d.to[d.to.length - 1] !== n - 1)
        console.warn(`zh: line ${d.i}: 'to' must rise through the English words and end on the last (${n - 1})`);
      const plate = timeline.find((e) => line.start + 0.05 >= e.start && line.start + 0.05 < e.end)?.id ?? '';
      const place: Place = { ...BASE, ...PLATE[plate], ...LINE[d.i] };

      // segments -> stretches of the sung position: a run of segments sharing a `to` splits it by length
      const spans: [number, number][] = [];
      for (let k = 0, from = 0; k < d.zh.length;) {
        let j = k;
        while (j + 1 < d.zh.length && d.to[j + 1] === d.to[k]) j++;
        const end = d.to[k]! + 1, wt = d.zh.slice(k, j + 1).map((s) => Math.max(1, Array.from(s).length));
        const tot = wt.reduce((a, b) => a + b, 0);
        for (let m = k, acc = from; m <= j; m++) { const dd = ((end - from) * wt[m - k]!) / tot; spans[m] = [acc, acc + dd]; acc += dd; }
        from = end;
        k = j + 1;
      }
      const z: ZLine = { i: d.i, line, doc: d, plate, place, spans, tIn: 0, tOut: 0, cutIn: false, cutOut: false, sets: new Map() };
      this.lines.push(z);
      this.byIndex.set(d.i, z);
    }
    // on screen from ~0.3 s before the first word (the original's anticipation) to 0.7 s after the last;
    // back-to-back lines switch at the end of the first (never before its last word is sung)
    this.lines.sort((p, q) => p.line.start - q.line.start);
    this.lines.forEach((z, k) => {
      const prev = this.lines[k - 1], next = this.lines[k + 1];
      z.tOut = next ? Math.min(z.line.end + 0.7, Math.max(z.line.end, next.line.start - 0.3)) : z.line.end + 0.7;
      z.tIn = Math.max(z.line.start - 0.3, prev?.tOut ?? -1);
      z.cutIn = !!prev && z.tIn - prev.tOut < 0.05;
      if (prev) prev.cutOut = z.cutIn;
    });
  }

  readonly slots = SLOTS;

  // ------------------------------------------------------------------ for the plates

  /** Mark lines (indices in data/lyrics.json, e.g. `this.L1.i`) as set by the calling plate. Call from init(). */
  claim(...lines: number[]) { for (const i of lines) this.claimed.add(i); }

  /** The Chinese of lyric line i (index in data/lyrics.json), if translated. */
  get(i: number): ZLine | undefined { return this.byIndex.get(i); }

  /** The line's text (its segments joined) and footnote. */
  text(i: number) { const z = this.get(i); return z ? { zh: z.doc.zh.join(''), segs: z.doc.zh, gloss: z.doc.gloss ?? null } : null; }

  /** The line set in a voice (cached): glyph x positions from the left end at the voice's own size. */
  set(i: number | ZLine, voice?: VoiceKey | Voice): ZSet | null {
    const z = typeof i === 'number' ? this.get(i) : i;
    if (!z) return null;
    const v: Voice = typeof voice === 'object' ? voice : VOICES[voice ?? z.place.voice];
    const key = typeof voice === 'object' ? JSON.stringify(voice) : voice ?? z.place.voice;
    let s = z.sets.get(key);
    if (s) return s;
    const d = z.doc;
    const starts: number[] = [];
    let c = 0;
    for (const x of d.zh) { starts.push(c); c += Array.from(x).length; }
    const segOf = (k: number) => { let m = 0; while (m + 1 < starts.length && starts[m + 1]! <= k) m++; return m; };
    const { glyphs, width } = setText(d.zh.join(''), v, segOf);
    const segs: Seg[] = d.zh.map((text, k) => {
      const gs = glyphs.filter((g) => g.seg === k && g.ch.trim());
      return { a: z.spans[k]![0], b: z.spans[k]![1], x0: Math.min(...gs.map((g) => g.x)), x1: Math.max(...gs.map((g) => g.x + g.w)), fx: d.fx?.[k], text };
    });
    // the moment each glyph is fully lit (its hot flash cools from there)
    for (const g of glyphs) {
      const sg = segs[g.seg]!, u = litEdge(sg, g, 1);
      g.tLit = timeAtPos(z.line, sg.a + (sg.b - sg.a) * u);
    }
    let gloss: ZSet['gloss'] = null;
    if (d.gloss) gloss = { ...setText(d.gloss, GLOSS), split: Array.from(d.gloss).indexOf('：') };
    s = { voice: v, glyphs, segs, width, gloss };
    z.sets.set(key, s);
    return s;
  }

  /** Sung position of line i at t, in English words (0..words). */
  pos(i: number | ZLine, t: number) { const z = typeof i === 'number' ? this.get(i) : i; return z ? posAt(z.line, t) : 0; }

  /** Sung progress (0..1) of segment k of line i at t. */
  segLit(i: number, k: number, t: number) {
    const z = this.get(i), sp = z?.spans[k];
    if (!z || !sp) return 0;
    const p = posAt(z.line, t);
    return sp[1] > sp[0] ? clamp((p - sp[0]) / (sp[1] - sp[0])) : p >= sp[1] ? 1 : 0;
  }

  /**
   * Karaoke state of glyph g of set S (line z) at t: how far it is lit (0..1), its colour and its opacity factor
   * (the same rules as the English: dim until sung, hot orange while sung, cooling to the base colour).
   */
  glyphState(z: ZLine, S: ZSet, g: Glyph, t: number, o: { base?: RGB; hot?: RGB; sung?: RGB; dim?: number; typed?: boolean } = {}) {
    const s = S.segs[g.seg]!;
    const pos = posAt(z.line, t);
    const u = s.b > s.a ? (pos - s.a) / (s.b - s.a) : pos >= s.b ? 1 : 0;
    const e0 = litEdge(s, g, 0), e1 = litEdge(s, g, 1);
    const lit = clamp((u - Math.min(e0, e1)) / Math.max(1e-4, Math.abs(e1 - e0)));
    const base = o.base ?? BONE, hot = o.hot ?? SIGNAL, typed = o.typed ?? !!S.voice.typed;
    const cool = lit >= 1 ? smoothstep(0, 0.45, t - g.tLit) : 0;
    const c = lit < 1 ? mix(base, hot, lit) : mix(hot, o.sung ?? base, cool);
    const a = typed && lit < TYPE_ON ? 0 : lit < 1 ? lerp(typed ? 1 : o.dim ?? 0.3, 1, lit) : lerp(1, 0.94, cool);
    return { lit, cool, col: c, a };
  }

  /** The line's on-screen envelope at t (0..1): in over 0.15 s from ~0.3 s before its first word, out after its last. */
  envelope(i: number | ZLine, t: number) {
    const z = typeof i === 'number' ? this.get(i) : i;
    if (!z || t < z.tIn || t >= z.tOut) return 0;
    return (z.cutIn ? 1 : smoothstep(z.tIn, z.tIn + 0.15, t)) * (z.cutOut ? 1 : 1 - smoothstep(z.tOut - 0.25, z.tOut, t));
  }

  /** Width and height (ideograph size) of line i set at `size` in a voice. */
  measure(i: number, o: { size?: number; voice?: VoiceKey } = {}) {
    const S = this.set(i, o.voice);
    if (!S) return null;
    const k = (o.size ?? S.voice.size) / S.voice.size;
    return { width: S.width * k, size: S.voice.size * k, gloss: S.gloss ? S.gloss.width * this.glossK(S, o.size ?? S.voice.size) : 0 };
  }

  /**
   * Draw line i into a plate's Canvas2D context at (x, y), the baseline's `align` end, under the context's current
   * transform (so it rides the plate's camera, roll, shake and 3D planes). Returns the box it covers, or null
   * (no translation, or outside the line's window).
   */
  draw(c: CanvasRenderingContext2D, i: number, t: number, x: number, y: number, o: ZhDraw = {}): ZhBox | null {
    const z = this.get(i), S = z && this.set(z, o.voice);
    if (!z || !S) return null;
    const env = o.env === 'always' ? 1 : this.envelope(z, t);
    const alpha = env * (o.alpha ?? 1);
    if (alpha <= 0.001) return null;
    const size = o.size ?? S.voice.size, k = size / S.voice.size;
    const w = S.width * k, align = o.align ?? 'left';
    const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    const base = col(o.base, BONE), hot = col(o.hot, SIGNAL), sung = o.sung === undefined ? undefined : col(o.sung, BONE);
    const box: ZhBox = { x0: x0 - 0.4 * size, y0: y - size * 1.1, x1: x0 + w + 0.4 * size, y1: y + size * 0.36 };
    const gs = o.glossSize ?? Math.max(15, size * 0.4);
    const glossY = y + size * 0.5 + gs * 1.5;
    if (o.gloss !== false && S.gloss) box.y1 = glossY + gs * 0.5;
    c.save();
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.shadowBlur = 0;
    if (o.band) {
      c.fillStyle = css(o.band === true ? INK2 : col(o.band, INK2), 0.92 * alpha);
      c.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    }
    this.glyphs(c, z, S, t, x0, y, k, alpha, { base, hot, sung, dim: o.dim, typed: o.typed, fx: o.fx !== false, glow: o.glow });
    if (o.gloss !== false && S.gloss) {
      const gk = this.glossK(S, size), gw = S.gloss.width * gk;
      const gx = align === 'left' ? x : align === 'right' ? x - gw : x - gw / 2;
      this.glossAt(c, S, t, z, gx, glossY, gk, alpha, base);
    }
    c.restore();
    return box;
  }

  /** The box (ideograph body) segment k of line i covers when the line is drawn at (x, y) with these size, voice and align. */
  segBox(i: number, k: number, x: number, y: number, o: { size?: number; voice?: VoiceKey; align?: 'left' | 'right' | 'center' } = {}): ZhBox | null {
    const S = this.set(i, o.voice), s = S?.segs[k];
    if (!S || !s) return null;
    const size = o.size ?? S.voice.size, q = size / S.voice.size, w = S.width * q, align = o.align ?? 'left';
    const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    return { x0: x0 + s.x0 * q, x1: x0 + s.x1 * q, y0: y - size * 0.88, y1: y + size * 0.12 };
  }

  /** Draw only line i's footnote with its left end of the baseline at (x, y) (for plates that place it themselves). */
  drawGloss(c: CanvasRenderingContext2D, i: number, t: number, x: number, y: number, o: { size?: number; base?: PaletteKey | RGB; alpha?: number; env?: 'line' | 'always' } = {}) {
    const z = this.get(i), S = z && this.set(z);
    if (!z || !S?.gloss) return 0;
    const alpha = (o.env === 'always' ? 1 : this.envelope(z, t)) * (o.alpha ?? 1);
    const gk = (o.size ?? GLOSS.size) / GLOSS.size;
    if (alpha > 0.001) { c.save(); c.textBaseline = 'alphabetic'; c.textAlign = 'left'; this.glossAt(c, S, t, z, x, y, gk, alpha, col(o.base, BONE)); c.restore(); }
    return S.gloss.width * gk;
  }

  private glossK(S: ZSet, size: number) { return Math.max(15, size * 0.4) / GLOSS.size; }

  private glossAt(c: CanvasRenderingContext2D, S: ZSet, t: number, z: ZLine, x: number, y: number, k: number, alpha: number, base: RGB) {
    // fades in once the line is under way; the term (before the colon) a step brighter
    const ga = alpha * smoothstep(z.tIn + 0.35, z.tIn + 0.8, t);
    if (ga <= 0.001) return;
    S.gloss!.glyphs.forEach((g, n) => {
      c.font = font(g.family, g.size * k);
      c.fillStyle = css(base, ga * (n < S.gloss!.split ? 0.82 : 0.55));
      c.fillText(g.ch, x + g.x * k, y);
    });
  }

  /** The glyphs of set S at (x0 = left end, y = baseline), scaled k, with the line's karaoke and fx. */
  private glyphs(c: CanvasRenderingContext2D, z: ZLine, S: ZSet, t: number, x0: number, y: number, k: number, alpha: number,
    o: { base: RGB; hot: RGB; sung?: RGB; dim?: number; typed?: boolean; fx: boolean; glow?: number }) {
    const pos = posAt(z.line, t);
    const typed = o.typed ?? !!S.voice.typed;
    let caret = -1;
    for (const g of S.glyphs) {
      if (!g.ch.trim()) continue;
      const s = S.segs[g.seg]!;
      const st = this.glyphState(z, S, g, t, { base: o.base, hot: o.hot, sung: o.sung, dim: o.dim, typed });
      if (st.a <= 0) continue;
      let gx = x0 + g.x * k;
      const fx = o.fx ? s.fx : undefined;
      c.save();
      if (o.glow && st.lit > 0) { c.shadowColor = css(o.hot, 0.8 * alpha); c.shadowBlur = o.glow; }
      if (fx === 'mirror') {
        // the segment set backwards, glyph by glyph mirrored in place (as the plate sets "backward")
        gx = x0 + (s.x0 + s.x1 - g.x - g.w) * k;
        c.translate(gx + (g.w * k) / 2, 0); c.scale(-1, 1); c.translate(-(gx + (g.w * k) / 2), 0);
      }
      if (fx === 'askew') {
        // leans further as it is sung (the plate's tilting table)
        const q = clamp((pos - s.a) / Math.max(1e-3, s.b - s.a)), ax = x0 + s.x0 * k;
        c.translate(ax, y); c.rotate(-0.05 - 0.13 * ease.outCubic(q)); c.translate(-ax, -y);
      }
      if (fx === 'mask' && st.lit < 1) {
        // [MASK]: a solid block until the word is sung
        c.fillStyle = css(o.base, alpha * lerp(0.5, 0, st.lit));
        c.fillRect(gx + g.w * k * 0.04, y - g.size * k * 0.84, g.w * k * 0.92, g.size * k * 0.96);
      }
      c.font = font(g.family, g.size * k);
      c.fillStyle = css(st.col, alpha * st.a * (fx === 'mask' ? st.lit : 1));
      c.fillText(g.ch, gx, y);
      c.restore();
      caret = Math.max(caret, x0 + (g.x + g.w) * k);
    }
    if (typed) {
      // the prompt's caret after the last typed glyph: solid while typing, blinking once the line is typed
      const done = pos >= z.line.words.length - 1e-3;
      if (caret < 0) caret = x0;
      if (!done || (t - z.line.end) % 1.06 < 0.53) {
        c.fillStyle = css(o.hot, alpha);
        c.fillRect(caret + 6 * k, y - S.voice.size * k * 0.86, 3 * k, S.voice.size * k * 1.04);
      }
    }
  }

  // ------------------------------------------------------------------ the layer (fixed placement, credit)

  /** Left end of a run `width` wide set at anchor p. */
  private left(p: Anchor, width: number) {
    return p.align === 'left' ? p.x : p.align === 'right' ? p.x - width : p.x - width / 2;
  }

  /** The box (logical px, y down) line z covers in the fixed placement with its baseline at anchor p. */
  box(z: ZLine, p: Anchor) {
    const S = this.set(z)!, s = S.voice.size, pad = 0.4 * s, x0 = this.left(p, S.width);
    const b = { x0: x0 - pad, y0: p.y - s * 1.1, x1: x0 + S.width + pad, y1: p.y + s * 0.36 };
    if (S.gloss) {
      const g0 = this.left(p, S.gloss.width);
      b.x0 = Math.min(b.x0, g0 - pad); b.x1 = Math.max(b.x1, g0 + S.gloss.width + pad);
      b.y1 = p.y + s * 0.5 + 30 + 14;
    }
    return b;
  }

  /** What the layer last held when it was only the credit (its look), to skip redrawing and re-uploading it. */
  private creditOnly = '';

  draw2D(t: number, post: PostParams): THREE.Texture {
    const L = this.layer;
    const z = this.lines.find((l) => t >= l.tIn && t < l.tOut && !this.claimed.has(l.i));
    // most frames hold only the credit, which changes only with the paper and the fades
    const sig = z ? '' : `${clamp(post.paper).toFixed(3)}|${clamp(post.fade).toFixed(3)}`;
    if (sig && sig === this.creditOnly) return L.texture;
    this.creditOnly = sig;
    L.clear();
    if (z) this.fixedLine(L.ctx, z, t, post);
    this.credit(L.ctx, post);
    return L.upload();
  }

  private fixedLine(c: CanvasRenderingContext2D, z: ZLine, t: number, post: PostParams) {
    const P = z.place, S = this.set(z)!;
    const alpha = this.envelope(z, t);
    if (alpha <= 0.001) return;
    const rise = 10 * (1 - ease.outExpo(prog(t, z.tIn, z.tIn + 0.4)));
    // on its band a line is bone on ink; otherwise it follows the plate (ink on the paper plates)
    const paper = P.band ? 0 : clamp(post.paper);
    const base = mix(BONE, INK, paper);
    const y = P.y + rise, x0 = this.left(P, S.width);
    c.save();
    c.textBaseline = 'alphabetic';
    if (P.band) {
      const b = this.box(z, { ...P, y });
      c.fillStyle = css(INK2, 0.92 * alpha);
      c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
    this.glyphs(c, z, S, t, x0, y, 1, alpha, { base, hot: SIGNAL, fx: true });
    if (S.gloss) this.glossAt(c, S, t, z, this.left(P, S.gloss.width), y + S.voice.size * 0.5 + 30, 1, alpha, base);
    c.restore();
  }

  /**
   * The subtitle credit, top right inside title safe: whose Chinese subtitles these are (the video itself is
   * Giacomo Magnanini's, the song its authors'). The instrument-label idiom of the plates: a signal tick, the
   * role in 思源黑体, the name in Plex Mono, bone at half strength on a flat ink plate that keeps it legible when
   * giant bone type passes under it (ink on a bone plate on the paper plates).
   */
  private credit(c: CanvasRenderingContext2D, post: PostParams) {
    const a = 0.5 * (1 - clamp(post.fade));
    if (a <= 0.001) return;
    const paper = clamp(post.paper), base = mix(BONE, INK, paper), ground = mix(INK2, BONE, paper);
    const role = '中文字幕', name = 'XIAOMING6680', size = 21, x1 = W - 96, y = 88;
    c.save();
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), size);
    c.letterSpacing = '2px';
    const nw = c.measureText(name).width - 2;
    c.letterSpacing = '0px';
    c.font = font('NotoSansSC-500', size);
    const rw = c.measureText(role).width, gap = 14, x0 = x1 - nw - gap - rw - 14;
    c.fillStyle = css(ground, a * 1.4);
    c.fillRect(x0 - 12, y - size * 1.08, x1 - x0 + 24, size * 1.5);
    c.fillStyle = css(base, a * 0.9);
    c.fillText(role, x1 - nw - gap - rw, y);
    c.font = font(F.mono(500), size);
    c.letterSpacing = '2px';
    c.fillStyle = css(base, a);
    c.fillText(name, x1 - nw, y);
    c.fillStyle = css(SIGNAL, Math.min(1, a * 1.7));
    c.fillRect(x0, y - size * 0.78, 3, size * 0.86);
    c.restore();
  }
}

/** How far through segment s (0..1, in reading order) glyph g's edge sits: its leading edge (e = 0) or trailing edge (e = 1). */
function litEdge(s: Seg, g: Glyph, e: number) {
  const w = Math.max(1, s.x1 - s.x0);
  const back = s.fx === 'rtl' || s.fx === 'mirror';
  return clamp(back ? (s.x1 - (g.x + g.w * (1 - e))) / w : (g.x + g.w * e - s.x0) / w);
}
