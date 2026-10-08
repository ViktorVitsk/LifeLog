# LifeLog

**A personal journal and structured observation log with browser-side encryption, an offline queue, and user-confirmed AI proposals.**

LifeLog is an independent, AI-assisted Fullstack/AI project, built for personal use. It is an **experimental MVP**: suitable for local evaluation and portfolio review, with explicit security and operational limits. It is not a medical or diagnostic product.

The long-term idea is to accumulate a useful personal history that future, more capable AI systems could help analyse—possibly including AGI. That is a motivation, not an implemented capability or a claim about present-day models.

## What you can try today

- Log observations through manual forms without any cloud LLM or API key.
- Encrypt diary text and goal/memory/action/feedback payloads in the browser using Web Crypto; keep numeric metrics open for server-side charts.
- Save encrypted operations in IndexedDB, retry after connectivity returns, and track revisions, rejections, deletion tombstones and conflicts.
- Review both sides of a conflict before choosing a version. Local state and API queries are scoped to the signed-in account.
- Use optional OpenRouter or local Ollama integration. The model proposes cards; the application persists them only after an explicit user action.
- Explore trends, habits, skill activity, goals and a deterministic weekly review. Download metadata or a decrypted JSON snapshot with a completeness/decryption report.
- Switch between English and Russian UI.

**Technical focus:** React + TypeScript + Dexie; FastAPI + async SQLAlchemy + PostgreSQL; versioned batch synchronisation, account/session guards, encrypted client persistence, controlled LLM tool access, and regression tests at unit, browser and database boundaries.

## Preview

*Screenshot placeholder: Today view with only `[FICTIONAL DEMO]` data.*

*Screenshot placeholder: local/server conflict comparison and a trend chart.*

*Short video placeholder: offline save → reconnect → confirmed sync → export. No personal account or paid provider is needed.*

These placeholders are intentional. There is no hosted public demo yet.

## Run locally

The Compose profile is for **localhost development**, with host ports bound to `127.0.0.1`. It uses PostgreSQL 16 and persistent database storage. It is not a public deployment configuration.

Requirements: Docker Engine with Compose, or Python 3.12+, uv, Node.js 22 (22.6+ for TypeScript tests), and a separate PostgreSQL database.

```sh
cp .env.example .env
# Set JWT_SECRET to a new random value in .env before starting.
docker compose up --build
```

