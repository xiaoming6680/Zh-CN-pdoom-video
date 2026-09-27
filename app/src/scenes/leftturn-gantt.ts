// "Without a single CDR": the review schedule, drawn in world units on the same drawing sheet as
// the roadmap (north of it). Time runs along x at the song's own rate, so the lyric is literally
// scheduled: each word is a Gantt bar spanning exactly the time it is sung, filled as it is sung,
// cascading down to the milestone lane where the reviews are stamped on the beats. The CDR slot
// is an empty dashed diamond; its syllables light one by one; it ends as the prompt's caret.
import { Lyrics, type Word } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { clamp, ease, lerp, prog } from '../engine/util';
import { tr, ZH } from '../engine/lang';
import { zhLayer, type Voice } from '../engine/zh';
import { zhDays } from './leftturn-map';

// ---- the Chinese version: "Without a single CDR" is 连一次 CDR 都没开过. 连一次 is set after "Without" on the first
// task row (each glyph lit with its English word), 都没开过 under the big CDR (the block's width), the line's footnote
// in the plate's footnote slot.
const ZV_ROW: Voice = { cjk: 'NotoSansSC-900', latin: F.archivo(100, 900), size: 84, latinScale: 1 };
const ZV_SLOT: Voice = { cjk: 'NotoSansSC-700', latin: F.mono(700), size: 68, latinScale: 1 };
const SIGNAL_RGB = [0xff, 0x4d, 0x12];
const css = (c: number[], a: number) => `rgba(${c.map((x) => Math.round(x)).join(',')},${clamp(a).toFixed(3)})`;

export const GANTT = {
  GX: 700, // x of the first sung word ("Without")
  V: 480, // world units per second
  GL: 700, // y of the milestone lane
  DS: 36, // milestone diamond half-diagonal
  ROW: [-375, -258, -141], // bar y (relative to the lane) of the three lyric rows
  RULER: -500,
  WORD: 112, // lyric type size
};

export interface ScheduleTimes {
  t0: number; // time at x = GX
  words: Word[]; // Without, a, single
  cdr: Word;
  syl: number[]; // C, D, R
  SRR: number; PDR: number; TRR: number; LAUNCH: number;
  zip0: number; // the playhead leaves the CDR slot
  beats: number[]; // beat times across the strip
  downbeats: number[];
  drain0: number; // everything but the slot starts to fade
  end: number;
}

type Ms = { code: string; t: number; date: string; kind: 'diamond' | 'slot' | 'launch' };

export class Schedule {
  ms: Ms[];
  /** the Chinese version: the line's index in data/lyrics.json (set by the plate) */
  zhLine = -1;
  constructor(public T: ScheduleTimes, public pdoom: string) {
    this.ms = [
      { code: 'SRR', t: T.SRR, date: 'T−120 d', kind: 'diamond' },
      { code: 'PDR', t: T.PDR, date: 'T−90 d', kind: 'diamond' },
      { code: 'CDR', t: T.cdr.start, date: 'T−45 d', kind: 'slot' },
      { code: 'TRR', t: T.TRR, date: 'T−14 d', kind: 'diamond' },
      { code: 'LAUNCH', t: T.LAUNCH, date: 'T−0', kind: 'launch' },
    ];
  }
  X(t: number) { return GANTT.GX + (t - this.T.t0) * GANTT.V; }
  get slot() { return { x: this.X(this.T.cdr.start), y: GANTT.GL }; }

