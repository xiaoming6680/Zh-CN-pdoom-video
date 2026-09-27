// Shared helpers for the bridge plates (stack, dense) by A8:
//  - TextPlane: a word rendered to a high-res canvas texture on a 3D plane, with a karaoke
//    wipe (direction selectable), dim outline for unsung, fill for sung, crisp at any scale.
//  - strokeSegs: single-stroke technical lettering as 2D polylines (for LineBatch).
//  - beat helpers that read the analysed grid (never hard-coded times).
import * as THREE from 'three';
import { F, font } from '../engine/type';
import { strokeText, type StrokeFontName } from '../engine/stroke';
import type { AudioData } from '../engine/audio';
import { HEX, LIN, type PaletteKey } from '../engine/palette';
import { GLSL_COMMON } from '../engine/glsl/common';
import { SCALE } from '../engine/scale';
import { clamp } from '../engine/util';
import type { Glyph as ZGlyph, ZhLayer, ZLine, ZSet } from '../engine/zh';

export type RGB = [number, number, number];
export const lin = (k: keyof typeof LIN, s = 1): RGB => [LIN[k][0] * s, LIN[k][1] * s, LIN[k][2] * s];

const TEXT_VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const TEXT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D map;
uniform float prog;      // 0..1 sung progress
uniform float dir;       // +1 left->right, -1 right->left
uniform float feather;   // wipe softness (fraction of word)
uniform float u0, u1;    // text extent in uv.x
uniform vec3 cDim, cSung, cDone;
uniform float aDim;      // opacity of unsung outline
uniform float fillDim;   // opacity of unsung fill (ghost)
uniform float done;      // 0..1 cooling from cSung to cDone
uniform float opacity;
uniform float flash;     // additive white-hot boost on the sung fill
void main() {
  vec4 tx = texture(map, vUv);
  float fill = tx.r, line = tx.g;
  float u = clamp((vUv.x - u0) / max(1e-4, u1 - u0), 0.0, 1.0);
  if (dir < 0.0) u = 1.0 - u;
  float e = prog * (1.0 + feather);
  float sung = 1.0 - smoothstep(e - feather, e, u);
  if (prog <= 0.0) sung = 0.0;
  vec3 cs = mix(cSung, cDone, done) + flash * vec3(1.0, 0.42, 0.13);
  vec3 rgb = fill * sung * cs + (line * aDim * cDim + fill * fillDim * cDim) * (1.0 - sung);
  float a = fill * sung + max(line * aDim, fill * fillDim) * (1.0 - sung);
  fragColor = vec4(rgb, a) * opacity;
}`;

export interface TextPlaneOpts {
  /** Canvas font size in px (texture resolution). */
  px?: number;
  /** Letter spacing in em. */
  tracking?: number;
  /** Outline width in em (for the unsung look). */
  outline?: number;
  /** World height of the cap height. */
  capH: number;
  /** Horizontal anchor: 0 = left, 0.5 = centre, 1 = right (of the ink extent). */
  ax?: number;
  /** Vertical anchor: 0 = baseline, 0.5 = middle of cap height, 1 = cap top. */
  ay?: number;
  anisotropy?: number;
}

/**
 * A single line of text on a plane in 3D. Geometry is in world units with the anchor at the origin
 * (plane lies in local XY, facing +Z). Karaoke state via `set()`.
 */
export class TextPlane {
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  tex: THREE.CanvasTexture;
  /** World width/height of the ink box (cap height x advance). */
  w: number;
  h: number;
  /** World size of the em, and x of the ink box's left edge relative to the pen origin (for setting planes on a text layout). */
  em: number;
  inkX: number;
  text: string;
  constructor(text: string, family: string, o: TextPlaneOpts) {
    this.text = text;
    const px = (o.px ?? 220) * SCALE; // texture resolution follows the output scale (world size does not)
    const tr = (o.tracking ?? 0) * px;
    const ol = (o.outline ?? 0.018) * px;
    const cv = document.createElement('canvas');
    const c = cv.getContext('2d')!;
    c.font = font(family, px);
    c.letterSpacing = `${tr}px`;
    const m = c.measureText(text);
    const capM = c.measureText('H');
    const cap = capM.actualBoundingBoxAscent;
    const asc = Math.max(m.actualBoundingBoxAscent, cap);
    const desc = Math.max(0, m.actualBoundingBoxDescent);
    const inkL = -m.actualBoundingBoxLeft, inkR = m.actualBoundingBoxRight;
    const pad = Math.ceil(ol * 2 + px * 0.04);
    const W = Math.ceil(inkR - inkL + pad * 2), H = Math.ceil(asc + desc + pad * 2);
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H);
    c2.font = font(family, px);
    c2.letterSpacing = `${tr}px`;
    c2.textBaseline = 'alphabetic';
    const bx = pad - inkL, by = pad + asc;
    c2.globalCompositeOperation = 'lighter';
    c2.fillStyle = '#f00';
    c2.fillText(text, bx, by);
    if (ol > 0) {
      c2.strokeStyle = '#0f0';
      c2.lineWidth = ol;
      c2.lineJoin = 'round';
      c2.strokeText(text, bx, by);
    }
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.anisotropy = o.anisotropy ?? 8;
    const s = o.capH / cap; // world units per px
    this.w = (inkR - inkL) * s;
    this.h = o.capH;
    this.em = px * s;
    this.inkX = inkL * s;
    const gw = W * s, gh = H * s;
    const geo = new THREE.PlaneGeometry(gw, gh);
    // anchor: ink box x in [pad, W-pad] px, baseline at by, cap top at by - cap
    const ax = o.ax ?? 0.5, ay = o.ay ?? 0.5;
    const axPx = pad + (inkR - inkL) * ax;
    const ayPx = by - cap * ay; // from top
    geo.translate(gw / 2 - axPx * s, -(gh / 2 - ayPx * s), 0);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `precision highp float;\nin vec3 position; in vec2 uv; uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;\n${TEXT_VERT}`,
      fragmentShader: TEXT_FRAG,
      uniforms: {
        map: { value: this.tex }, prog: { value: 0 }, dir: { value: 1 }, feather: { value: 0.08 },
        u0: { value: pad / W }, u1: { value: (W - pad) / W },
        cDim: { value: new THREE.Vector3(...LIN.bone) }, cSung: { value: new THREE.Vector3(...LIN.signal) },
        cDone: { value: new THREE.Vector3(...LIN.bone) }, aDim: { value: 0.35 }, fillDim: { value: 0 }, done: { value: 0 },
        opacity: { value: 1 }, flash: { value: 0 },
      },
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }
  get u() { return this.mat.uniforms; }
  set(o: { prog?: number; dir?: number; opacity?: number; done?: number; aDim?: number; fillDim?: number; flash?: number; feather?: number; cSung?: RGB; cDim?: RGB; cDone?: RGB }) {
    const u = this.mat.uniforms;
    if (o.prog !== undefined) u.prog!.value = o.prog;
    if (o.dir !== undefined) u.dir!.value = o.dir;
    if (o.opacity !== undefined) u.opacity!.value = o.opacity;
    if (o.done !== undefined) u.done!.value = o.done;
    if (o.aDim !== undefined) u.aDim!.value = o.aDim;
    if (o.fillDim !== undefined) u.fillDim!.value = o.fillDim;
    if (o.flash !== undefined) u.flash!.value = o.flash;
    if (o.feather !== undefined) u.feather!.value = o.feather;
    if (o.cSung) (u.cSung!.value as THREE.Vector3).set(...o.cSung);
    if (o.cDim) (u.cDim!.value as THREE.Vector3).set(...o.cDim);
    if (o.cDone) (u.cDone!.value as THREE.Vector3).set(...o.cDone);
  }
}

/** Single-stroke lettering as 2D polylines (y DOWN, origin left-baseline), in px at `size`. */
export function strokeLines(text: string, fontName: StrokeFontName, size: number, tracking = 0) {
  const st = strokeText(text, fontName, size, tracking);
  return { strokes: st.strokes, width: st.width, cap: st.capHeight };
}

// ------------------------------------------------------------------ timing helpers

/** Beat times (from the analysed grid) in [t0, t1). */
export function beatsIn(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  const i0 = Math.ceil(au.beatAt(t0) - 1e-6);
  for (let i = i0; ; i++) {
    const t = au.timeOfBeat(i);
    if (t >= t1) break;
    if (t >= t0 - 1e-6) out.push(t);
    if (out.length > 400) break;
  }
  return out;
}

/** Cut time for a line: the last beat at/before its first word (+ tolerance), like the timeline's cut(). */
export function cutBeat(au: AudioData, wordStart: number, tol = 0.12) {
  return au.timeOfBeat(Math.floor(au.beatAt(wordStart + tol)));
}

/** Snare events in a range if the analysis has them, else backbeats (beats 2 & 4) from the grid. */
export function snaresIn(au: AudioData, t0: number, t1: number): number[] {
  const ev = au.events('snare', t0, t1).map((e) => e[0]);
  if (ev.length >= 2) return ev;
  const out: number[] = [];
  for (const b of beatsIn(au, t0, t1)) {
    const bar = au.barAt(b + 1e-3);
    const pos = Math.round((bar - Math.floor(bar)) * 4) % 4;
    if (pos === 1 || pos === 3) out.push(b);
  }
  return out;
}

export { F };

/** GLSL_COMMON without the fragment-only (fwidth) helpers, usable in vertex shaders. */
export const GLSL_COMMON_VS = (() => {
  const a = GLSL_COMMON.indexOf('/** Anti-aliased coverage');
  const b = GLSL_COMMON.indexOf('// ---- colour ----');
  return a > 0 && b > a ? GLSL_COMMON.slice(0, a) + GLSL_COMMON.slice(b) : GLSL_COMMON;
})();

// ------------------------------------------------------------------ the Chinese version (?zh)

function textMaterial(tex: THREE.Texture, u0: number, u1: number) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;\nin vec3 position; in vec2 uv; uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;\n${TEXT_VERT}`,
    fragmentShader: TEXT_FRAG,
    uniforms: {
      map: { value: tex }, prog: { value: 0 }, dir: { value: 1 }, feather: { value: 0.01 },
      u0: { value: u0 }, u1: { value: u1 },
      cDim: { value: new THREE.Vector3(...LIN.bone) }, cSung: { value: new THREE.Vector3(...LIN.signal) },
      cDone: { value: new THREE.Vector3(...LIN.bone) }, aDim: { value: 0.35 }, fillDim: { value: 0 }, done: { value: 0 },
      opacity: { value: 1 }, flash: { value: 0 },
    },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

