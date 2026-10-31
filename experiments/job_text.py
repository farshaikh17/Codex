"""Decode ATS HTML before removing tags, preserving requirement boundaries."""
import html,re

def clean_text(value):
    value=html.unescape(html.unescape(str(value or '')))
    value=re.sub(r'</(?:p|div|li|h[1-6])\s*>|<br\s*/?>','\n',value,flags=re.I)
    value=re.sub('<[^>]+>',' ',value)
    return re.sub(r'[ \t\r]+',' ',value).strip()
