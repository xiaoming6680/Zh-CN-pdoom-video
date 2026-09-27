// Posting covers (render.ts cover): a clean plate from the video under one big plain-language question.
// The picture is the shoggoth plate as its scan passes the middle of the smiling mask — the smile on one side,
// the creature and its eye on the other — rendered without its type (the plate's `bare`), full bleed. The title
// is 思源黑体 Heavy in the video's bone and signal orange. Portrait 3:4 and landscape 4:3 (Douyin's two covers)
// and wide 16:9 (Bilibili's), drawn at any size of those shapes; the text is in data/lyrics.zh.json (cover).
import type { Engine } from './engine/engine';
import { W, H, SCALE } from './engine/gl';
import { HEX, rgba } from './engine/palette';
import { F, font } from './engine/type';
import { loadZhFonts, setText } from './engine/zh';
import { mulberry32 } from './engine/util';

/** The plate, the moment, and the crop's centre (logical px): the seam between the smile and the creature. */
const HERO = { id: 'shoggoth', t: 30.9, samples: 36, shutter: 0.2, cx: 1060, cy: 540 };

interface CoverText { title: string[]; sub: string; tag: string }
type C2D = CanvasRenderingContext2D;

const HEAVY = { cjk: 'NotoSansSC-900', latin: F.archivo(100, 900), latinScale: 1 };
const PLAIN = { cjk: 'NotoSansSC-700', latin: F.archivo(100, 700), latinScale: 1 };

/** Width of a mixed Chinese/Latin run (zh.ts setText) at a size. */
const runWidth = (s: string, v: typeof HEAVY, size: number) => setText(s, { ...v, size }).width;

/** Draw a mixed Chinese/Latin run with its left end of the baseline at (x, y); glyphs from `from2` on take `fill2`. */
function run(c: C2D, s: string, v: typeof HEAVY, size: number, x: number, y: number, fill: string, from2 = Infinity, fill2 = fill) {
  const { glyphs } = setText(s, { ...v, size });
  glyphs.forEach((g, k) => { c.font = font(g.family, g.size); c.fillStyle = k < from2 ? fill : fill2; c.fillText(g.ch, x + g.x, y); });
}

/** An orange label with ink type (the plate's detection tags). */
function tag(c: C2D, s: string, x: number, y: number, size: number) {
  const w = runWidth(s, PLAIN, size), px = size * 0.5;
  c.fillStyle = rgba('signal');
  c.fillRect(x, y - size * 1.08, w + 2 * px, size * 1.5);
  run(c, s, PLAIN, size, x + px, y, rgba('ink'));
}

/** Ink rising from the bottom so the title reads over the picture. */
function shade(c: C2D, w: number, y0: number, y1: number, h: number) {
  const g = c.createLinearGradient(0, y0, 0, h);
  g.addColorStop(0, rgba('ink', 0));
  g.addColorStop((y1 - y0) / (h - y0), rgba('ink', 0.88));
  g.addColorStop(1, rgba('ink', 0.96));
  c.fillStyle = g;
  c.fillRect(0, y0, w, h - y0);
}

/** Film grain like the video's (deterministic), over the whole cover so the type sits in the same stock. */
function grain(cv: HTMLCanvasElement, amt = 6) {
  const c = cv.getContext('2d')!;
  const img = c.getImageData(0, 0, cv.width, cv.height), d = img.data, rnd = mulberry32(5);
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 765, n = (rnd() - 0.5) * amt * (0.6 + 1.6 * l * (1 - l));
    d[i] = d[i]! + n; d[i + 1] = d[i + 1]! + n; d[i + 2] = d[i + 2]! + n;
  }
  c.putImageData(img, 0, 0);
}