/**
 * A run of a Chinese line's glyphs (zh set glyphs, each in its own face: 思源黑体 for the ideographs and the
 * punctuation, the Latin family for Latin runs) on a 3D plane, with TextPlane's karaoke look: outline and a ghost
 * fill until sung, a wipe to signal, bone once done. The wipe runs across the run's advance boxes, so `prog` is the
 * share of the run the zh karaoke has lit (zhFront). Local origin: set x `origin` on the baseline, raised `ay` em;
 * `em` is the world size of the voice's em.
 */
export class ZhPlane {
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  tex: THREE.CanvasTexture;
  /** World x of the run's first/last advance edge and y of its ink top/bottom, relative to the local origin. */
  x0: number; x1: number; top: number; bottom: number;
  constructor(glyphs: ZGlyph[], vsize: number, o: { em: number; origin: number; ay?: number; px?: number; outline?: number }) {
    const px = (o.px ?? 220) * SCALE; // texture px per em (follows the output scale, like TextPlane)
    const k = px / vsize;
    const ol = (o.outline ?? 0.02) * px;
    const gx0 = Math.min(...glyphs.map((g) => g.x)), gx1 = Math.max(...glyphs.map((g) => g.x + g.w));
    const mc = document.createElement('canvas').getContext('2d')!;
    let asc = 0, desc = 0, inkL = 0, inkR = (gx1 - gx0) * k;
    for (const g of glyphs) {
      mc.font = font(g.family, g.size * k);
      const m = mc.measureText(g.ch), gx = (g.x - gx0) * k;
      asc = Math.max(asc, m.actualBoundingBoxAscent);
      desc = Math.max(desc, m.actualBoundingBoxDescent);
      inkL = Math.min(inkL, gx - m.actualBoundingBoxLeft);
      inkR = Math.max(inkR, gx + m.actualBoundingBoxRight);
    }
    const pad = Math.ceil(ol * 2 + px * 0.04);
    const W = Math.ceil(inkR - inkL + pad * 2), H = Math.ceil(asc + desc + pad * 2);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.textBaseline = 'alphabetic';
    c.globalCompositeOperation = 'lighter';
    c.lineJoin = 'round';
    const bx = pad - inkL, by = pad + asc; // canvas position of set x gx0 on the baseline
    for (const g of glyphs) {
      c.font = font(g.family, g.size * k);
      const x = bx + (g.x - gx0) * k;
      c.fillStyle = '#f00'; c.fillText(g.ch, x, by);
      if (ol > 0) { c.strokeStyle = '#0f0'; c.lineWidth = ol; c.strokeText(g.ch, x, by); }
    }
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.anisotropy = 8;
    const s = o.em / px; // world units per texture px
    const ay = (o.ay ?? 0) * px;
    const ox = bx + (o.origin - gx0) * k, oy = by - ay;
    const geo = new THREE.PlaneGeometry(W * s, H * s);
    geo.translate((W / 2 - ox) * s, (oy - H / 2) * s, 0);
    this.x0 = (gx0 - o.origin) * k * s;
    this.x1 = (gx1 - o.origin) * k * s;
    this.top = (asc - ay) * s;
    this.bottom = (-desc - ay) * s;
    this.mat = textMaterial(this.tex, bx / W, (bx + (gx1 - gx0) * k) / W);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }
  set(o: Parameters<TextPlane['set']>[0]) { TextPlane.prototype.set.call(this as unknown as TextPlane, o); }
}

