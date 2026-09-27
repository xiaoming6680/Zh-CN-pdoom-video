# 引擎指南（写给场景作者）

> 本文是 [ENGINE.md](ENGINE.md) 的中文译本。命令、代码和 API 名称保留原文。
>
> 译注：从措辞看，这份文档的读者是 Claude Code 里负责各个场景的**子代理**（subagent）：它让读者“用 Read 工具亲眼看 PNG”“在最后一条消息里汇报”、称读者为 “scene agents”，改引擎要“找 lead”（统筹全局的主会话）。所以它既是开发文档，也是派活用的任务说明。

这支视频是一个 Web 应用（`app/`，TypeScript + three.js，用 bun + Vite 运行），能以 1920×1080 确定性地渲染歌曲里的任意时刻 `t`（用 `?scale=2` 则是两倍尺寸 3840×2160，见下文“输出缩放（4K）”）。实时预览和离线 60 fps 导出由同一套代码驱动。

## 怎么跑起来

- 开发服务器（可能已经在跑了）：`cd app && bunx vite --port 5173`。预览：http://localhost:5173/?t=23.0（空格 = 播放/暂停，←/→ = ±1 秒，shift = ±5 秒，`,`/`.` = ±1 帧，`[`/`]` = 上一个/下一个时间线条目，`l` = 循环当前条目，`h` = 隐藏界面）。
- 静帧（检查成果的主要方式——渲染完一定要用 Read 工具**亲眼看**这些 PNG）：`cd app && bun scripts/render.ts stills --t 12.5,13.0,14.2 --only open --out ../out/wip/open`
- 某段时间范围的缩略图拼版：`bun scripts/render.ts sheet --from 1.5 --to 9 --n 16 --cols 4 --only open --out ../out/wip/open/sheet.png`
- 短视频片段（用来判断运动效果：用 ffmpeg 抽帧来看，或者干脆相信数学）：`bun scripts/render.ts video --from 20 --to 25 --only hook --out ../out/wip/hook.mp4 --preset veryfast`
- `--only a,b` 只加载这几个时间线条目（速度快，也能把你和别人写坏的场景隔离开）。没有匹配的条目就什么都不渲染（黑屏），所以这个条目必须在 `src/timeline.ts` 里存在。
- 只对你自己的文件做类型检查：`bunx tsc --noEmit -p tsconfig.json 2>&1 | grep scenes/yourscene`。
- 渲染脚本会打印 `SCENE ERRORS` 和浏览器控制台错误——要读一读。
- 4K：在任意模式后面加 `--scale 2`（此时 `stills` 保存全分辨率的 3840×2160 PNG）。两种缩放下都要检查你的场景：缩小之后，4K 画面应当和 1080p 的一样，只是更清晰。
- 在文件还在被编辑时渲染：启动一个不带热重载的服务器（`PDOOM_NO_HMR=1 bunx vite --port 5190`），并传 `--url http://localhost:5190`；带热重载的服务器会在渲染中途重新加载页面。`render.ts` 在找不到可用服务器时自己启动的私有服务器，本来就不带热重载。

## 数据

- `lyrics`（`src/engine/lyrics.ts`）：`lines[]`，每行有 `text,start,end,words[]`，每个词是 `{w,start,end}`（逐词，已与人声对齐）。按内容查找歌词行，绝不要硬编码时间：`const l = this.ctx.lyrics.get('sudden drop')` → `l.words[3].start`。辅助函数：`Lyrics.wordProgress(word, t)`（0..1 的演唱进度）、`Lyrics.lineCharProgress(line, t)`（到目前为止唱了多少个字符——用于逐字形的擦除效果）、`lyrics.findWords('P(doom)')`。
- `audio`（`src/engine/audio.ts`）：`beats[]`、`downbeats[]`、`sections[]`、`beatAt(t)`（连续的节拍序号）、`barAt(t)`、`timeOfBeat(i)`、`nearestBeat(t)`、`events('kick'|'snare'|'hat'|'vocal', t0, t1)`、`env(name, t)`（`rms|low|mid|high|vocal|drums|bass|other` 的包络，0..1）、`hit(kind, t, halfLife)`（衰减的脉冲）。
- 每个 `Frame` 都已经带着 `f.a` = `{rms,low,mid,high,vocal,drums,bass,other,kick,snare,hat,vonset}`，以及 `f.beat,f.bar,f.beatPhase,f.barPhase`。

