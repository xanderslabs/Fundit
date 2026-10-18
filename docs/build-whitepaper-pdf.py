#!/usr/bin/env python3
"""Build docs/fundit-whitepaper.pdf from docs/whitepaper.md.

Requirements: Python 3 with the `markdown` package (pip install markdown) and Google Chrome or
Chromium. Set CHROME to the browser binary if it is not in the default macOS location.

Run from the repository root:

    python3 docs/build-whitepaper-pdf.py
"""
import os
import pathlib
import subprocess
import tempfile

import markdown

DOCS = pathlib.Path(__file__).resolve().parent
SOURCE = DOCS / "whitepaper.md"
TARGET = DOCS / "fundit-whitepaper.pdf"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #101928; }
h1 { font-size: 20pt; margin: 0 0 4pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #d5dade; padding-bottom: 3pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
p, ul, ol { margin: 0 0 7pt; }
li { margin-bottom: 2pt; }
code { font-family: Menlo, Consolas, monospace; font-size: 9pt; background: #eceff1; padding: 0 2pt; border-radius: 3px; }
pre { background: #eceff1; padding: 7pt 9pt; border-radius: 6px; font-size: 8.5pt; overflow-wrap: anywhere; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 9pt; font-size: 9pt; }
th, td { border-bottom: 1px solid #d5dade; padding: 4pt 6pt; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f5f6f7; }
a { color: #c25a00; text-decoration: none; }
h2, h3 { break-after: avoid; }
tr, pre { break-inside: avoid; }
"""


def main() -> None:
    body = markdown.markdown(SOURCE.read_text(encoding="utf-8"), extensions=["tables", "fenced_code"])
    html = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fundit whitepaper</title><style>{CSS}</style></head><body>{body}</body></html>'
    with tempfile.TemporaryDirectory() as tmp:
        page = pathlib.Path(tmp) / "whitepaper.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={TARGET}", page.as_uri()],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    print(f"Wrote {TARGET}")


if __name__ == "__main__":
    main()