/**
 * How far (0..1, in reading direction) the zh karaoke has lit a run of glyphs of set S (line z) at t: the lit front
 * of glyphState (each glyph lit from its leading edge as the English it translates is sung), as a share of the
 * run's advance boxes. `rtl`: the run lights right to left.
 */
export function zhFront(zl: ZhLayer, z: ZLine, S: ZSet, glyphs: ZGlyph[], t: number, rtl = false) {
  const gx0 = Math.min(...glyphs.map((g) => g.x)), gx1 = Math.max(...glyphs.map((g) => g.x + g.w));
  const span = Math.max(1e-6, gx1 - gx0);
  const list = rtl ? [...glyphs].reverse() : glyphs;
  for (const g of list) {
    const lit = zl.glyphState(z, S, g, t).lit;
    if (lit < 1) return clamp(rtl ? (gx1 - (g.x + g.w * (1 - lit))) / span : (g.x + g.w * lit - gx0) / span);
  }
  return 1;
}

/** First time in [a, b] at which f (non-decreasing in t, e.g. a zhFront) leaves 0 (b if it never does). */
export function firstLit(f: (t: number) => number, a: number, b: number) {
  if (f(b) <= 1e-4) return b;
  let lo = a, hi = b;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (f(m) > 1e-4) hi = m; else lo = m; }
  return hi;
}

