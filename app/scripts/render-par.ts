#!/usr/bin/env bun
// Parallel export: the song in chunks, each rendered by its own headless browser (render.ts video --noaudio),
// several at once, then a lossless concat with the audio muxed once. On Windows (ANGLE on Direct3D 11) each
// browser's GPU process is bound by one CPU core while the GPU idles, so an export scales with the number of
// browsers. Chunks are frame-aligned and taken from a queue in order; a finished chunk is kept, so an interrupted
// export resumes where it stopped.
//   bun scripts/render-par.ts [--workers 6] [--chunk 8] [--from 0] [--to <song end>] [--out ../out/pdoom-zh.mp4]
//                             [render.ts video options, passed on: --zh --channel msedge --samples auto --max-samples 108 --shutter 0.2 --crf 16 …]
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const OWN = ['workers', 'chunk', 'from', 'to', 'out', 'fps'];
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const pass: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const k = argv[i]!.replace(/^--/, '');
  if (OWN.includes(k)) { i++; continue; }
  pass.push(argv[i]!);
}
const APP = path.resolve(import.meta.dir, '..'), ROOT = path.resolve(APP, '..');
const FPS = +opt('fps', '60')!;
const DUR: number = JSON.parse(readFileSync(path.join(ROOT, 'data/audio.json'), 'utf-8')).duration;
const from = +opt('from', '0')!, to = +opt('to', String(DUR))!;
const out = path.resolve(opt('out', path.join(ROOT, 'out/pdoom.mp4'))!);
const workers = +opt('workers', '6')!, chunk = +opt('chunk', '8')!;
const segDir = path.join(path.dirname(out), `${path.basename(out, '.mp4')}.seg`);
if (!existsSync(segDir)) mkdirSync(segDir, { recursive: true });

// frame-aligned chunks [n0, n1)
const n0 = Math.round(from * FPS), nEnd = Math.round(to * FPS), step = Math.max(1, Math.round(chunk * FPS));
const chunks: { k: number; a: number; b: number; file: string }[] = [];
for (let n = n0, k = 0; n < nEnd; n += step, k++) {
  const b = Math.min(nEnd, n + step);
  chunks.push({ k, a: n, b, file: path.join(segDir, `c${String(k).padStart(3, '0')}_${n}-${b}.mp4`) });
}
const done = (c: (typeof chunks)[number]) => existsSync(`${c.file}.done`) && existsSync(c.file) && statSync(c.file).size > 0;
const todo = chunks.filter((c) => !done(c));
console.log(`${chunks.length} chunks of ${step} frames, ${todo.length} to render, ${workers} at a time -> ${segDir}`);

const t0 = performance.now();
let next = 0, finished = chunks.length - todo.length, failed = 0;
async function run(c: (typeof chunks)[number], attempt = 1): Promise<void> {
  const args = ['bun', 'scripts/render.ts', 'video', '--from', String(c.a / FPS), '--to', String(c.b / FPS), '--fps', String(FPS), '--noaudio', '--out', c.file, ...pass];
  const p = Bun.spawn(args, { cwd: APP, stdout: 'pipe', stderr: 'pipe', env: process.env });
  const [so, se] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const frames = /\((\d+) frames in/.exec(so)?.[1];
  if (p.exitCode === 0 && frames && +frames === c.b - c.a && existsSync(c.file)) {
    writeFileSync(`${c.file}.done`, so.split('\n').filter((l) => /sub-frames|wrote/.test(l)).join('\n'));
    finished++;
    const el = (performance.now() - t0) / 60000;
    console.log(`chunk ${c.k} (${(c.a / FPS).toFixed(2)}–${(c.b / FPS).toFixed(2)} s) done  [${finished}/${chunks.length}, ${el.toFixed(1)} min]  ${/sub-frames[^\n]*/.exec(so)?.[0] ?? ''}`);
  } else if (attempt < 2) {
    console.log(`chunk ${c.k} failed (exit ${p.exitCode}), retrying:\n${(se || so).split('\n').slice(-8).join('\n')}`);
    return run(c, attempt + 1);
  } else {
    failed++;
    console.log(`chunk ${c.k} FAILED:\n${(se || so).split('\n').slice(-12).join('\n')}`);
  }
}
await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, async () => { while (next < todo.length) await run(todo[next++]!); }));
if (failed) { console.log(`${failed} chunk(s) failed; rerun the same command to resume`); process.exit(1); }

// lossless concat of the chunks + the song's audio over the same span
const list = path.join(segDir, 'list.txt');
writeFileSync(list, chunks.map((c) => `file '${c.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const ff = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ss', String(n0 / FPS), '-t', String((nEnd - n0) / FPS), '-i', path.join(ROOT, 'audio/pdoom.mp3'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', out], { stdout: 'inherit', stderr: 'inherit' });
await ff.exited;
console.log(ff.exitCode === 0 ? `wrote ${out} (${((performance.now() - t0) / 60000).toFixed(1)} min)` : `concat failed (exit ${ff.exitCode})`);
