"""python -m engine ingest|summary|rebuild|check [--db PATH] [--public DIR] [--sources FILE] [--ref REF] [--journal FILE]"""
import argparse,json
from pathlib import Path
from engine.store import connect,ingest_snapshot,summary
from engine.persist import check,rebuild
ROOT=Path(__file__).resolve().parent.parent
ap=argparse.ArgumentParser(prog='python -m engine')
ap.add_argument('command',choices=('ingest','summary','rebuild','check'))
ap.add_argument('--db',default=str(ROOT/'state'/'engine.sqlite3'),help='store path; state/ is git-ignored')
ap.add_argument('--public',default=str(ROOT/'public'),help='collector output directory to read')
ap.add_argument('--sources',default=str(ROOT/'sources.json'),help='collector source list, for provider metadata')
ap.add_argument('--ref',default='HEAD',help='rebuild: replay snapshots committed up to this ref')
ap.add_argument('--journal',default=str(ROOT/'data'/'posting-events.jsonl'),help='rebuild: committed expiry evidence')
args=ap.parse_args()
conn=connect(args.db)
if args.command=='ingest':
    sources=json.loads(Path(args.sources).read_text(encoding='utf-8')) if Path(args.sources).exists() else []
    out=ingest_snapshot(conn,args.public,sources)
    print(json.dumps({'attempted_at':out['attempted_at'],'warnings':out['warnings'],
                      'sources':[{k:v for k,v in s.items() if v} for s in out['sources']]},indent=1))
if args.command=='rebuild':
    sources=json.loads(Path(args.sources).read_text(encoding='utf-8')) if Path(args.sources).exists() else []
    print(json.dumps(rebuild(conn,ROOT,sources,args.ref,args.journal if Path(args.journal).exists() else None),indent=1))
if args.command=='check':
    result=check(conn)
    print(json.dumps({'integrity':result},indent=1))
    raise SystemExit(0 if result==['ok'] else 1)
print(json.dumps(summary(conn),indent=1))