/** A palette colour as sRGB 0..255 (for the zh API's colours). */
export const rgb255 = (k: PaletteKey) => { const n = parseInt(HEX[k].slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const cssRGB = (c: number[], a: number) => `rgba(${c.map((x) => Math.round(x)).join(',')},${clamp(a).toFixed(3)})`;

/** Is this zh glyph set in a Chinese face (ideographs, full-width punctuation)? */
export const zhCJK = (g: ZGlyph) => g.family.startsWith('Noto');

/**
 * Pen x of each glyph of zh set S drawn at `size`, with the ideographs condensed to `cw` of their width (长体,
 * the Chinese way to condense a face), and the run's width.
 */
export function zhPositions(S: ZSet, size: number, cw = 1) {
  const k = size / S.voice.size;
  const xs: number[] = [];
  let x = 0, prev: ZGlyph | null = null;
  for (const g of S.glyphs) {
    x = prev ? x + (g.x - prev.x) * k * (zhCJK(prev) ? cw : 1) : g.x * k;
    xs.push(x);
    prev = g;
  }
  const last = S.glyphs[S.glyphs.length - 1];
  const width = last ? xs[xs.length - 1]! + last.w * k * (zhCJK(last) ? cw : 1) : 0;
  return { xs, width, k };
}

export interface ZhRunOpts {
  base?: number[]; hot?: number[]; dim?: number; alpha?: number;
  /** colour a sung glyph cools to (default base), per glyph */
  sung?: (g: ZGlyph) => number[] | undefined;
  /** ideographs condensed to this share of their width (default 1) */
  cw?: number;
  /** per-glyph hook, called with the context translated to the glyph's pen position on the baseline */
  each?: (g: ZGlyph, st: { lit: number; cool: number }, i: number, w: number) => void;
}

/**
 * Draw zh set S of line z at t with its left end of the baseline at (x0, y), glyph by glyph with the zh karaoke
 * (glyphState: dim until sung, hot signal while sung, cooling), under the context's transform.
 */
export function drawZhRun(c: CanvasRenderingContext2D, zl: ZhLayer, z: ZLine, S: ZSet, t: number, x0: number, y: number, size: number, o: ZhRunOpts = {}) {
  const cw = o.cw ?? 1;
  const { xs, k } = zhPositions(S, size, cw);
  S.glyphs.forEach((g, i) => {
    if (!g.ch.trim()) return;
    const st = zl.glyphState(z, S, g, t, { base: o.base, hot: o.hot, sung: o.sung?.(g), dim: o.dim });
    if (st.a <= 0) return;
    const cj = zhCJK(g);
    c.save();
    c.translate(x0 + xs[i]!, y);
    o.each?.(g, st, i, g.w * k * (cj ? cw : 1));
    if (cj && cw !== 1) c.scale(cw, 1);
    c.font = font(g.family, g.size * k);
    c.fillStyle = cssRGB(st.col, (o.alpha ?? 1) * st.a);
    c.fillText(g.ch, 0, 0);
    c.restore();
  });
}
