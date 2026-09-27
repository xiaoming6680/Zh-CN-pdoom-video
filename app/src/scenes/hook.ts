// HOOK x4 — "I'M / UPPING / MY / P(DOOM)": one full-frame slam per sung word, then P(doom)
// itself takes the frame (maths label, rolling digits, scale) and leaves on the cut, a different
// way each time:
//   n=1 bone on ink, clean. The number lands on the DOOM hit; on the next 8th it implodes into a
//       spark and a centred P(DOOM) bursts out of it: FIG. 3a (room) opens by shattering that outline.
//   n=2 ink on a signal field. The instrument rolls in on "P(", and on DOOM the field closes like an
//       eyelid onto the glowing seam that opens FIG. 6 (ascent).
//   n=3 the breakdown: hairlines, tiny, black. A ghost of the number waits behind the words, rolls,
//       and burns out filament by filament on the cut.
//   n=4 maximal: strobes, stacked outlines, 0.99999…; the 9s multiply until the string is a thread,
//       which switches off into the loom's weft line (FIG. 13).
// The Chinese version (?zh): each Chinese segment (我 / 上调了 / 我的 / P(doom)) is part of its English word's hit,
// in the hook voice (思源黑体 Black), in the same slam transform: 我 nested under I'M's apostrophe on the shared
// baseline, 上调了 shooting up under UPPING, 我的 set vertically in MY's M–Y gap; with P(DOOM) the whole line lands
// on the instrument label's baseline (top right) and leaves with the instrument. Hook 3 sets its ladder bilingual
// (a light Chinese column); hook 1 keeps line 6's footnote (what P(doom) means) in the corner throughout.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { HEX, rgba } from '../engine/palette';
import { F, font, measure, layout, plain, type TextLayout } from '../engine/type';
import { PDoom, formatPDoom } from '../engine/hud';
import type { Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep, frameIdx } from '../engine/util';
import { sparkHead2D } from './_motifs';
import { ZH, tr } from '../engine/lang';
import { zhLayer, setText, type ZLine, type ZSet, type Glyph as ZGlyph } from '../engine/zh';

const CAP = 0.686; // Archivo cap height / em
const PCAP = 0.698; // Plex Mono cap height / em
const PADV = 0.6; // Plex Mono advance / em
/** Space between the italic P and "(" (em): no kerning between the two runs, so it is set by eye (the italic P's bowl overhangs its advance). */
const P_GAP = 0.05;

/** The instrument at full scale: maths label top-left, digits, tick bar (hairline variant for n=3). */
const BIG = { numSize: 720, numX: 92, numC: 585, labX: 118, labY: 214, labSize: 168, barX: 118, barY: 906, barW: W - 236 };
const HAIR = { numSize: 740, numX: 88, numC: 542, labX: 118, labY: 190, labSize: 84, barX: 118, barY: 890, barW: W - 236 };

// ---- hand-off geometry of the plates that follow (copied, not imported: they are other agents' files)
/** FIG. 3a (room): centred P(DOOM), Archivo 900 w100, 300 px, baseline H/2 + 0.36 em; its spark roots at the centre. */
const ROOM = { size: 300, root: { x: W * 0.5, y: H * 0.53 } };
/** FIG. 6 (ascent): the closed eye's camera and orbit (eye space: y up, seam y = TILT·x, |x| ≤ A). */
const EYE = { zoom: 0.68, rot: -0.07, cx: 0.12, cy: -0.06, A: 1, HU: 0.6, HL: 0.5, TILT: 0.06 };
/** FIG. 13 (loom): the reed's hairline across the loom at the cut, and the shuttle's spark on it. */
const THREAD = { y: 629, sparkX: 300 };

/** Deadpan footnote under the big number (Δ is computed from the actual step). */
const NOTES: Record<number, string> = {
  1: 'posterior · updated on one (1) chatbot',
  2: 'posterior · updated on Sydney',
  3: 'posterior · updated on a cat',
  4: 'posterior · rounded up',
};
const NOTES_ZH: Record<number, string> = {
  1: '后验 · 据一（1）个聊天机器人更新',
  2: '后验 · 据 Sydney 更新',
  3: '后验 · 据一只猫更新',
  4: '后验 · 已向上取整',
};

/** The Chinese version: where the whole line docks (right end of the baseline it shares with the instrument's label). */
const DOCK = { x: BIG.barX + BIG.barW, big: 68, hair: 44 };
/** Hook 1's footnote (line 6's gloss), bottom left on the instrument's footnote baseline. */
const GLOSS = { x: BIG.labX, y: BIG.barY + 50, size: 20 };

type Col = keyof typeof HEX;
type Style = (i: number) => { col: string; a: number };

export default class Hook extends Scene {
  n = 1;
  pd!: PDoom;
  L = new Layer2D();
  comp!: FSPass;
  words: Word[] = [];
  ws: number[] = [];
  /** P( and DOOM sung; the instrument's entrance; its roll; the exit window; hook 1's P(DOOM) burst. */
  tP = 0; tDoom = 0; tNum = 0; tRoll0 = 0; tRoll1 = 0; tX0 = 0; tX1 = 0; tSlam = 0;
  dPrev = 0; dNew = 0;
  prevWord = '';
  lw = 1; // hairline width multiplier (kept constant under the exit transforms)
  f = {
    im: F.archivo(100, 900), up: F.archivo(125, 900), my: F.archivo(62, 900), doom: F.archivo(100, 900),
    P: F.archivoItalic(100, 800), paren: F.archivo(62, 300), hair: F.archivo(100, 300), hairW: F.archivo(125, 300),
    mono: F.mono(400), monoM: F.mono(500), monoL: F.mono(300),
  };
  upLay!: TextLayout;
  finLay!: TextLayout;
  // ---- the Chinese version (null/empty in the English one)
  /** the hook line in Chinese, set in the hook voice and (hook 3) the light voice; hook 3's pre-roll: the plea's */
  zline: ZLine | null = null; zS: ZSet | null = null; zSL: ZSet | null = null; zPrev: ZLine | null = null;
  /** per segment: its ink's depth below the baseline (em), so a segment's ink sits on the English baseline */
  zDesc: number[] = [];
  /** 我 in I'M (left end of its baseline and size, from the word's origin); 我的 down MY's M–Y gap (column left, first baseline) */
  nIM = { x: 0, y: 0, size: 0 }; nMY = { x: 0, y: 0, size: 0 };
  zGloss: { glyphs: ZGlyph[]; split: number } | null = null;
  /** this frame's field and ink (the Chinese follows the English's strobes and punch frames) */
  bgK: Col = 'ink'; inkK: Col = 'bone';

