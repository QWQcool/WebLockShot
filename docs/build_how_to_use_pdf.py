# -*- coding: utf-8 -*-
"""
HOW_TO_USE.md -> 排版 HTML -> A4 PDF（Edge headless）

用法:
    python build_how_to_use_pdf.py [输出PDF路径]

默认输出: 用户桌面的 HOW_TO_USE.pdf（跨平台，可用 WLS_PDF_OUT 环境变量覆盖）

链路与同机 Resume 仓库内简历 PDF 一致：
    Markdown ->(python-markdown) HTML ->(自研打印 CSS) Edge --headless --print-to-pdf -> A4 PDF

可移植性：不含任何机器特定的绝对路径，均可用环境变量覆盖。
    WLS_PDF_OUT   输出 PDF 路径（默认 ~/Desktop/HOW_TO_USE.pdf）
    WLS_EDGE      Edge 可执行文件位置（默认按 Windows / macOS / Linux 依次探测）
"""
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

import markdown
import pymupdf


def _default_edge() -> str:
    """按平台依次探测 Edge / Chrome 可执行文件位置。"""
    if os.environ.get("WLS_EDGE"):
        return os.environ["WLS_EDGE"]
    candidates = [
        r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        r"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("microsoft-edge") or "msedge"


EDGE = _default_edge()
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_MD = os.path.join(HERE, "HOW_TO_USE.md")
OUT_HTML = os.path.join(HERE, "HOW_TO_USE.html")
DEFAULT_PDF = os.environ.get(
    "WLS_PDF_OUT",
    os.path.join(os.path.expanduser("~"), "Desktop", "HOW_TO_USE.pdf"),
)

CSS = """
@page { size: A4; margin: 15mm 13mm 15mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
html { font-size: 10.5pt; }
body {
  margin: 0;
  font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC",
               "Noto Sans CJK SC", system-ui, sans-serif;
  color: #1f2430;
  line-height: 1.75;
  background: #fff;
}

/* ---------- 封面标题块 ---------- */
.cover {
  border-bottom: 2.2pt solid #4f46e5;
  padding-bottom: 4mm;
  margin-bottom: 6mm;
}
.cover .kicker {
  font-size: 9pt; letter-spacing: 2px; color: #4f46e5;
  font-weight: 600; text-transform: uppercase; margin-bottom: 1.5mm;
}
.cover h1 { all: unset; }

/* ---------- 标题 ---------- */
h1 {
  font-size: 21pt; line-height: 1.35; font-weight: 700;
  color: #1a1f36; margin: 0 0 3mm; letter-spacing: .5px;
  break-after: avoid;
}
h2 {
  font-size: 15pt; font-weight: 700; color: #fff;
  background: linear-gradient(100deg, #4f46e5, #7c3aed);
  padding: 2.6mm 4mm; margin: 0 0 4mm; border-radius: 1.5mm;
  break-before: page; break-after: avoid;
}
h2:first-of-type { break-before: auto; } /* 目录不上分页 */
h3 {
  font-size: 12.5pt; font-weight: 700; color: #3730a3;
  margin: 6mm 0 2.5mm; padding-left: 2.6mm;
  border-left: 2.4pt solid #6366f1; line-height: 1.5;
  break-after: avoid;
}
h4 {
  font-size: 11pt; font-weight: 700; color: #312e81;
  margin: 4.5mm 0 2mm; padding-left: 2.2mm;
  border-left: 1.8pt solid #a5b4fc;
  break-after: avoid;
}
p { margin: 0 0 2.4mm; text-align: justify; }

/* ---------- 目录 ---------- */
nav.toc { padding: 2mm 0 1mm; }
nav.toc ul { list-style: none; margin: 0; padding-left: 0; }
nav.toc > ul > li { margin-bottom: 1.4mm; }
nav.toc ul ul { padding-left: 5mm; margin-top: .8mm; }
nav.toc li { line-height: 1.6; }
nav.toc a { color: #3730a3; text-decoration: none; font-weight: 600; }
nav.toc ul ul a { color: #4b5563; font-weight: 400; }

/* ---------- 列表 ---------- */
ul, ol { margin: 0 0 2.6mm; padding-left: 5.5mm; }
li { margin-bottom: 1.2mm; }
li > ul, li > ol { margin: 1.2mm 0; }
ul { list-style: none; }
ul > li { position: relative; }
ul > li::before {
  content: ""; position: absolute; left: -4mm; top: 3.2mm;
  width: 1.6mm; height: 1.6mm; border-radius: 50%; background: #818cf8;
}
nav.toc ul > li::before { display: none; }
ol { list-style: decimal; }
ol > li::marker { color: #4f46e5; font-weight: 700; }

/* ---------- 强调 / 代码 ---------- */
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
  font-size: 9pt; line-height: 1.65; overflow: hidden;
  break-inside: avoid;
}
pre code {
  background: none; color: inherit; padding: 0; border: none; font-size: 9pt;
}
blockquote {
  margin: 3mm 0 4mm; padding: 2.6mm 4mm;
  background: #f5f3ff; border-left: 2.4pt solid #8b5cf6;
  color: #4c4a63; border-radius: 0 1.5mm 1.5mm 0;
  break-inside: avoid;
}
blockquote p { margin: 0; }
hr { border: none; border-top: .6pt solid #e5e7eb; margin: 5mm 0; }

/* ---------- 表格 ---------- */
table {
  width: 100%; border-collapse: collapse; margin: 3mm 0 4mm;
  font-size: 9pt; break-inside: avoid;
}
th {
  background: #4f46e5; color: #fff; font-weight: 700;
  padding: 1.8mm 2.2mm; text-align: left; line-height: 1.5;
}
td { padding: 1.6mm 2.2mm; border-bottom: .4pt solid #e5e7eb; line-height: 1.6; }
tbody tr:nth-child(even) { background: #f8f8ff; }

/* ---------- 图片 ---------- */
figure { margin: 3mm 0 4mm; text-align: center; break-inside: avoid; }
figure img {
  max-width: 100%; max-height: 85mm; width: auto; height: auto;
  border: .5pt solid #dcdfe6; border-radius: 1.5mm;
  box-shadow: 0 1mm 3mm rgba(31,36,48,.13);
}
figcaption {
  margin-top: 1.8mm; font-size: 8.5pt; color: #6b7280; line-height: 1.5;
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
        extensions=["tables", "fenced_code", "toc", "attr_list", "sane_lists"],
        extension_configs={"toc": {"permalink": False}},
    )
    # 图片 -> figure + figcaption（用 alt 做图注）
    def fig(m: re.Match) -> str:
        tag, alt = m.group(1), m.group(2)
        if not alt.strip():
            return f"<figure>{tag}</figure>"
        return f'<figure>{tag}<figcaption>{alt}</figcaption></figure>'

    body = re.sub(r"<p>(<img[^>]*?alt=\"([^\"]*)\"[^>]*?>)</p>", fig, body)
    body = re.sub(r"<p>(<img[^>]*>)</p>", r"<figure>\1</figure>", body)
    # 目录块包一层 nav
    m = re.search(r"(<h2[^>]*>目录</h2>)(.*?)(<hr\s*/?>)", body, re.S)
    if m:
        body = (body[: m.start()] + m.group(1)
                + '<nav class="toc">' + m.group(2) + "</nav>"
                + body[m.end():])
    return body


def main() -> None:
    out_pdf = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF
    text = open(SRC_MD, encoding="utf-8").read()
    body = md_to_html(text)
    title = "WebLockShot 完整使用指南"
    html = TEMPLATE.format(title=title, css=CSS, body=body)
    open(OUT_HTML, "w", encoding="utf-8").write(html)
    print("[html] ->", OUT_HTML)

    url = "file:///" + urllib.parse.quote(os.path.abspath(OUT_HTML).replace("\\", "/"))
    r = subprocess.run([EDGE, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={os.path.abspath(out_pdf)}", url],
                       capture_output=True, text=True)
    print(f"[render] edge exit={r.returncode} -> {out_pdf}")

    doc = pymupdf.open(out_pdf)
    print(f"[check] pages = {doc.page_count}")
    imgs = sum(len(p.get_images(full=True)) for p in doc)
    print(f"[check] 嵌入图片 {imgs} 张")
    for i, page in enumerate(doc):
        blocks = [b for b in page.get_text("blocks") if b[4].strip()]
        if not blocks:
            continue
        maxy_mm = max(b[3] for b in blocks) / 2.8346
        flag = "OK" if maxy_mm < 294 else "!! 触底"
        print(f"[check] p{i+1}: 内容底边 {maxy_mm:.1f}mm  {flag} | "
              f"末尾: {sorted(blocks, key=lambda b: b[1])[-1][4].strip()[:40]}")
    print("[done]")


if __name__ == "__main__":
    main()
