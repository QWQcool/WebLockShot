# -*- coding: utf-8 -*-
"""SHOWCASE.canvas.md -> 排版 HTML -> A4 PDF（Edge headless）

用途：生成一份**面向招聘展示**的项目能力文档（封面 + 数据卡 + 截图 + 实测表格），
与 `build_how_to_use_pdf.py` 同一链路，只是换了源文档与版式：

    Markdown ->(python-markdown) HTML ->(自研打印 CSS) Edge --headless --print-to-pdf -> A4 PDF

用法:
    python docs/build_showcase_pdf.py [输出PDF路径]

默认输出: 用户桌面的 `WebLockShot-Agent创意画布-能力展示.pdf`
可移植性：不含机器特定绝对路径，可用环境变量覆盖。
    WLS_SHOWCASE_OUT   输出 PDF 路径
    WLS_EDGE           Edge / Chrome 可执行文件位置
"""
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

import markdown
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))


def _default_browser() -> str:
    """按平台依次探测 Edge / Chrome 可执行文件位置（Edge 优先：CJK 字体与打印更稳）。"""
    if os.environ.get("WLS_EDGE"):
        return os.environ["WLS_EDGE"]
    candidates = [
        r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        r"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        r"C:/Program Files/Google/Chrome/Application/chrome.exe",
        r"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("microsoft-edge") or shutil.which("chrome") or "msedge"


BROWSER = _default_browser()
SRC_MD = os.path.join(HERE, "SHOWCASE.canvas.md")
OUT_HTML = os.path.join(HERE, "SHOWCASE.canvas.html")
DEFAULT_PDF = os.environ.get(
    "WLS_SHOWCASE_OUT",
    os.path.join(os.path.expanduser("~"), "Desktop", "WebLockShot-Agent创意画布-能力展示.pdf"),
)

CSS = """
@page { size: A4; margin: 14mm 13mm 14mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
html { font-size: 10.4pt; }
body {
  margin: 0;
  font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC",
               "Noto Sans CJK SC", system-ui, sans-serif;
  color: #1f2430; line-height: 1.72; background: #fff;
}

/* ---------------- 封面 ---------------- */
.cover {
  border-top: 4pt solid #4f46e5;
  padding: 9mm 0 6mm;
  margin-bottom: 7mm;
}
.cover .kicker {
  font-size: 9pt; letter-spacing: 2.4px; color: #4f46e5;
  font-weight: 700; margin-bottom: 3mm;
}
.cover h1 {
  font-size: 25pt; line-height: 1.28; font-weight: 800;
  color: #14183a; margin: 0 0 4mm; letter-spacing: .4px;
  border: none; padding: 0;
}
.cover .lead {
  font-size: 11.6pt; line-height: 1.7; color: #3f4460;
  margin: 0 0 5mm; text-align: left;
}
.cover .lead b { color: #4f46e5; }
.cover-meta {
  border-top: .7pt solid #e5e7eb; padding-top: 3.4mm;
  font-size: 9pt; color: #565b73; line-height: 1.9;
}
.cover-meta span { display: block; }
.cover-meta b { color: #1f2430; }
/* 封面主视觉 = 文档里第一个 figure。
   注意：它是 `.cover` 的**兄弟**而不是子节点——raw HTML 块内的 markdown 不会被解析，
   所以封面文字在 <div class="cover"> 里，而紧随其后的正文/数据卡/截图都是普通 markdown 块。
   首版写成 `.cover figure img` 于是完全没生效（截图仍是原始大小，被挤到第 2 页成孤立页）。 */
body > figure:first-of-type { margin: 2.6mm 0 0; }
body > figure:first-of-type img { max-height: 43mm; }
body > figure:first-of-type figcaption { font-size: 7.8pt; line-height: 1.45; }

/* ---------------- 数据卡 ---------------- */
.stats {
  display: flex; flex-wrap: wrap; gap: 2.6mm;
  margin: 4mm 0 5mm;
}
.stat {
  flex: 1 1 30%; min-width: 30%;
  border: .7pt solid #dbe1ff; border-radius: 2mm;
  background: linear-gradient(160deg, #f6f5ff, #eef2ff);
  padding: 3mm 3.4mm; text-align: center;
}
.stat b {
  display: block; font-size: 17pt; line-height: 1.2;
  color: #4f46e5; font-weight: 800;
}
.stat span { font-size: 8.6pt; color: #4b5169; }

/* ---------------- 标题 ---------------- */
h1 { font-size: 19pt; line-height: 1.35; font-weight: 700; color: #1a1f36; margin: 0 0 3mm; }
h2 {
  font-size: 14.5pt; font-weight: 700; color: #fff;
  background: linear-gradient(100deg, #4f46e5, #7c3aed);
  padding: 2.6mm 4mm; margin: 0 0 4mm; border-radius: 1.5mm;
  break-before: page; break-after: avoid;
}
h3 {
  font-size: 12.2pt; font-weight: 700; color: #3730a3;
  margin: 6mm 0 2.5mm; padding-left: 2.6mm;
  border-left: 2.4pt solid #6366f1; line-height: 1.5; break-after: avoid;
}
p { margin: 0 0 2.4mm; text-align: justify; }

/* ---------------- 列表 ---------------- */
ul, ol { margin: 0 0 2.6mm; padding-left: 5.5mm; }
li { margin-bottom: 1.2mm; }
li > ul, li > ol { margin: 1.2mm 0; }
ul { list-style: none; }
ul > li { position: relative; }
ul > li::before {
  content: ""; position: absolute; left: -4mm; top: 3.1mm;
  width: 1.6mm; height: 1.6mm; border-radius: 50%; background: #818cf8;
}
ol { list-style: decimal; }
ol > li::marker { color: #4f46e5; font-weight: 700; }

/* ---------------- 强调 / 代码 ---------------- */
strong { color: #312e81; font-weight: 700; }
em { color: #6b7280; }
code {
  font-family: Consolas, "Cascadia Mono", Menlo, monospace;
  font-size: 9pt; background: #eef2ff; color: #3730a3;
  padding: .3mm 1.2mm; border-radius: .8mm; border: .4pt solid #dbe1ff;
}
pre {
  background: #0f172a; color: #e2e8f0; border-radius: 1.5mm;
  padding: 3mm 3.5mm; margin: 3mm 0 3.5mm;
  font-size: 8.8pt; line-height: 1.6; overflow: hidden; break-inside: avoid;
}
pre code { background: none; color: inherit; padding: 0; border: none; font-size: 8.8pt; }
blockquote {
  margin: 3mm 0 4mm; padding: 2.6mm 4mm;
  background: #f5f3ff; border-left: 2.4pt solid #8b5cf6;
  color: #4c4a63; border-radius: 0 1.5mm 1.5mm 0; break-inside: avoid;
}
blockquote p { margin: 0; }

/* ---------------- 表格 ---------------- */
table {
  width: 100%; border-collapse: collapse; margin: 3mm 0 4mm;
  font-size: 8.8pt; break-inside: avoid;
}
th { background: #4f46e5; color: #fff; font-weight: 700; padding: 1.8mm 2.2mm; text-align: left; line-height: 1.5; }
td { padding: 1.6mm 2.2mm; border-bottom: .4pt solid #e5e7eb; line-height: 1.6; }
tbody tr:nth-child(even) { background: #f8f8ff; }

/* ---------------- 图片 ---------------- */
figure { margin: 3mm 0 4mm; text-align: center; break-inside: avoid; }
figure img {
  max-width: 100%; max-height: 82mm; width: auto; height: auto;
  border: .5pt solid #dcdfe6; border-radius: 1.5mm;
  box-shadow: 0 1mm 3mm rgba(31,36,48,.13);
}
figcaption { margin-top: 1.8mm; font-size: 8.4pt; color: #6b7280; line-height: 1.5; }

/* ---------------- 结语 ---------------- */
.endnote {
  margin-top: 5mm; padding: 3.4mm 4mm;
  border: .8pt solid #c7d2fe; border-left: 3pt solid #4f46e5;
  border-radius: 0 2mm 2mm 0; background: #f8faff;
  font-size: 10pt; color: #2b3050;
}
a { color: #4f46e5; }
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{title}</title><style>{css}</style></head>
<body>
{body}
</body></html>"""


def md_to_html(text: str) -> str:
    body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "attr_list", "sane_lists"],
    )
    # 图片 -> figure + figcaption（用 alt 当图注）
    def fig(m: re.Match) -> str:
        tag, alt = m.group(1), m.group(2)
        if not alt.strip():
            return f"<figure>{tag}</figure>"
        return f'<figure>{tag}<figcaption>{alt}</figcaption></figure>'

    body = re.sub(r"<p>(<img[^>]*?alt=\"([^\"]*)\"[^>]*?>)</p>", fig, body)
    body = re.sub(r"<p>(<img[^>]*>)</p>", r"<figure>\1</figure>", body)
    return body