  /** Playhead x: song time, held at the empty slot, then a zip to LAUNCH. */
  playX(t: number) {
    const T = this.T, sx = this.slot.x - GANTT.DS - 12;
    if (t < T.zip0) return Math.min(this.X(t), sx);
    return lerp(sx, this.X(T.LAUNCH) - 30, ease.inOutCubic(prog(t, T.zip0, T.LAUNCH)));
  }
  /** Time at which the playhead passes TRR on its zip (for the "skipped" mark). */
  get tSkip() {
    const T = this.T, sx = this.slot.x - GANTT.DS - 12, xt = this.X(T.TRR), xl = this.X(T.LAUNCH) - 30;
    const k = clamp((xt - sx) / (xl - sx));
    // invert inOutCubic numerically
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (ease.inOutCubic(m) < k) lo = m; else hi = m; }
    return lerp(T.zip0, T.LAUNCH, lo);
  }

  /**
   * Draw in world units (the caller set the world transform). `px` = world units per screen px.
   * `keep` fades everything except the CDR slot (the hand-off); `morph` turns the slot into the caret.
   */
  draw(c: CanvasRenderingContext2D, t: number, px: number, o: { alpha: number; keep: number; morph: number; caret: { hw: number; hh: number } }) {
    const T = this.T, G = GANTT;
    const A = o.alpha * o.keep;
    const x0 = this.X(T.t0 - 0.45), x1 = this.X(T.end + 0.5);
    const L = G.GL;
    c.save();
    c.textBaseline = 'alphabetic';
    c.lineCap = 'butt';
    if (A > 0.002) {
      c.globalAlpha = A;
      // title
      c.textAlign = 'left';
      c.font = font(F.mono(600), ZH ? 32 : 30); c.fillStyle = rgba('bone', 0.95);
      c.fillText(tr('REVIEW SCHEDULE — AGI, v1.0', '评审日程 — AGI，v1.0'), x0, L + G.RULER - 100);
      c.font = font(F.mono(400), ZH ? 22 : 20); c.fillStyle = rgba('ash', 0.9);
      c.fillText(tr('REV C · BASELINE · ALL DATES FIRM', '修订版 C · 基线 · 所有日期均已锁定'), x0, L + G.RULER - 70);
      // ruler: a tick per beat, weeks on the downbeats
      const ry = L + G.RULER;
      c.fillStyle = rgba('ash', 0.7);
      c.fillRect(x0, ry, x1 - x0, 1.5 * px);
      for (const b of T.beats) {
        const x = this.X(b);
        if (x < x0 || x > x1) continue;
        const down = T.downbeats.some((d) => Math.abs(d - b) < 0.02);
        c.fillStyle = rgba('ash', down ? 0.9 : 0.55);
        c.fillRect(x - 0.75 * px, ry, 1.5 * px, down ? 30 : 14);
        // faint schedule column
        c.fillStyle = rgba('graphite', down ? 0.32 : 0.16);
        c.fillRect(x - 0.5 * px, ry + 34, 1 * px, L + 90 - ry - 34);
        if (down) {
          c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.85);
          const wk = 31 + T.downbeats.findIndex((d) => Math.abs(d - b) < 0.02);
          c.fillText(ZH ? `第 ${wk} 周` : `WK ${wk}`, x + 8, ry + 30);
        }
      }
      // lane
      c.strokeStyle = rgba('ash', 0.55); c.lineWidth = 1.5 * px; c.setLineDash([10, 8]);
      c.beginPath(); c.moveTo(x0, L); c.lineTo(x1, L); c.stroke(); c.setLineDash([]);
      c.font = font(F.mono(500), ZH ? 21 : 18); c.fillStyle = rgba('graphite', 1);
      c.fillText(tr('MILESTONES', '里程碑'), x0, L - 14);
      c.fillText(tr('LYRIC', '歌词'), x0, L + G.ROW[0]! + 6);
      this.drawRows(c, t, px);
      for (const m of this.ms) if (m.kind !== 'slot') this.drawMilestone(c, t, px, m);
      this.drawPlayhead(c, t, px);
      // P(doom) cameo, filed in the legend: always within tolerance
      const la = prog(t, T.LAUNCH + 0.05, T.LAUNCH + 0.25);
      if (la > 0) {
        c.globalAlpha = A * la;
        const lx = this.X(T.t0), ly = L + 150;
        c.strokeStyle = rgba('ash', 1); c.lineWidth = 2 * px;
        c.strokeRect(lx, ly - 22, 26, 26);
        c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 3.5 * px;
        c.beginPath(); c.moveTo(lx + 6, ly - 9); c.lineTo(lx + 11, ly - 3); c.lineTo(lx + 21, ly - 17); c.stroke();
        c.lineCap = 'butt';
        c.font = font(F.mono(400), 24); c.fillStyle = rgba('ash', 1); c.textAlign = 'left';
        c.fillText(ZH ? `P(doom) ${this.pdoom} · 在容差范围内（±1.00）` : `P(doom) ${this.pdoom} · within tolerance (±1.00)`, lx + 44, ly);
      }
    }
    c.globalAlpha = o.alpha;
    this.drawSlot(c, t, px, o);
    c.restore();
  }

  private drawRows(c: CanvasRenderingContext2D, t: number, px: number) {
    const T = this.T, G = GANTT;
    const ws = T.words;
    ws.forEach((w, i) => {
      const by = G.GL + G.ROW[i]!;
      const xa = this.X(w.start), xb = this.X(w.end);
      const vis = prog(t, w.start - 0.35, w.start - 0.05);
      if (vis <= 0) return;
      const p = Lyrics.wordProgress(w, t);
      const ga = c.globalAlpha;
      // bar: planned outline, filled as sung
      c.strokeStyle = rgba('ash', 0.8 * vis); c.lineWidth = 1.5 * px;
      c.strokeRect(xa, by - 9, Math.max(xb - xa, 2), 18);
      if (p > 0) {
        c.fillStyle = p < 1 ? rgba('signal', 1) : rgba('bone', 0.9);
        c.fillRect(xa, by - 9, Math.max((xb - xa) * p, 2), 18);
      }
      // label: dim until sung, signal while sung, bone after; slams a hair on its start
      const k = t >= w.start ? 1 + 0.12 * Math.pow(0.5, (t - w.start) / 0.05) : 1;
      c.save();
      c.translate(xa, by - 26); c.scale(k, k);
      c.font = font(F.archivo(100, 900), G.WORD);
      c.fillStyle = p <= 0 ? rgba('bone', 0.2 * vis) : p < 1 ? rgba('signal', 1) : rgba('bone', 1);
      c.textAlign = 'left';
      c.fillText(w.w, -6, 0);
      if (ZH && i === 0) this.drawZhHead(c, t, measure(w.w, F.archivo(100, 900), G.WORD) + 30, vis);
      c.restore();
      // duration, in mono, under the bar
      c.font = font(F.mono(400), 18); c.fillStyle = rgba('graphite', vis);
      c.fillText(`${Math.round((w.end - w.start) * 1000)} ms`, xa, by + 34);
      // finish-to-start dependency down to the next task (or to the CDR slot)
      if (t >= w.end - 0.02) {
        const nextY = i + 1 < ws.length ? G.GL + G.ROW[i + 1]! - 9 : G.GL - G.DS - 8;
        const k2 = ease.outCubic(prog(t, w.end - 0.02, w.end + 0.12));
        const ya = by + 9, yb = lerp(ya, nextY, k2);
        c.strokeStyle = rgba(i + 1 < ws.length ? 'ash' : 'signal', 0.9); c.lineWidth = 2 * px;
        c.beginPath(); c.moveTo(xb, ya); c.lineTo(xb, yb - 4); c.stroke();
        if (k2 > 0.95) {
          c.fillStyle = c.strokeStyle;
          c.beginPath(); c.moveTo(xb, nextY); c.lineTo(xb - 8, nextY - 16); c.lineTo(xb + 8, nextY - 16); c.closePath(); c.fill();
        }
      }
      c.globalAlpha = ga;
    });
  }

  private diamond(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
  }

  private drawMilestone(c: CanvasRenderingContext2D, t: number, px: number, m: Ms) {
    const G = GANTT;
    const x = this.X(m.t), y = G.GL, r = G.DS;
    const skipped = m.code === 'TRR';
    const tHit = skipped ? this.tSkip : m.t;
    const hit = t >= tHit;
    const e = t - tHit;
    // code label above, date below
    c.textAlign = 'center';
    const code = m.kind === 'launch' ? tr(m.code, '发射') : m.code;
    c.font = font(F.mono(ZH && m.kind === 'launch' ? 700 : 600), 44); c.fillStyle = rgba('bone', 0.95);
    c.fillText(code, x, y - r - 22);
    const cw = c.measureText(code).width;
    c.textAlign = 'left';
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('graphite', 1);
    c.fillText(zhDays(m.date), x + cw / 2 + 8, y - r - 22);
    c.textAlign = 'center';
    if (m.kind === 'launch') {
      c.beginPath(); c.moveTo(x, y - r - 4); c.lineTo(x + r, y + r - 8); c.lineTo(x - r, y + r - 8); c.closePath();
    } else this.diamond(c, x, y, r);
    c.fillStyle = rgba('ink', 1); c.fill();
    c.lineJoin = 'miter';
    c.strokeStyle = rgba('bone', 0.95); c.lineWidth = 3 * px; c.stroke();
    if (!hit) { c.textAlign = 'left'; return; }
    if (skipped) {
      c.strokeStyle = rgba('ash', 1); c.lineWidth = 5 * px;
      c.beginPath(); c.moveTo(x - r * 0.5, y); c.lineTo(x + r * 0.5, y); c.stroke();
      c.font = font(F.mono(500), ZH ? 24 : 22); c.fillStyle = rgba('ash', prog(e, 0, 0.05));
      c.fillText(tr('SKIPPED', '已跳过'), x, y + r + 34);
      c.textAlign = 'left';
      return;
    }
    // stamped: flash hot, settle to signal, a check, a ring
    const flash = Math.pow(0.5, e / 0.06);
    c.fillStyle = flash > 0.3 ? rgba('ember', 1) : rgba('signal', 1);
    c.fill();
    const s = 1 + 0.25 * Math.pow(0.5, e / 0.05);
    if (m.kind === 'launch') {
      c.font = font(F.mono(500), ZH ? 24 : 22); c.fillStyle = rgba('signal', prog(e, 0, 0.05));
      c.fillText(tr('AHEAD OF SCHEDULE', '提前完成'), x, y + r + 34);
    } else {
      c.save(); c.translate(x, y); c.scale(s, s);
      c.strokeStyle = rgba('ink', 1); c.lineWidth = 6 * px * 1.2; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-14, 0); c.lineTo(-4, 11); c.lineTo(16, -13); c.stroke();
      c.restore();
      c.font = font(F.mono(500), ZH ? 24 : 22); c.fillStyle = rgba('ash', prog(e, 0, 0.05));
      c.fillText(tr('PASSED', '已通过'), x, y + r + 34);
    }
    // ring
    const rr = r * (1 + 2.2 * ease.outCubic(prog(e, 0, 0.35)));
    const ra = 1 - prog(e, 0.05, 0.35);
    if (ra > 0) {
      c.strokeStyle = rgba('signal', ra); c.lineWidth = 2 * px;
      if (m.kind === 'launch') {
        const q = rr / r;
        c.beginPath(); c.moveTo(x, y - (r + 4) * q); c.lineTo(x + r * q, y + (r - 8) * q); c.lineTo(x - r * q, y + (r - 8) * q); c.closePath();
      } else this.diamond(c, x, y, rr);
      c.stroke();
    }
    c.textAlign = 'left';
  }

  private drawPlayhead(c: CanvasRenderingContext2D, t: number, px: number) {
    const T = this.T, G = GANTT;
    const a = prog(t, T.t0 - 0.3, T.t0) * (1 - prog(t, T.LAUNCH + 0.15, T.LAUNCH + 0.5));
    if (a <= 0) return;
    const x = this.playX(t);
    const ga = c.globalAlpha;
    c.globalAlpha = ga * a;
    const ry = G.GL + G.RULER;
    c.fillStyle = rgba('signal', 0.85);
    c.fillRect(x - 1 * px, ry - 6, 2 * px, G.GL + 70 - ry);
    // flag with a racing countdown
    const days = t >= T.LAUNCH ? 0 : this.daysAt(t);
    const txt = ZH ? (days > 0 ? `今天 T−${days} 天` : '今天 T−0') : days > 0 ? `TODAY T−${days} d` : 'TODAY T−0';
    c.font = font(F.mono(600), 20); c.textAlign = 'left';
    const tw = c.measureText(txt).width;
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, ry - 44, tw + 18, 34);
    c.fillStyle = rgba('ink', 1);
    c.fillText(txt, x + 9, ry - 20);
    c.globalAlpha = ga;
  }

  /** Days to launch shown on the playhead flag: interpolated between the milestone dates. */
  daysAt(t: number) {
    const x = this.playX(t);
    const pts: [number, number][] = [[this.X(this.T.t0 - 0.5), 150], ...this.ms.map((m) => [this.X(m.t), parseInt(m.date.replace(/[^0-9]/g, '') || '0', 10)] as [number, number])];
    for (let i = 1; i < pts.length; i++) {
      const [xa, da] = pts[i - 1]!, [xb, db] = pts[i]!;
      if (x <= xb) return Math.max(0, Math.round(lerp(da, db, clamp((x - xa) / Math.max(1, xb - xa)))));
    }
    return 0;
  }

  /** The empty CDR slot: dashed, blinking, its syllables lit as sung; finally the caret. */
  private drawSlot(c: CanvasRenderingContext2D, t: number, px: number, o: { alpha: number; keep: number; morph: number; caret: { hw: number; hh: number } }) {
    const T = this.T, G = GANTT;
    const { x, y } = this.slot;
    const r = G.DS;
    const since = t - T.cdr.start;
    const beat = T.beats.length > 1 ? (T.beats[T.beats.length - 1]! - T.beats[0]!) / (T.beats.length - 1) : 0.4545;
    const blinkOn = since < 0 || Math.floor(since / (beat / 2)) % 2 === 0;
    const m = o.morph;
    const keep = o.keep;
    // slot outline (dashed), morphing into the caret
    const hw = lerp(r, o.caret.hw, m), hh = lerp(r, o.caret.hh, m), cw = o.caret.hw * m;
    c.beginPath();
    c.moveTo(x - cw, y - hh); c.lineTo(x + cw, y - hh); c.lineTo(x + hw, y); c.lineTo(x + cw, y + hh); c.lineTo(x - cw, y + hh); c.lineTo(x - hw, y); c.closePath();
    if (m > 0) { c.fillStyle = rgba('signal', 0.9 * ease.inQuad(m)); c.fill(); }
    const hot = since >= 0;
    c.setLineDash(m > 0.5 ? [] : [12, lerp(9, 0, m * 2)]);
    c.lineJoin = 'miter';
    c.strokeStyle = hot ? rgba('signal', (blinkOn ? 1 : 0.3) * (1 - m)) : rgba('ash', 0.9);
    c.lineWidth = 3 * px;
    c.stroke();
    c.setLineDash([]);
    // labels fade with the rest
    c.globalAlpha = o.alpha * keep;
    if (keep <= 0.002) return;
    c.textAlign = 'center';
    c.font = font(F.mono(500), 20); c.fillStyle = rgba('graphite', 1);
    c.fillText(zhDays('T−45 d'), x, y + r + 32);
    // before it is sung: a planned milestone label like the others; then the lyric, large, beside it
    const big = ease.outExpo(prog(since, 0, 0.14));
    if (big < 1) {
      c.font = font(F.mono(600), 44); c.fillStyle = rgba('bone', 0.95 * (1 - big));
      c.fillText('CDR', x, y - r - 22);
    }
    if (since >= 0) {
      const size = 150;
      c.font = font(F.mono(700), size);
      const wch = c.measureText('C').width;
      const lx = x + r + 44, base = y + size * 0.36;
      c.textAlign = 'center';
      ['C', 'D', 'R'].forEach((ch, k) => {
        const ts = T.syl[k]!;
        const lit = t >= ts;
        const pop = (lit ? 1 + 0.3 * Math.pow(0.5, (t - ts) / 0.05) : 1) * lerp(0.3, 1, big);
        c.save();
        c.translate(lx + wch * (k + 0.5), base - size * 0.36); c.scale(pop, pop);
        c.fillStyle = lit ? rgba('signal', 1) : rgba('bone', 0.3);
        c.fillText(ch, 0, size * 0.36);
        c.restore();
      });
      c.textAlign = 'left';
      c.font = font(F.mono(700), 64); c.fillStyle = rgba('signal', big);
      c.fillText('*', lx + wch * 3 + 4, base - size * 0.5);
      // status and footnote
      const sa = prog(t, T.syl[1]! - 0.02, T.syl[1]! + 0.05);
      const fa = prog(t, T.syl[0]! + 0.3, T.syl[0]! + 0.45);
      if (ZH) {
        // 都没开过 under CDR, then the status and the line's footnote (in the plate's footnote slot)
        const zy = this.drawZhSlot(c, t, lx, base, wch * 3, big);
        c.font = font(F.mono(700), 30); c.fillStyle = rgba('signal', sa);
        c.fillText('状态：未举行', lx + 4, zy + 58);
        c.font = font(F.mono(400), 22); c.fillStyle = rgba('ash', fa);
        c.fillText('*', lx + 6, zy + 100);
        zhLayer()?.drawGloss(c, this.zhLine, t, lx + 26, zy + 100, { size: 19, base: 'bone', alpha: fa, env: 'always' });
      } else {
        c.font = font(F.mono(600), 26); c.fillStyle = rgba('signal', sa);
        c.fillText('STATUS: NOT HELD', lx + 6, base + 52);
        c.font = font(F.mono(400), 22); c.fillStyle = rgba('ash', fa);
        c.fillText('* CDR: Critical Design Review', lx + 6, base + 92);
      }
    }
    c.textAlign = 'left';
  }

  /** 连一次 after "Without" (inside its row's transform, so it slams with it): each glyph lit with its English word. */
  private drawZhHead(c: CanvasRenderingContext2D, t: number, x: number, vis: number) {
    const zl = zhLayer(), z = zl?.get(this.zhLine), S = z && zl!.set(z, ZV_ROW);
    if (!zl || !z || !S) return;
    for (const g of S.glyphs) {
      if (g.seg !== 0 || !g.ch.trim()) continue;
      const st = zl.glyphState(z, S, g, t, { dim: 0.2 });
      c.font = font(g.family, g.size);
      c.fillStyle = css(st.col, st.a * (st.lit > 0 ? 1 : vis));
      c.fillText(g.ch, x + g.x, 0);
    }
  }

  /** 都没开过 under the big CDR, as wide as it; lit as sung, staying signal like the lit letters. Returns its baseline. */
  private drawZhSlot(c: CanvasRenderingContext2D, t: number, lx: number, base: number, width: number, big: number) {
    const zy = base + 92;
    const zl = zhLayer(), z = zl?.get(this.zhLine), S = z && zl!.set(z, ZV_SLOT), sg = S?.segs[2];
    if (!zl || !z || !S || !sg) return zy;
    const k = width / Math.max(1, sg.x1 - sg.x0);
    c.save();
    c.translate(lx + 2, zy); c.scale(k, k);
    for (const g of S.glyphs) {
      if (g.seg !== 2 || !g.ch.trim()) continue;
      const st = zl.glyphState(z, S, g, t, { dim: 0.3, sung: SIGNAL_RGB });
      c.font = font(g.family, g.size);
      c.fillStyle = css(st.col, st.a * big);
      c.fillText(g.ch, g.x - sg.x0, 0);
    }
    c.restore();
    return zy;
  }
}

