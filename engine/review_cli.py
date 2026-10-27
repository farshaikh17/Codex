"""python -m engine.review_cli enqueue|claim|submit|release|status [options]

All output goes to stdout and contains candidate data: keep it private. The review database path comes from
--review-db, $JOB_ENGINE_REVIEW_DB, or <$JOB_ENGINE_CANDIDATES>/review.sqlite3, and must be outside the repository.

submit reads a JSON file:
  {"item_id": "...", "unit_decisions": {"<line id>": {"decision": "met", "evidence": "profile: ..."}},
   "findings": {"salary": {"result": "pass", "quote": "<verbatim posting text>", "reason": "...", "basis": "..."}},
   "usage": {"model": "...", "input_tokens": 0, "output_tokens": 0}}
usage is optional and stored exactly as reported.
"""
import argparse,json
from pathlib import Path
from engine import candidates as cfg
from engine import review as rq
from engine.store import connect as store_connect
ROOT=Path(__file__).resolve().parent.parent
def main(argv=None):
    ap=argparse.ArgumentParser(prog='python -m engine.review_cli')
    ap.add_argument('command',choices=('enqueue','claim','submit','release','status'))
    ap.add_argument('--candidates',help='private candidate directory (default: $%s)'%cfg.ENV)
    ap.add_argument('--review-db',help='private review database (default: $%s)'%rq.ENV)
    ap.add_argument('--db',default=str(ROOT/'state'/'engine.sqlite3'),help='shared posting store (read only)')
    ap.add_argument('--candidate',help='candidate_id for claim and status')
    ap.add_argument('--worker',help='reviewer name for claim, submit and release')
    ap.add_argument('--batch-size',type=int,default=10)
    ap.add_argument('--per-employer-cap',type=int,default=3)
    ap.add_argument('--lease-seconds',type=int,default=1800)
    ap.add_argument('--include-deferred',action='store_true')
    ap.add_argument('--file',help='submit: JSON decision file')
    ap.add_argument('--item',help='release: item id')
    ap.add_argument('--since',help='status: count READY decisions made at or after this ISO time as newly qualified')
    args=ap.parse_args(argv)
    people=cfg.load_all(args.candidates)
    if args.candidates and not args.review_db: args.review_db=str(Path(args.candidates)/'review.sqlite3')
    conn=rq.connect(args.review_db or rq.default_path())
    store=store_connect(args.db)
    if args.command=='enqueue': out=rq.enqueue(store,conn,people)
    elif args.command=='claim': out=rq.claim(store,conn,args.candidate,args.worker,args.batch_size,args.lease_seconds,args.per_employer_cap,args.include_deferred)
    elif args.command=='submit':
        d=json.loads(Path(args.file).read_text(encoding='utf-8'))
        out=rq.submit(store,conn,people,d['item_id'],args.worker,d.get('unit_decisions'),d.get('findings'),d.get('usage'))
    elif args.command=='release':
        rq.release(conn,args.item,args.worker)
        out={'released':args.item}
    else: out=[rq.status(store,conn,c,args.since) for c in sorted(people) if not args.candidate or c==args.candidate]
    print(json.dumps(out,indent=1,ensure_ascii=False))
if __name__=='__main__':
    try: main()
    except (rq.QueueError,cfg.ConfigError) as e: raise SystemExit('error: %s'%e)