/** A cover w x h (portrait when taller than wide). */
export async function makeCover(engine: Engine, w: number, h: number) {
  const [doc] = await Promise.all([fetch('data/lyrics.zh.json').then((r) => r.json()), loadZhFonts()]);
  const T = doc.cover as CoverText;

  // the clean plate: no type in the scene, no Chinese line, no HUD
  const scene = engine.loaded.get(HERO.id)?.scene as unknown as { bare: boolean } | undefined;
  if (!scene) throw new Error(`cover: load the '${HERO.id}' plate (render.ts --only ${HERO.id})`);
  const zh = engine.zh;
  scene.bare = true; engine.zh = null; engine.hudOff = true;
  try { engine.render(HERO.t, 1 / 60, true, HERO.samples, HERO.shutter); } finally { scene.bare = false; engine.zh = zh; engine.hudOff = false; }

  const portrait = h > w, wide = w / h > 1.55;
  const RW = portrait ? 1440 : 1920, RH = portrait ? 1920 : wide ? 1080 : 1440;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.scale(w / RW, h / RH);
  c.fillStyle = HEX.ink;
  c.fillRect(0, 0, RW, RH);
  // full bleed: the largest crop of the frame with the cover's shape, centred on the seam
  const ch = H, cw = Math.min(W, (ch * RW) / RH);
  const sx = Math.min(W - cw, Math.max(0, HERO.cx - cw / 2)), sy = Math.max(0, HERO.cy - ch / 2);
  c.imageSmoothingQuality = 'high';
  c.drawImage(engine.canvas, sx * SCALE, sy * SCALE, cw * SCALE, ch * SCALE, 0, 0, RW, RH);
  c.textBaseline = 'alphabetic';

  const M = portrait ? 88 : 96;
  if (portrait) {
    shade(c, RW, 1020, 1480, RH);
    const size = Math.min(210, (RW - 2 * M) / (Math.max(...T.title.map((s) => runWidth(s, HEAVY, 100))) / 100));
    const y2 = RH - 250, y1 = y2 - size * 1.2;
    run(c, T.title[0]!, HEAVY, size, M - size * 0.04, y1, rgba('bone'));
    run(c, T.title[1]!, HEAVY, size, M - size * 0.04, y2, rgba('signal'));
    run(c, T.sub, PLAIN, 54, M, y2 + 118, rgba('bone', 0.78));
    tag(c, T.tag, M, M + 44, 44);
  } else if (wide) {
    // Bilibili shows the cover at 16:9 and, on its home feed, cropped to the middle 4:3 (x 240–1680): the type
    // stays inside that crop, and clear of the bottom ~12% where its cards lay the play count and the duration
    // over the cover. The two-line question as in the other covers, the line under it moved above as a kicker.
    const X0 = 240 + 76, X1 = RW - 240 - 76;
    shade(c, RW, 280, 640, RH);
    const size = Math.min(150, (X1 - X0) / (Math.max(...T.title.map((s) => runWidth(s, HEAVY, 100))) / 100));
    const y2 = RH - 175, y1 = y2 - size * 1.18;
    run(c, T.sub, PLAIN, 48, X0, y1 - size - 34, rgba('bone', 0.78));
    run(c, T.title[0]!, HEAVY, size, X0 - size * 0.04, y1, rgba('bone'));
    run(c, T.title[1]!, HEAVY, size, X0 - size * 0.04, y2, rgba('signal'));
    tag(c, T.tag, X0, 60 + 42, 42);
  } else {
    shade(c, RW, RH - 740, RH - 300, RH);
    const line = T.title.join('，');
    const size = Math.min(150, (RW - 2 * M) / (runWidth(line, HEAVY, 100) / 100));
    const y = RH - 190;
    // one run (so the comma keeps its space): bone up to the comma, orange after
    const split = setText(`${T.title[0]}，`, { ...HEAVY, size }).glyphs.length;
    run(c, line, HEAVY, size, M - size * 0.04, y, rgba('bone'), split, rgba('signal'));
    run(c, T.sub, PLAIN, 50, M, y + 104, rgba('bone', 0.78));
    tag(c, T.tag, M, M + 42, 42);
  }
  grain(cv);
  return cv;
}
