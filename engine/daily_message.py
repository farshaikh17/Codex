"""Plan G1: one short daily message per person, sent to a phone after the daily discovery run.

    "Sana: 4 new jobs today · 25 best matches, 25 worth a try · https://<site>/app#sana/today"

Free channels only:
  * Telegram (bot API, free): repository secret TELEGRAM_BOT_TOKEN. Each person taps Start on the bot once and the owner runs the manual
    workflow telegram-link.yml, which stores that chat in discovery_state under "telegram:<candidate id>" (never in the repository).
    The Start link carries a per-person secret code (repository secrets TELEGRAM_LINK_CODE_SANA / TELEGRAM_LINK_CODE_FARHAN), not the name.
  * Email (optional, instead or as well): repository variable DIGEST_PROVIDER = "smtp" (any SMTP account, e.g. Gmail with an app password)
    and the secrets DIGEST_SMTP_USER, DIGEST_SMTP_PASSWORD and DIGEST_TO ("farhan_shaikh=a@example.com; sana_ansari=b@example.com").
    DIGEST_SMTP_HOST / DIGEST_SMTP_PORT (variables) default to smtp.gmail.com / 465.

With neither configured, it does nothing and says so in the run log (exit 0). It never prints a token, a chat id or an address.
Reads: two small queries. Writes: one row ("message:last_sent"), so a second run on the same day does not send again.

    python engine/daily_message.py --send [--status success|failure] [--event schedule]
    python engine/daily_message.py --link            (telegram-link.yml: read the bot's updates, store each person's chat)
"""
import argparse
import hmac
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SITE_URL = 'https://career-job-engine.farshaikh17.workers.dev'
TIERS = ('READY', 'READY_HIGH', 'STRETCH_READY')
MAX_CHATS = 3            # chats per person (the person, and e.g. the owner)
RESEND_HOURS = 12        # a second run within this many hours of the last message sends nothing
CANDIDATE_ID = re.compile(r'^[a-z0-9_-]{1,64}$')
TELEGRAM_API = 'https://api.telegram.org'


# ---------------------------------------------------------------- pure parts (tested in test_daily_message.py)

def first_name(full_name, candidate_id):
    name = (full_name or '').strip().split()
    return name[0] if name else candidate_id.split('_')[0].capitalize()


def site_link(candidate_id, site=SITE_URL):
    """The person's Today screen (plan U11 route); before that route ships the page simply opens."""
    return f"{(site or SITE_URL).rstrip('/')}/app#{candidate_id.split('_')[0]}/today"


def plural(n, one, many):
    return f'{n} {one if n == 1 else many}'


def build_message(name, counts, link, status='success'):
    """counts = {new_ready, new_stretch, ready, stretch}. One line of plain text, the same for Telegram and email.
    status: 'success' (the run finished and its health check passed), 'postponed' (the budget guard skipped a due run), anything else
    (failed, cancelled, or finished without doing its work) says the update did not finish properly."""
    c = {k: max(0, int((counts or {}).get(k) or 0)) for k in ('new_ready', 'new_stretch', 'ready', 'stretch')}
    new = c['new_ready'] + c['new_stretch']
    if status == 'postponed':
        head = f"{name}: today's update was postponed (daily database limit) and runs again in a few hours; the lists are from the last run"
    elif status != 'success':
        head = f"{name}: today's update did not finish properly; the lists may be out of date"
    elif new:
        head = f"{name}: {plural(new, 'new job', 'new jobs')} today"
    else:
        head = f"{name}: no new jobs today"
    lists = f"{plural(c['ready'], 'best match', 'best matches')}, {c['stretch']} worth a try"
    return f'{head} · {lists} · {link}'


