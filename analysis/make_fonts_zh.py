# Chinese fonts for the Chinese version (?zh=1; app/src/engine/lang.ts, zh.ts): Noto Sans SC and Noto Serif SC
# (SIL OFL), subset to the characters the video prints in Chinese and instanced at the weights it draws
# (lang.ts CJK_FAMILIES). The characters come from data/lyrics.zh.json (the lyric translation, the covers) and
# from every string literal with Chinese in it under app/src (the plates' T('…', '…') strings, the watermark).
# Only U+2000 and up are kept (CJK, full-width punctuation, “ ” ‘ ’ … —): Latin, digits and spaces come from
# the video's own families (Archivo, IBM Plex Mono, Cormorant), which the Chinese faces stand behind.
# Rerun after changing any Chinese text:
#   uv run --no-project --with fonttools python make_fonts_zh.py [--gb2312] [NotoSansSC[wght].ttf] [NotoSerifSC[wght].ttf]
# (defaults: the copies Windows 11 ships in C:\Windows\Fonts; Google Fonts has the same files)
# --gb2312: also keep every GB2312 character (larger files, for work in progress: new text needs no rerun).
import io
import json
import re
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "public" / "fonts"
GB2312 = "--gb2312" in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SRC = {
    "NotoSansSC": Path(ARGS[0]) if len(ARGS) > 0 else Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf"),
    "NotoSerifSC": Path(ARGS[1]) if len(ARGS) > 1 else Path(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"),
}
WEIGHTS = {"NotoSansSC": [300, 400, 500, 700, 900], "NotoSerifSC": [400, 600]}


def strings(x):
    """Every string in a JSON document."""
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from strings(v)


def han(s):
    return any(0x3000 <= ord(c) <= 0x9FFF or 0xF900 <= ord(c) <= 0xFFEF for c in s)


LITERAL = re.compile(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`")

texts = list(strings(json.loads((ROOT / "data" / "lyrics.zh.json").read_text(encoding="utf-8"))))
for f in sorted((ROOT / "app" / "src").rglob("*.ts")):
    src = f.read_text(encoding="utf-8")
    texts += [m for m in LITERAL.findall(src) if han(m)]
chars = {c for c in "".join(texts) if ord(c) >= 0x2000}
if GB2312:
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                c = bytes([hi, lo]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            if ord(c) >= 0x2000:
                chars.add(c)
chars = sorted(chars)
print(len(chars), "characters:", "".join(chars) if not GB2312 else "(GB2312 and the video's)")

for name, src in SRC.items():
    f = TTFont(src)
    opts = Options()
    opts.name_IDs = ["*"]  # keep the copyright and license records
    opts.name_languages = ["*"]
    opts.layout_features = ["*"]
    sub = Subsetter(opts)
    sub.populate(unicodes=[ord(c) for c in chars])
    sub.subset(f)
    buf = io.BytesIO()
    f.save(buf)
    for wt in WEIGHTS[name]:
        inst = instancer.instantiateVariableFont(TTFont(io.BytesIO(buf.getvalue())), {"wght": wt}, updateFontNames=False)
        out = OUT / f"{name}-{wt}.ttf"
        inst.save(out)
        print(out.name, out.stat().st_size // 1024, "KB")
