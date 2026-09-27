#!/usr/bin/env bun
// Offline renderer. Drives the app in headless Chrome (?export=1) and either
//   stills:  bun scripts/render.ts stills --t 1.5,23,40.2 [--only id1,id2] [--out dir]
//   sheet:   bun scripts/render.ts sheet --from 20 --to 35 [--n 12] [--cols 4] [--only ids] [--out file.png]   (or --times a,b,c | --cuts)
//   plates:  bun scripts/render.ts plates   (renders one representative JPEG per plate into public/plates/ (used by the outro's rewind), times from plates.json or entry midpoints;
//            with --zh into public/plates-zh/, the Chinese version's)
//   perf:    bun scripts/render.ts perf --from 20 --to 25 [--only ids] [--samples 1] [--shutter 0.5]   (avg ms per frame incl. GPU sync and the export's pixel readback)
//   video:   bun scripts/render.ts video [--from 0] [--to 156.65] [--fps 60] [--crf 16] [--x264 aq-mode=3] [--samples 1] [--shutter 0.5] [--out ../out/pdoom.mp4] [--noaudio]
//            --samples N averages N sub-frames per frame over shutter×(1/fps): motion blur + temporal AA;
//            --samples auto picks the count per frame (4, 12, 36, 108 or 324, see Engine.render)
//   --scale N (all modes): render at N× the 1920x1080 layout (--scale 2 = true 3840x2160); stills are then saved
//            full-res from the pixel buffer, videos are encoded at the physical size.
//   cover:   bun scripts/render.ts cover --only shoggoth --scale 2 [--sizes 1440x1920,1920x1440] [--out ../out/cover]   (posting covers, src/cover.ts;
//            Douyin's 3:4 and 4:3 by default, 1920x1080 for Bilibili's 16:9)
//   zhplace: bun scripts/render.ts zhplace --zh [--n 9]   (for each Chinese line, how cluttered each candidate slot
//            (zh.ts SLOTS) is in the plate under it, sampled over the line's time on screen: lower is emptier)
//   info:    bun scripts/render.ts info [--zh]   (the edit, and every lyric line with its times (and its Chinese))
//   --zh (all modes): the Chinese version (src/engine/lang.ts, src/engine/zh.ts).
//   --channel msedge (all modes): drive installed Edge instead of Chrome (default: chrome).
// Uses the Vite dev server at --url (default http://localhost:5173); starts a private one if unreachable.
import { chromium, type Page } from 'playwright-core';
import { mkdirSync as mkdirSync0, existsSync } from 'node:fs';
import path from 'node:path';
// (Bun on Windows throws EEXIST for an existing directory with a non-ASCII path, even with recursive)
const mkdirSync = (p: string, o: { recursive: boolean }) => { if (!existsSync(p)) mkdirSync0(p, o); };

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'stills';
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const SCALE = Math.max(1, Math.round(+opt('scale', '1')!));
const OW = 1920 * SCALE, OH = 1080 * SCALE; // output size
// --samples N (fixed) or --samples auto [--min-samples 4] [--max-samples 324] [--tol 3] (adaptive, see Engine.render)
const SAMPLES = opt('samples', '1') === 'auto'
  ? { min: +opt('min-samples', '4')!, max: +opt('max-samples', '324')!, tol: +opt('tol', '3')! }
  : +opt('samples', '1')!;
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
const ROOT = path.resolve(APP, '..');

async function reachable(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function ensureServer(): Promise<{ url: string; stop: () => void }> {
  const url = opt('url', 'http://localhost:5173')!;
  if (await reachable(url)) return { url, stop: () => {} };
  const port = 5300 + Math.floor(Math.random() * 500);
  // no live reload: a file saved mid-render must not reload the page
  const proc = Bun.spawn(['bunx', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, PDOOM_NO_HMR: '1' } });
  const u = `http://localhost:${port}`;
  for (let i = 0; i < 100 && !(await reachable(u)); i++) await Bun.sleep(100);
  return { url: u, stop: () => proc.kill() };
}

// ANGLE backend: Metal on macOS, Direct3D 11 on Windows, the browser's default elsewhere
const ANGLE = process.platform === 'darwin' ? ['--use-angle=metal'] : process.platform === 'win32' ? ['--use-angle=d3d11'] : [];