## 编写场景

一个场景就是一个文件 `app/src/scenes/<name>.ts`，默认导出一个继承 `Scene`（`src/engine/scene.ts`）的类：

```ts
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../engine/gl';

export default class MyScene extends Scene {
  bg = new FSPass(`uniform float t; void main(){ fragColor = vec4(C_INK, 1.0); }`, { t: { value: 0 } });
  text = new Layer2D();
  async init() { /* 构建几何体、预计算文字轮廓等 */ }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, lyrics } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);            // 全屏着色器 → out（覆盖写入）
    const c = this.text.ctx; this.text.clear(); /* 用 Canvas2D 绘制 */
    comp.draw(renderer, this.text.upload(), out); // 按 alpha 叠加到 out 上
    return { bloom: 0.7 };                   // 覆盖后期参数（可选）
  }
}
```

规则：

- **确定性**：输出必须是 `f.t` 的纯函数（随机要带种子：`mulberry32(seed)`、`hash(...)`）。视觉效果里绝不能用 `Math.random()`、`Date.now()` 或 `performance.now()`。导出时每一帧要平均许多子帧，而且渲染顺序任意（见“运动模糊与采样”）。如果确实需要模拟状态（粒子、反馈缓冲），就设 `stateful = true`，在 `reset()` 里重置，用 `f.dt` 做积分，引擎会在跳转之后快进；这样的场景只能用固定的 `--samples` 导出。
- `render()` 必须完整覆盖 `out`（一个 HalfFloat 线性 HDR 渲染目标）。颜色是**线性**的；超过约 0.85 的值会泛光（bloom）。使用调色板常量（GLSL 里用 `C_INK`、`C_BONE`、`C_SIGNAL`……；TS 里给 GL 用 `LIN.signal`；Canvas2D 用 `rgba('signal', a)`）。
- `ctx.params` 是时间线条目的参数（一个模块可以服务多个条目）；`ctx.start/ctx.end` 是它的时间窗口；`f.lt`/`f.p` 是局部时间/局部进度。
- 转场：默认情况下，引擎会给时间上重叠的条目做交叉淡化。要自定义转场，就设 `handlesTransition = true`，然后自己用 `f.tin`（在重叠期间从 0→1）去合成 `f.under`（上一个场景的画面）。大多数切换应当是落在强拍上的硬切（不重叠）——两个窗口首尾相接时，这就是默认行为。
- 可以返回的后期覆盖参数：`exposure, bloom, bloomThreshold, bloomKnee, bloomRadius, halation, ca, grain, vignette, hud（HUD 不透明度）, fade, flash, shake:[x,y], zoom, invert, pdoomText, hudCorruption`。默认值在 `src/engine/post.ts`。
- 性能：目标是每帧 < 25 ms。每个 Canvas2D 图层上传一次大约要 2–4 ms；每个场景不要超过 2–3 个。能预计算的放在 `init()` 里。
- 不要编辑你自己的场景文件（以及你自己命名为 `scenes/<name>-*.ts` 的辅助文件）以外的任何文件。需要改引擎：去找 lead（总负责人）（在你最后一条消息里汇报你需要什么）。不要编辑 `src/timeline.ts`。

## 工具箱

