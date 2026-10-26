"""python -m engine ingest|extract|summary|show [--posting ID] [--limit N] [--db PATH] [--public DIR] [--sources FILE]"""
import argparse,json
from pathlib import Path
from engine.store import connect,extract_pending,ingest_snapshot,posting_record,summary
ROOT=Path(__file__).resolve().parent.parent
ap=argparse.ArgumentParser(prog='python -m engine')
ap.add_argument('command',choices=('ingest','extract','summary','show'))
ap.add_argument('--db',default=str(ROOT/'state'/'engine.sqlite3'),help='store path; state/ is git-ignored')
ap.add_argument('--public',default=str(ROOT/'public'),help='collector output directory to read')
ap.add_argument('--sources',default=str(ROOT/'sources.json'),help='collector source list, for provider metadata')
ap.add_argument('--posting',help='posting id for show, for example greenhouse:gitlab:123')
ap.add_argument('--limit',type=int,help='extract at most this many versions')
args=ap.parse_args()
conn=connect(args.db)
if args.command in ('ingest','extract'):  # writers take the run lock, so they never interleave with python -m engine.run
    from engine.lock import RunLock
    _lock=RunLock(args.db,'python -m engine '+args.command).__enter__()  # released when this process exits
if args.command=='show':
    if not args.posting: ap.error('show needs --posting')
    print(json.dumps(posting_record(conn,args.posting),indent=1,ensure_ascii=False))
    raise SystemExit(0)
if args.command=='ingest':
    sources=json.loads(Path(args.sources).read_text(encoding='utf-8')) if Path(args.sources).exists() else []
    out=ingest_snapshot(conn,args.public,sources)
    print(json.dumps({'attempted_at':out['attempted_at'],'warnings':out['warnings'],
                      'sources':[{k:v for k,v in s.items() if v} for s in out['sources']]},indent=1))
if args.command=='extract': print(json.dumps(extract_pending(conn,args.limit)))
print(json.dumps(summary(conn),indent=1))