async function openPage(url: string) {
  const browser = await chromium.launch({
    channel: opt('channel', 'chrome'),
    headless: !flag('headed'),
    args: [...ANGLE, '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const only = opt('only');
  await page.goto(`${url}/?export=1${only ? `&only=${only}` : ''}${SCALE !== 1 ? `&scale=${SCALE}` : ''}${flag('zh') ? '&zh=1' : ''}`);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => (window as any).__pdoom.error);
  if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
  const size: [number, number] = await page.evaluate(() => [(window as any).__pdoom.width ?? 1920, (window as any).__pdoom.height ?? 1080]);
  if (size[0] !== OW || size[1] !== OH) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${OW}x${OH} (--scale ${SCALE})`);
  const sceneErrors: string[] = await page.evaluate(() => (window as any).__pdoom.errors);
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
  return { browser, page, logs };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__pdoom.still(t, s, sh), [t, SAMPLES, +opt('shutter', '0.5')!] as const);
    const f = path.join(outDir, `f_${t.toFixed(2).padStart(7, '0')}.png`);
    if (typeof SAMPLES !== 'number') console.log(`t=${t}: ${k} sub-frames`);
    // at scale > 1 the canvas is shown downscaled on the page: save the full-res pixel buffer instead
    if (SCALE !== 1) await Bun.write(f, Buffer.from(await page.evaluate(() => (window as any).__pdoom.png()), 'base64'));
    else await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(async ({ times, cols }) => {
    const P = (window as any).__pdoom;
    const cw = 480, ch = 270, pad = 4, lab = 18;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    times.forEach((t: number, i: number) => {
      P.still(t);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
    });
    return cv.toDataURL('image/png');
  }, { times, cols });
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

async function video(page: Page, from: number, to: number, fps: number, out: string) {
  mkdirSync(path.dirname(out), { recursive: true });
  const crf = opt('crf', '16')!;
  const audio = path.join(ROOT, 'audio/pdoom.mp3');
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (!flag('noaudio')) args.push('-ss', String(from), '-t', String(to - from), '-i', audio);
  args.push('-vf', 'vflip', '-c:v', 'libx264', '-preset', opt('preset', 'slow')!, '-crf', crf, '-pix_fmt', 'yuv420p', '-tune', 'grain', '-x264-params', opt('x264', 'aq-mode=3')!);
  if (!flag('noaudio')) args.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
  args.push('-movflags', '+faststart', out);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
  let frames = 0;
  const total = Math.round(to * fps) - Math.round(from * fps);
  const t0 = performance.now();
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 4 + 1024),
      async message(ws, msg) {
        ff.stdin.write(msg as Uint8Array);
        await ff.stdin.flush();
        frames++;
        ws.send(String(frames)); // ack: the page keeps at most a few frames ahead of ffmpeg (bounded memory at 4K)
        if (frames % 60 === 0 || frames === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${frames}/${total} frames  ${(frames / el).toFixed(1)} fps  eta ${((total - frames) / (frames / el)).toFixed(0)}s   `);
        }
      },
    },
  });
  const used: Record<string, number> = await page.evaluate((o) => (window as any).__pdoom.stream(o), { from, to, fps, ws: `ws://localhost:${server.port}`, samples: SAMPLES, shutter: +opt('shutter', '0.5')!, inflight: 4 });
  // wait for all frames to arrive
  while (frames < total) await Bun.sleep(20);
  ff.stdin.end();
  await ff.exited;
  server.stop();
  console.log(`\nwrote ${out} (${frames} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
}

const { url, stop } = await ensureServer();
const { browser, page, logs } = await openPage(url);
try {
  if (mode === 'gpu') {
    console.log(await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }));
  } else if (mode === 'stills') {
    const times = (opt('t') ?? '0').split(',').map(Number);
    const files = await stills(page, times, opt('out', path.join(ROOT, 'out/stills'))!);
    console.log(files.join('\n'));
  } else if (mode === 'sheet') {
    const from = +opt('from', '0')!, to = +opt('to', '10')!, n = +opt('n', '12')!;
    let times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
    if (opt('times')) times = opt('times')!.split(',').map(Number);
    if (flag('cuts')) {
      // 4 frames around every timeline boundary: 2 frames before, 2 after
      const tl: { id: string; start: number }[] = await page.evaluate(() => (window as any).__pdoom.timeline);
      times = tl.slice(1).flatMap((e) => [e.start - 0.1, e.start - 1 / 60, e.start + 1 / 60, e.start + 0.1]);
    }
    const out = opt('out', path.join(ROOT, `out/sheets/sheet_${from}-${to}.png`))!;
    await sheet(page, times, +opt('cols', '4')!, out);
    console.log(out);
  } else if (mode === 'plates') {
    const tl: { id: string; start: number; end: number }[] = await page.evaluate(() => (window as any).__pdoom.timeline);
    const figs = ['open', 'loss', 'room', 'shoggoth', 'spacetime', 'ascent', 'bureau', 'leftturn', 'paperclips', 'fuse', 'stack', 'dense', 'loom', 'ilya'];
    const overrides: Record<string, number> = existsSync(path.join(APP, 'plates.json')) ? await Bun.file(path.join(APP, 'plates.json')).json() : {};
    // the Chinese version's plates (with their Chinese type) go beside the English ones; the outro picks by language
    const dir = path.join(APP, flag('zh') ? 'public/plates-zh' : 'public/plates');
    mkdirSync(dir, { recursive: true });
    await page.evaluate(() => { (window as any).__pdoom.engine.hudOff = true; });
    for (let i = 0; i < figs.length; i++) {
      const e = tl.find((x) => x.id === figs[i]);
      if (!e) continue;
      const t = overrides[figs[i]!] ?? (e.start + e.end) / 2;
      await page.evaluate((t) => (window as any).__pdoom.still(t, 4, 0.2), t);
      const f = path.join(dir, `fig${String(i + 1).padStart(2, '0')}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      console.log(f, t.toFixed(2));
    }
  } else if (mode === 'perf') {
    const from = +opt('from', '0')!, to = +opt('to', '5')!;
    const r = await page.evaluate(async ({ from, to, samples, shutter }) => {
      const P = (window as any).__pdoom;
      const ms: number[] = [];
      const buf = new Uint8Array(P.width * P.height * 4);
      P.still(from);
      const used: Record<number, number> = {};
      for (let t = from; t < to; t += 1 / 60) {
        const a = performance.now();
        const k = P.engine.render(t, 1 / 60, false, samples, shutter);
        used[k] = (used[k] ?? 0) + 1;
        await P.engine.readPixelsAsync(buf);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return { n: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1], used };
    }, { from, to, samples: SAMPLES, shutter: +opt('shutter', '0.5')! });
    console.log(`frames ${r.n}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.used)}`);
  } else if (mode === 'cover') {
    // posting covers: portrait 3:4 and landscape 4:3 by default (Douyin's two covers)
    const dir = path.resolve(opt('out', path.join(ROOT, 'out/cover'))!);
    mkdirSync(dir, { recursive: true });
    for (const s of opt('sizes', '1440x1920,1920x1440')!.split(',')) {
      const [w, h] = s.split('x').map(Number) as [number, number];
      const b64: string = await page.evaluate(([w, h]) => (window as any).__pdoom.cover(w, h), [w, h] as const);
      const f = path.join(dir, `cover_${w}x${h}.png`);
      await Bun.write(f, Buffer.from(b64, 'base64'));
      console.log(f);
    }
  } else if (mode === 'zhplace') {
    // each line's frames without the layer; per slot, the worst sample of: luminance edges in the box the line would
    // cover (the plate's own lines and type) + how far the background under it is from the layer's ground
    const rows: { i: number; plate: string; text: string; slots: Record<string, [number, number]> }[] = await page.evaluate(async (n) => {
      const P = (window as any).__pdoom, E = P.engine, Z = E.zh;
      if (!Z) throw new Error('zhplace needs --zh');
      const W = P.width, H = P.height, S = P.scale, D = 4 * S, gw = Math.floor(W / D), gh = Math.floor(H / D);
      const buf = new Uint8Array(W * H * 4), L = new Float32Array(gw * gh);
      const out: any[] = [];
      E.zh = null;
      try {
        for (const z of Z.lines) {
          const acc: Record<string, number[][]> = {};
          for (const k of Object.keys(Z.slots)) acc[k] = [];
          for (let s = 0; s < n; s++) {
            E.render(z.tIn + ((z.tOut - z.tIn) * (s + 0.5)) / n, 1 / 60, false, 1);
            await E.readPixelsAsync(buf);
            for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
              let sum = 0;
              for (let yy = 0; yy < D; yy += S) for (let xx = 0; xx < D; xx += S) {
                const o = ((H - 1 - (gy * D + yy)) * W + gx * D + xx) * 4; // rows are bottom-up
                sum += 0.2126 * buf[o]! + 0.7152 * buf[o + 1]! + 0.0722 * buf[o + 2]!;
              }
              L[gy * gw + gx] = sum / (16 * 255);
            }
            const paper = E.lastPost.paper > 0.5;
            for (const [k, place] of Object.entries(Z.slots)) {
              const b = Z.box(z, place);
              const x0 = Math.max(1, Math.floor(b.x0 / 4)), x1 = Math.min(gw - 1, Math.ceil(b.x1 / 4));
              const y0 = Math.max(1, Math.floor(b.y0 / 4)), y1 = Math.min(gh - 1, Math.ceil(b.y1 / 4));
              let edge = 0, ground = 0, c = 0;
              for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, c++) {
                const i = y * gw + x, l = L[i]!;
                edge += Math.abs(L[i + 1]! - L[i - 1]!) + Math.abs(L[i + gw]! - L[i - gw]!);
                ground += paper ? Math.max(0, 0.6 - l) : Math.max(0, l - 0.25);
              }
              acc[k]!.push([edge / c, ground / c]);
            }
          }
          const slots: Record<string, [number, number]> = {};
          for (const [k, v] of Object.entries(acc)) slots[k] = [Math.max(...v.map((a) => a[0]!)), Math.max(...v.map((a) => a[1]!))];
          out.push({ i: z.line.i, plate: z.plate, text: z.line.text, slots });
        }
      } finally {
        E.zh = Z;
      }
      return out;
    }, +opt('n', '9')!);
    const keys = Object.keys(rows[0]?.slots ?? {});
    const score = (v: [number, number]) => v[0] * 10 + v[1] * 4;
    console.log(`line plate       ${keys.map((k) => k.padStart(6)).join('')}   best  text`);
    for (const r of rows) {
      const sc = keys.map((k) => score(r.slots[k]!));
      const best = keys[sc.indexOf(Math.min(...sc))]!;
      console.log(`${String(r.i).padStart(4)} ${r.plate.padEnd(11)}${sc.map((x) => x.toFixed(2).padStart(6)).join('')}   ${best.padEnd(4)}  ${r.text}`);
    }
    if (opt('json')) await Bun.write(opt('json')!, JSON.stringify(rows, null, 1));
  } else if (mode === 'info') {
    // the edit and the lyric lines with their times (and, with --zh, each line's Chinese and whether a plate sets it;
    // load every plate, no --only, for that)
    const info: { tl: { id: string; start: number; end: number }[]; lines: { i: number; start: number; end: number; text: string; zh: string | null; own: boolean }[] } = await page.evaluate(() => {
      const P = (window as any).__pdoom, E = P.engine;
      return {
        tl: P.timeline,
        lines: E.lyrics.lines.map((l: any) => ({ i: l.i, start: l.start, end: l.end, text: l.text, zh: E.zh?.text(l.i)?.zh ?? null, own: E.zh ? E.zh.claimed.has(l.i) : true })),
      };
    });
    for (const e of info.tl) {
      console.log(`${e.id.padEnd(11)} ${e.start.toFixed(2).padStart(7)} – ${e.end.toFixed(2).padStart(7)}`);
      for (const l of info.lines.filter((l) => l.start >= e.start - 0.05 && l.start < e.end - 0.05))
        console.log(`   ${String(l.i).padStart(2)}  ${l.start.toFixed(2).padStart(7)} – ${l.end.toFixed(2).padStart(7)}  ${l.text}${l.zh ? `  ｜ ${l.zh}` : ''}${l.own ? '' : '   (no plate sets it: fallback strip)'}`);
    }
  } else if (mode === 'video') {
    const dur: number = await page.evaluate(() => (window as any).__pdoom.duration);
    await video(page, +opt('from', '0')!, +opt('to', String(dur))!, +opt('fps', '60')!, path.resolve(opt('out', path.join(ROOT, 'out/pdoom.mp4'))!));
  }
  if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
} finally {
  await browser.close();
  stop();
}
