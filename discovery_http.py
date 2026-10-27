"""Portable scanner I/O. Stdlib only; API endpoints validated by registry."""
import json,re,urllib.request
from pathlib import Path
import registry

def redact(value):
    return re.sub(r"(?i)(token|key|secret|password)=[^&\s]+",r"\1=[redacted]",str(value))
def write(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2)+"\n",encoding="utf-8")
def fetch_feed(source):
    # Standalone scanner uses the same counted/robots-aware transport as market discovery.
    from market_discovery import Network
    if source["url"]!=registry.feed_url(source["provider"],source["board"]):
        raise ValueError("unapproved feed URL")
    return Network(max_requests=2).feed(source)