def counts_sql(candidate_ids, now):
    """One read: per person, rows on Best matches / Worth a try, and those found or put on the list in the last 24 hours
    (the page's "New today" definition), excluding jobs the person already applied to (the page's
    NOT_APPLIED rule: the latest application record is SAVED, or there is none)."""
    ids = ', '.join("'" + c + "'" for c in candidate_ids if CANDIDATE_ID.match(c))
    since = (now - timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    new = f"(julianday(j.discovered_at) >= julianday('{since}') OR julianday(q.qualified_at) >= julianday('{since}'))"
    ready = "q.qualification_status IN ('READY', 'READY_HIGH')"
    stretch = "q.qualification_status = 'STRETCH_READY'"
    return (f"SELECT q.candidate_id AS id, c.full_name AS full_name, "
            f"SUM(CASE WHEN {ready} THEN 1 ELSE 0 END) AS ready, SUM(CASE WHEN {stretch} THEN 1 ELSE 0 END) AS stretch, "
            f"SUM(CASE WHEN {ready} AND {new} THEN 1 ELSE 0 END) AS new_ready, SUM(CASE WHEN {stretch} AND {new} THEN 1 ELSE 0 END) AS new_stretch "
            f"FROM candidate_qualifications q JOIN jobs j ON j.id = q.job_id JOIN candidates c ON c.id = q.candidate_id "
            f"WHERE q.candidate_id IN ({ids}) AND j.is_active = 1 AND q.qualification_status IN ({', '.join(repr(t) for t in TIERS)}) "
            f"AND COALESCE(q.manual_override_status, '') NOT IN ('INELIGIBLE', 'CLOSED', 'HOLD') "   # as the page's counts (worker todayCounts)
            f"AND COALESCE((SELECT a.status FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id ORDER BY a.rowid DESC LIMIT 1), 'SAVED') = 'SAVED' "
            f"GROUP BY q.candidate_id")


def chats_from_state(rows):
    """discovery_state rows {key: 'telegram:<cid>', value: '[123, 456]'} -> {cid: [chat ids]}. Bad values are ignored."""
    out = {}
    for r in rows or []:
        key = str(r.get('key') or '')
        cid = key[len('telegram:'):]
        if not key.startswith('telegram:') or not CANDIDATE_ID.match(cid):
            continue
        try:
            v = json.loads(r.get('value') or '[]')
        except ValueError:
            continue
        v = v if isinstance(v, list) else [v]
        chats = [int(x) for x in v if isinstance(x, int) or (isinstance(x, str) and re.fullmatch(r'-?\d{1,20}', x))]
        if chats:
            out[cid] = chats[:MAX_CHATS]
    return out


def email_recipients(spec, known):
    """DIGEST_TO = "farhan_shaikh=a@x.com, b@y.com; sana_ansari=c@z.com" -> {cid: [addresses]} for known people only."""
    out = {}
    for part in (spec or '').split(';'):
        if '=' not in part:
            continue
        cid, addrs = part.split('=', 1)
        cid = cid.strip()
        if cid not in known:
            continue
        good = [a.strip() for a in addrs.split(',') if re.fullmatch(r'[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+', a.strip())]
        if good:
            out[cid] = good[:MAX_CHATS]
    return out


def recently_sent(value, now, hours=RESEND_HOURS, run_ok=True):
    """value = "<ISO time> ok|failed" (or a bare time: ok). True when the last message went out within `hours` and this one adds
    nothing: a message about a good run is still sent after a recent "did not finish" one (the retried run's news)."""
    stamp, _, kind = str(value).strip().partition(' ')
    if run_ok and kind == 'failed':
        return False
    try:
        last = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    except ValueError:
        return False
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return timedelta(0) <= now - last < timedelta(hours=hours)


MIN_CODE = 12


def link_codes(env, known):
    """Gap fix (13 Nov): the per-person link codes the owner chose, from repository secrets TELEGRAM_LINK_CODE_<FIRST NAME> (e.g.
    TELEGRAM_LINK_CODE_SANA, TELEGRAM_LINK_CODE_FARHAN). A code is 12-64 letters, digits, '_' or '-' (what a Telegram start link carries);
    anything else is ignored. Returns {code: candidate id}; a code given for two people links neither."""
    out, dup = {}, set()
    for cid in sorted(known):
        code = str(env.get('TELEGRAM_LINK_CODE_' + cid.split('_')[0].upper(), '') or '').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{%d,64}' % MIN_CODE, code):
            continue
        if code in out:
            dup.add(code)
        out[code] = cid
    return {c: cid for c, cid in out.items() if c not in dup}


def link_updates(updates, codes, existing):
    """The bot's updates -> (new chats per person, chats to remove). A person links with /start <their secret link code> (the owner sends them
    https://t.me/<bot>?start=<code>, which sends exactly that) and unlinks with /stop. A name or candidate id no longer links anyone, so a stranger
    who guesses the bot cannot take a person's message (gap fix, 13 Nov). Only private chats count; at most MAX_CHATS per person; nothing is replaced."""
    add, remove = {}, set()
    for u in updates or []:
        m = (u or {}).get('message') or {}
        chat = m.get('chat') or {}
        if chat.get('type') != 'private' or not isinstance(chat.get('id'), int):
            continue
        text = str(m.get('text') or '').strip()
        if re.fullmatch(r'/stop(@\w+)?', text, re.I):
            remove.add(chat['id'])
            continue
        mt = re.fullmatch(r'/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})', text)
        if not mt:
            continue
        word = mt.group(1)
        cid = next((c for code, c in (codes or {}).items() if hmac.compare_digest(code.encode(), word.encode())), None)
        if not cid:
            continue
        add.setdefault(cid, [])
        if chat['id'] not in add[cid]:
            add[cid].append(chat['id'])
    out = {}
    for cid, chats in add.items():
        merged = [c for c in existing.get(cid, []) if c not in remove]
        for c in chats:
            if c not in merged and c not in remove and len(merged) < MAX_CHATS:
                merged.append(c)
        if merged != existing.get(cid, []):
            out[cid] = merged
    for cid, chats in existing.items():
        if cid not in out and any(c in remove for c in chats):
            out[cid] = [c for c in chats if c not in remove]
    return out


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def state_sql(key, value, now):
    return (f"INSERT OR REPLACE INTO discovery_state(key, value, updated_at) VALUES ({q(key)}, {q(value)}, "
            f"{q(now.strftime('%Y-%m-%d %H:%M:%S'))});\n")


# ---------------------------------------------------------------- side effects

def d1_read(sql):
    from engine.dataset_discovery import d1
    return d1(sql)


def d1_write(sql_text):
    """Runs one small SQL file on D1 (the workflow gives this job the Cloudflare credentials)."""
    import subprocess
    import tempfile
    dashboard = Path(__file__).resolve().parent.parent / 'dashboard'
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
        f.write(sql_text)
    try:
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'career-job-engine', '--remote', f'--file={f.name}'], cwd=dashboard,
                           capture_output=True, text=True, timeout=180)
        return r.returncode == 0
    finally:
        os.unlink(f.name)


