# LifeLog

Personal Digital Twin — local-first, client-side E2EE journaling & tracking.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

---

## Phase status

| Phase | Status | What it delivers |
|---|---|---|
| 1 — Core foundation | ✅ done | Docker stack, DB schema, JWT auth, encrypted entries sync, Web Crypto module |
| 2 — Daily check-in | ✅ done | `/checkin` with dynamic forms, Dexie offline queue, SyncManager, `/dashboard` with mood trend |
| 3 — Psychology | ✅ done | `/psychology` with gap-model chart, pattern insights, gratitude log, emotional history (lazy decrypt); EMOTIONAL_STATE form in Check-in |
| 4 — Skills & habits | ✅ done | `/api/skills` + `/api/habits`, `/skills` builder + session chart, `/habits` + heatmap, Check-in **Skill** / **Habit** tabs |
| 5 — Analytics & polish | — | `/api/analytics/*`, correlations, body metrics, sleep, JSON export |

### Phase 2 details

- **Routing**: `react-router-dom` with protected routes. `/login` → `/checkin` (primary) and `/dashboard`.
- **Auth**: `AuthContext` mirrors `{ token, username, salt }` to `sessionStorage` and keeps the KEK strictly in memory. After a same-tab refresh the token and salt are restored, but the KEK is gone — a modal (`UnlockOverlay`) asks for the master password so the KEK can be re-derived locally (no network round-trip). Wrong-password attempts are caught by unwrapping an existing entry's DEK.
- **Offline queue**: Dexie IndexedDB table `entries` with `status: pending | synced | error`. Every submission is encrypted client-side, enqueued optimistically, and displayed instantly on the dashboard.
- **SyncManager** (single global instance via `SyncContext`): pushes pending rows every 30 s, on `online`, on `visibilitychange`, and on explicit `trigger()` after a form submit. Idempotent on the server (`ON CONFLICT DO NOTHING`). Network failures are caught as `NetworkError`, marked silently as "offline", and retried on the next tick; only genuine 4xx/5xx rejections flip a row into the `error` state.
- **Check-in forms** (Phase 2 subset): `DAILY_CHECKIN`, `THOUGHT`, `GRATITUDE`. Emotional / skill / habit / sleep / meal forms come in later phases.
- **Dashboard**: today widgets (mood / energy / anxiety averages + entry type counts) and a 30-day line chart for mood/energy/anxiety. **All aggregation uses open numeric fields only — no content is decrypted on the dashboard.**
- **Recent entries feed**: metadata-only (timestamp, type, open scores, tags, sync source).

### Phase 3 details

- **EMOTIONAL_STATE form** (`/checkin` → "Emotion" tab): full gap-model with per-emotion toggle — resentment (expectation / reality / trigger), guilt (my_action / perceived_expectation), shame (action / ideal_self), fear (threat / missing_solution) — plus a free-form reflection and a `cognitive_distortion` dropdown. Only the four intensity scores (0–10) leave the device as open fields; every text field is encrypted.
- **`/psychology` page**:
  - `GapChart` — 30-day line chart with 4 series (resentment / guilt / shame / fear) built **purely from open scores** — no decryption needed, renders even without a KEK.
  - `PatternInsights` — per-emotion average + peak day over the last 30 days. Open-field aggregates only.
  - `GratitudeLog` — eagerly decrypts the last 20 GRATITUDE entries client-side for a scannable list of items.
  - `EmotionalHistory` — list of recent EMOTIONAL_STATE rows with scores visible at a glance; the encrypted gap-model breakdown is decrypted lazily **on click**, one row at a time.
- **`useDecryptedEntries<T>(entries, kek)`** hook: batch-decrypts by id into a stable map, caches per mount so rows are never decrypted twice. Dropped on unmount — no plaintext ever reaches IndexedDB or localStorage.
- No backend changes: the `resentment_score` / `guilt_score` / `shame_score` / `fear_score` columns were already provisioned in the Phase 1 migration.

### Phase 4 details

- **Backend**: `GET/POST /api/skills`, `PUT /api/skills/{id}`; `GET/POST /api/habits`, `PUT /api/habits/{id}`. `GET /api/entries` accepts optional `habit_id` (in addition to existing `skill_id`, `entry_type`, etc.).
- **Skill `metric_schema`**: JSON document `{ v: 1, fields: [...] }` where each field is `number` | `slider` | `text` | `select`. The **Skill** check-in tab renders `MetricFieldsForm` from this schema; values go into encrypted `custom_metrics` on `SKILL_SESSION` (see ARCHITECTURE §5). Open fields: `skill_id`, `session_duration_min`.
- **`/skills`**: create skill (name, color, metric builder), list + select, **SkillSessionChart** (Recharts bar: sum of `session_duration_min` per local day), edit schema / deactivate, recent sessions list (metadata only).
- **`/habits`**: create habit (name, frequency daily/weekly, optional target + unit, color), list + toggle active, **HabitHeatmap** (14 weeks, Mon–Sun, intensity = count of `HABIT_LOG` rows with `habit_completed === true` per day; future days muted).
- **Check-in**: new **Skill** and **Habit** tabs → `SkillSessionForm` / `HabitLogForm`. `HABIT_LOG` encrypts optional `notes`; open: `habit_id`, `habit_completed`, `habit_value`.
- **Dexie** schema bumped to **v2** — adds compound indexes `skill_id` / `habit_id` on the offline queue for faster filtered reads.
- **`useEntries`**: server fetch uses `limit=1000` so skill/habit charts have enough history without a second round-trip.
- **Alembic `0002`**: adds nullable `focus_score`, `social_battery_score`, `stress_score` on `entries` so daily check-in sliders can appear in the dashboard feed as **open** metrics (run `alembic upgrade head` after pull).

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