- `gl.ts`：`FSPass(frag, uniforms)`，全屏 GLSL3 渲染 pass（提供 `vUv`，输出写到 `fragColor`，自动包含 `GLSL_COMMON`）；`Compositor`（合成器），通过 `this.ctx.comp.draw(renderer, tex, target, {mode:'normal'|'add'|'screen'|'multiply'|'max', opacity, tint, scale, offset})` 调用；`Layer2D`（1920×1080 逻辑尺寸的 Canvas2D → sRGB 纹理）；`makeRT()`（屏幕尺寸的 HDR 渲染目标；`makeRT(w, h)` 的参数是逻辑像素）；`clearRT(renderer, rt, [r,g,b])`；`SCALE`/`PW`/`PH`（输出缩放倍数和物理尺寸）。
- `glsl/common.ts`（`GLSL_COMMON`，会自动加在 FSPass 前面；你自己的 ShaderMaterial 也可以导入它）：调色板常量、`hash*`、`snoise(vec2|vec3)`、`fbm`、`curl2`、2D/3D SDF、`smin`、`aaFill`、`aaStroke`，**用来做雕版风格明暗的 `hatch(u, darkness)` 和 `engrave(uv, darkness, freq, angle)`**，`heat(x)` 橙色热度渐变，`toSRGB/toLinear`。
- `lines.ts`：`LineBatch(capacity, {screen2D, worldWidth, blend})` —— GPU 绘制的胶囊形线段，可以是 2D 像素坐标（y 轴向下），也可以是带相机的 3D。`seg2`、`seg`、`polyline`、`render(renderer, out, camera?)`。颜色是线性的，可以超过 1 来发光。适合 1 万到 20 万条线段的规模。
- `type.ts`：字体。`F.archivo(width 62–125, weight 300–900)`（Grotesk 无衬线体，宽度档位 62/75/87.5/100/112.5/125），`F.archivoItalic()`，`F.serif(weight, italic)`（Cormorant Garamond），`F.mono(weight, italic)`（IBM Plex Mono）。`font(family, px)` → CSS 字体字符串。`layout(text, family, size, tracking)` → 按字体自带的字偶距（kerning）算出每个字形的 x 坐标和步进（第 i 个字形画在 `glyphs[i].x`）。`glyphX(text, i, family, size)` → 一个词被拆成几段来画时（已唱/未唱不同颜色、擦除效果），`text[i..]` 应该从哪里开始画；绝不要用 `measure(text.slice(0, i))` 来偏移某一段，那样会丢掉两段之间的字偶距。`fitSize`、`measure`、`textPath2D`（opentype 轮廓转成 Path2D）、`textPathCommands`、`textPoints(text, family, size, step)`（填满字形的点——“由原子组成的文字”）。`smart(s)` / `plain(s)`：打字机引号 → 印刷引号（’ “ ” …），以及反向转换。
- `stroke.ts`：单线绘图仪/雕版字体（`script`、`hscript`、`sans`、`readable`、`tech`、`serif`、`osmotron`、`felix`）：`strokeText(text, font, size, tracking, kern)`，`drawStrokeText(ctx2d, st, lengthPx)` → 返回笔头位置，`writtenLength(st, charTimes, t)` 让书写进度和词的时间同步。这些字体没有字偶距表：会留下空洞的字母对（To、Yo、We、AV、LT……）根据字形形状做视觉字偶距调整（连笔手写体关闭这项调整）。

## 排版

