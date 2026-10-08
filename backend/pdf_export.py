"""Readable, vector, paginated hierarchy export independent of canvas zoom."""
import io
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, LETTER, landscape
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def wrap(text, font, size, width):
    lines, line = [], ""
    for word in text.split():
        proposed = (line + " " + word).strip()
        if pdfmetrics.stringWidth(proposed, font, size) <= width:
            line = proposed
            continue
        if line:
            lines.append(line)
        line = ""
        for char in word:
            if line and pdfmetrics.stringWidth(line + char, font, size) > width:
                lines.append(line)
                line = ""
            line += char
    if line:
        lines.append(line)
    return lines or [""]


def make_pdf(data, uploads, paper="a4", orientation="portrait", scope="full"):
    # Use a Unicode font when available; fonts are embedded in the PDF.
    regular, bold = "Helvetica", "Helvetica-Bold"
    font_paths = [(Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
                  (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))]
    for normal, heavy in font_paths:
        if normal.exists() and heavy.exists():
            if "OrgRegular" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("OrgRegular", str(normal)))
                pdfmetrics.registerFont(TTFont("OrgBold", str(heavy)))
            regular, bold = "OrgRegular", "OrgBold"
            break
    size = A4 if paper == "a4" else LETTER
    if orientation == "landscape":
        size = landscape(size)
    width, height = size
    margin, card_h, gap = 36, 76, 16
    people = {e["id"]: e for e in data["nodes"]}
    kids, parent = {}, {}
    for edge in data["edges"]:
        kids.setdefault(edge["source"], []).append(edge["target"])
        parent[edge["target"]] = edge["source"]
    rows, visited = [], set()
    def walk(id, depth):
        if id in visited:
            return
        visited.add(id)
        rows.append((people[id], depth))
        for child in kids.get(id, []):
            walk(child, depth + 1)
    for id in people:
        if id not in parent:
            walk(id, 0)
    for id in people:
        if id not in visited:
            walk(id, 0)
    # Wrap all labels instead of silently clipping long names or roles.
    prepared = []
    for e, depth in rows:
        x = margin + min(depth, 6) * 22
        card_w = width - margin - x
        has_photo = bool(e.get("photo_path") and Path(e["photo_path"]).name == e["photo_path"] and (uploads / e["photo_path"]).is_file())
        text_w = card_w - 28 - (42 if has_photo else 0)
        names = wrap(e["name"], bold, 11, text_w)
        roles = wrap(e["designation"] or "Team member", regular, 9, text_w)
        manager = people.get(parent.get(e["id"]))
        label = "Reports to: " + manager["name"] if manager else "Manager outside this view" if e.get("reports_to_id") else "Top of hierarchy"
        if e.get("is_board_member"):
            label += " | Board member"
        labels = wrap(label, regular, 8, card_w - 28)
        row_h = max(card_h, 26 + len(names) * 13 + len(roles) * 11 + len(labels) * 10)
        prepared.append((e, depth, names, roles, labels, row_h))
    chunks, chunk, used = [], [], 0
    for row in prepared:
        if chunk and used + row[-1] + gap > height - 180:
            chunks.append(chunk)
            chunk, used = [], 0
        chunk.append(row)
        used += row[-1] + gap
    if chunk:
        chunks.append(chunk)
    pages = len(chunks)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=size)
    pdf.setTitle(data["company"]["company_name"] + " - Organization Chart")
    pdf.setAuthor(data["company"]["company_name"])
    for page in range(pages):
        pdf.setFillColorRGB(.10, .17, .25)
        title_x = margin
        logo = data["company"].get("logo_path")
        if logo and Path(logo).name == logo and (uploads / logo).is_file():
            try:
                pdf.drawImage(ImageReader(str(uploads / logo)), margin, height - 70, 36, 36, preserveAspectRatio=True, mask="auto")
                title_x += 48
            except (OSError, ValueError):
                pass
        title_size = 16
        titles = wrap(data["company"]["company_name"], bold, title_size, width - margin - title_x)
        while len(titles) > 3 and title_size > 9:
            title_size -= 1
            titles = wrap(data["company"]["company_name"], bold, title_size, width - margin - title_x)
        pdf.setFont(bold, title_size)
        for line, text in enumerate(titles):
            pdf.drawString(title_x, height - 36 - line * (title_size + 2), text)
        pdf.setFont(regular, 10)
        pdf.setFillColorRGB(.32, .39, .47)
        pdf.drawString(margin, height - 92, f"Organization chart | {'Full organization' if scope == 'full' else 'Currently displayed people'} | {len(rows)} people")
        board = ", ".join(e["name"] for e in data["board"])
        if board:
            lines = simpleSplit("Board: " + board, regular, 9, width - margin * 2)
            for line, text in enumerate(lines[:2]):
                pdf.drawString(margin, height - 108 - line * 12, text)
        chunk = chunks[page]
        positions = {}
        offset = 0
        for e, depth, name_lines, role_lines, label_lines, card_h in chunk:
            x = margin + min(depth, 6) * 22
            y = height - 146 - offset - card_h
            offset += card_h + gap
            card_w = width - margin - x
            pdf.setStrokeColorRGB(.76, .82, .88)
            pdf.setFillColorRGB(.97, .98, 1)
            pdf.roundRect(x, y, card_w, card_h, 8, fill=1, stroke=1)
            manager = people.get(parent.get(e["id"]))
            if manager and manager["id"] in positions:
                px, py = positions[manager["id"]]
                rail = px - 10
                pdf.setStrokeColorRGB(.60, .69, .78)
                path = pdf.beginPath()
                path.moveTo(px, py)
                path.lineTo(rail, py)
                path.lineTo(rail, y + card_h / 2)
                path.lineTo(x, y + card_h / 2)
                pdf.drawPath(path)
            positions[e["id"]] = (x, y + card_h / 2)
            tx = x + 14
            photo = e.get("photo_path")
            if photo and Path(photo).name == photo and (uploads / photo).is_file():
                try:
                    pdf.drawImage(str(uploads / photo), tx, y + 27, 32, 32, preserveAspectRatio=True, mask="auto")
                    tx += 42
                except (OSError, ValueError):
                    pass
            pdf.setFillColorRGB(.10, .17, .25)
            pdf.setFont(bold, 11)
            text_y = y + card_h - 18
            for text in name_lines:
                pdf.drawString(tx, text_y, text)
                text_y -= 13
            pdf.setFont(regular, 9)
            pdf.setFillColorRGB(.32, .39, .47)
            text_y -= 4
            for text in role_lines:
                pdf.drawString(tx, text_y, text)
                text_y -= 11
            pdf.setFont(regular, 8)
            text_y -= 5
            for text in label_lines:
                pdf.drawString(x + 14, text_y, text)
                text_y -= 10
        pdf.setFont(regular, 8)
        pdf.setFillColorRGB(.32, .39, .47)
        pdf.drawString(margin, 25, "Indentation and connecting lines show reporting relationships.")
        pdf.drawRightString(width - margin, 25, f"Page {page + 1} of {pages}")
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def make_chart_pdf(data, uploads, paper, orientation, scope, mode, positions):
    """Vector diagram using the same layout coordinates as the interactive chart."""
    import math
    from reportlab.lib.colors import HexColor
    regular, bold = "Helvetica", "Helvetica-Bold"
    for normal, heavy in [(Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
                           (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))]:
        if normal.exists() and heavy.exists():
            if "OrgRegular" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("OrgRegular", str(normal)))
                pdfmetrics.registerFont(TTFont("OrgBold", str(heavy)))
            regular, bold = "OrgRegular", "OrgBold"
            break
    people = {str(e["id"]): e for e in data["nodes"]}
    card_h = 160 if mode == "radial" else 76 if mode == "tree" else 100
    boxes = {key: (p["x"], p["y"], 156 if mode == "radial" else 240, card_h) for key, p in positions.items() if key in people}
    if "group" in positions:
        loose_keys = [k for k in boxes if k not in {str(e["source"]) for e in data["edges"]} | {str(e["target"]) for e in data["edges"]}]
        gx, gy = positions["group"]["x"], positions["group"]["y"]
        boxes["group"] = (gx, gy, max([boxes[k][0] + 240 - gx for k in loose_keys] or [240]), 44)
    if mode == "radial":
        p = positions["company"]
        boxes["company"] = (p["x"], p["y"], 144, 144)
    elif data["board"]:
        p = positions["board"]
        boxes["board"] = (p["x"], p["y"], 240, 44 + 68 * len(data["board"]))
    left = min(b[0] for b in boxes.values()) - 36
    top = min(b[1] for b in boxes.values()) - 36
    right = max(b[0] + b[2] for b in boxes.values()) + 36
    bottom = max(b[1] + b[3] for b in boxes.values()) + 36
    chart_w, chart_h = right - left, bottom - top
    if paper == "chart":
        scale = min(1, 14000 / max(chart_w, chart_h))
        width, height = chart_w * scale + 72, chart_h * scale + 116
    else:
        width, height = landscape(A4 if paper == "a4" else LETTER) if orientation == "landscape" else (A4 if paper == "a4" else LETTER)
        scale = min((width - 72) / chart_w, (height - 116) / chart_h)
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(width, height))
    c.setTitle(f'{data["company"]["company_name"]} - {mode.title()} organization chart')
    c.setAuthor(data["company"]["company_name"])
    def text(value, x, y, w, font=regular, size=12, color="#24364b", center=False, max_lines=2):
        # Shrink long labels to keep their complete text within the node.
        lines = wrap(value, font, size, w)
        while len(lines) > max_lines and size > 1:
            size -= .5
            lines = wrap(value, font, size, w)
        c.setFillColor(HexColor(color))
        c.setFont(font, size)
        for i, line in enumerate(lines):
            if center:
                c.drawCentredString(x + w / 2, y - i * size * 1.25, line)
            else:
                c.drawString(x, y - i * size * 1.25, line)
    logo = uploads / Path(data["company"].get("logo_path") or "missing").name
    tx = 36
    if logo.is_file():
        try:
            c.drawImage(ImageReader(str(logo)), 36, height - 60, 40, 40, preserveAspectRatio=True, anchor="sw", mask="auto")
            tx = 86
        except Exception:
            pass
    text(data["company"]["company_name"], tx, height - 32, width - tx - 36, bold, 16)
    text(f'{mode.title()} layout | {"Full organization" if scope == "full" else "Currently displayed people"} | {len(people)} people', 36, height - 64, width - 72, size=10)
    text('Reporting lines' + (' | Dashed lines connect the company to leaders' if mode == 'radial' else ''), 36, 22, width - 72, size=9, color="#526479")
    c.saveState()
    c.translate(36 + (width - 72 - chart_w * scale) / 2, height - 84)
    c.scale(scale, scale)
    def xy(x, y):
        return x - left, top - y
    def rect(x, y, w, h, fill, border=None, radius=8):
        px, py = xy(x, y + h)
        c.setFillColor(HexColor(fill))
        c.setStrokeColor(HexColor(border or fill))
        c.roundRect(px, py, w, h, radius, fill=1, stroke=bool(border))
    def avatar(e, x, y, diameter):
        px, py = xy(x + diameter / 2, y + diameter / 2)
        c.setFillColor(HexColor("#eaf2fb"))
        c.setStrokeColor(HexColor("#ffffff"))
        c.circle(px, py, diameter / 2, fill=1, stroke=1)
        image = uploads / Path(e.get("photo_path") or "missing").name
        if image.is_file():
            try:
                c.saveState()
                p = c.beginPath(); p.circle(px, py, diameter / 2 - 2); c.clipPath(p, stroke=0)
                # Crop to a square like CSS object-fit: cover.
                from PIL import Image, ImageOps
                with Image.open(image) as source:
                    cropped = ImageOps.fit(source.convert("RGB"), (300, 300))
                    c.drawImage(ImageReader(cropped), px - diameter / 2, py - diameter / 2, diameter, diameter)
                c.restoreState()
                return
            except (OSError, ValueError):
                c.restoreState()
        initials = ''.join(word[0] for word in e['name'].split()[:2]).upper()
        text(initials, px - diameter / 2, py - diameter * .12, diameter, bold, diameter / 2.5, "#346291", True)
    def line(points, dashed=False):
        c.setStrokeColor(HexColor("#a9b2bb" if mode == "radial" else "#a6b8c9"))
        c.setLineWidth(1 if mode == "radial" else 1.5)
        c.setDash([5, 5] if dashed else [])
        p = c.beginPath(); p.moveTo(*xy(*points[0]))
        for point in points[1:]: p.lineTo(*xy(*point))
        c.drawPath(p)
        c.setDash([])
    def radial_line(a, b, company=False):
        ax, ay = a[0] + a[2]/2, a[1] + (72 if company else 40)
        bx, by = b[0] + b[2]/2, b[1] + 40
        dx, dy = bx-ax, by-ay; length = math.hypot(dx, dy) or 1
        r = 72 if company else 42
        line([(ax+dx/length*r, ay+dy/length*r), (bx-dx/length*42, by-dy/length*42)], company)
    for edge in data['edges']:
        a, b = boxes[str(edge['source'])], boxes[str(edge['target'])]
        if mode == 'radial': radial_line(a, b)
        elif mode == 'compact':
            line([(a[0], a[1]+50), (a[0]-24, a[1]+50), (a[0]-24, b[1]+50), (b[0], b[1]+50)])
        else:
            if positions[str(edge['target'])].get('stacked'):
                line([(a[0]+12, a[1]+card_h), (a[0]+12, b[1]+card_h/2), (b[0], b[1]+card_h/2)])
                continue
            middle = (a[1]+card_h+b[1])/2
            line([(a[0]+120, a[1]+card_h), (a[0]+120, middle), (b[0]+120, middle), (b[0]+120, b[1])])
    if mode == 'radial':
        managed = {str(e['target']) for e in data['edges']}
        for key in people:
            if key not in managed: radial_line(boxes['company'], boxes[key], True)
        x,y,w,h = boxes['company']; px,py = xy(x+72,y+72)
        c.setFillColor(HexColor('#285e96')); c.circle(px,py,72,fill=1,stroke=0)
        logo = uploads / Path(data['company'].get('logo_path') or 'missing').name
        if logo.is_file():
            c.drawImage(str(logo), px-44, py-32, 88, 64, preserveAspectRatio=True, anchor='c', mask='auto')
        else: text(data['company']['company_name'], px-55, py+12,110,bold,13,'#ffffff',True,3)
        text('Our organization',px-60,py-47,120,size=9,color='#ffffff',center=True)
    for key, e in people.items():
        x,y,w,h = boxes[key]
        if mode == 'radial':
            depth = positions[key]['depth']; fill = '#285e96' if depth == 0 else '#347bc5' if depth == 1 else '#eaf3fc'
            ink = '#284f76' if depth >= 2 else '#ffffff'
            avatar(e,x+38,y,80)
            rect(x,y+84,156,58,fill,radius=4)
            px,py = xy(x+6,y+100)
            text(e['name'],px,py,144,bold,12,ink,True)
            px,py = xy(x+6,y+126)
            text(e['designation'] or 'Team member',px,py,144,regular,10,ink,True)
            if e.get('is_board_member'):
                px,py=xy(x+4,y+155); text('Board member',px,py,148,size=9,color='#526479',center=True)
        elif mode == 'tree':
            rect(x,y,240,card_h,'#ffffff','#d8e1ea',12)
            avatar(e,x+14,y+18,40)
            px,py=xy(x+64,y+30); text(e['name'],px,py,162,bold,13,max_lines=1)
            px,py=xy(x+64,y+50); text(e['designation'] or 'Team member',px,py,162,size=11,color='#526479',max_lines=1)
        else:
            rect(x,y,240,100,'#ffffff','#d8e1ea',12)
            avatar(e,x+16,y+23,44)
            px,py=xy(x+72,y+31); text(e['name'],px,py,152,bold,14)
            px,py=xy(x+72,y+64); text(e['designation'] or 'Team member',px,py,152,size=12,color='#526479')
    if 'group' in boxes:
        x,y,w,h = boxes['group']; rect(x,y,w,h,'#f1f5f9','#94a3b8',10)
        px,py = xy(x+16,y+27); text(positions['group'].get('label') or 'Not yet placed',px,py,w-32,bold,13,'#334155',max_lines=1)
    if mode != 'radial' and data['board']:
        x,y,w,h=boxes['board']; rect(x,y,w,h,'#eef3fa','#c9d7e7',12)
        px,py=xy(x+12,y+25); text('Board of Directors',px,py,216,bold,13)
        for i,e in enumerate(data['board']):
            row=y+44+i*68; avatar(e,x+12,row+8,32)
            px,py=xy(x+56,row+20); text(e['name'],px,py,172,bold,12)
            px,py=xy(x+56,row+45); text(e['designation'],px,py,172,size=10,color='#526479')
    c.restoreState(); c.showPage(); c.save()
    return out.getvalue()
