import markdown
from weasyprint import HTML

md_file = '/mnt/user-outputs/Tutorial_Venta_Rapida.md'
pdf_file = '/mnt/user-outputs/Tutorial_Venta_Rapida.pdf'

with open(md_file, 'r') as f:
    md_content = f.read()

html_body = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

html_full = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
body {{
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
    max-width: 680px;
    margin: 0 auto;
    padding: 40px 50px;
    font-size: 14px;
}}
h1 {{
    font-size: 28px;
    font-weight: 900;
    line-height: 1.2;
    margin-top: 0;
    margin-bottom: 4px;
    color: #111;
}}
h2 {{
    font-size: 22px;
    font-weight: 900;
    margin-top: 36px;
    margin-bottom: 12px;
    color: #111;
    border-top: 2px solid #222;
    padding-top: 16px;
}}
h3 {{
    font-size: 18px;
    font-weight: 700;
    margin-top: 24px;
    margin-bottom: 8px;
    color: #111;
}}
h4 {{
    font-size: 15px;
    font-weight: 700;
    margin-top: 18px;
    margin-bottom: 6px;
    color: #222;
}}
p {{
    margin: 8px 0;
}}
strong {{
    font-weight: 700;
}}
ul, ol {{
    margin: 8px 0;
    padding-left: 24px;
}}
li {{
    margin: 4px 0;
}}
table {{
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
}}
th {{
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid #222;
    font-weight: 700;
    background: #fafafa;
}}
td {{
    padding: 10px 12px;
    border-bottom: 1px solid #e5e5e5;
    vertical-align: top;
}}
tr:last-child td {{
    border-bottom: 2px solid #222;
}}
code {{
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    background: #f5f5f5;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
}}
pre {{
    background: #f5f5f5;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.5;
}}
pre code {{
    background: none;
    padding: 0;
}}
blockquote {{
    margin: 12px 0;
    padding: 12px 16px;
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    border-radius: 0 6px 6px 0;
    color: #92400e;
}}
blockquote p {{
    margin: 4px 0;
}}
hr {{
    border: none;
    border-top: 2px solid #222;
    margin: 28px 0;
}}
em {{
    font-style: italic;
}}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

HTML(string=html_full).write_pdf(pdf_file)
print(f"PDF created: {pdf_file}")
