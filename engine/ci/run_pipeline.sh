#!/usr/bin/env bash
# Scheduled pipeline step (also runnable locally). Private data never touches the checkout:
#   CANDIDATES_B64       base64 of a tar.gz holding the private candidate *.json (and optional *.history.json)
#   PIPELINE_PASSPHRASE  passphrase for the encrypted state (Actions cache) and results (artifact)
#   WORK_DIR             private scratch directory (default: $RUNNER_TEMP/career)
#   STATE_DIR            directory holding state.sqlite.enc between runs (default: $WORK_DIR/state-cache)
# Missing secrets: prints a notice and exits 0 without doing anything.
set -euo pipefail
umask 077
if [ -z "${CANDIDATES_B64:-}" ] || [ -z "${PIPELINE_PASSPHRASE:-}" ]; then
  echo "::notice::CANDIDATES_B64 or PIPELINE_PASSPHRASE secret not set; pipeline skipped (nothing read or written)."
  exit 0
fi
WORK_DIR="${WORK_DIR:-${RUNNER_TEMP:-/tmp}/career}"
STATE_DIR="${STATE_DIR:-$WORK_DIR/state-cache}"
BOARDS="${BOARDS:-public/boards}"
mkdir -p "$WORK_DIR/candidates" "$WORK_DIR/out" "$STATE_DIR"
printf '%s' "$CANDIDATES_B64" | base64 -d | tar -xz -C "$WORK_DIR/candidates" --no-same-owner
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PIPELINE_PASSPHRASE "$@"; }
if [ -f "$STATE_DIR/state.sqlite.enc" ]; then
  enc -d -in "$STATE_DIR/state.sqlite.enc" -out "$WORK_DIR/state.sqlite"
  echo "restored state ($(stat -c %s "$WORK_DIR/state.sqlite") bytes)"
else
  echo "no previous state: first run starts a new tracker"
fi
python -m engine.pipeline run --candidates "$WORK_DIR/candidates" --state "$WORK_DIR/state.sqlite" --out "$WORK_DIR/out" --boards "$BOARDS" ${PIPELINE_ARGS:-} > "$WORK_DIR/summary.json"
enc -in "$WORK_DIR/state.sqlite" -out "$STATE_DIR/state.sqlite.enc"
tar -czf - -C "$WORK_DIR" out | enc -out "$WORK_DIR/results.tar.gz.enc"
# Candidate-agnostic summary only (no candidate ids, titles or counts per person).
python - "$WORK_DIR/summary.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); x=d['discovery']
print('run %s outcome %s: pool %s postings, %s new, %s search requests, %s source failure(s), VERIFIED_READY total %s'%(
    d['run_id'],d['outcome'],x['pool'],x['new_postings'],x['requests'],len(x['failures']),sum(c['verified_ready'] for c in d['candidates'].values())))
PY
rm -rf "$WORK_DIR/candidates" "$WORK_DIR/out" "$WORK_DIR/state.sqlite" "$WORK_DIR/state.sqlite-wal" "$WORK_DIR/state.sqlite-shm" "$WORK_DIR/summary.json"
