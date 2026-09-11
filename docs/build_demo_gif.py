#!/usr/bin/env python3
"""把 `.tmp-gif/` 的帧序列组装成 README 顶部的演示 GIF。

输入由 `npm run demo:frames`（scripts/capture-demo-gif.mjs）采集：
  - `.tmp-gif/f-*.png`：连续帧
  - `.tmp-gif/frames.json`：每帧的**真实时间戳**（毫秒）

为什么用真实时间戳：截图本身耗时（每帧约 80–150ms），若按固定帧率写延时，动作会被
加速、与实际操作时长脱节。这里按相邻帧的真实间隔写每帧延时，播放节奏与真人操作一致。

体积控制（GIF 是逐帧位图，不优化会到十几 MB）：
  1. **相同帧合并**：相邻帧像素完全一致时合并延时，不新增帧（静态等待期几乎零成本）；
  2. **全局调色板**：所有帧共用一套自适应调色板（默认 128 色），比逐帧调色板小且无闪烁；
  3. **自动降级**：若超出 `--max-mb`，依次降采样尺寸与色数重试，直到达标。

用法：
    python docs/build_demo_gif.py                 # 默认 900px 宽 / 128 色 / ≤4MB
    python docs/build_demo_gif.py --max-mb 3 --width 800
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
FRAME_DIR = ROOT / ".tmp-gif"
OUT_PATH = ROOT / "docs" / "screenshots" / "demo.gif"

# 每帧延时上下限（GIF 以 10ms 为单位）：太快看不清、太慢像卡住。
# MAX 定得偏大是有意的：合并后的静态停留帧若被截断，GIF 总时长会明显短于真实录制时长
# （首版 400ms → 25.3s 的真实内容被压成 20.8s），观感像「快进」。
MIN_DELAY_MS = 40
MAX_DELAY_MS = 700


def load_frames() -> tuple[list[Image.Image], list[int]]:
    meta_path = FRAME_DIR / "frames.json"
    if not meta_path.exists():
        sys.exit(f"未找到 {meta_path}；请先运行：npm run demo:frames")
    meta = json.loads(meta_path.read_text(encoding="utf8"))
    entries = meta["frames"]
    if not entries:
        sys.exit("frames.json 里没有帧")

    images: list[Image.Image] = []
    delays: list[int] = []
    for i, entry in enumerate(entries):
        path = FRAME_DIR / entry["file"]
        img = Image.open(path).convert("RGB")
        # 该帧的展示时长 = 到下一帧的真实间隔（末帧沿用上一帧的间隔）
        if i + 1 < len(entries):
            delta = entries[i + 1]["t"] - entry["t"]
        else:
            delta = delays[-1] if delays else 100
        delay = max(MIN_DELAY_MS, min(MAX_DELAY_MS, int(delta)))
        images.append(img)
        delays.append(delay)
    return images, delays


def merge_identical(images: list[Image.Image], delays: list[int]) -> tuple[list[Image.Image], list[int]]:
    """相邻帧像素完全一致 → 合并延时。静态等待期在 GIF 里几乎不占体积。"""
    out_img: list[Image.Image] = [images[0]]
    out_delay: list[int] = [delays[0]]
    merged = 0
    for img, delay in zip(images[1:], delays[1:]):
        prev = out_img[-1]
        same = prev.size == img.size and ImageChops.difference(prev, img).getbbox() is None
        if same:
            out_delay[-1] = min(MAX_DELAY_MS * 4, out_delay[-1] + delay)
            merged += 1
        else:
            out_img.append(img)
            out_delay.append(delay)
    if merged:
        print(f"  · 合并完全相同的帧 {merged} 帧（静态期零成本）")
    return out_img, out_delay


def build(images: list[Image.Image], delays: list[int], width: int, colors: int) -> tuple[bytes, int]:
    ratio = width / images[0].width
    size = (width, max(2, round(images[0].height * ratio)))
    resized = [im.resize(size, Image.LANCZOS) for im in images]

    # 全局调色板：取若干等间隔帧共同求色，避免只用首帧导致后续帧色彩失真
    step = max(1, len(resized) // 8)
    sample = resized[::step][:8]
    strip = Image.new("RGB", (size[0], size[1] * len(sample)))
    for i, im in enumerate(sample):
        strip.paste(im, (0, i * size[1]))
    palette = strip.quantize(colors=colors, method=Image.MEDIANCUT)

    quantized = [im.quantize(palette=palette, dither=Image.FLOYDSTEINBERG) for im in resized]

    import io

    buf = io.BytesIO()
    quantized[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=quantized[1:],
        duration=delays,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return buf.getvalue(), len(quantized)


def main() -> None:
    # Windows 控制台默认 GBK，输出 ✔/⚠ 这类字符会抛 UnicodeEncodeError（GIF 已写盘但脚本报错）。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 —— 老版本 Python / 非标准 stdout 时忽略
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=900, help="输出宽度（等比缩放）")
    ap.add_argument("--colors", type=int, default=128, help="全局调色板色数")
    ap.add_argument("--max-mb", type=float, default=4.0, help="体积上限（MB），超出自动降级")
    args = ap.parse_args()

    print("=== 组装演示 GIF ===")
    images, delays = load_frames()
    print(f"  · 读入 {len(images)} 帧（真实时长 {sum(delays) / 1000:.1f}s）")
    images, delays = merge_identical(images, delays)

    # 自动降级：先降色数，再降尺寸
    attempts = [
        (args.width, args.colors),
        (args.width, max(64, args.colors // 2)),
        (int(args.width * 0.85), max(64, args.colors // 2)),
        (int(args.width * 0.72), 64),
    ]
    data = b""
    used = attempts[0]
    frames_used = 0
    for width, colors in attempts:
        data, frames_used = build(images, delays, width, colors)
        used = (width, colors)
        mb = len(data) / 1024 / 1024
        print(f"  · 尝试 {width}px / {colors} 色 → {mb:.2f} MB / {frames_used} 帧")
        if mb <= args.max_mb:
            break

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(data)
    mb = len(data) / 1024 / 1024
    print(f"\n  ✔ 写入 {OUT_PATH.relative_to(ROOT)}")
    print(f"    尺寸 {used[0]}px · {used[1]} 色 · {frames_used} 帧 · {mb:.2f} MB · 时长 {sum(delays) / 1000:.1f}s")
    if mb > args.max_mb:
        print(f"    ⚠ 仍超出 --max-mb {args.max_mb}（已尝试全部降级档位），如需更小请调低 --width")


if __name__ == "__main__":
    main()