## Phase 3 acceptance (DoD)

1. Open `/checkin` → new **Emotion** tab is present.
2. Enable 2–3 of the four emotion cards (e.g. Resentment + Fear), set intensities, fill some text fields, pick a cognitive distortion, save. Green toast appears.
3. Open `/psychology`:
   - **Gap-model chart** renders lines for the emotions you just scored. Emotions you didn't enable don't appear — `connectNulls` is off, so days without data are gaps, not zeros.
   - **Pattern insights** shows the per-emotion average and peak day for the last 30 days.
   - **Gratitude log** decrypts recent gratitude entries client-side and lists their items.
   - **Emotional history** shows each row with R/G/S/F score badges; clicking "show" decrypts that row only and reveals the gap-model breakdown.
4. Verify the server still sees only scores + ciphertext for emotional entries:

```powershell
docker exec -it lifelog_postgres psql -U lifelog -d lifelog -c "SELECT entry_type, resentment_score, guilt_score, shame_score, fear_score, left(encrypted_content, 40) AS ct FROM entries WHERE entry_type='EMOTIONAL_STATE' ORDER BY timestamp DESC LIMIT 5;"
```

Scores are plain integers, `encrypted_content` is opaque. The distortion label, expectations, reality, reflection — none of them appear anywhere in the DB.

---

## Phase 4 acceptance (DoD)

1. Open **Swagger** `http://localhost:8000/docs` — confirm `GET/POST /api/skills`, `PUT /api/skills/{id}`, `GET/POST /api/habits`, `PUT /api/habits/{id}` exist and require auth.
2. **`/skills`**: create a skill with at least one slider metric (e.g. intensity 1–10). Open `/checkin` → **Skill**, log a session (duration + custom metric + encrypted notes). On `/skills`, select the skill — the bar chart shows minutes for days you logged; recent sessions lists open metadata only.
3. **`/habits`**: create a daily habit. `/checkin` → **Habit** — mark completed, save. On `/habits`, select the habit — heatmap shows at least one green cell for that day. Toggle **off** on the habit → it disappears from the check-in habit list (inactive filtered out).
4. SQL sanity — `skill_id` / `habit_id` on entries, ciphertext unchanged:

```powershell
docker exec -it lifelog_postgres psql -U lifelog -d lifelog -c "SELECT entry_type, skill_id, habit_id, habit_completed, session_duration_min, left(encrypted_content, 36) AS ct FROM entries WHERE entry_type IN ('SKILL_SESSION','HABIT_LOG') ORDER BY timestamp DESC LIMIT 8;"
```

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
│       ├── schemas/           # Pydantic (auth, entry, skill, habit)
│       ├── api/               # auth, entries, skills, habits, deps
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
        │   ├── api.ts                       # + skills / habits CRUD, filtered listEntries
        │   ├── metricSchema.ts              # Skill metric_schema types + parseMetricSchema
        │   └── entrySubmit.ts               # encrypt + enqueue helper
        ├── hooks/
        │   ├── useEntries.ts                # React Query + Dexie merged feed
        │   └── useDecryptedEntries.ts       # Batch / lazy client-side decryption cache
        ├── pages/
        │   ├── LoginPage.tsx
        │   ├── CheckinPage.tsx              # Type selector → dynamic form (+ Skill / Habit)
        │   ├── DashboardPage.tsx
        │   ├── PsychologyPage.tsx           # Gap chart + insights + gratitude + history
        │   ├── SkillsPage.tsx               # Skill builder + session chart
        │   └── HabitsPage.tsx               # Habit CRUD + heatmap
        └── components/
            ├── Layout.tsx                   # Nav + SyncBadge (online/offline-aware) + Outlet
            ├── ProtectedRoute.tsx           # Shows UnlockOverlay when KEK is missing
            ├── UnlockOverlay.tsx            # Re-derive KEK after refresh
            ├── ui/Slider.tsx
            ├── checkin/
            │   ├── DailyCheckinForm.tsx
            │   ├── EmotionalStateForm.tsx   # Gap-model: 4 toggleable emotions + reflection + distortion
            │   ├── ThoughtForm.tsx
            │   ├── GratitudeForm.tsx
            │   ├── SkillSessionForm.tsx       # SKILL_SESSION + dynamic metrics
            │   └── HabitLogForm.tsx           # HABIT_LOG
            ├── dashboard/
            │   ├── TodayWidgets.tsx
            │   ├── MoodTrendChart.tsx       # Recharts LineChart (30 days, daily avg)
            │   └── RecentEntries.tsx        # Metadata-only activity feed
            ├── psychology/
            │   ├── GapChart.tsx
            │   ├── PatternInsights.tsx
            │   ├── GratitudeLog.tsx
            │   └── EmotionalHistory.tsx
            ├── skills/
            │   ├── MetricSchemaBuilder.tsx
            │   ├── MetricFieldsForm.tsx
            │   └── SkillSessionChart.tsx    # Minutes / day (open metrics)
            └── habits/
                └── HabitHeatmap.tsx         # Completion calendar
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
