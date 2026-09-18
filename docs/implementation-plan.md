# LifeLog implementation plan

Living document. A stage is not done just because files exist — behaviour checks must pass.

**Updated:** 2026-09-19  
**Branch:** `main`  
**Constraint:** no Docker Compose, no `alembic upgrade` on the working DB, no new npm/uv packages, no real diary / `.env` / live LLM calls during development.

## Status

| Stage | Status | Notes |
|---|---|---|
| A1 Proposal vs persist | checked (unit) | Model cannot persist; app sets confirmation |
| A2 Context envelope | checked (unit) | Envelope + unique decrypt budget + compact audit |
| A3 KEK verifier | implemented, not UI-run | Local verifier; JWT refresh is not a key check |
| A4 Account isolation | implemented, not UI-run | `owner_user_id`, orphans, query keys |
| A5 Privacy wording | done | README, ARCHITECTURE, banners |
| B–D | not started | After A is used on a running stack |

## Confirmed defects (code, 2026-09-19)

- A1: `auto_commit` / `commit_entries` persist with `user_confirmed: true`; catalog tools mutate without a card; Save uses assistant `msgId` as `source_turn_id`; `score()` clamps 1–10; `habit_completed ?? true`; no runtime JSON tool-arg checks.
- A2: `today` and `7d_open` unused in search; decrypt budget per call; no audit UI.
- A3: unlock with empty Dexie accepts a KEK if JWT refresh succeeds.
- A4: shared IndexedDB, no owner on the queue, React Query keys have no user id.
- A5: one password for bcrypt + PBKDF2; “E2EE / server cannot read entries” overclaims the hybrid model.

## Decisions

1. Persist happens only after Save (entry card or manual form). Model `auto_commit` / `user_confirmed` are ignored. Client `auto_save_enabled` is reserved, default false, no UI.
2. Score scale for persist is **1–10** (matches API). Out-of-range values are errors, not clamped. Missing stays missing. `habit_completed` missing is not `true`.
3. `source_turn_id` is the user message id. Save creates a separate `confirmation_event_id`.
4. Context limits are enforced in one envelope per `runAgent`. Diary plaintext is data, never a permission switch.
5. JWT refresh is not a KEK check. Verifier or an existing ciphertext must unwrap. Unverified KEK cannot enqueue.
6. Local rows without `owner_user_id` are orphans — never auto-attached. Attach only after current KEK unwraps them and the user confirms.
7. Alembic `0004` (server KEK verifier columns) is **prepared, not applied** in this session. `GET /api/auth/me` works without it (id + username). Verifier PUT degrades until 0004.
8. User SQLAlchemy model does **not** map the new columns, so login still works on the current schema.

## Future split of auth vs encryption (A5)

Today the same master password is sent to `/api/auth/login` (bcrypt) and used locally for PBKDF2 → KEK. A compromised API can see the password at login time and could derive the KEK using `password_salt`. Storage encryption still hides diary text from a stolen database *without* the password, but it is **not** “the server can never read the diary.”

Later (not this stage): a separate encryption secret that never leaves the device; login password only mints JWT; no mass re-encrypt until a migration is designed. Do not invent a custom PAKE here.

Empty-account bootstrap still trusts the just-accepted login password to create the first verifier. Unlock after refresh never bootstraps.

## Checks that passed

Command (frontend, no extra packages):

```
cd frontend && npx tsc --noEmit
node --experimental-strip-types --test src/agent/a1.behavior.test.ts src/lib/accountScope.test.ts
```

14 tests, 0 failed:

- model `user_confirmed` / `auto_commit` stripped; persist tools blocked
- «тяжёлый день» without a number → no mood
- `mood_score` 0 / 99 → error, not clamp
- missing `habit_completed` is not `true`
- confirmation event id ≠ source turn
- invalid tool JSON rejected
- `today` / `7d_open` deny decrypt; unique decrypt budget across the run
- ownerless rows are not the current user

Not run: Docker, Alembic upgrade, browser UI, OpenRouter/Ollama, working Postgres.

## Remaining limits

- Browser / Docker UI flows were not run.
- `0004` is not applied. Server verifier is best-effort; local Dexie verifier is the real A3 gate.
- Undo still only deletes the local row (B2).
- Charts under `today` policy still use the 7d open-metrics API enum (no 1-day period).
- Old LLM settings row `id=default` is not auto-attached; re-save agent settings per account.
- Nightly rollups, goals/memory (C), chat modes (D) are out of this pass.

## Next

Use the app on a disposable stack when allowed. Then B1 sync contract (do not mark a whole batch synced unless the server said so).
