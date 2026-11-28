# -*- coding: utf-8 -*-
"""Convert docs/Chemistry-Gameplay-Rebuild-Report.md into a formatted .docx."""
import io
import os
import re

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

SRC = 'docs/Chemistry-Gameplay-Rebuild-Report.md'
OUT = 'docs/Bond Quest 化學玩法重建報告.docx'

md = io.open(SRC, encoding='utf-8').read().split('\n')
doc = Document()

sec = doc.sections[0]
sec.left_margin = sec.right_margin = Cm(2.0)
sec.top_margin = sec.bottom_margin = Cm(2.0)

st = doc.styles['Normal']
st.font.name = 'Calibri'
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
st.paragraph_format.space_after = Pt(4)
st.paragraph_format.line_spacing = 1.15


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hexcolor)
    tcPr.append(shd)


def add_runs(p, text, bold=False, size=None):
    for part in re.split(r'(`[^`]*`|\*\*[^*]+\*\*)', text):
        if not part:
            continue
        if part.startswith('`') and part.endswith('`') and len(part) > 2:
            r = p.add_run(part[1:-1])
            r.font.name = 'Consolas'
            r.element.rPr.rFonts.set(qn('w:eastAsia'), 'Consolas')
            r.font.size = Pt((size or 10.5) - 0.5)
            r.font.color.rgb = RGBColor(0xB0, 0x30, 0x60)
        elif part.startswith('**') and part.endswith('**') and len(part) > 4:
            r = p.add_run(part[2:-2])
            r.bold = True
            if size:
                r.font.size = Pt(size)
        else:
            r = p.add_run(part)
            r.bold = bold
            if size:
                r.font.size = Pt(size)


i = 0
n = len(md)
while i < n:
    line = md[i].rstrip()
    s = line.strip()

    if s.startswith('```'):
        i += 1
        buf = []
        while i < n and not md[i].strip().startswith('```'):
            buf.append(md[i])
            i += 1
        i += 1
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.4)
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(6)
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear')
        shd.set(qn('w:fill'), 'F3F5F7')
        p._p.get_or_add_pPr().append(shd)
        r = p.add_run('\n'.join(buf))
        r.font.name = 'Consolas'
        r.element.rPr.rFonts.set(qn('w:eastAsia'), 'Consolas')
        r.font.size = Pt(8.5)
        continue

    if s.startswith('|') and i + 1 < n and re.match(r'^\|[\s:|-]+\|$', md[i + 1].strip()):
        header = [c.strip() for c in s.strip('|').split('|')]
        i += 2
        rows = []
        while i < n and md[i].strip().startswith('|'):
            rows.append([c.strip() for c in md[i].strip().strip('|').split('|')])
            i += 1
        t = doc.add_table(rows=1, cols=len(header))
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for j, h in enumerate(header):
            cell = t.rows[0].cells[j]
            cell.text = ''
            add_runs(cell.paragraphs[0], h, bold=True, size=9)
            shade(cell, 'E8EEF3')
        for row in rows:
            cells = t.add_row().cells
            for j in range(len(header)):
                cells[j].text = ''
                add_runs(cells[j].paragraphs[0], row[j] if j < len(row) else '', size=9)
        doc.add_paragraph().paragraph_format.space_after = Pt(2)
        continue

    if not s:
        i += 1
        continue

    img = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$', s)
    if img:
        alt, rel = img.group(1), img.group(2)
        path = rel if os.path.isabs(rel) else None
        if not path:
            for cand in (rel, os.path.join('docs', rel)):
                if os.path.isfile(cand):
                    path = cand
                    break
        if os.path.isfile(path):
            # Shrink the source PNG before embedding: the originals are 1440x900
            # lossless captures (~1.5 MB each) and embedding them raw makes the
            # document ~10 MB. 1400 px wide is still above the 16 cm print width.
            embed = path
            try:
                from PIL import Image
                im = Image.open(path).convert('RGB')
                if im.width > 1400:
                    im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
                tmp = os.path.join('docs', '_tmp_' + os.path.basename(path).rsplit('.', 1)[0] + '.jpg')
                im.save(tmp, 'JPEG', quality=86, optimize=True, progressive=True)
                embed = tmp
            except Exception as exc:  # Pillow missing or an unreadable image
                print('image shrink skipped:', path, exc)
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(6)
            p.paragraph_format.space_after = Pt(2)
            p.add_run().add_picture(embed, width=Cm(16.0))
            if embed != path:
                try:
                    os.remove(embed)
                except OSError:
                    pass
            # No separate caption: the bold "圖 N — ..." line above the picture
            # already names it, and a duplicate made each figure read twice.
            p.paragraph_format.space_after = Pt(12)
        else:
            p = doc.add_paragraph()
            add_runs(p, '[缺圖] ' + rel, size=9)
        i += 1
        continue

    # Figure caption: centred, small, grey — sits under the picture it names.
    if re.match(r'^\*\*圖 \d+ — ', s):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(12)
        txt = s.replace('**', '')
        r = p.add_run(txt)
        r.italic = True
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGBColor(0x55, 0x66, 0x70)
        i += 1
        continue

    if s.startswith('# '):
        h = doc.add_heading(level=0)
        add_runs(h, s[2:], bold=True, size=20)
    elif s.startswith('## '):
        h = doc.add_heading(level=1)
        add_runs(h, s[3:], bold=True, size=15)
        h.paragraph_format.space_before = Pt(14)
    elif s.startswith('### '):
        h = doc.add_heading(level=2)
        add_runs(h, s[4:], bold=True, size=12.5)
        h.paragraph_format.space_before = Pt(10)
    elif s == '---':
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        pPr = p._p.get_or_add_pPr()
        bd = OxmlElement('w:pBdr')
        b = OxmlElement('w:bottom')
        b.set(qn('w:val'), 'single')
        b.set(qn('w:sz'), '6')
        b.set(qn('w:space'), '1')
        b.set(qn('w:color'), 'C9D3DA')
        bd.append(b)
        pPr.append(bd)
    elif s.startswith('> '):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.6)
        p.paragraph_format.space_before = Pt(2)
        add_runs(p, s[2:], size=9.5)
        for r in p.runs:
            r.font.color.rgb = RGBColor(0x44, 0x55, 0x60)
    elif re.match(r'^[-*] ', s):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_after = Pt(2)
        add_runs(p, s[2:])
    elif re.match(r'^\d+\. ', s):
        # Keep the source's own numbering: Word's list numbering would restart
        # or continue across unrelated lists, which renumbers the report.
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.85)
        p.paragraph_format.first_line_indent = Cm(-0.45)
        p.paragraph_format.space_after = Pt(2)
        add_runs(p, s)
    else:
        p = doc.add_paragraph()
        add_runs(p, s)
    i += 1

doc.save(OUT)
print('saved', OUT)