Open [LifeLog](http://127.0.0.1:5173) and [API docs](http://127.0.0.1:8001/docs). Compose applies Alembic migrations before starting the API. The example database password is for local development; choose your own credentials for real data. Keep `.env` private.

**Validation limit:** Docker was unavailable during the October 2026 preparation. Host execution and all nine migrations were tested against a disposable PostgreSQL 18.6 database; container builds and a PostgreSQL 16 run still need confirmation. See [verification report](docs/portfolio-preparation-2026-10-09.md).

Host setup, using a new disposable database rather than an existing personal database:

```sh
cd backend
uv sync --locked
# Set DATABASE_URL and JWT_SECRET in this shell; use a dedicated database.
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8001
```

In a second shell:

```sh
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:8001` by default. Set `VITE_API_PROXY` for another backend address. The backend allows the default localhost frontend origins; adjust `CORS_ORIGINS` when changing ports. Web Crypto requires a secure context (localhost is supported).

## Fictional demo, no API key

With the local stack running, open [demo setup](http://127.0.0.1:5173/demo.html) **in a private browser window**, against a disposable database, and click **Create fictional demo**.

The development-only page registers a fresh `fictional_demo_…` account, creates 14 daily check-ins, a thought, a goal update, a habit, a skill and a goal. Every seeded entry has a `fictional-demo` tag; all seeded text is labelled `[FICTIONAL DEMO]` and has `fictional_demo: true`. Encryption and synchronisation use the real application paths.

Sign in with the credentials shown on the page. The demo password is public and must never protect personal information. The page refuses an active session, does not reset existing accounts, and is excluded from the production build. If setup fails, it reports partial data instead of deleting anything.

Manual forms work without a model. The demo selects the **Synthetic** development provider: scripted local responses, not AI analysis, and no network requests to a model provider. OpenRouter/Ollama remain opt-in. Synthetic execution is rejected in production.

Try Today, manual forms, Timeline, Overview, Analytics and Settings/export. Reloading requires the master password to unlock the key again. General journal-entry editing is currently available through the sync contract, not a complete Timeline edit UI; goals/memory/actions have their own controls.

## Privacy and recovery boundaries

Sensitive text uses a random AES-256-GCM data key per payload. That key is wrapped with a password-derived AES key (PBKDF2-SHA256, KDF v1: 100,000 iterations). The derived key stays in memory and is cleared on logout. Cached diary/life content and chat turns are encrypted locally.

This is **hybrid client-side encryption**, not a verified end-to-end or zero-knowledge guarantee:

- The login API receives the same password that derives the encryption key. A compromised auth server or delivered JavaScript could capture it. XSS, malicious extensions and a compromised browser can expose unlocked plaintext.
- Types, timestamps, tags, numeric metrics, entity relationships, usernames, habit/skill names and other operational metadata remain readable by the server. Use neutral names/tags when appropriate.
- A stolen database still permits offline password guessing. KDF v1 is retained for compatibility; a stronger KDF requires a key migration, not a config change.
- Cloud AI requests disclose the current message and any explicitly permitted context in plaintext to the selected provider. Context policy and tool budgets limit access; they do not certify model privacy or resistance to every prompt injection.
- New passwords must be 8–256 characters and at most 72 UTF-8 bytes. Legacy longer passwords retain bcrypt's first-72-byte authentication semantics; the **full original password** is still needed to derive the correct encryption key.
- There is no forgotten-password recovery or general backup import/restore workflow. A decrypted export is readable by anyone with the file. Chat export covers this device only; inspect the export report for failures or partial sections.
- IndexedDB is a working cache/queue, not a backup. Browser storage eviction or clearing data can lose unsynced operations. Offline editing works in an already loaded, unlocked app; first-load offline/PWA support is not implemented.
- Login throttling is process-local; JWTs have an absolute lifetime but no server-side revocation list. This is a local, single-process MVP.

Keep a private backup of the database and required configuration, and protect exported plaintext. Soft deletion coordinates clients; it does not promise physical erasure from storage or backups.

## Architecture and tests

[Architecture](ARCHITECTURE.md) describes current data flows and trust boundaries. [Dependency review](docs/security-dependencies.md) records remaining npm advisories and their applicability. [Verification report](docs/portfolio-preparation-2026-10-09.md) distinguishes tests actually run from checks still pending.

```sh
# backend
uv run ruff check .
uv run pytest
# With a migrated DISPOSABLE DB and the API running on :8001:
LIFELOG_LIVE_API=1 uv run pytest

# frontend
npm run build
npx playwright install chromium
npm test
# With a migrated disposable DB and API running:
VITE_API_PROXY=http://127.0.0.1:8001 npm run test:e2e
```

Run backend commands from `backend/`, frontend commands from `frontend/`. `DATABASE_URL` must point at the disposable DB for live tests. `LIFELOG_API` and `PLAYWRIGHT_API` override the test API address; `PLAYWRIGHT_BASE_URL` changes the browser test origin/port. E2E tests create fictional accounts and tombstone their entities; empty test accounts remain. Do not run them against personal data.

CI defines lint/unit/build/component jobs and a PostgreSQL 16 job for migrations, live tests and browser scenarios. A green GitHub CI run has not been observed locally.

## Development history and scope

The owner developed the architecture iteratively with **DeepSeek, GPT and Claude**, passed proposals between models, compared their criticism, revised the design and chose how to proceed. Implementation was also AI-assisted. This repository does not represent code written entirely by hand or a course/video tutorial project.

The engineering intent is to make privacy, integrity, recoverability, unreliable connectivity and user control visible in the design. Tests and documented limits are part of that work; they do not establish a production security certification.

Future work includes independently reviewed security, stronger key separation/KDF migration, tested backup restoration, a complete journal editing experience, smaller frontend bundles, and richer longitudinal analysis. AGI analysis, autonomous decisions, medical interpretation and public production hosting are not delivered features.

Historical planning documents are [archived](docs/archive/); their proposals are not promises about the current application.

## License

A redistribution license has not yet been selected by the owner. Public visibility alone should not be interpreted as a grant of reuse rights.
