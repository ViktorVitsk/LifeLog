# LifeLog implementation plan

Living document. A stage is not done just because files exist — behaviour checks must pass.

**Updated:** 2026-09-19  
**Branch:** `main`

## Status

| Stage | Status | Notes |
|---|---|---|
| A1 Proposal vs persist | checked (unit) | Model cannot persist; app sets confirmation |
| A2 Context envelope | checked (unit) | Envelope + unique decrypt budget + compact audit |
| A3 KEK verifier | implemented, not UI-run | Local verifier; JWT refresh is not a key check |
| A4 Account isolation | implemented, not UI-run | `owner_user_id`, orphans, query keys |
| A5 Privacy wording | done | README, ARCHITECTURE, banners |
| B1 Sync contract | checked (unit + live API) | Per-item created/duplicate/conflict/rejected |
| B2 Delete / undo | checked (unit + live API) | Version, soft-delete, queued undo, no GET resurrection |
| B3 Timezone / calendar day | checked (unit + live API) | IANA zone, event vs input time, sleep = wake day |
| B4 Aggregation | checked (unit + live API) | Catalog, SUM vs AVG, n/coverage, chosen pairs + lag |
| B5 Schema / export | checked (unit + live API) | CHECK 1–10, habit index, paged export + decrypt report |
| C Goals / memory / actions | checked (unit + live API) | Encrypted goals/memory/actions, owner-checked links |
| D Chat modes | not started | Next |

## Environment (this session)

- Permission granted: Compose Postgres, Alembic on this volume, `.env` for stack config, synthetic QA users, host tests, Cursor browser on `:5173`.
- `docker compose up --build` **failed**: Docker Desktop does not share `/media/dev/SSD/...` for bind mounts. `postgres` alone starts (named volume only).
- Host stack used instead: Postgres `:5433`, uvicorn `:8001`. Alembic `0001`–`0008` applied on this test volume.
- Frontend Vite did not start: `frontend/node_modules` is `root:root` and contains only Windows Rollup binaries. `sudo` needs a password; bind-mount frontend is blocked by Docker file sharing.
- To unblock UI: add `/media/dev/SSD` (or the project path) in Docker Desktop → File Sharing, **or** `sudo chown -R "$USER:$USER" frontend/node_modules && cd frontend && npm install`.
- No OpenRouter/Ollama calls. No `down -v`. Commits allowed after each stage; no push.

## Confirmed defects (code, 2026-09-19)

- A1–A5: see earlier notes (persist policy, envelope, KEK, owner, wording).
- B1 (fixed): client marked the whole POST batch `synced`; server `saved` listed only new inserts (`ON CONFLICT DO NOTHING`); one FK/validation error 400’d the batch; `skill_id` / `habit_id` / `context_id` were not checked for owner.
- B2 (fixed): Undo only deleted Dexie; server row and GET cache could restore it.
- B3 (fixed): analytics used UTC `date_trunc`; «вчера вечером» could bind to `now()`; sleep day was not defined as wake day.

## Decisions

