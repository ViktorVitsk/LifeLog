# LifeLog

Personal Digital Twin — local-first, client-side E2EE journaling & tracking.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

---

## Phase status

| Phase | Status | What it delivers |
|---|---|---|
| 1 — Core foundation | ✅ done | Docker stack, DB schema, JWT auth, encrypted entries sync, Web Crypto module |
| 2 — Daily check-in | ✅ done | `/checkin` with dynamic forms, Dexie offline queue, SyncManager, `/dashboard` with mood trend |
| 3 — Psychology | — | EMOTIONAL_STATE (gap model), gratitude chart, `/psychology` |
| 4 — Skills & habits | — | Skill builder, SKILL_SESSION form, habit heatmap |
| 5 — Analytics & polish | — | `/api/analytics/*`, correlations, body metrics, sleep, JSON export |

### Phase 2 details

- **Routing**: `react-router-dom` with protected routes. `/login` → `/checkin` (primary) and `/dashboard`.
- **Auth**: `AuthContext` mirrors `{ token, username, salt }` to `sessionStorage` and keeps the KEK strictly in memory. After a same-tab refresh the token and salt are restored, but the KEK is gone — a modal (`UnlockOverlay`) asks for the master password so the KEK can be re-derived locally (no network round-trip). Wrong-password attempts are caught by unwrapping an existing entry's DEK.
- **Offline queue**: Dexie IndexedDB table `entries` with `status: pending | synced | error`. Every submission is encrypted client-side, enqueued optimistically, and displayed instantly on the dashboard.
- **SyncManager** (single global instance via `SyncContext`): pushes pending rows every 30 s, on `online`, on `visibilitychange`, and on explicit `trigger()` after a form submit. Idempotent on the server (`ON CONFLICT DO NOTHING`). Network failures are caught as `NetworkError`, marked silently as "offline", and retried on the next tick; only genuine 4xx/5xx rejections flip a row into the `error` state.
- **Check-in forms** (Phase 2 subset): `DAILY_CHECKIN`, `THOUGHT`, `GRATITUDE`. Emotional / skill / habit / sleep / meal forms come in later phases.
- **Dashboard**: today widgets (mood / energy / anxiety averages + entry type counts) and a 30-day line chart for mood/energy/anxiety. **All aggregation uses open numeric fields only — no content is decrypted on the dashboard.**
- **Recent entries feed**: metadata-only (timestamp, type, open scores, tags, sync source).

---

## Prerequisites

- Docker Desktop running
- Ports `5433` (Postgres), `8000` (API), `5173` (frontend dev) free on the host
  - Port `5432` is intentionally avoided because a local PostgreSQL typically uses it.

---

## Quick start

```powershell
# 1. Copy env template
Copy-Item .env.example .env

# 2. Build and run everything
docker compose up --build

# Then open:
#   Backend API docs : http://localhost:8000/docs
#   Frontend         : http://localhost:5173
```

First startup: Alembic runs `upgrade head` automatically before uvicorn boots
(the backend container's command chains them together).

---

## Phase 2 acceptance (DoD)

On `http://localhost:5173`:

1. On `/login` register a user (≥ 8-char password), then log in — you're redirected to `/checkin`.
2. Fill **Daily** check-in (mood/energy/anxiety/focus/social/stress + notes) and save. A green toast confirms it's encrypted and queued.
3. Switch to **Thought** tab, write a short thought with tags, save.
4. Switch to **Gratitude** tab, enter three items, save.
5. Open `/dashboard`:
   - Today widgets show non-`—` values for mood/energy/anxiety and an entry count.
   - The 30-day line chart renders a point for today.
   - Recent activity feed shows all three entries with `synced` badges (after sync tick).
6. Disconnect network → page keeps working (the top-right badge turns into `offline`, dashboard shows a soft grey info banner). Submit another entry → it appears immediately with a `pending` badge. Reconnect → within 30 s it flips to `synced`.
7. Refresh the page (F5) while authenticated → an **unlock modal** appears over a faded dashboard. Type the master password → KEK is re-derived locally (verified against an existing entry) and the UI becomes interactive again. A wrong password is rejected with a clear error.

Confirm the server still sees only ciphertext:

```powershell
docker exec -it lifelog_postgres psql -U lifelog -d lifelog -c "SELECT id, entry_type, mood_score, left(encrypted_content, 40) AS ct FROM entries ORDER BY timestamp DESC LIMIT 5;"
```

`mood_score` is a plain integer, `encrypted_content` is an opaque base64 blob. No plaintext anywhere in the DB.

---

## Project layout

```
.
├── ARCHITECTURE.md            # Source of truth for the full design
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml         # uv-managed deps
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/0001_initial_schema.py
│   └── app/
│       ├── main.py
│       ├── core/              # config, database, security (JWT, bcrypt, PBKDF2 salt)
│       ├── models/            # SQLAlchemy (User, Skill, Habit, ContextTag, Entry)
│       ├── schemas/           # Pydantic (auth, entry)
│       ├── api/               # auth.py, entries.py, deps.py
│       └── enums.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx                          # Router root + providers
        ├── index.css
        ├── context/
        │   ├── AuthContext.tsx              # JWT + salt in sessionStorage; KEK memory only; unlock()
        │   └── SyncContext.tsx              # Single global SyncManager
        ├── db/
        │   └── offlineQueue.ts              # Dexie schema + enqueue / markSynced / markError
        ├── sync/
        │   └── syncManager.ts               # Interval + online/visibility-driven push loop
        ├── lib/
        │   ├── crypto.ts                    # Web Crypto API: KEK / DEK / encrypt / decrypt
        │   ├── api.ts
        │   └── entrySubmit.ts               # encrypt + enqueue helper
        ├── hooks/
        │   └── useEntries.ts                # React Query + Dexie merged feed
        ├── pages/
        │   ├── LoginPage.tsx
        │   ├── CheckinPage.tsx              # Type selector → dynamic form
        │   └── DashboardPage.tsx
        └── components/
            ├── Layout.tsx                   # Nav + SyncBadge (online/offline-aware) + Outlet
            ├── ProtectedRoute.tsx           # Shows UnlockOverlay when KEK is missing
            ├── UnlockOverlay.tsx            # Re-derive KEK after refresh
            ├── ui/Slider.tsx
            ├── checkin/
            │   ├── DailyCheckinForm.tsx
            │   ├── ThoughtForm.tsx
            │   └── GratitudeForm.tsx
            └── dashboard/
                ├── TodayWidgets.tsx
                ├── MoodTrendChart.tsx       # Recharts LineChart (30 days, daily avg)
                └── RecentEntries.tsx        # Metadata-only activity feed
```

---

## Security invariants (enforced by code, not docs)

- The server never decrypts `encrypted_content` or `encrypted_dek`.
- The backend logs entry `id`, `entry_type`, `timestamp` — never ciphertext or plaintext.
- The KEK is non-extractable and lives only in React state; on refresh the user must re-enter the password.
- DEK is generated fresh per entry (`crypto.getRandomValues` → AES-GCM 256).
- All primary keys are UUID; all timestamps are `TIMESTAMPTZ` (UTC).
- Schema changes go through Alembic; `create_all()` is never called.

---

## Running outside Docker (optional)

If you want the backend on the host instead of the container:

```powershell
# Postgres still in Docker (exposes 5433 on the host)
docker compose up postgres -d

cd backend
uv sync
$env:DATABASE_URL = "postgresql+asyncpg://lifelog:lifelog@localhost:5433/lifelog"
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

```powershell
cd frontend
npm install
npm run dev
```
