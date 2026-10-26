"""Screens open stored postings for private candidates. Read-only: writes nothing, prints to stdout.

python -m engine.screen [--candidates DIR] [--candidate ID] [--posting ID] [--db PATH]

Without --posting it prints counts per candidate; with --posting it prints the full screening record, which
contains candidate facts and must not be committed or published. Decisions are not stored here: persisting
them is the review queue's job (step 5), and the output location for candidate data is an owner decision.
"""
import argparse,json
from pathlib import Path
from engine import candidates as cfg
from engine.gates import screen
from engine.store import EXTRACTOR_VERSION,connect,posting_record
ROOT=Path(__file__).resolve().parent.parent
OPEN=('listed','inaccessible')  # missing and expired postings are not screened
def postings(conn,posting_id=None):
    sql='''select p.posting_id,p.content_hash,p.canonical_url,p.board,p.availability,v.title,v.description
           from postings p join posting_versions v using(posting_id) where v.content_hash=p.content_hash'''
    if posting_id: return conn.execute(sql+' and p.posting_id=?',(posting_id,)).fetchall()
    return conn.execute(sql+' and p.availability in (%s) order by p.posting_id'%','.join('?'*len(OPEN)),OPEN).fetchall()
def run(conn,people,posting_id=None,today=None):
    """Returns ({candidate: counts}, [records]). Records are returned only for a single posting."""
    summary,records={},[]
    rows=postings(conn,posting_id)
    for cid,person in sorted(people.items()):
        counts={'screened':0,'not_extracted':0,'verdicts':{},'blocking':{},'routing':{}}
        for row in rows:
            rec=posting_record(conn,row['posting_id'])['extraction']
            if rec is None:
                counts['not_extracted']+=1
                continue
            r=screen(person,dict(row),rec,None,today)
            counts['screened']+=1
            counts['verdicts'][r['verdict']]=counts['verdicts'].get(r['verdict'],0)+1
            counts['routing'][r['relevance']['routing']]=counts['routing'].get(r['relevance']['routing'],0)+1
            for g in r['blocking']: counts['blocking'][g]=counts['blocking'].get(g,0)+1
            if posting_id: records.append(r)
        summary[cid]=counts
    return summary,records
if __name__=='__main__':
    ap=argparse.ArgumentParser(prog='python -m engine.screen')
    ap.add_argument('--candidates',help='private candidate directory (default: $%s)'%cfg.ENV)
    ap.add_argument('--candidate',help='screen only this candidate_id')
    ap.add_argument('--posting',help='print the full record for one posting id')
    ap.add_argument('--db',default=str(ROOT/'state'/'engine.sqlite3'))
    args=ap.parse_args()
    people=cfg.load_all(args.candidates)
    if args.candidate:
        if args.candidate not in people: ap.error('unknown candidate %s'%args.candidate)
        people={args.candidate:people[args.candidate]}
    conn=connect(args.db)
    summary,records=run(conn,people,args.posting)
    print(json.dumps({'extractor_version':EXTRACTOR_VERSION,'note':'Unreviewed screening: ready requires reviewed qualifications; '
                      'conditional means unknowns remain; nothing here is stored.','candidates':summary,'records':records},indent=1,ensure_ascii=False))
