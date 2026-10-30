"""Reproducible side-by-side trial. Baseline directory is an explicit pinned input.

Evaluation artifacts are local, public-job-only snapshots, not application ledgers.
"""
import argparse,json,shutil,subprocess,sys
from pathlib import Path
from weekend_trial import run

def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--boards',default='public/boards');p.add_argument('--new-boards');p.add_argument('--output',required=True);a=p.parse_args()
    dest=Path(a.output);dest.mkdir(parents=True,exist_ok=True)
    combined=dest/'combined-boards';combined.mkdir(exist_ok=True)
    for directory in [a.boards,a.new_boards]:
        if directory:
            for source in Path(directory).glob('*.json'):shutil.copyfile(source,combined/source.name)
    summary={}
    for candidate in ('farhan','sana'):
        baseline=dest/'baseline';baseline.mkdir(exist_ok=True)
        subprocess.run([sys.executable,str(Path(a.baseline)/'weekend_trial.py'),'--boards',str(Path(a.boards).resolve()),'--candidate',candidate,'--limit','50','--output',str(baseline.resolve())],check=True,capture_output=True)
        before=json.loads((baseline/f'{candidate}-trial.json').read_text(encoding='utf-8'))
        fixed=run(Path(a.boards),candidate,50);expanded=run(combined,candidate,50)
        for label,data in [('fixed',fixed),('expanded',expanded)]:
            (dest/f'{candidate}-{label}.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
        summary[candidate]={label:{k:data[k] for k in ['total_source_records','unique_identities','sample_size','sample_counts']+([] if label=='before' else ['all_counts','shortlist_size','shortfall','shortlist_sources','review_groups','exact_url_duplicates','unique_urls'])} for label,data in [('before',before),('fixed',fixed),('expanded',expanded)]}
    (dest/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
