"""python -m engine ingest|summary [--db PATH] [--public DIR] [--sources FILE]"""
import argparse,json
from pathlib import Path
from engine.store import connect,ingest_snapshot,summary
ROOT=Path(__file__).resolve().parent.parent
ap=argparse.ArgumentParser(prog='python -m engine')
ap.add_argument('command',choices=('ingest','summary'))
ap.add_argument('--db',default=str(ROOT/'state'/'engine.sqlite3'),help='store path; state/ is git-ignored')
ap.add_argument('--public',default=str(ROOT/'public'),help='collector output directory to read')
ap.add_argument('--sources',default=str(ROOT/'sources.json'),help='collector source list, for provider metadata')
args=ap.parse_args()
conn=connect(args.db)
if args.command=='ingest':
    sources=json.loads(Path(args.sources).read_text(encoding='utf-8')) if Path(args.sources).exists() else []
    out=ingest_snapshot(conn,args.public,sources)
    print(json.dumps({'attempted_at':out['attempted_at'],'warnings':out['warnings'],
                      'sources':[{k:v for k,v in s.items() if v} for s in out['sources']]},indent=1))
print(json.dumps(summary(conn),indent=1))