- 比例字体的文字要用上字体自带的字偶距：通过 Canvas2D 整串绘制的字符串自动就有；逐字形绘制则必须用 `layout()` / `glyphX()`。不同字体或字号的相邻文字段之间没有字偶距：那个间隙要凭肉眼调。
- 歌词自带印刷体标点（`don’t`、`’cause`、`“Just`）：`Word.w` 和 `Line.text` 都经过 `smart()` 处理；`lyrics.get()` 同时能匹配直引号和弯引号。硬编码的显示字符串同样要用 ’ “ ” … – — × −。等宽文字（IBM Plex Mono）是界面/终端的声音，保留打字机引号（把歌词显示成键入内容时，用 `plain()`）。
- 不用描边字，也不给文字加光晕。
- `util.ts`：`clamp, lerp, remap, smoothstep, ease.*, prog(x,a,b,ease), keys(t, [[t,v,ease],...]), springStep, pulse, mulberry32, hash, noise1/2/3, fbm1/2, polylineLengths, pointAtLength, window01`。
- `hud.ts`：全局 HUD（裁切标记；来自时间线条目的可选图注，自第 2 版修订起不再使用；左下角的 P(doom) 读数默认关闭，除非某个场景返回 `post.pdoom > 0`）。P(doom) 是在图版内部“上演”的：`new PDoom(lyrics).value(t)`、`formatPDoom(v)`，以及 `drawReadout(ctx2d, x, y, v, {scale})` 可以在任意位置画出这个仪表。`PDoom.value(t)` 可以通过 `engine.hud.pdoom` 拿到——如果你在场景里需要这个值，就用 `new PDoom(this.ctx.lyrics).value(t)` 重新算。

## 输出缩放（4K）

`?scale=2`（render.ts 的 `--scale 2`）会渲染真正的 3840×2160 画面。场景继续按逻辑上的 1920×1080 像素排版（`W`、`H`、`ctx.W`、`ctx.H` 永远不变）；剩下的由引擎处理：

- 渲染目标：`out`、引擎自己的渲染目标以及 `makeRT()` 都是物理尺寸（`PW`×`PH`）。`makeRT(w, h)` 接收逻辑像素，分配 `w*SCALE`×`h*SCALE`；如果是分辨率不能随输出变化的数据型渲染目标，传 `{ pxScale: 1 }`。
- `Layer2D`：底层 canvas 放大了 `SCALE` 倍，它的上下文也预先缩放过，所以绘制代码照常用逻辑像素。`setTransform`/`resetTransform`/`getTransform`、`shadowBlur`、`shadowOffsetX/Y` 以及 `filter` 里的像素长度都打过补丁，保持为逻辑单位。没打补丁的：`canvas.width/height` 和 `getImageData`/`putImageData` 用的是物理像素，`drawImage(layer.canvas, x, y)` 需要显式给出尺寸。`new Layer2D(w, h, 1)` 会建一个刻意的低分辨率图层（比如柔和的辉光）。`scaleContext2D(ctx, SCALE)` 可以给你自己的 canvas 打同样的补丁。
- `LineBatch`：坐标和线宽保持逻辑单位；抗锯齿羽化和发丝线的最小线宽则按物理像素计算，所以发丝线依然锐利。
- GLSL（`GLSL_COMMON`）：`gl_FragCoord`、`fwidth` 和 `dFdx` 是物理像素。只要和逻辑尺寸一起计算，就用 `FRAG_PX`（片元在逻辑像素中的位置）代替 `gl_FragCoord.xy`，并用 `PX_SCALE` 换算。宽度由 `fwidth` 决定的线（“1.2 px 的发丝线”：`1.0 - smoothstep(a, b, d / fwidth(u))`）在 4K 下会变细、变淡：把它写成 `pxLine(d, a, b)`，它在 1× 下完全一样，在 4K 下保持与 1× 相同的墨量，只是边缘更锐利（`rampLine` 对线性渐变的写法做同样的事）。`hatch`、`engrave` 和 `aaStroke` 已经这样处理了。以像素表示的 LOD 阈值和超采样偏移量要用逻辑像素（`fwidth(u) * PX_SCALE`，偏移量 `/ PX_SCALE`）。
- 用作纹理的离屏 canvas（图集、文字平面）保持它们自己的尺寸：如果会被放大显示，就把它们做成 `SCALE` 倍大（配合 `ctx.scale(SCALE, SCALE)`），否则在 4K 下会发虚。
- 后期（bloom、halation、色差 CA、颗粒、暗角）和 HUD 会自动缩放；bloom 的降采样金字塔保持在逻辑分辨率。