  override init() {
    const { lyrics, params, start, end, audio: au } = this.ctx;
    this.n = Number(params.n ?? 1);
    const n = this.n;
    this.pd = new PDoom(lyrics);
    const line = lyrics.linesIn(start - 0.3, end).find((l) => /upping/i.test(l.text)) ?? lyrics.linesIn(start, end)[0]!;
    this.words = line.words.slice(0, 4);
    const prev = lyrics.lines[line.i - 1];
    this.prevWord = prev ? plain(prev.words[prev.words.length - 1]!.w) : ''; // typed (mono): typewriter quotes
    const zl = zhLayer();
    if (zl?.get(line.i)) {
      zl.claim(line.i);
      this.zline = zl.get(line.i)!;
      this.zS = zl.set(this.zline, 'hook');
      this.zSL = zl.set(this.zline, 'light');
      // the plea's tail runs into the pre-roll: hooks 1 and 2 leave it (like the English) to the white-out/field,
      // hook 3 keeps its held glyph under the held "go"
      if (n <= 3 && prev && zl.get(prev.i)) { zl.claim(prev.i); if (n === 3) this.zPrev = zl.get(prev.i)!; }
      this.initZh();
    }
    this.ws = this.words.map((w) => w.start);
    const wP = this.words[3] ?? this.words[this.words.length - 1]!;
    this.tP = wP.start;
    this.tDoom = Math.min(wP.syl && wP.syl.length > 1 ? wP.syl[1]![0] : wP.start + 0.4 * (wP.end - wP.start), end - 0.03);
    const step = this.pd.steps.find((s) => s.t >= this.tP - 0.01 && s.t < end + 0.2) ?? this.pd.lastStep(end);
    const i = this.pd.steps.indexOf(step);
    this.dPrev = this.pd.steps[Math.max(0, i - 1)]!.v; this.dNew = step.v;

    // Hooks 1 and 4 have a beat after the DOOM hit: the number arrives on DOOM. In 2 and 3 the hit is
    // the cut itself, so the number arrives on "P(" and lands on DOOM.
    const early = n === 2 || n === 3;
    this.tNum = early ? this.tP : this.tDoom;
    this.tRoll0 = this.tNum + 0.015;
    this.tRoll1 = n === 1 ? this.tDoom + 0.13 : n === 4 ? this.tDoom + 0.08 : Math.max(this.tRoll0 + 0.08, n === 3 ? this.tP + 0.11 : this.tDoom - 0.015);
    // exits (all land on the cut)
    if (n === 1) {
      const hat = au.timeOfBeat(Math.round(au.beatAt(this.tDoom)) + 0.5); // the 8th after DOOM
      this.tSlam = hat > this.tDoom + 0.15 && hat < end - 0.12 ? hat : lerp(this.tDoom, end, 0.5);
      this.tX0 = this.tSlam - 0.066; this.tX1 = this.tSlam - 0.004;
    } else if (n === 2) {
      this.tX0 = Math.min(this.tDoom, end - 0.05); this.tX1 = end - 0.002;
    } else if (n === 3) {
      this.tX0 = Math.max(this.tRoll1 + 0.01, end - 0.16); this.tX1 = end - 0.004;
    } else {
      this.tX0 = end - 0.1; this.tX1 = end - 0.008;
    }
    this.upLay = layout('UPPING', this.f.up, 100);
    this.finLay = layout('P(DOOM)', this.f.doom, ROOM.size);
    this.comp = new FSPass(COMP, {
      tex: { value: this.L.texture }, bgCol: { value: [0, 0, 0] }, echo: { value: 0 }, hot: { value: 1 }, gain: { value: 1 },
    });
  }

  // ------------------------------------------------------------------ the Chinese version
  /** Where the segments nest, from the words' own letterforms (Archivo's ink boxes). */
  private initZh() {
    const n = this.n, S = this.zS!;
    const mc = document.createElement('canvas').getContext('2d')!;
    const ink = (ch: string, fam: string, size: number) => { mc.font = font(fam, size); const m = mc.measureText(ch); return { l: -m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, b: m.actualBoundingBoxDescent }; };
    this.zDesc = S.segs.map((_, k) => Math.max(0, ...S.glyphs.filter((g) => g.seg === k && g.ch.trim()).map((g) => ink(g.ch, g.family, 100).b / 100)));
    // I'M: 我 in the gap between I and M, under the apostrophe, its ink on the baseline
    {
      const fam = this.f.im, w1 = measure('I’M', fam, 100) / 100;
      const size = Math.min(n === 1 ? 980 : 1200, (W - 150) / w1), lay = layout('I’M', fam, size), x0 = (-w1 * size) / 2;
      const iR = x0 + lay.glyphs[0]!.x + ink('I', fam, size).r, mL = x0 + lay.glyphs[2]!.x + ink('M', fam, size).l;
      const apo = ink('’', fam, size).b; // the apostrophe's bottom (above the baseline: negative)
      const zs = Math.min((mL - iR) * 0.8, (-apo - 0.05 * size) / 0.92);
      this.nIM = { x: (iR + mL) / 2 - zs / 2, y: -this.zDesc[0]! * zs, size: zs };
    }
    // MY: 我的 set vertically down the gap between M and the Y's stem (the stem's left edge sits 0.092 em left of the
    // Y's centre and runs straight from 0.266 em above the baseline down), ink ending inside title safe
    {
      const fam = this.f.my, size = n === 1 ? 1300 : 1420, lay = layout('MY', fam, size), x0 = -measure('MY', fam, size) / 2;
      const mR = x0 + lay.glyphs[0]!.x + ink('M', fam, size).r;
      const y = ink('Y', fam, size), yC = x0 + lay.glyphs[1]!.x + (y.l + y.r) / 2, stemL = yC - 0.092 * size;
      const base = H / 2 + (size * CAP) / 2;
      const yb = Math.min(0, 984 - base) - 6, yTop = -0.266 * size + 12;
      const zs = Math.min((stemL - mR) * 0.8, (yb - yTop) / 2.04);
      const k = this.zS!.segs.length > 2 ? 2 : 0;
      this.nMY = { x: (mR + stemL) / 2 - zs / 2, y: yb - this.zDesc[k]! * zs - zs * 1.02, size: zs };
    }
    // hook 1's footnote: line 6's gloss in the mono voice (term brighter, like the zh layer's footnotes)
    const gl = zhLayer()!.text(this.zline!.i)?.gloss;
    if (n === 1 && gl) {
      const s = setText(gl, { cjk: 'NotoSansSC-400', latin: F.mono(400), size: GLOSS.size, latinScale: 1 });
      this.zGloss = { glyphs: s.glyphs, split: s.glyphs.findIndex((g) => g.ch === '：') };
    }
  }

  /** Karaoke colours of the Chinese on this frame's field (sRGB): unsung dim, the sung glyph hot, then the ink. */
  private zCol() {
    if (this.n === 3) return { base: RGB.bone, hot: RGB.signal, sung: RGB.bone, dim: 0.3 };
    // on the signal field the hot colour can't be signal: ink on orange, darkening from dim as it is sung
    if (this.bgK === 'signal') return { base: rgbOf(this.inkK), hot: rgbOf(this.inkK), sung: rgbOf(this.inkK), dim: 0.3 };
    return { base: rgbOf(this.inkK), hot: RGB.signal, sung: rgbOf(this.inkK), dim: 0.45 };
  }

  /**
   * Segment k of the hook line, glyph by glyph (the zh layer's karaoke), at (x, y): the left end of its baseline, or
   * (vertical) the left edge of its column and its first glyph's baseline. `at(j)` moves glyph j (UPPING's rise;
   * null hides it); `stroke` draws outlines of that width instead (hook 4's echoes).
   */
  private zSeg(c: CanvasRenderingContext2D, t: number, k: number, x: number, y: number, size: number,
    o: { S?: ZSet; alpha?: number; vertical?: boolean; stroke?: number; strokeCol?: string; at?: (j: number) => { dy: number; sy: number; a?: number } | null } = {}) {
    const zl = zhLayer(), z = this.zline, S = o.S ?? this.zS;
    if (!zl || !z || !S || !S.segs[k]) return;
    const q = size / S.voice.size, col = this.zCol(), seg = S.segs[k]!;
    S.glyphs.filter((g) => g.seg === k && g.ch.trim()).forEach((g, j) => {
      const st = zl.glyphState(z, S, g, t, { base: col.base, hot: col.hot, sung: col.sung, dim: col.dim });
      const a = st.a * (o.alpha ?? 1);
      if (a <= 0.003) return;
      let gy = o.vertical ? y + j * size * 1.02 : y, sy = 1, pa = 1;
      if (o.at) { const p = o.at(j); if (!p) return; gy += p.dy; sy = p.sy; pa = p.a ?? 1; }
      c.save();
      c.globalAlpha *= pa;
      c.translate(o.vertical ? x : x + (g.x - seg.x0) * q, gy);
      if (sy !== 1) c.scale(1, sy);
      c.font = font(g.family, g.size * q);
      if (o.stroke) { c.lineWidth = o.stroke; c.strokeStyle = o.strokeCol ?? css(st.col, a); c.strokeText(g.ch, 0, 0); }
      else { c.fillStyle = css(st.col, a); c.fillText(g.ch, 0, 0); }
      c.restore();
    });
  }