def main() -> None:
    # Windows 控制台默认 GBK：文档里含 ✔/… 等字符会让 print 抛 UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    out_pdf = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF
    if not os.path.exists(SRC_MD):
        raise SystemExit(f"缺少源文档：{SRC_MD}")

    text = open(SRC_MD, encoding="utf-8").read()
    body = md_to_html(text)
    html = TEMPLATE.format(title="WebLockShot · Agent 创意画布 · 能力展示", css=CSS, body=body)
    open(OUT_HTML, "w", encoding="utf-8").write(html)
    print("[html] ->", OUT_HTML)

    os.makedirs(os.path.dirname(os.path.abspath(out_pdf)), exist_ok=True)
    url = "file:///" + urllib.parse.quote(os.path.abspath(OUT_HTML).replace("\\", "/"))
    r = subprocess.run(
        [BROWSER, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={os.path.abspath(out_pdf)}", url],
        capture_output=True, text=True,
    )
    print(f"[render] {os.path.basename(BROWSER)} exit={r.returncode} -> {out_pdf}")

    doc = pymupdf.open(out_pdf)
    print(f"[check] 页数 = {doc.page_count}")
    imgs = sum(len(p.get_images(full=True)) for p in doc)
    print(f"[check] 嵌入图片 {imgs} 张")
    for i, page in enumerate(doc):
        blocks = [b for b in page.get_text("blocks") if b[4].strip()]
        if not blocks:
            print(f"[check] p{i + 1}: （无文本块，可能是整页图片）")
            continue
        maxy_mm = max(b[3] for b in blocks) / 2.8346
        flag = "OK" if maxy_mm < 292 else "!! 触底"
        tail = sorted(blocks, key=lambda b: b[1])[-1][4].strip()[:38]
        print(f"[check] p{i + 1}: 底边 {maxy_mm:.1f}mm {flag} | 末尾: {tail}")
    print("[done]")


if __name__ == "__main__":
    main()
