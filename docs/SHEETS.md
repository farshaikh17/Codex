# Google Sheets ledger adapter (engine step 7)

Status: interface implemented and tested offline against an in-memory fake. **No live Google client exists, and nothing here has touched a real spreadsheet, a review task or a tracker.** *End-to-end tracker ingestion* is not verified. The engine is not proven end to end.

New files only: `engine/sheets.py`, `engine/tests/test_sheets.py` and this document. The decision feed gained an optional `posting` block (title, employer, canonical URL, availability) as an additive field of `decision-feed-1`.

## Pieces

- **`SheetsClient`**: the interface a live client implements. Three calls, mirroring the Sheets API:
  - `get_values(spreadsheet_id, range)` (`spreadsheets.values.get`)
  - `batch_update(spreadsheet_id, [{range, values}])` (`values.batchUpdate`)
  - `append_rows(spreadsheet_id, tab, rows)` (`values.append`)

  A live client must use `valueInputOption=RAW`. Credentials, and the choice to run against a real sheet, belong to the owner and are outside this repository.
- **`FakeSheets`**: an in-memory stand-in with crash injection (`fail_after`). It's used by the tests and by the `--fake-sheet` dry runs.
- **`plan(rows, target, entries)`**: a pure diff of feed entries against the sheet's current rows.
- **`sync(client, target, feed, journal)`**: applies one decision-feed page, with a write-ahead journal and recovery.
- **`init_headers`**: writes the engine's header cells, into an **empty** tab only.

## Private target file (`sheets-target-1`), one per candidate, outside the repository

```json
{"schema": "sheets-target-1", "candidate_id": "<candidate>", "spreadsheet_id": "<id>", "tab": "Tracker",
 "columns": {"posting_id": "Engine posting id", "feed_seq": "Engine seq", "outcome": "Outcome", "verdict": "Verdict",
             "title": "Role", "employer": "Company", "url": "Link", "blocking": "Open questions", "evidence": "Evidence"}}
```

- `columns` maps engine fields to header text in the existing sheet. `posting_id` and `feed_seq` are required.
- Optional fields: `item_id`, `state`, `gates`, `decided_by`, `decided_at`, `versions`.
- The real tracker's layout is not documented in this repository, so nothing is assumed. The owner maps the engine's columns into it, or adds them by hand.

## Write rules

1. **Only owned columns are written.** Columns are found by header text, in any order. Every other column (for example "Applied" or "Notes") is never written, cleared or reordered. Rows are never deleted or moved, and the header row is never changed. Tested with human columns in between.
2. **One sheet per candidate.** A feed whose `candidate_id` differs from the target's is refused before any read or write.
3. **Upsert by posting id, guarded by the feed sequence.** An existing row changes only when the incoming `feed_seq` is newer than the one stored in the row. Only cells whose value differs are rewritten. A replayed or older feed is a no-op. A new posting is appended once.
4. **The newest state wins, and a stale READY never stands.** When content, rules or profile change, the old item is superseded. Its row then shows `re-review pending`, with verdict and open questions cleared, until the new item is decided. If the new version is decided automatically (for example excluded), the row shows that.
5. **Refusals write nothing:**
   - a duplicate posting id already in the sheet (fix it by hand)
   - a missing engine header (the adapter never adds or renames columns)
   - an empty tab (use `init-headers`)
   - an unknown target field
   - a target, journal or fake sheet inside the repository
6. **Untrusted text stays text.** A value starting with `=`, `+`, `-` or `@` is stored with a leading apostrophe, and a live client must also use RAW input. Tested with a posting titled `=HYPERLINK(...)`.

## Safe, repeatable writes and recovery

Each sync uses a private journal (`sheets-journal-1`) with `checkpoint` (the last fully applied feed cursor), `pending` and `history`.

1. The feed page must start at the journal's checkpoint (`cursor_from == checkpoint`); otherwise it's refused with the cursor to regenerate it from. Rerunning a page already applied returns `already_applied`.
2. **Write-ahead:** the batch (cursor range and entries) is saved as `pending` *before* the sheet is touched.
3. Cell updates go in chunks of 100, then appends.
4. Only after every write succeeded does the checkpoint advance and `pending` clear.
5. **After a crash**, the next run finds `pending`. It re-reads the sheet and re-plans the same entries against it: rows already written are skipped by the sequence guard, and missing ones are written once. Only then does it advance. Tested: a crash after the cell updates but before the appends recovers to a sheet byte-identical to a clean run, with no duplicate rows.

Paging: generate the feed with `--since <checkpoint>` (step 6), sync it, and repeat while `has_more` (tested).

## Dry run (no Google access)

```
python -m engine.sheets init-headers --target T.json --fake-sheet S.json            # empty fake tab only
python -m engine.outputs decisions --out PRIVATE --candidates DIR --candidate ID --since <checkpoint>
python -m engine.sheets plan --target T.json --fake-sheet S.json --feed PRIVATE/decisions-ID.json
python -m engine.sheets sync --target T.json --fake-sheet S.json --feed PRIVATE/decisions-ID.json --journal J.json
```

Measured on the committed snapshot with the synthetic USD candidate:
- 3 items reviewed through `batch` and `submit-batch`; a rerun reported `already_submitted` for all 3.
- A 311-entry feed was applied as 311 appended rows (308 excluded automatically, 3 conditional).
- A rerun gave `already_applied`.

## Open owner decisions

- **Which outcomes belong in the real ledger.** Today every feed decision becomes a row, including automatic exclusions (308 of 311 above), which may be noise in a human tracker. A filter such as "ready and conditional only" is a small target option, once the owner says which.
- **Where the target, journal and feed live** (D3), and whether a live client runs at all, under which credentials and on which machine. Until then, only the fake is used.
- **The real tracker's column names.** The engine maps into them; it doesn't impose them.