1. Persist happens only after Save (entry card or manual form). Model `auto_commit` / `user_confirmed` are ignored. Client `auto_save_enabled` is reserved, default false, no UI.
2. Score scale for persist is **1–10** (matches API). Out-of-range values are errors, not clamped. Missing stays missing. `habit_completed` missing is not `true`.
3. `source_turn_id` is the user message id. Save creates a separate `confirmation_event_id`.
4. Context limits are enforced in one envelope per `runAgent`. Diary plaintext is data, never a permission switch.
5. JWT refresh is not a KEK check. Verifier or an existing ciphertext must unwrap. Unverified KEK cannot enqueue.
6. Local rows without `owner_user_id` are orphans — never auto-attached. Attach only after current KEK unwraps them and the user confirms.
7. Alembic `0004` is applied on the Compose test volume. `GET /api/auth/me` still works if columns are missing (raw SQL + fallback).
8. User SQLAlchemy model maps `timezone` and KEK verifier columns. Schema on this volume is `0006`.
9. **B1:** HTTP 200 + per-item `results[]`. Client marks `synced` only for `created` | `duplicate`. `conflict` / `rejected` become local `rejected` and are not retried. One bad row does not fail siblings. Logs are counts + reason codes, never ciphertext. Catalog create stays owner-scoped; entry FKs must belong to the current user.
10. **B2:** `entries.version` + `deleted_at`. Undo writes `pending_delete` (tombstone), not a local-only wipe. GET/analytics/export skip soft-deleted rows. Delete retry of an already-deleted or missing id is `deleted` (idempotent). Stale version on a live row is `conflict`. A create that lands after local undo is not marked `synced`. No event sourcing.
11. **B3:** Instants stay UTC. Account `users.timezone` is IANA. Entries store `recorded_at` (input) and `event_timezone` (snapshot so a later trip does not rewrite old days). Calendar day is the civil date in `event_timezone` or the account zone. SLEEP `timestamp` is wake/end; the night belongs to that local day, not bedtime. «Вчера вечером» is 20:00 yesterday in the account zone. Fingerprint for idempotency does not include `recorded_at` / `event_timezone` (retry without them is still `duplicate`).
12. **B4:** Each open metric has scale, unit, range, aggregation, required filters, and missing=`skip`. Session minutes are summed per day; mood is averaged with `n`. `habit_value` / `habit_completed` require `habit_id` so habits are not mixed. Trends/correlations return period, observations, day coverage. Comparisons are user-chosen pairs plus an optional lag. Joint n < 3 is `insufficient` with empty points — not a hidden correlation. No nightly rollups.
13. **B5:** Scores are 1–10 in UI, API, and CHECK constraints. Alembic `0007` refuses to apply if existing rows are out of range — it does not clamp. Partial indexes `(user_id, habit_id, timestamp)` and `(user_id, skill_id, timestamp)` cover habit/skill history. Metadata export is a page with `next_offset` / `total`. Full export walks every list page and writes `report.decrypt_errors`.
14. **C:** Goals, memory items, planned actions, and feedback are separate encrypted tables. Links are explicit and owner-checked. `GOAL_UPDATE` may set `entries.goal_id`. Accepting memory is user agreement with the wording, not proof. The model profile is assembled from accepted items and is rebuildable. Feedback uses `outcome_kind`, not a single 1–5 score.

## Future split of auth vs encryption (A5)

Today the same master password is sent to `/api/auth/login` (bcrypt) and used locally for PBKDF2 → KEK. A compromised API can see the password at login time and could derive the KEK using `password_salt`. Storage encryption still hides diary text from a stolen database *without* the password, but it is **not** “the server can never read the diary.”

Later (not this stage): a separate encryption secret that never leaves the device; login password only mints JWT; no mass re-encrypt until a migration is designed. Do not invent a custom PAKE here.

Empty-account bootstrap still trusts the just-accepted login password to create the first verifier. Unlock after refresh never bootstraps.

## Checks that passed

Frontend:

```
cd frontend && npx tsc --noEmit
npm test
```

31 tests, 0 failed (previous + C memory profile).

Backend unit:

```
cd backend && uv run pytest tests/test_sync_contract.py tests/test_calendar_days.py tests/test_metrics.py tests/test_schema_guard.py
```

27 passed.

Live API (host uvicorn + Compose Postgres):

```
LIFELOG_LIVE_API=1 uv run pytest tests/test_sync_api_live.py tests/test_calendar_live.py
```

- B1/B2: mixed batch, identical retry → `duplicate`, different ciphertext → `conflict`, delete → gone from GET, delete retry → `deleted`.
- B3 (`qa_b3_*`): invalid IANA rejected; register/PUT timezone; 22:00Z in `Europe/Moscow` buckets as `2026-09-19` on `/trends`, not `2026-09-18`.
- B4 (`qa_b4_*`): catalog lists SUM vs AVG; `habit_value` without `habit_id` → 400; two mood scores average to 7 with n=2; two sessions sum to 30; one joint pair with lag=1 is `insufficient`.
- B5 (`qa_b5_*`): export page limit=2 returns `next_offset=2`; second page finishes; ciphertext is absent. Alembic `0007` applied (pre-check found 0 incompatible rows).
- C (`qa_c_*`): foreign habit on a goal is `unknown_habit`; create goal → propose memory → accept (`updated`) → reject unknown goal → accept action → `tried_no_effect` feedback; other account sees empty bundle.

Alembic on this test volume: `0001`–`0008`.

Not run: Cursor browser UI, OpenRouter/Ollama, `docker compose` backend/frontend with bind mounts.

## Remaining limits

- Browser / Docker UI flows were not run (file sharing + root `node_modules`).
- Undo UI was not clicked in a browser; behaviour is covered by unit + live API.
- Charts under `today` policy still use the 7d open-metrics API enum (no 1-day period).
- Old LLM settings row `id=default` is not auto-attached; re-save agent settings per account.
- Chat modes (D) are out of this pass.

## Next

D: Record / Analyze / Review modes, tool allowlists, free text without forced scales, deterministic review briefing, cite-only real ids, action review reminder.