  /** Hook 4: stacked outline echoes of a nested segment (as the English word's), scaled about the word's origin. */
  private zEchoes(c: CanvasRenderingContext2D, t: number, t0: number, draw: (stroke: number, col: string) => void) {
    const age = t - this.retrig(t, t0);
    for (let j = 6; j >= 1; j--) {
      const sc = 1 + j * 0.07 * (1 + age * 2.5);
      c.save();
      c.scale(sc, sc);
      draw(2 / sc, rgba(j % 2 ? 'signal' : 'bone', 0.6 - j * 0.07));
      c.restore();
    }
  }

  /** The whole line, docked on the instrument label's baseline at the top right (right-aligned to the bar's end). */
  private drawZhLine(c: CanvasRenderingContext2D, t: number, alpha = 1) {
    const zl = zhLayer();
    if (!zl || !this.zline || alpha <= 0.003) return;
    const hair = this.n === 3, col = this.zCol();
    zl.draw(c, this.zline.i, t, DOCK.x, hair ? HAIR.labY : BIG.labY, {
      voice: hair ? 'light' : 'hook', size: hair ? DOCK.hair : DOCK.big, align: 'right',
      base: col.base, hot: col.hot, sung: col.sung, dim: col.dim, env: 'always', alpha, gloss: false,
    });
  }

  /** Hook 1: line 6's footnote, bottom left, from the white-out on (not under MY, which fills the frame). */
  private drawZhGloss(c: CanvasRenderingContext2D, t: number, wi: number, inNum: boolean) {
    const G = this.zGloss;
    if (!G || (wi === 2 && !inNum)) return;
    const a = smoothstep(this.ctx.start + 0.08, this.ctx.start + 0.22, t);
    if (a <= 0.003) return;
    c.save();
    c.textBaseline = 'alphabetic';
    G.glyphs.forEach((g, i) => {
      c.font = font(g.family, g.size);
      c.fillStyle = rgba(this.inkK, a * (i <= G.split ? 0.9 : 0.72));
      c.fillText(g.ch, GLOSS.x + g.x, GLOSS.y);
    });
    c.restore();
  }

  // ------------------------------------------------------------------ helpers
  private wordIdx(t: number) {
    let i = -1;
    for (let k = 0; k < this.ws.length; k++) if (t >= this.ws[k]! - 1e-4) i = k;
    return i;
  }
  private slam(t: number, t0: number, amt = 0.14, dur = 0.16) {
    const r = this.retrig(t, t0);
    const hold = 1 + 0.035 * Math.max(0, t - t0); // held words creep toward camera
    return hold * (1 + amt * (r === t0 ? 1 : 0.5) * (1 - ease.outExpo(clamp((t - r) / dur))));
  }
  /** Hook 4 re-slams a held word on every beat ("strobing repeats"); others slam once. */
  private retrig(t: number, t0: number) {
    if (this.n !== 4) return t0;
    const au = this.ctx.audio;
    const bt = au.timeOfBeat(Math.floor(au.beatAt(t) + 1e-4));
    return bt > t0 + 0.12 ? bt : t0;
  }

  // ------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, n = this.n;
    const L = this.L; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    const wi = this.wordIdx(t);
    const o: PostOverrides = { bloomThreshold: 1.0, bloomKnee: 0.2, bloom: 0.6, bloomRadius: 0.55, ca: n === 3 ? 0.5 : 1.2, vignette: n === 2 ? 0.55 : 0.4, grain: n === 3 ? 0.07 : 0.055 };

    // ---- palette for this frame
    let bgK: Col = n === 2 ? 'signal' : 'ink';
    let inkK: Col = n === 2 ? 'ink' : 'bone';
    if (n === 4 && t >= this.ws[0]! - 0.01 && t < this.tDoom) {
      // strobe on the 8ths: ink / signal / bone
      const e = Math.floor(f.beat * 2);
      const m = ((e % 3) + 3) % 3;
      bgK = m === 0 ? 'ink' : m === 1 ? 'signal' : 'bone';
      inkK = m === 0 ? 'bone' : 'ink';
    }
    if (n === 1 && t < this.ws[0]!) { bgK = 'bone'; inkK = 'ink'; } // hold the prompt's white-out until I'M
    // punch frames: 2 inverted frames on every slam (not in the breakdown; hook 2's DOOM is the eyelid)
    const punchT = [...this.ws.slice(0, 3), n === 3 ? -9 : this.tP, n === 2 || n === 3 ? -9 : this.tDoom];
    const punch = n !== 3 && punchT.some((x) => t >= x && t < x + 2 / 60);
    if (punch) { const k = bgK; bgK = inkK; inkK = k; }
    this.bgK = bgK; this.inkK = inkK;

    // ---- content
    let shake = 0;
    const inNum = t >= this.tNum;
    if (n === 4 && t < this.ws[0]!) this.drawAskew(c, t);
    if (n === 3 && wi >= 0) this.drawGhost(c, t);
    if (!inNum) {
      if (wi < 0) this.drawPre(c, t, inkK);
      else if (n === 3) this.drawTiny(c, t, wi);
      else if (wi === 0) this.drawIM(c, t, inkK);
      else if (wi === 1) this.drawUP(c, t, inkK);
      else if (wi === 2) this.drawMY(c, t, inkK);
      else this.drawPDFull(c, t, inkK);
      if (wi >= 0 && n !== 3) shake = [0, 7, 13, 0, 20][n]! * pulse(t, this.retrig(t, this.ws[wi]!), 0.05);
      if (n !== 3) this.drawAnnotations(c, t, wi, inkK);
    } else {
      if (n === 3) this.drawTiny(c, t, 3, 1 - smoothstep(this.tNum, this.tNum + 0.06, t), 3);
      this.drawNumberPhase(c, t, inkK);
    }
    if (this.zGloss) this.drawZhGloss(c, t, wi, inNum);
    L.upload();

    const u = this.comp.u;
    (u.bgCol!.value as number[]).splice(0, 3, ...lin(bgK));
    u.echo!.value = n === 4 ? (wi === 3 && !inNum ? 0.02 : 0.06) * pulse(t, this.ws[Math.max(0, wi)] ?? t, 0.1) + (inNum && t < this.tX0 ? 0.025 : 0) : 0;
    u.hot!.value = bgK === 'signal' ? (n === 2 && t >= this.tX0 ? 1.4 : 0) : n === 3 ? 0.9 : 0.95;
    // hook 1's last frames: the drained outline runs white-hot, like the one FIG. 3a shatters
    u.gain!.value = n === 1 ? 1 + 0.9 * smoothstep(this.ctx.end - 0.09, this.ctx.end - 0.02, t) : n === 2 ? 1 + 0.7 * smoothstep(this.tX0 + 0.02, this.tX1, t) : n === 4 ? 1 + 1.2 * smoothstep(this.tX0 + 0.03, this.tX1, t) : 1;
    this.comp.render(this.ctx.renderer, out);