## 运动模糊与采样

导出时，每一帧都渲染成许多子帧的平均值，这些子帧分布在快门时间内（`--shutter 0.2`：帧间隔的五分之一，以这一帧的时刻为中心），平均在后期处理之前完成。`--samples N` 取 N 个均匀分布的子帧；`--samples auto` 逐帧决定数量（`Engine.render`、`AdaptiveSampling`）：

- 数量按 4、12、36、108、324 逐级增加。每升一级，就在每个已有子帧的两侧各加一个子帧，所以每一组都均匀分布、并以这一帧的时刻为中心。
- 每升一级之后，引擎比较新子帧的平均值和旧子帧的平均值（比较的是最终显示值，取误差最大的 2×2 逻辑像素块）。运动边缘上一格一格的重影在两组之间会不同；已经收敛的拖影或者静止画面则不会。重影误差随 1/子帧数 缩小，所以这一帧剩下的误差大约是最后一级变化量的一半；当它低于 `--tol`（默认 3 个色阶，满量程 255）时就停止。
- 实际上，静止画面停在 12，普通的镜头运动停在 36，甩镜、重击和快速变焦停在 108 或 324。在 4K 下 1:1 查看，108 和 324 已经分辨不出，而 36 在最快的边缘上还能看到淡淡的条纹。

这对场景提出的要求：

- 子帧不按时间顺序渲染，数量也不固定：场景的输出只能依赖 `f.t`。`stateful` 场景不能做自适应采样（引擎会拒绝）；任何逻辑都不能依赖 `render()` 被调用的次数。
- 按 60 fps 逐帧变化的闪烁和抖动必须用 `frameIdx(t)`（`util.ts`），而不是 `Math.floor(t * 60)`。`frameIdx` 在这一帧的整个快门时间内保持不变；`floor` 却恰好在这一帧自己的时刻跳变，于是每一帧都会把两种状态叠印在一起。
- 随连续的 `t` 变化的噪声（以时间为种子的 hash）在每个子帧里都会重新采样：它最终会被平均掉，但很慢，还会让自适应采样器更费劲。除非本来就想让它平滑掉，否则用 `frameIdx(t)` 做种子。
- 发射速率随时间变化的火花发射器，要把速率写成粒子出生时间的函数，并给出最大值（`sparkParticles(..., { rate: (tb) => ..., rateMax })`）。如果读的是当前 `t` 的速率，每个粒子的时间都会在子帧之间被重新排布。
- 内部自带超采样（4 个旋转网格采样点）的着色器接收 `ssTap: SS_TAP` 和 `${SS_TAP_GLSL}`，用 `for (int k = ssK0(); k < ssK1(); k++) ... rgss(k)` 循环，按 `ssWeight()` 加权。这样引擎会给每个子帧只分一个采样点、轮流循环（每组的数量都是 4 的倍数），平均下来是同样的画面，开销只有四分之一。在预览和单采样的静帧里，它们会取全部四个点。
- 后期参数（震动、闪光、缩放、淡入淡出、HUD 模式）只在快门内的一个时间点读取：这一帧时刻之后 1/8 个快门长度处（视频就是在这个点上调校的，而且每一组采样都包含这个点）；HUD、颗粒和抖色（dither）每帧只画一次。

## 共用母题（`app/src/scenes/_motifs.ts`）

用这些函数，让反复出现的母题在各幅图版里看起来完全一致：`sparkHead(lineBatch, x, y, t, scale, intensity)` + `sparkParticles(lineBatch, t, headAt, opts)`（火花，用 2D 加法混合的 `LineBatch` 绘制），`sparkHead2D`（Canvas2D 的后备版本），以及面具：`drawMask2D(ctx, x, y, R, rot)`、`MASK` 几何常量和 `GLSL_MASK`（`sdMaskInk(p)`，以面具为单位，y 轴向下）。对场景代理（scene agents）只读；需要修改请找 lead。
