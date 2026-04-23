# LifeLog

Personal Digital Twin — local-first, client-side E2EE journaling & tracking.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

---

## Phase 1 scope

What Phase 1 delivers:

- Docker Compose (Postgres 16 + FastAPI + Vite+React frontend)
- All DB tables via a single Alembic migration (`0001_initial_schema.py`)
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`
- `POST /api/entries/sync`, `GET /api/entries`, `GET /api/entries/{id}`
- Frontend `lib/crypto.ts` with `deriveKEK`, `generateDEK`, `encryptEntry`, `decryptEntry`
- A minimal smoke-test UI that encrypts a note, syncs it, fetches it back, and decrypts it

What is **not** in Phase 1 (comes later):
Dexie offline queue, `/checkin` form, dashboards, analytics, skill builder, habits UI.

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

## Smoke test (Phase 1 acceptance)

On `http://localhost:5173`:

1. Enter a username and a password (≥ 8 chars). Click **Register**.
2. Click **Login & derive KEK**. The frontend derives the KEK in-memory only.
3. Type a private note, pick a mood score, click **Encrypt & POST /api/entries/sync**.
4. Click **GET /api/entries & decrypt locally** — the note should come back decrypted.

To confirm the server sees no plaintext, inspect the DB directly:

```powershell
docker exec -it lifelog_postgres psql -U lifelog -d lifelog -c `
  "SELECT id, entry_type, mood_score, left(encrypted_content, 40) AS ct FROM entries;"
```

You should see `mood_score` in clear and `encrypted_content` as an opaque base64 blob.

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
        ├── App.tsx            # Phase 1 smoke-test UI
        ├── index.css
        ├── lib/
        │   ├── crypto.ts      # Web Crypto API: KEK / DEK / encrypt / decrypt
        │   └── api.ts
        └── hooks/useAuth.ts   # Holds JWT + KEK in memory (never persisted)
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