def telegram(token, method, payload=None, timeout=20):
    """Calls the bot API. Any failure is returned as a short reason that never contains the token."""
    req = urllib.request.Request(f'{TELEGRAM_API}/bot{token}/{method}', data=json.dumps(payload or {}).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode() or '{}')
            return (body.get('result'), None) if body.get('ok') else (None, 'the bot API said no')
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}'
    except Exception as e:   # noqa: BLE001 - network errors; the message may include the URL, so only the type is shown
        return None, type(e).__name__


def send_email(cfg, to, subject, text):
    msg = EmailMessage()
    msg['From'], msg['To'], msg['Subject'] = cfg['user'], ', '.join(to), subject
    msg.set_content(text)
    try:
        with smtplib.SMTP_SSL(cfg['host'], cfg['port'], context=ssl.create_default_context(), timeout=30) as s:
            s.login(cfg['user'], cfg['password'])
            s.send_message(msg)
        return None
    except Exception as e:   # noqa: BLE001
        return type(e).__name__


def run_send(a, env, now=None):
    now = now or datetime.now(timezone.utc)
    token = env.get('TELEGRAM_BOT_TOKEN', '').strip()
    provider = env.get('DIGEST_PROVIDER', '').strip().lower()
    smtp = {'host': env.get('DIGEST_SMTP_HOST') or 'smtp.gmail.com', 'port': int(env.get('DIGEST_SMTP_PORT') or 465),
            'user': env.get('DIGEST_SMTP_USER', '').strip(), 'password': env.get('DIGEST_SMTP_PASSWORD', '')}
    use_email = provider == 'smtp' and smtp['user'] and smtp['password'] and env.get('DIGEST_TO', '').strip()
    if provider and provider != 'smtp':
        print(f'Daily message: DIGEST_PROVIDER "{provider[:20]}" is not supported (use "smtp"); email skipped')
    if not token and not use_email:
        print('Daily message: skipped - no channel is set up (repository secret TELEGRAM_BOT_TOKEN, or DIGEST_PROVIDER=smtp with its secrets). '
              'See dashboard/docs/RELEASE.md, "Daily phone message".')
        return 0
    state = d1_read("SELECT key, value FROM discovery_state WHERE key LIKE 'telegram:%' OR key = 'message:last_sent'")
    last = next((r.get('value') for r in state if r.get('key') == 'message:last_sent'), None)
    status = a.status or 'success'
    run_ok = status == 'success'
    if last and recently_sent(last, now, run_ok=run_ok) and not a.force:
        print(f'Daily message: already sent at {last} (within {RESEND_HOURS} h); nothing sent')
        return 0
    chats = chats_from_state(state) if token else {}
    known = [r['id'] for r in d1_read('SELECT id FROM candidates') if CANDIDATE_ID.match(str(r.get('id') or ''))]
    mails = email_recipients(env.get('DIGEST_TO', ''), set(known)) if use_email else {}
    people = sorted((set(chats) | set(mails)) & set(known))
    if not people:
        print('Daily message: a channel is set up but nobody is linked yet (Telegram: each person taps Start, then the owner runs '
              '"Link Telegram chats"; email: DIGEST_TO names no known person); nothing sent')
        return 0
    rows = {r['id']: r for r in d1_read(counts_sql(people, now))}
    site = env.get('SITE_URL') or SITE_URL
    sent, failed = 0, 0
    for cid in people:
        r = rows.get(cid, {})
        name = first_name(r.get('full_name'), cid)
        text = build_message(name, r, site_link(cid, site), status=status)
        for chat in chats.get(cid, []):
            _, err = telegram(token, 'sendMessage', {'chat_id': chat, 'text': text, 'disable_web_page_preview': True})
            sent, failed = (sent + 1, failed) if not err else (sent, failed + 1)
            print(f'Daily message: Telegram to {cid}: {"sent" if not err else "failed (" + err + ")"}')
        if mails.get(cid):
            err = send_email(smtp, mails[cid], text.split(' · ')[0], text)
            sent, failed = (sent + 1, failed) if not err else (sent, failed + 1)
            print(f'Daily message: email to {cid}: {"sent" if not err else "failed (" + err + ")"}')
    if sent:
        d1_write(state_sql('message:last_sent', now.strftime('%Y-%m-%dT%H:%M:%SZ') + (' ok' if run_ok else ' failed'), now))
    print(f'Daily message: {sent} sent, {failed} failed')
    return 1 if failed and not sent else 0