    // ---- camera-ish post
    if (n === 4 && t < this.ws[0]!) {
      // continuing "RLHF goes askew": the frame is still rolled, it snaps straight on I'M
      o.zoom = 1.08;
    }
    const hit = pulse(t, this.tDoom, 0.06);
    if (n !== 3 && n !== 2) { shake += [0, 10, 16, 0, 26][n]! * hit; o.zoom = (o.zoom ?? 1) * (1 + 0.04 * hit); }
    if (n === 1) { shake += 9 * pulse(t, this.tSlam, 0.05); o.bloom = 0.6 + 0.5 * pulse(t, this.tSlam, 0.08); }
    if (shake > 0.05) o.shake = [noise1(t * 60, 1) * shake, noise1(t * 60, 2) * shake];
    // the exits hand geometry to the next plate: hold the frame still for them
    const still = n === 1 ? this.ctx.end - 0.1 : this.tX0;
    if (t >= still) { o.shake = [0, 0]; o.zoom = 1; o.ca = 0.5; }
    return o;
  }

  // ------------------------------------------------------------------ words
  private drawPre(c: CanvasRenderingContext2D, t: number, ink: Col) {
    if (this.n === 3) {
      // the breakdown: the cursor is still holding on to the last letter, alone in the dark
      const a = 1 - smoothstep(this.ws[0]! - 0.12, this.ws[0]!, t);
      const size = 40, adv = size * PADV;
      const w = this.prevWord.length * adv;
      c.font = font(this.f.mono, size);
      c.fillStyle = rgba('bone', 0.8 * a);
      c.fillText(this.prevWord, W / 2 - w / 2, H / 2 + size * 0.35);
      c.fillStyle = rgba('signal', a);
      c.fillRect(W / 2 + w / 2 + 3, H / 2 + size * 0.35 - size * 0.78, 3, size * 0.9);
      // the Chinese row's caret still holds its last glyph (我) under it, as in the prompt
      const zl = zhLayer(), zp = this.zPrev, S = zp && zl?.set(zp, 'mono');
      const g = S?.glyphs.filter((x) => x.ch.trim()).pop();
      if (zl && zp && S && g) {
        const st = zl.glyphState(zp, S, g, t, { base: RGB.ember, hot: RGB.signal, sung: RGB.bone, typed: true });
        const zx = W / 2 - w / 2, zy = H / 2 + size * 0.35 + 62, gw = g.w;
        c.font = font(g.family, g.size);
        c.fillStyle = css(st.col, a * (st.a > 0 ? Math.max(st.a, 0.9) : 0));
        c.fillText(g.ch, zx, zy);
        c.fillStyle = rgba('signal', 0.9 * a);
        c.fillRect(zx + gw + 4, zy - g.size * 0.86, 3, g.size * 1.04);
      }
      return;
    }
    const k = ease.outExpo(prog(t, this.ctx.start, this.ws[0]!));
    c.fillStyle = rgba(ink, 0.3);
    c.fillRect(W / 2 - 400 * k, H / 2, 800 * k, 1);
  }

  /** Hook 4 pre-roll: the frame still askew from the previous plate; outlines of I'M pulse in. */
  private drawAskew(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.ws[0]!;
    const k = prog(t, this.ctx.start, t0);
    const fam = this.f.im, size = 1150;
    const w = measure('I’M', fam, size);
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(-0.12 * (1 - k * k));
    c.font = font(fam, size);
    for (let j = 0; j < 5; j++) {
      const sc = 0.2 + 0.8 * ((k * 2 + j / 5) % 1);
      c.save(); c.scale(sc, sc);
      c.strokeStyle = rgba(j % 2 ? 'signal' : 'bone', 0.5 * sc);
      c.lineWidth = 2 / sc;
      c.strokeText('I’M', -w / 2, (size * CAP) / 2);
      c.restore();
    }
    c.restore();
  }

  /** Type-specimen guides: hairlines at the word's baseline and cap height, full width. */
  private guides(c: CanvasRenderingContext2D, base: number, capH: number, ink: Col, a = 1) {
    if (this.n === 3) return;
    c.save();
    c.fillStyle = rgba(ink, 0.22 * a);
    c.fillRect(0, Math.round(base), W, 1);
    c.fillRect(0, Math.round(base - capH), W, 1);
    c.font = font(this.f.mono, ZH ? 13 : 11);
    c.fillStyle = rgba(ink, 0.5 * a);
    c.fillText(tr('baseline', '基线'), 96, Math.round(base) + (ZH ? 18 : 16));
    // (the Chinese version drops the label under its line where it would sit on the legend's row)
    const capY = Math.round(base - capH) - 8;
    c.fillText(`${tr('cap-height', '大写高度')} · ${(CAP).toFixed(3)} em`, 96, ZH && capY > 66 && capY < 104 ? capY + 26 : capY);
    c.restore();
  }

  private drawIM(c: CanvasRenderingContext2D, t: number, ink: Col) {
    const n = this.n, t0 = this.ws[0]!;
    const fam = this.f.im;
    const w1 = measure('I’M', fam, 100) / 100;
    const size = Math.min(n === 1 ? 980 : 1200, (W - 150) / w1);
    const s = this.slam(t, t0, n === 4 ? 0.3 : 0.16);
    const w = w1 * size;
    const base = H / 2 + (size * CAP) / 2;
    this.guides(c, base, size * CAP, ink);
    c.save();
    c.translate(W / 2, base);
    c.scale(s, s);
    if (n === 4) this.echoes(c, 'I’M', fam, size, -w / 2, 0, t, t0);
    c.font = font(fam, size);
    c.fillStyle = rgba(ink);
    c.fillText('I’M', -w / 2, 0);
    // 我, nested under the apostrophe on the same baseline
    if (this.zline) {
      const N = this.nIM;
      if (n === 4) this.zEchoes(c, t, t0, (sw, col) => this.zSeg(c, t, 0, N.x, N.y, N.size, { stroke: sw, strokeCol: col }));
      this.zSeg(c, t, 0, N.x, N.y, N.size);
    }
    c.restore();
  }

  private drawUP(c: CanvasRenderingContext2D, t: number, ink: Col) {
    const n = this.n, t0 = this.ws[1]!, t1 = this.ws[2] ?? t0 + 0.4;
    const fam = this.f.up;
    const size = Math.min(900, (W - 150) / (this.upLay.width / 100));
    const lay = layout('UPPING', fam, size);
    const x0 = (W - lay.width) / 2;
    const capH = size * CAP;
    const endY = H / 2 + capH / 2 - 30;
    const hold = t1 - t0;
    const dur = Math.min(0.3, hold * 0.8);
    const stagger = Math.min(0.035, hold * 0.08);
    // hook 4 holds "upping" ~1 s: the word launches again on every 8th note, a stream of rising copies
    const period = n === 4 ? this.ctx.audio.timeOfBeat(this.ctx.audio.beatAt(t0) + 0.5) - t0 : 99;
    const reps = n === 4 ? Math.min(8, 1 + Math.floor(Math.max(0, t - t0) / Math.max(0.12, period))) : 1;
    this.guides(c, endY, capH, ink, 0.6);
    c.save();
    c.font = font(fam, size);
    const posAt = (i: number, tt: number, rep: number) => {
      const ts = t0 + i * stagger + rep * period;
      const k = clamp((tt - ts) / dur);
      const e = ease.outExpo(k);
      const drift = Math.max(0, tt - ts - dur) * (n === 4 ? 900 : 70); // keeps rising
      return { y: lerp(H + capH * 1.3, endY, e) - drift, ts };
    };
    for (let rep = reps - 1; rep >= 0; rep--) {
      for (let i = 0; i < lay.glyphs.length; i++) {
        const g = lay.glyphs[i]!;
        const p = posAt(i, t, rep);
        if (t < p.ts || p.y < -80) continue;
        const pPrev = posAt(i, t - 1 / 60, rep);
        const vel = Math.abs(pPrev.y - p.y) * 60; // px/s
        const stretch = 1 + clamp(vel / 5000, 0, 1.3);
        const x = x0 + g.x;
        const trail = clamp(vel / 3000);
        if (trail > 0.02) {
          c.strokeStyle = rgba(ink, 0.55 * trail);
          c.lineWidth = 1.5;
          for (let j = 1; j <= 4; j++) {
            c.save(); c.translate(x, p.y + j * vel * 0.012); c.scale(1, stretch); c.strokeText(g.ch, 0, 0); c.restore();
          }
        }
        c.save();
        c.translate(x, p.y);
        c.scale(1, stretch);
        c.fillStyle = rgba(ink);
        if (n === 4 && rep < reps - 1) { c.strokeStyle = rgba(ink, 0.9); c.lineWidth = 3; c.strokeText(g.ch, 0, 0); }
        else c.fillText(g.ch, 0, 0);
        c.restore();
      }
    }
    // 上调了 shoots up under it the same way (its glyphs launched between the letters), left edge on the U's ink
    if (this.zline) {
      const zs = size * 0.52, zy = endY + 36 + 0.88 * zs, zx = Math.max(104, x0 + size * 0.05);
      const zpos = (j: number, tt: number, rep: number) => {
        const ts = t0 + (2 * j + 1) * stagger + rep * period;
        const e = ease.outExpo(clamp((tt - ts) / dur));
        return { y: lerp(H + zs * 1.3, zy, e) - Math.max(0, tt - ts - dur) * (n === 4 ? 900 : 70), ts };
      };
      for (let rep = reps - 1; rep >= 0; rep--) {
        const mv = (j: number) => {
          const p = zpos(j, t, rep);
          if (t < p.ts || p.y < -zs) return null;
          const vel = Math.abs(zpos(j, t - 1 / 60, rep).y - p.y) * 60;
          return { dy: p.y - zy, sy: 1 + clamp(vel / 5000, 0, 1.3), vel, trail: clamp(vel / 3000) };
        };
        for (let q = 1; q <= 4; q++) {
          this.zSeg(c, t, 1, zx, zy, zs, {
            stroke: 1.5, strokeCol: rgba(ink, 0.55),
            at: (j) => { const m = mv(j); return m && m.trail > 0.02 ? { dy: m.dy + q * m.vel * 0.012, sy: m.sy, a: m.trail } : null; },
          });
        }
        if (n === 4 && rep < reps - 1) this.zSeg(c, t, 1, zx, zy, zs, { at: mv, stroke: 3, strokeCol: rgba(ink, 0.9) });
        else this.zSeg(c, t, 1, zx, zy, zs, { at: mv });
      }
    }
    c.restore();
  }

  private drawMY(c: CanvasRenderingContext2D, t: number, ink: Col) {
    const n = this.n, t0 = this.ws[2]!;
    const fam = this.f.my;
    const size = n === 1 ? 1300 : 1420;
    const s = this.slam(t, t0, n === 4 ? 0.3 : 0.12);
    const w = measure('MY', fam, size);
    const base = H / 2 + (size * CAP) / 2;
    this.guides(c, base, size * CAP, ink);
    c.save();
    c.translate(W / 2, base);
    c.scale(s, s);
    if (n === 4) this.echoes(c, 'MY', fam, size, -w / 2, 0, t, t0);
    c.font = font(fam, size);
    c.fillStyle = rgba(ink);
    c.fillText('MY', -w / 2, 0);
    // 我的, set vertically down the gap between M and the Y's stem
    if (this.zline) {
      const N = this.nMY;
      if (n === 4) this.zEchoes(c, t, t0, (sw, col) => this.zSeg(c, t, 2, N.x, N.y, N.size, { vertical: true, stroke: sw, strokeCol: col }));
      this.zSeg(c, t, 2, N.x, N.y, N.size, { vertical: true });
    }
    c.restore();
  }

  /** Width of the maths-set P(DOOM) at a given em size. */
  private pdWidth(size: number, hair = false) {
    const f = this.f;
    return (measure('P', this.pFam(hair), size) + size * P_GAP + measure('(', f.paren, size * 1.25) * 2 + measure('DOOM', hair ? f.hairW : f.doom, size) + size * 0.03);
  }
  /** The P of P(DOOM): bold italic, or the light italic for the hairline variant. */
  private pFam(hair: boolean) { return hair ? F.archivoItalic(100, 400) : this.f.P; }
  /**
   * P(DOOM) set like a maths expression: italic P, hairline stretched delimiters, heavy DOOM.
   * Anchored at the left baseline. `lit` (0..1) karaoke for "DOOM)".
   */
  private drawPD(c: CanvasRenderingContext2D, x: number, base: number, size: number, ink: Col, lit: number, hair = false, doomCol?: string) {
    const f = this.f;
    c.fillStyle = rgba(ink);
    c.font = font(this.pFam(hair), size);
    c.fillText('P', x, base);
    x += measure('P', this.pFam(hair), size) + size * P_GAP;
    const psz = size * 1.25;
    c.font = font(f.paren, psz);
    c.fillText('(', x, base + psz * 0.12);
    x += measure('(', f.paren, psz);
    c.fillStyle = rgba(ink, lerp(this.n === 2 ? 0.3 : 0.2, 1, lit));
    c.font = font(hair ? f.hairW : f.doom, size);
    const pc = c.fillStyle;
    if (doomCol) c.fillStyle = doomCol;
    c.fillText('DOOM', x, base);
    c.fillStyle = pc;
    x += measure('DOOM', hair ? f.hairW : f.doom, size) + size * 0.03;
    c.font = font(f.paren, psz);
    c.fillText(')', x, base + psz * 0.12);
  }

  private drawPDFull(c: CanvasRenderingContext2D, t: number, ink: Col) {
    const n = this.n, t0 = this.tP;
    const size = (W - 190) / (this.pdWidth(100) / 100);
    const s = this.slam(t, t0, n === 4 ? 0.25 : 0.12);
    const w = this.pdWidth(size);
    const base = H / 2 + (size * CAP) / 2;
    this.guides(c, base, size * CAP, ink);
    c.save();
    c.translate(W / 2, base);
    c.scale(s, s);
    if (n === 4) {
      c.save();
      for (let j = 3; j >= 1; j--) {
        const sc = 1 + j * 0.07 * (1 + (t - t0) * 3);
        c.save(); c.scale(sc, sc); c.globalAlpha = 0.28 - j * 0.07;
        this.drawPD(c, -w / 2, 0, size, j % 2 ? 'signal' : 'bone', 1);
        c.restore();
      }
      c.restore();
    }
    this.drawPD(c, -w / 2, 0, size, ink, t >= this.tDoom ? 1 : 0);
    c.restore();
    // with P(DOOM) the whole Chinese line lands, on the baseline the instrument's label will take; it takes the
    // word's slam about its own anchor, so the punch stays inside title safe
    if (this.zline) {
      c.save();
      c.translate(DOCK.x, BIG.labY); c.scale(s, s); c.translate(-DOCK.x, -BIG.labY);
      this.drawZhLine(c, t);
      c.restore();
    }
  }

  /** Stacked outline echoes (hook 4). */
  private echoes(c: CanvasRenderingContext2D, s: string, fam: string, size: number, x: number, y: number, t: number, t0: number) {
    c.save();
    c.font = font(fam, size);
    const age = t - this.retrig(t, t0);
    for (let j = 6; j >= 1; j--) {
      const sc = 1 + j * 0.07 * (1 + age * 2.5);
      c.save();
      c.scale(sc, sc);
      c.strokeStyle = rgba(j % 2 ? 'signal' : 'bone', 0.6 - j * 0.07);
      c.lineWidth = 2 / sc;
      c.strokeText(s, x, y);
      c.restore();
    }
    c.restore();
  }

  /** Hook 3: tiny hairline words in a lot of black; earlier words climb away above, fading. */
  private drawTiny(c: CanvasRenderingContext2D, t: number, wi: number, fade = 1, skip = -1) {
    const labels = ['I’M', 'UPPING', 'MY', 'P(DOOM)'];
    const fam = this.f.hair, size = 54, track = 16, gap = 84;
    const cy = H / 2 + (size * CAP) / 2;
    for (let i = 0; i <= wi; i++) {
      if (i === skip) continue;
      const since = t - this.ws[i]!;
      const cur = i === wi;
      // the stack scrolls up one slot per new word (eased), plus a slow drift
      let slot = 0;
      for (let j = i + 1; j <= wi; j++) slot += ease.outExpo(clamp((t - this.ws[j]!) / 0.3));
      // each new word rises into its slot from below (UPPING from further), clear of the one leaving
      const rise = -(1 - ease.outExpo(clamp(since / 0.3))) * (i === 1 ? gap : gap * 0.5);
      const y = cy - slot * gap - rise - since * 8;
      const a = (cur ? 0.95 : 0.22 / slot) * fade;
      c.save();
      c.fillStyle = rgba('bone', a);
      const s = labels[i]!;
      if (s === 'P(DOOM)') {
        c.globalAlpha = fade;
        this.drawPD(c, W / 2 - this.pdWidth(size, true) / 2, y, size, 'bone', t >= this.tDoom ? 1 : 0, true);
      } else {
        c.font = font(fam, size);
        c.letterSpacing = `${track}px`;
        const w = measure(s, fam, size, track) - track;
        c.fillText(s, W / 2 - w / 2, y);
      }
      c.restore();
      // the rung's Chinese in a light column to the right, a hairline leader across the gutter
      if (this.zline && i < 3) {
        const ew = measure(s, fam, size, track) - track, zx = W / 2 + 200, lx = W / 2 + ew / 2 + 22;
        c.fillStyle = rgba('bone', 0.25 * a);
        c.fillRect(lx, y - 14, zx - 22 - lx, 1);
        this.zSeg(c, t, i, zx, y - this.zDesc[i]! * 40, 40, { S: this.zSL!, alpha: a });
      }
    }
    c.fillStyle = rgba('bone', 0.1 * fade);
    c.fillRect(W / 2 - 360, cy + 26, 720, 1);
  }

  private drawAnnotations(c: CanvasRenderingContext2D, t: number, wi: number, ink: Col) {
    if (ZH) { this.drawAnnotationsZh(c, wi, ink); return; }
    c.save();
    c.font = font(this.f.monoM, 13);
    c.letterSpacing = '3px';
    const labels = ["I'M", 'UPPING', 'MY', 'P(DOOM)']; // mono UI legend: typewriter apostrophe
    let x = 96;
    labels.forEach((l, i) => {
      const s = `${String(i + 1).padStart(2, '0')} ${l}`;
      c.fillStyle = i === wi ? rgba(ink === 'ink' ? 'ink' : 'signal', 1) : rgba(ink, 0.4);
      c.fillText(s, x, 84);
      x += measure(s, this.f.monoM, 13, 3) + 36;
    });
    c.textAlign = 'right';
    c.fillStyle = rgba(ink, 0.5);
    c.fillText(`HOOK ${this.n} / 4`, W - 96, 84);
    c.restore();
    void t;
  }

  /**
   * The legend in Chinese: the line's segments, each entering its slot as its word is sung (the Chinese never
   * runs ahead of the voice); the counter moves left of the subtitle credit's corner.
   */
  private drawAnnotationsZh(c: CanvasRenderingContext2D, wi: number, ink: Col) {
    const segs = this.zline?.doc.zh ?? ['我', '上调了', '我的', 'P(doom)'];
    c.save();
    c.font = font(this.f.monoM, 15);
    c.letterSpacing = '1px';
    let x = 96;
    segs.forEach((s, i) => {
      const num = String(i + 1).padStart(2, '0');
      c.fillStyle = i === wi ? rgba(ink === 'ink' ? 'ink' : 'signal', 1) : rgba(ink, 0.4);
      c.fillText(i <= wi ? `${num} ${s}` : num, x, 84);
      x += measure(`${num} ${s}`, this.f.monoM, 15, 1) + 30;
    });
    c.textAlign = 'right';
    c.fillStyle = rgba(ink, 0.5);
    c.fillText(`副歌 ${this.n} / 4`, 1440, 84);
    c.restore();
  }

  // ------------------------------------------------------------------ the number
  /**
   * Displayed value: rolls from the previous step to this hook's value (PDoom steps) in time to land
   * on the beat; hook 4 then keeps counting 9s.
   */
  private shown(t: number) {
    const k = prog(t, this.tRoll0, this.tRoll1, this.n === 3 ? ease.inOutCubic : ease.outCubic);
    const v = lerp(this.dPrev, this.dNew, k);
    if (this.n !== 4) return v;
    return lerp(v, Math.max(v, 0.999), prog(t, this.tRoll1 + 0.005, this.tRoll1 + 0.05, ease.outCubic));
  }
  /** Hook 4: how many extra 9s have been appended (one every 18 ms once 0.999 is reached). */
  private extra9(t: number) {
    if (this.n !== 4) return 0;
    const t9 = this.tRoll1 + 0.06;
    return t >= t9 ? Math.min(30, 1 + Math.floor((t - t9) / 0.018)) : 0;
  }
  /** Where the label glides in from: the word as it was last set (full-width slam, or the tiny ladder). */
  private labelFrom(t: number) {
    const n = this.n;
    if (n === 3) {
      const size = 54;
      const rise = (1 - ease.outExpo(clamp((t - this.tP) / 0.3))) * 42; // as drawTiny sets a new word
      return { x: W / 2 - this.pdWidth(size, true) / 2, base: H / 2 + (size * CAP) / 2 - (t - this.tP) * 8 + rise, size };
    }
    if (n === 1 || n === 4) {
      const size = (W - 190) / (this.pdWidth(100) / 100);
      return { x: W / 2 - this.pdWidth(size) / 2, base: H / 2 + (size * CAP) / 2, size };
    }
    return { x: BIG.labX, base: BIG.labY, size: BIG.labSize };
  }

  private drawNumberPhase(c: CanvasRenderingContext2D, t: number, ink: Col) {
    const n = this.n;
    this.lw = 1;
    if (n === 1) {
      // lands on DOOM; implodes into a spark on the next 8th; a centred P(DOOM) bursts out of it
      const R = ROOM.root;
      if (t < this.tSlam) {
        const k = prog(t, this.tX0, this.tX1, ease.inCubic);
        c.save();
        if (k > 0) { c.translate(R.x, R.y); c.scale(1 - k, 1 - k); c.translate(-R.x, -R.y); }
        this.drawInstrument(c, t, ink);
        c.restore();
        if (k > 0.02) sparkHead2D(c, R.x, R.y, t, 0.4 + 1.8 * k);
      } else {
        this.drawFinalPD(c, t);
      }
    } else if (n === 2) {
      // the field closes like an eyelid onto FIG. 6's glowing seam
      const e = prog(t, this.tX0, this.tX1);
      if (e <= 0) { this.drawInstrument(c, t, ink); return; }
      const S = eyePx(0, 0), P0 = eyePx(-1, -EYE.TILT), P1 = eyePx(1, EYE.TILT);
      const th = Math.atan2(P1.y - P0.y, P1.x - P0.x);
      const G = { x: BIG.numX + (4 * PADV * BIG.numSize) / 2, y: BIG.numC };
      const eo = ease.outCubic(e);
      c.save();
      c.translate(lerp(G.x, S.x, eo), lerp(G.y, S.y, eo));
      c.rotate(th * eo);
      c.scale(lerp(1, 0.55, eo), Math.max(0.002, (1 - e) * (1 - e)));
      c.translate(-G.x, -G.y);
      this.drawInstrument(c, t, ink);
      c.restore();
      this.drawLids(c, e);
    } else if (n === 3) {
      // burns out, filament by filament
      this.drawInstrument(c, t, ink);
    } else {
      // the 9s become a thread; the thread switches off into the loom's weft line
      const k = prog(t, this.tX0, this.tX1);
      if (k <= 0) { this.drawInstrument(c, t, ink); return; }
      const ex = this.extra9(t);
      const { size } = this.numFit(ex);
      const sw = (5 + ex) * size * PADV; // "0.999" + 9s
      const G = { x: BIG.numX + sw / 2, y: BIG.numC };
      const sy = Math.pow(1 - k, 3);
      c.save();
      c.translate(lerp(G.x, W / 2, ease.outCubic(k)), lerp(G.y, THREAD.y, ease.outCubic(k)));
      c.scale(lerp(1, (W + 40) / sw, ease.inCubic(k)), Math.max(0.003, sy));
      c.translate(-G.x, -G.y);
      this.drawInstrument(c, t, ink);
      c.restore();
      // the thread itself: bone, full width, hot at the shuttle
      const a = smoothstep(0.25, 0.85, k);
      c.fillStyle = rgba('bone', a);
      c.fillRect(0, THREAD.y - 1, W, 2);
      c.fillStyle = rgba('signal', 0.5 * a);
      c.fillRect(0, THREAD.y - 3, W, 1);
      if (k > 0.5) sparkHead2D(c, THREAD.sparkX, THREAD.y - 6, t, smoothstep(0.5, 1, k) * 0.9);
    }
  }

  /** Hook 1's last word: a plain centred P(DOOM) (FIG. 3a's geometry), bursting out of the spark, then draining to its outline. */
  private drawFinalPD(c: CanvasRenderingContext2D, t: number) {
    const R = ROOM.root, size = ROOM.size, fam = this.f.doom;
    const lay = this.finLay;
    const ox = W / 2 - lay.width / 2, oy = H / 2 + size * 0.36;
    const e = prog(t, this.tSlam, this.tSlam + 0.14);
    const s = e >= 1 ? 1 : lerp(0.1, 1, ease.outBack(e, 1.3));
    const end = this.ctx.end;
    const drain = smoothstep(end - 0.075, end - 0.012, t);
    c.save();
    c.translate(R.x, R.y); c.scale(s, s); c.translate(-R.x, -R.y);
    c.font = font(fam, size);
    // per glyph at the layout's positions (FIG. 3a builds its outline the same way)
    c.fillStyle = rgba('bone', 0.94 * (1 - drain));
    for (const g of lay.glyphs) c.fillText(g.ch, ox + g.x, oy);
    const lineA = smoothstep(end - 0.11, end - 0.04, t);
    if (lineA > 0) {
      c.lineJoin = 'round';
      c.strokeStyle = rgba('bone', lineA);
      c.lineWidth = 2.6 / s;
      for (const g of lay.glyphs) c.strokeText(g.ch, ox + g.x, oy);
    }
    // the Chinese line bursts out with it, centred under it, and drains with its fill
    zhLayer()?.draw(c, this.zline?.i ?? -1, t, W / 2, oy + 128, {
      voice: 'hook', size: 64, align: 'center', base: 'bone', hot: 'signal', sung: 'bone', dim: 0.45, env: 'always', alpha: 1 - drain, gloss: false,
    });
    c.restore();
    // the spark stays at the root (FIG. 3a's spark is born there)
    sparkHead2D(c, R.x, R.y, t, lerp(2.2, 0.75, prog(t, this.tSlam, this.tSlam + 0.16, ease.outCubic)));
  }

  /** Hook 2: ink lids closing onto the eye's seam (FIG. 6's opening camera and orbit). */
  private drawLids(c: CanvasRenderingContext2D, e: number) {
    const A = EYE.A * (1 + 2.6 * (1 - e));
    const h = Math.max(0.012, 4.4 * (1 - e) * (1 - e));
    const K = (x: number) => { const q = x / A; return Math.abs(q) < 1 ? Math.pow(1 - q * q, 0.62) : 0; };
    const up: { x: number; y: number }[] = [], dn: { x: number; y: number }[] = [];
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const x = lerp(-3.4, 3.6, i / N);
      up.push(eyePx(x, EYE.TILT * x + h * EYE.HU * K(x)));
      dn.push(eyePx(x, EYE.TILT * x - h * EYE.HL * K(x)));
    }
    c.save();
    c.fillStyle = rgba('ink', 1);
    c.beginPath();
    up.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.lineTo(W + 100, -100); c.lineTo(-100, -100); c.closePath(); c.fill();
    c.beginPath();
    dn.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.lineTo(W + 100, H + 100); c.lineTo(-100, H + 100); c.closePath(); c.fill();
    // lash lines (engraved edge of each lid, only where the lids are apart)
    c.strokeStyle = rgba('bone', 0.3 * (1 - smoothstep(0.6, 0.95, e)));
    c.lineWidth = 1.5;
    for (const [sgn, H0] of [[1, EYE.HU], [-1, EYE.HL]] as const) {
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = lerp(-A, A, i / N);
        const p = eyePx(x, EYE.TILT * x + sgn * h * H0 * K(x));
        if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
      }
      c.stroke();
    }
    // light through the closing seam
    const a = smoothstep(0.3, 0.9, e);
    if (a > 0) {
      const p0 = eyePx(-A, -EYE.TILT * A), p1 = eyePx(A, EYE.TILT * A);
      c.lineCap = 'round';
      c.strokeStyle = rgba('signal', 0.35 * a); c.lineWidth = 9;
      c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
      c.strokeStyle = rgba('signal', a); c.lineWidth = 3;
      c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    }
    c.restore();
  }

  /** Hook 3: the number's ghost, waiting behind the tiny words (hairline, barely there). */
  private drawGhost(c: CanvasRenderingContext2D, t: number) {
    if (t >= this.tNum) return;
    const a = 0.1 * smoothstep(this.ws[0]!, this.ws[0]! + 0.5, t);
    if (a <= 0.003) return;
    const size = HAIR.numSize;
    c.save();
    c.strokeStyle = rgba('bone', a);
    c.lineWidth = 1.2;
    c.font = font(this.f.monoL, size);
    c.strokeText(formatPDoom(this.dPrev), HAIR.numX, HAIR.numC + (size * PCAP) / 2);
    c.restore();
  }

  /** Size and baseline of the digits (hook 4 shrinks the type to fit the multiplying 9s). */
  private numFit(extra: number) {
    const B = this.n === 3 ? HAIR : BIG;
    const chars = 5 + extra;
    const size = extra > 0 ? Math.min(B.numSize, (W - 180) / (chars * PADV)) : B.numSize;
    return { size, base: B.numC + (size * PCAP) / 2 };
  }

  private drawInstrument(c: CanvasRenderingContext2D, t: number, ink: Col) {
    const n = this.n;
    const hair = n === 3;
    const B = hair ? HAIR : BIG;
    const age = t - this.tNum;
    const v = this.shown(t), vPrev = this.shown(t - 1 / 60);
    const inkSignal = ink === 'ink';
    // hook 3 burns out: each element goes at its own moment (label and bar first, then the digits)
    // (bar first, then the digits in a fixed shuffled order; the label last, flaring on the sung DOOM)
    const burn = (i: number): { col: string; a: number } => {
      if (!hair) return { col: '', a: 1 };
      const RANK = [3, 1, 0, 2];
      const span = Math.max(0.02, this.tX1 - 0.05 - (this.tX0 + 0.025));
      const tb = i === -2 ? this.tX0 : i === -1 ? this.tDoom : this.tX0 + 0.025 + (span * (RANK[i] ?? 3)) / 3;
      const heat = prog(t, tb - 0.03, tb + 0.01);
      const out = i === -1 ? 0.6 * prog(t, tb + 0.01, this.ctx.end) : prog(t, tb, tb + 0.05, ease.inQuad);
      const flick = 0.55 + 0.45 * hash(frameIdx(t), i + 3);
      const a = (1 - out) * (heat > 0 && out > 0 ? flick : 1) * (1 + 0.6 * heat * (1 - out));
      const k = Math.min(1, heat * 1.3);
      const col = k > 0 ? `rgb(${Math.round(lerp(242, 255, k))},${Math.round(lerp(236, 92, k))},${Math.round(lerp(228, 36, k))})` : rgba('bone');
      return { col, a: Math.min(1, a) * (i < 0 ? 1 : 0.92) };
    };
    const appear = hair ? prog(age, 0, 0.1) : 1;

    // ---- label: maths P(DOOM) gliding in from where the word was last set
    const m = n === 2 ? 1 : hair ? prog(t, this.tNum + 0.02, this.tNum + 0.16, ease.inOutCubic) : prog(t, this.tNum, this.tNum + 0.14, ease.outExpo);
    const from = this.labelFrom(t);
    const ls = Math.exp(lerp(Math.log(from.size), Math.log(B.labSize), m));
    c.save();
    const lb = burn(-1);
    c.globalAlpha = lb.a;
    this.drawPD(c, lerp(from.x, B.labX, m), lerp(from.base, B.labY, m), ls, ink, t >= this.tDoom ? 1 : 0, hair, hair && t >= this.tDoom ? lb.col : undefined);
    c.restore();
    const bb = burn(-2);

    // ---- bar + ticks (drawn on left to right as the instrument arrives)
    const d = prog(age, 0, hair ? 0.2 : 0.16, ease.outExpo);
    const bx = B.barX, by = B.barY, bw = B.barW;
    const th = hair ? 1 : 2;
    c.save();
    c.globalAlpha = appear * bb.a;
    c.fillStyle = rgba(ink, hair ? 0.35 : 0.43);
    c.fillRect(bx, by, bw * d, th);
    for (let i = 0; i <= 10 * d; i++) {
      const hh = (i % 5 === 0 ? 5 : 3) * (hair ? 3 : 4);
      c.fillRect(bx + (bw * i) / 10, by - hh, th, hh);
    }
    c.font = font(this.f.mono, 13);
    c.fillStyle = rgba(ink, 0.55 * smoothstep(0.3, 0.9, d));
    for (const i of [0, 5, 10]) c.fillText((i / 10).toFixed(2), bx + (bw * i) / 10 - (i === 10 ? 30 : i === 5 ? 15 : 0), by + 26);
    c.textAlign = 'right';
    const dd = this.dNew - this.dPrev;
    if (ZH) c.font = font(this.f.mono, 15);
    // U+2206 INCREMENT: Plex Mono has it, not the Greek Δ (which would fall back to a system font)
    c.fillText(`\u2206 ${dd >= 0 ? '+' : '−'}${Math.abs(dd).toFixed(2)} · ${(ZH ? NOTES_ZH : NOTES)[n] ?? ''}`, bx + bw, by + 50);
    c.textAlign = 'left';
    c.fillStyle = hair ? rgba('bone', 0.9) : inkSignal ? rgba('ink', 1) : rgba('signal', 1);
    c.fillRect(bx, by - (hair ? 1 : 3), bw * clamp(v) * d, hair ? 3 : 9);
    c.restore();

    // ---- the number (slams in; hook 3 fades in)
    const extra = this.extra9(t);
    const { size, base } = this.numFit(extra);
    const numCol = inkSignal ? rgba('ink', 1) : hair ? rgba('bone', 0.9) : rgba('signal', 1);
    const s = hair ? 1 : 1 + 0.1 * (1 - ease.outExpo(clamp(age / 0.16)));
    c.save();
    const cx = B.numX + (4 * PADV * size) / 2, cy = B.numC;
    c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy);
    c.globalAlpha = appear;
    c.fillStyle = numCol; c.strokeStyle = numCol;
    this.drawDigits(c, B.numX, base, size, v, vPrev, extra, hair, hair ? burn : undefined);
    c.restore();
    // the Chinese line on the label's baseline (hook 3's burns out with the label)
    if (this.zline) this.drawZhLine(c, t, hair ? appear * lb.a : 1);
  }

  /** Rolling number: each digit on a drum (continuous value), formatted like formatPDoom, plus hook 4's 9s. */
  private drawDigits(c: CanvasRenderingContext2D, x: number, y: number, size: number, v: number, vPrev: number, extra: number, hair: boolean, style?: Style) {
    const dec = formatPDoom(v).length - 2;
    const scale = Math.pow(10, dec);
    const N = v * scale, Np = vPrev * scale;
    const adv = size * PADV;
    const rowH = size * 1.05;
    const a0 = c.globalAlpha;
    const glyph = (s: string, gx: number, gy: number) => {
      if (hair) { c.lineWidth = 1.4 * this.lw; c.strokeText(s, gx, gy); } else c.fillText(s, gx, gy);
    };
    const apply = (i: number) => {
      if (!style) return 1;
      const st = style(i);
      c.fillStyle = st.col; c.strokeStyle = st.col;
      return st.a;
    };
    c.font = font(hair ? this.f.monoL : this.f.mono, size);
    let sa = apply(0); c.globalAlpha = a0 * sa; glyph('0', x, y);
    sa = apply(1); c.globalAlpha = a0 * sa; glyph('.', x + adv, y);
    for (let d = 0; d < dec; d++) {
      const kp = dec - 1 - d; // 0 = last digit
      const pos = drum(N, kp), posP = drum(Np, kp);
      const speed = Math.abs(pos - posP) * 60;
      const xx = x + adv * (2 + d);
      sa = apply(2 + d);
      c.save();
      c.beginPath();
      c.rect(xx - 6, y - size * PCAP - size * 0.3, adv + 12, size * PCAP + size * 0.6);
      c.clip();
      const base = Math.floor(pos), fr = pos - base;
      const blur = clamp(speed / 25, 0, 1);
      for (let j = -1; j <= 1; j++) {
        const dig = (((base + j) % 10) + 10) % 10;
        const off = (fr - j) * rowH;
        const a = (1 - Math.min(1, Math.abs(off) / (rowH * 0.85))) * (hair && j !== 0 ? 0.5 : 1);
        if (a <= 0.01) continue;
        const copies = blur > 0.05 && !hair ? 4 : 1;
        for (let q = 0; q < copies; q++) {
          c.globalAlpha = a0 * sa * a * (copies > 1 ? 0.4 : 1);
          glyph(String(dig), xx, y + off + (q - (copies - 1) / 2) * rowH * 0.07 * blur);
        }
      }
      c.restore();
    }
    // the multiplying 9s
    c.globalAlpha = a0;
    for (let e = 0; e < extra; e++) glyph('9', x + adv * (2 + dec + e), y);
    if (extra > 0) {
      // stacked outlines of the whole string (maximal)
      const s = '0.' + '9'.repeat(dec + extra);
      c.save();
      c.lineWidth = 1.5;
      for (let r = 1; r <= 4; r++) {
        c.globalAlpha = a0 * (0.35 - r * 0.07);
        c.strokeText(s, x, y - r * rowH * 0.34);
        c.strokeText(s, x, y + r * rowH * 0.34);
      }
      c.restore();
    }
  }
}

