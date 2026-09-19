# LifeLog implementation plan

Living document. A stage is not done just because files exist — behaviour checks must pass.

**Updated:** 2026-09-19  
**Branch:** `main`

## Status

| Stage | Status | Notes |
|---|---|---|
| A1 Proposal vs persist | checked (unit) | Model cannot persist; app sets confirmation |
| A2 Context envelope | checked (unit) | Envelope + unique decrypt budget + compact audit |
| A3 KEK verifier | checked (unit + UI) | Unlock after reload re-derives KEK; JWT session alone is not enough |
| A4 Account isolation | checked (unit + UI) | Session `qa_ui_0919` only sees its own life + entries |
| A5 Privacy wording | done | README, ARCHITECTURE, banners |
| B1 Sync contract | checked (unit + live API) | Per-item created/duplicate/conflict/rejected |
| B2 Delete / undo | checked (unit + live API) | Version, soft-delete, queued undo, no GET resurrection |
| B3 Timezone / calendar day | checked (unit + live API + UI) | Register IANA, Settings PUT, check-in snapshot `event_timezone` |
| B4 Aggregation | checked (unit + live API + UI) | Coverage `n` / days / %, empty joint = insufficient |
| B5 Schema / export | checked (unit + live API + UI) | Sliders 1–10; paged meta + full decrypt report |
| C Goals / memory / actions | checked (unit + live API + UI) | Encrypted goal / proposed→accepted memory / action on `/insights/life` |
| D Chat modes | checked (unit + UI) | Record / Analyze / Review chips; due reminder on Today open |

## Environment (this session)

- Permission granted: Compose Postgres, Alembic on this volume, `.env` for stack config, synthetic QA users, host tests, Cursor browser on `:5173`.
- `docker compose up --build` **failed**: Docker Desktop does not share `/media/dev/SSD/...` for bind mounts. `postgres` alone starts (named volume only).
- Host stack used instead: Postgres `:5433`, uvicorn `:8001`, Vite `:5173`. Alembic `0001`–`0008` applied on this test volume.
- Frontend unblocked: `chown` + `npm install` wrote Linux Rollup; Vite `v5.4.21` serves `http://127.0.0.1:5173/`.
- Bind-mount Compose for backend/frontend still blocked (Docker Desktop file sharing).
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
15. **D:** Chat modes Record / Analyze / Review use one model and different tool allowlists. The model cannot add tools. Record allows free text without every scale and at most one question. Analyze may propose memory/actions as cards. Review gets a deterministic briefing first. Unknown UUIDs are stripped before display. Due actions show a reminder on open; no push. No invented helplines.

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

36 tests, 0 failed (previous + D modes).

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

Cursor browser (`qa_ui_0919`, `http://127.0.0.1:5173/`):

- Register stored browser IANA (`Europe/Kiev`); Settings saved `Europe/Moscow` («Пояс сохранён.»).
- After reload, JWT stays and KEK unlock is required (A3).
- Manual check-in: scores 1–10, API `event_timezone=Europe/Moscow`, dashboard shows `19 сент., 12:18`.
- Analytics: empty joint = «Мало совместных наблюдений…»; after one mood point `среднее · n=1 · дней 1/30 (3%)`.
- Export: metadata `0` pages; full report `записей 0 · чат 0 · ошибок расшифровки 0` (before the check-in).
- Life: goal decrypts, memory proposed→accepted, action + feedback chips.
- Today: chips Записать / Разобрать / Обзор; due banner «Есть 1 действие(й) к обсуждению…» after `review_at` is due. `QueryClient` `staleTime: 60s` can hide a just-updated due list until remount/reload.

Not run: OpenRouter/Ollama, `docker compose` backend/frontend with bind mounts, Undo click in the browser.

## Remaining limits

- Undo UI was not clicked in a browser; behaviour is covered by unit + live API.
- Charts under `today` policy still use the 7d open-metrics API enum (no 1-day period).
- Old LLM settings row `id=default` is not auto-attached; re-save agent settings per account.
- OpenRouter/Ollama were not called; D tool allowlists stay unit-covered.
- Due reminder on Today uses the cached `["life"]` query; a due change made outside that query is visible on the next fresh fetch (reload / 60s).

## Next

Plan A–D is implemented and UI-checked on this host stack. Optional: Docker file sharing for bind mounts, real LLM keys, undo click, `refetchOnMount: "always"` for Today life.
