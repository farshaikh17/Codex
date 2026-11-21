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
mkdir -p "$WORK_DIR" "$STATE_DIR"
private_dir=$(mktemp -d "$WORK_DIR/private.XXXXXXXX")
trap 'rm -rf -- "$private_dir"' EXIT
mkdir -p "$private_dir/candidates" "$private_dir/out"
# Archive tools and config validation can include private filenames or field values in errors.
if ! (printf '%s' "$CANDIDATES_B64" | base64 -d | tar -xz -C "$private_dir/candidates" --no-same-owner) 2>/dev/null; then
  echo "::error::Private candidate archive could not be unpacked." >&2
  exit 1
fi
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PIPELINE_PASSPHRASE "$@"; }
if [ -f "$STATE_DIR/state.sqlite.enc" ]; then
  enc -d -in "$STATE_DIR/state.sqlite.enc" -out "$private_dir/state.sqlite"
  echo "restored encrypted tracker state"
else
  echo "no previous state: first run starts a new tracker"
fi
if ! python -m engine.pipeline run --candidates "$private_dir/candidates" --state "$private_dir/state.sqlite" --out "$private_dir/out" --boards "$BOARDS" ${PIPELINE_ARGS:-} > "$private_dir/summary.json" 2>/dev/null; then
  echo "::error::Private pipeline failed. Check the candidate archive and configuration locally." >&2
  exit 1
fi
enc -in "$private_dir/state.sqlite" -out "$STATE_DIR/state.sqlite.enc"
if ! (tar -czf - -C "$private_dir" out | enc -out "$WORK_DIR/results.tar.gz.enc") 2>/dev/null; then
  echo "::error::Private results could not be packaged." >&2
  exit 1
fi
# Candidate-agnostic summary only (no candidate ids, titles or counts per person).
python - "$private_dir/summary.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); x=d['discovery']
print('run %s outcome %s: pool %s postings, %s new, %s search requests, %s source failure(s), VERIFIED_READY total %s'%(
    d['run_id'],d['outcome'],x['pool'],x['new_postings'],x['requests'],len(x['failures']),sum(c['verified_ready'] for c in d['candidates'].values())))
PY
