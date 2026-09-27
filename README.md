# I'm Upping My P(doom) —— 音乐视频（中文本地化版）

> 用代码生成的 AI 主题音乐视频 *I'm Upping My P(doom)* 的**中文深度汉化版**。中文汉化：**XIAOMING6680**。
> 原项目 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)，作者 Giacomo Magnanini，按 MIT 协议开源（见 [LICENSE](LICENSE)）；英文原版说明见 [README.en.md](README.en.md)。

![中文版全部图版一览](docs/images/overview.jpg)

## 原作者

这个中文版是在别人的作品上做的汉化，视频和歌曲都不是我原创的：

- **视频原作者：Giacomo Magnanini**（原仓库：[mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)）。概念、创意方案、渲染引擎和每一个场景都出自原项目，代码以 [MIT 许可证](LICENSE) 开源（Copyright (c) 2026 Giacomo Magnanini）。原版 4K 视频：[YouTube](https://www.youtube.com/watch?v=5EoO5413dBY)。
- **歌曲《I'm Upping My P(doom)》**：歌词由 [osmarks](https://docs.osmarks.net/hypha/p%28doom%29_song_objectively_correct_interpretation) 创作，开头主歌和副歌出自 [MusicPerson](https://www.udio.com/creators/MusicPerson)，另有 EleutherAI Discord 网友贡献的句子。原版用 Udio 生成（[YouTube](https://www.youtube.com/watch?v=uEB5E67vcPA)）；本视频用的是 [deckard (@slimer48484)](https://x.com/slimer48484/status/2097752569212756134) 用 Suno 制作的“Claude-Pop”版本。歌曲和歌词归各自作者所有，不在 MIT 许可证范围内。

我只负责中文汉化部分（见下一节）。感谢原作者们的开源和创作。

## 我做的中文汉化

中文歌词不是贴在画面底部的一条固定字幕，而是逐幅图版重新排进每个画面自己的构图里，和英文原句一起组成双语版式：

| | |
|:-:|:-:|
| ![修格斯的谎言](docs/images/shoggoth.jpg) | ![被困在中文屋](docs/images/chinese.jpg) |
| **修格斯**：中文歌词跟着英文大字一起排版 | **中文屋**：中文标题嵌进三维场景 |
| ![英伟达直冲月球](docs/images/nvda.jpg) | ![够安全了](docs/images/safe.jpg) |
| **月球储备券**：钞票上的文字全部改成中文 | **安全评测表**：表格、印章、批注都是中文 |
| ![冲破每一道安全围栏](docs/images/breaking.jpg) | ![我们点燃了导火索](docs/images/fuse.jpg) |
| **冲破围栏**：中文副标题配合动态大字 | **导火索**：中文歌词沿着引线弯曲排版 |

具体做了这些：

- **中文歌词翻译与逐词同步**：[`data/lyrics.zh.json`](data/lyrics.zh.json) 收录全曲中文歌词，时间和英文歌词逐行对齐，跟着演唱逐字点亮。
- **逐幅图版的双语排版**：每个场景都给中文单独设计了位置、字号和动画，中英文一起构图，而不是统一压一条底部字幕。
- **界面文字全部中文化**：HUD、表格、标签、钞票、终端界面等所有非歌词文字都换成了中文（各场景里用 [`app/src/engine/lang.ts`](app/src/engine/lang.ts) 提供的 `tr(英文, 中文)` 切换）。梗名词用中文圈的常见叫法，比如 NVDA 写作「英伟达」、Shoggoth 写作「修格斯」。
- **中文字体**：用 [`analysis/make_fonts_zh.py`](analysis/make_fonts_zh.py) 从思源 / Noto 字体（OFL 协议）里抽出用到的汉字生成子集，排版逻辑在 [`app/src/engine/zh.ts`](app/src/engine/zh.ts)。
- **文档翻译**：[`docs/TREATMENT.zh-CN.md`](docs/TREATMENT.zh-CN.md)（创意方案）和 [`docs/ENGINE.zh-CN.md`](docs/ENGINE.zh-CN.md)（引擎文档）。
- **署名水印**：画面右上角显示「中文字幕 XIAOMING6680」，只署名字幕汉化，视频本身仍归原作者。

## 快速上手

需要 [bun](https://bun.sh)、Chrome 或 Edge、带 libx264 的 ffmpeg。

**预览**

```sh
cd app
bun install
bunx vite
```

浏览器打开 <http://localhost:5173/?zh=1> 看中文版（去掉 `?zh=1` 是英文原版，加 `&t=23` 从第 23 秒开始）。空格播放/暂停，`←` `→` 快进快退，`[` `]` 切换场景，`h` 隐藏界面。

**导出中文版视频**（Windows 用 Edge 多进程并行）

```sh
cd app
bun scripts/render-par.ts --workers 7 --chunk 8 --out ../out/pdoom-zh.mp4 --zh --channel msedge --samples auto --max-samples 108 --shutter 0.2
```

输出 1920×1080、60 fps。加 `--scale 2` 渲染 4K。改过中文文字后，要重跑 `analysis/make_fonts_zh.py` 重新生成字体子集。

## 目录结构

| 路径 | 内容 |
|---|---|
| `app/` | 渲染器（TypeScript + three.js），`src/scenes/` 里每个场景一个文件 |
| `data/lyrics.zh.json` | 中文歌词及其与英文单词的对应 |
| `data/lyrics.json`、`data/audio.json` | 逐词歌词时间、节拍与音频分析 |
| `analysis/` | 生成时间数据和中文字体的 Python 工具 |
| `docs/` | 创意方案和引擎文档（中英文） |

更多细节（运动模糊参数、4K 开销、重新生成时间数据等）见英文原版 [README.en.md](README.en.md) 和 [`docs/ENGINE.zh-CN.md`](docs/ENGINE.zh-CN.md)。

## 许可证

代码按 [MIT 许可证](LICENSE) 发布。字体保留各自的开源许可证（Archivo、IBM Plex Mono、Cormorant Garamond、Noto Sans/Serif SC 为 OFL，Hershey 字体为 OFL / 公有领域）。歌曲和歌词（`audio/`、`lyrics/`、`data/lyrics*.json`）不在 MIT 范围内，归各自作者所有。