/** FIG. 6's eye space → canvas px (its opening camera). */
function eyePx(ex: number, ey: number) {
  const dx = ex - EYE.cx, dy = ey - EYE.cy;
  const cs = Math.cos(EYE.rot), sn = Math.sin(EYE.rot);
  const px = EYE.zoom * (cs * dx + sn * dy), py = EYE.zoom * (-sn * dx + cs * dy);
  return { x: W / 2 + px * (H / 2), y: H / 2 - py * (H / 2) };
}

/** Odometer drum position for the digit 10^k of a continuous count N. */
function drum(N: number, k: number) {
  const p = Math.pow(10, k);
  if (k === 0) {
    // detent: rests on the rounded digit (like toFixed), rolls continuously in between
    const r = Math.round(N), f = N - r;
    return (((r + Math.sign(f) * 0.5 * smoothstep(0.38, 0.5, Math.abs(f))) % 10) + 10) % 10;
  }
  const q = Math.floor(N / p);
  const rem = N - q * p;
  const carry = clamp(rem - (p - 0.5), 0, 1);
  return ((q % 10) + carry + 10) % 10;
}

function hexRGB(k: Col): [number, number, number] {
  const n = parseInt(HEX[k].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** sRGB 0..255 of a palette colour (the zh layer's karaoke colours). */
const rgbOf = (k: Col): number[] => hexRGB(k);
const RGB = { bone: hexRGB('bone'), signal: hexRGB('signal'), ember: hexRGB('ember') };
const css = (c: number[], a: number) => `rgba(${c.map((x) => Math.round(x)).join(',')},${clamp(a).toFixed(3)})`;

function lin(k: Col): [number, number, number] {
  return hexRGB(k).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }) as [number, number, number];
}

const COMP = /* glsl */ `
uniform sampler2D tex; uniform vec3 bgCol; uniform float echo, hot, gain;
void main() {
  vec4 s = texture(tex, vUv);
  if (echo > 0.0) {
    // radial echo (zoom trails) for the maximal hook
    vec4 acc = vec4(0.0); float wsum = 0.0;
    for (int i = 0; i < 6; i++) {
      float k = float(i) / 5.0;
      vec4 e = texture(tex, mix(vUv, vec2(0.5), k * echo));
      float w = 1.0 - k * 0.8;
      acc += vec4(e.rgb * e.a, e.a) * w; wsum += w;
    }
    acc /= wsum;
    s = vec4(acc.rgb / max(acc.a, 1e-3), max(s.a, acc.a));
  }
  // signal-orange type glows (only the signal colour exceeds the bloom threshold); gain = white-hot
  float h = smoothstep(0.25, 0.7, s.r - s.g * 1.3);
  vec3 col = mix(bgCol, s.rgb * (1.0 + hot * h) * gain, s.a);
  fragColor = vec4(col, 1.0);
}`;