def run_link(env, now=None):
    now = now or datetime.now(timezone.utc)
    token = env.get('TELEGRAM_BOT_TOKEN', '').strip()
    if not token:
        print('Link Telegram chats: skipped - repository secret TELEGRAM_BOT_TOKEN is not set')
        return 0
    updates, err = telegram(token, 'getUpdates', {'allowed_updates': ['message'], 'timeout': 0})
    if err:
        print(f'Link Telegram chats: could not read the bot updates ({err})')
        return 1
    known = [r['id'] for r in d1_read('SELECT id FROM candidates') if CANDIDATE_ID.match(str(r.get('id') or ''))]
    existing = chats_from_state(d1_read("SELECT key, value FROM discovery_state WHERE key LIKE 'telegram:%'"))
    codes = link_codes(env, known)
    if not codes:
        print('Link Telegram chats: no link code is set - add repository secrets TELEGRAM_LINK_CODE_SANA / TELEGRAM_LINK_CODE_FARHAN '
              f'({MIN_CODE}-64 letters, digits, _ or -), send each person https://t.me/<bot>?start=<their code>, then run this again')
        return 0   # nothing is read or marked read, so a person's Start still counts once the codes are added
    changes = link_updates(updates, codes, existing)
    if not updates:
        print('Link Telegram chats: the bot has no new messages (Telegram keeps them for 24 hours: ask the person to tap Start again)')
    if not changes:
        print('Link Telegram chats: nothing to change')
        return 0
    sql = ''.join(state_sql(f'telegram:{cid}', json.dumps(chats), now) if chats else f"DELETE FROM discovery_state WHERE key = {q('telegram:' + cid)};\n"
                  for cid, chats in sorted(changes.items()))
    if not d1_write(sql):
        print('Link Telegram chats: the database write failed')
        return 1
    for cid, chats in sorted(changes.items()):
        print(f'Link Telegram chats: {cid} now has {len(chats)} linked chat(s)')
        for chat in chats:
            if chat not in existing.get(cid, []):
                telegram(token, 'sendMessage', {'chat_id': chat, 'text': f'Linked. You will get the daily jobs message for {first_name(None, cid)}.'})
    if updates:   # mark the updates read, so the next run starts after them
        telegram(token, 'getUpdates', {'offset': max(u.get('update_id', 0) for u in updates) + 1, 'timeout': 0})
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--send', action='store_true', help='send today\'s message to every linked person')
    ap.add_argument('--link', action='store_true', help='store the chats of people who tapped Start on the bot')
    ap.add_argument('--status', default='success', help="success | postponed | anything else (failure, cancelled, unhealthy): says the update did not finish")
    ap.add_argument('--force', action='store_true', help='send even when a message went out in the last 12 hours')
    a = ap.parse_args(argv)
    if a.link:
        return run_link(os.environ)
    if a.send:
        return run_send(a, os.environ)
    ap.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
