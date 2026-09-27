// "SHROOMS" across the room → shoggoth cut: the word escapes the room's flip-board and ends the
// room plate in a fixed screen layout; shoggoth's first frames continue exactly that layout while
// the mask rushes in. Shared here so both plates agree on every letter.
import { W, H } from '../engine/gl';
import { F, layout } from '../engine/type';

export const SHROOMS = 'SHROOMS';
export const SHROOMS_FAM = () => F.archivo(125, 900);
/** Screen size (px) of the word at the cut. */
export const SHROOMS_SIZE = 250;

/** Letter centres (x), cap-centre y and size for the screen layout at scale k (1 = at the cut). */
export function shroomsScreen(k = 1): { size: number; x: number[]; y: number; w: number[] } {
  const size = SHROOMS_SIZE * k;
  const fam = SHROOMS_FAM();
  const lay = layout(SHROOMS, fam, size, size * 0.04);
  const x0 = W / 2 - lay.width / 2;
  return { size, x: lay.glyphs.map((g) => x0 + g.x + g.w / 2), y: H / 2 + 40 * k, w: lay.glyphs.map((g) => g.w) };
}

/** Deterministic per-letter wobble (the trip). amt 0..1. */
export function shroomWobble(t: number, i: number, amt: number) {
  return {
    dx: Math.sin(t * 5.1 + i * 2.7) * 6 * amt,
    dy: (Math.sin(t * 9 + i * 0.9) * 14 + Math.sin(t * 5.3 + i * 2.1) * 8) * amt,
    rot: Math.sin(t * 6.5 + i * 1.7) * 0.16 * amt,
    sx: 1 + 0.12 * Math.sin(t * 7.7 + i) * amt,
    sy: 1 + 0.16 * Math.sin(t * 4.4 + i * 0.6) * amt,
  };
}

/**
 * Canvas affine for letter i of SHROOMS drawn at 100 px (glyph advance gw, cap height capPx),
 * placed in the screen layout at scale k with the trip wobble at time t.
 */
export function shroomsAffine(t: number, i: number, k: number, gw: number, capPx: number, amt = 1) {
  const L = shroomsScreen(k);
  const sc = L.size / 100;
  const wb = shroomWobble(t, i, amt);
  const cs = Math.cos(wb.rot), sn = Math.sin(wb.rot);
  const X = L.x[i]! + wb.dx, Y = L.y + wb.dy;
  const a = cs * wb.sx * sc, b = sn * wb.sx * sc, c = -sn * wb.sy * sc, d = cs * wb.sy * sc;
  const cx = gw / 2, cy = -capPx / 2;
  return { a, b, c, d, e: X - (a * cx + c * cy), f: Y - (b * cx + d * cy) };
}

// ---- the Chinese version: 迷幻蘑菇 (the Chinese of "of shrooms") lifts off the board with SHROOMS and lands
// centred under it, half its size, in 思源黑体 Heavy (the face behind Archivo 900); both plates share this layout.
export const SHROOMS_ZH_FAM = 'NotoSansSC-900';
/** Ideograph size (em) as a fraction of SHROOMS_SIZE. */
export const SHROOMS_ZH_K = 0.5;
/** Ink centre of an ideograph above its baseline, in em (思源黑体's face spans about -0.07..0.83 em). */
export const ZH_MID = 0.38;

/**
 * Canvas affine for ideograph j of n (drawn at 100 px, advance gw, fillText at its baseline-left) in the row
 * under SHROOMS in the screen layout at scale k, wobbling with the trip like the letters above it.
 */
export function shroomsZhAffine(t: number, j: number, n: number, k: number, gw: number, amt = 1) {
  const L = shroomsScreen(k);
  const size = SHROOMS_SIZE * SHROOMS_ZH_K * k;
  const sc = size / 100;
  // ink top a small gap under the caps (cap half-height 0.36 em of the word), glyphs one em apart
  const Y0 = L.y + (0.36 + 0.16) * SHROOMS_SIZE * k + (0.83 - ZH_MID) * size;
  const X0 = W / 2 - (n * size) / 2 + (j + 0.5) * size;
  const wb = shroomWobble(t, 7 + j, amt);
  const cs = Math.cos(wb.rot), sn = Math.sin(wb.rot);
  const X = X0 + wb.dx, Y = Y0 + wb.dy * 0.7;
  const a = cs * wb.sx * sc, b = sn * wb.sx * sc, c = -sn * wb.sy * sc, d = cs * wb.sy * sc;
  const cx = gw / 2, cy = -ZH_MID * 100;
  return { a, b, c, d, e: X - (a * cx + c * cy), f: Y - (b * cx + d * cy) };
}
