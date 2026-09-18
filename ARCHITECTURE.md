# 🧬 LifeLog: Personal Digital Twin
## Архитектурный документ для Cursor Plan Agent

---

## ⚠️ AGENT: READ THIS BEFORE WRITING ANY CODE

Do NOT start coding immediately. First, output a short confirmation that you understand these 5 points:

1. The primary data model is **one central `entries` table** with polymorphic `entry_type` — NOT 15 separate tables.
2. **Sensitive text fields are encrypted on the CLIENT side** (Web Crypto API). The server stores binary blobs. The server can never read diary content.
3. **Numeric metrics and entry types are NOT encrypted** — they stay open for server-side analytics and graph queries.
4. The `context_tags` table is always open (unencrypted) to enable analytics without decryption.
5. You will proceed **phase by phase** and wait for user confirmation before starting each new phase.

Only after confirming these 5 points — propose your implementation plan and wait for approval.

---

## 1. Project Concept

LifeLog is a **local-first web application** for structured personal data logging, designed for:

- **Future AI analysis** — accumulating a structured personal dataset for LLM/AGI processing
- **Psychological self-awareness** — tracking cognitive gap patterns (resentment / guilt / shame / fear)
- **Skill development** — customizable metrics per skill (boxing, guitar, vocals, programming, etc.)
- **Health tracking** — sleep, nutrition, physical metrics, habits, supplements
- **Privacy** — sensitive content encrypted client-side; server is a dumb encrypted data store

**Core principle:** Fast input first. Daily check-in must take under 3 minutes. Usability over feature count.

---

## 2. Tech Stack

### Backend
- **Python 3.12 + FastAPI** (async)
- **PostgreSQL 16** + SQLAlchemy 2.0 (async) + Alembic migrations
- **python-jose** (JWT) + **bcrypt** (password hashing)
- No server-side content decryption — ever

### Frontend
- **TypeScript + Vite + React 18**
- **TailwindCSS + shadcn/ui** (components)
- **Recharts** (graphs)
- **TanStack Query** (React Query for server state)
- **Dexie.js** (IndexedDB for offline queue)
- **Web Crypto API** (client-side encryption — built into all modern browsers, no library needed)

### Infrastructure
- **Docker Compose** — one command to start everything
- `.env` for config (DATABASE_URL, JWT_SECRET)
- Local deployment only (localhost)

---

## 3. Security Model (Hybrid E2EE)

### Philosophy
The server stores **encrypted text blobs + open numeric metrics**.

- ✅ Text content (thoughts, reflections, triggers) — encrypted on client
- ✅ Server cannot read diary entries even with full DB access
- ✅ Numeric metrics stay open → server can run analytics queries fast
- ✅ Entry types and timestamps stay open → server can filter without decryption

### Key Derivation Flow
```
User types Master Password
        ↓
GET /api/auth/salt  →  receives unique salt (stored in users table)
        ↓
Frontend: KEK = PBKDF2(password, salt, 100_000 iterations, SHA-256)
        ↓
For each new entry:
  DEK = crypto.getRandomValues(32 bytes)   ← random per-entry key
  encrypted_content = AES-256-GCM(plaintext_json, DEK)
  encrypted_dek = AES-256-GCM(DEK, KEK)
        ↓
Send to server: { encrypted_content, encrypted_dek, timestamp, entry_type, open_metrics, tags, skill_id, context_id }
```

### What the server never sees
- Diary text, reflections, thoughts
- Emotion descriptions, triggers, expectations
- Food details, supplement names
- Goal descriptions, belief content

### What the server CAN see (for analytics)
- Timestamps, entry types
- Numeric scores (mood 1-10, energy 1-10, sleep quality, etc.)
- Skill IDs, habit IDs
- Tags array, context metadata (location, weather, social presence)

---

## 4. Database Schema

### `users`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| username | VARCHAR | |
| password_hash | VARCHAR | bcrypt, for login verification |
| password_salt | VARCHAR | For PBKDF2 key derivation (different from bcrypt salt) |
| created_at | TIMESTAMPTZ | |

### `skills`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR | "Boxing", "Guitar", "Programming" |
| color | VARCHAR | HEX for graph colors |
| icon | VARCHAR | emoji or icon name |
| metric_schema | JSONB | Custom metric definitions (see below) |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

**Example `metric_schema` for Boxing:**
```json
{
  "rounds": { "type": "integer", "label": "Rounds", "min": 1, "max": 20 },
  "session_type": { "type": "enum", "label": "Type", "options": ["sparring", "bag", "technique", "conditioning"] },
  "intensity": { "type": "rating_1_10", "label": "Intensity" }
}
```

**Example `metric_schema` for Guitar:**
```json
{
  "bpm": { "type": "integer", "label": "Practice BPM", "min": 40, "max": 240 },
  "technique": { "type": "enum", "label": "Focus", "options": ["scales", "chords", "fingerpicking", "piece"] },
  "clean_ratio": { "type": "rating_1_10", "label": "Cleanness of playing" }
}
```

### `habits`
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR | "Water 8 glasses", "Meditation", "No sugar" |
| frequency | ENUM | daily / weekly |
| target_value | FLOAT | Optional (e.g. 8 for glasses of water) |
| unit | VARCHAR | "glasses", "minutes", "times" |
| color | VARCHAR | |
| is_active | BOOLEAN | |

### `context_tags` ← ALWAYS UNENCRYPTED (for analytics without decryption)
| Field | Type | Notes |
|---|---|---|
| id | UUID PK | |
| location | VARCHAR | "home", "gym", "office", "outside" |
| social_presence | JSONB | ["alone", "with Anna", "team meeting"] |
| weather | VARCHAR | "sunny", "rainy", "cloudy" |
| created_at | TIMESTAMPTZ | |

### `entries` ← CORE TABLE
**The server only sees encrypted blobs + open numeric metadata.**

| Field | Type | Index | Notes |
|---|---|---|---|
| id | UUID PK | | |
| user_id | UUID FK | Yes | |
| timestamp | TIMESTAMPTZ | Yes | Client-provided UTC time of the event |
| entry_type | ENUM | Yes | See types below |
| skill_id | UUID FK nullable | Yes | For SKILL_SESSION entries |
| habit_id | UUID FK nullable | | For HABIT_LOG entries |
| context_id | UUID FK nullable | | Link to context_tags |
| tags | JSONB array | GIN | Open tags for filtering ["morning", "work", "family"] |
| — Open numeric metrics (never encrypted) — | | | |
| mood_score | SMALLINT | | 1-10, null if not applicable |
| energy_score | SMALLINT | | 1-10 |
| anxiety_score | SMALLINT | | 1-10 |
| sleep_hours | FLOAT | | For SLEEP entries |
| sleep_quality | SMALLINT | | 1-10, for SLEEP entries |
| session_duration_min | INTEGER | | For SKILL_SESSION |
| habit_completed | BOOLEAN | | For HABIT_LOG |
| habit_value | FLOAT | | For quantitative habits |
| resentment_score | SMALLINT | | 1-10, for EMOTIONAL_STATE |
| guilt_score | SMALLINT | | 1-10, for EMOTIONAL_STATE |
| shame_score | SMALLINT | | 1-10, for EMOTIONAL_STATE |
| fear_score | SMALLINT | | 1-10, for EMOTIONAL_STATE |
| — Encrypted blobs — | | | |
| encrypted_dek | TEXT | | Encrypted per-entry data key |
| encrypted_content | TEXT | | AES-256-GCM encrypted JSON (see content schemas below) |
| created_at | TIMESTAMPTZ | | Server time of receipt |
| synced_from_offline | BOOLEAN | | Was this from offline queue |

### Entry Types (ENUM)
```
DAILY_CHECKIN     — morning/evening check-in (mood, energy, notes)
EMOTIONAL_STATE   — psychological gap logging (resentment/guilt/shame/fear)
GRATITUDE         — gratitude log
SKILL_SESSION     — practice session for a skill
HABIT_LOG         — habit completion record
SLEEP             — sleep log
MEAL              — food/nutrition log
SUPPLEMENT        — vitamins and supplements
BODY_METRICS      — physical measurements (weight, body fat, measurements)
THOUGHT           — free-form thought or journal entry
GOAL_UPDATE       — goal progress update
BELIEF            — belief or value statement
```

---

## 5. Encrypted Content Schemas

These are the JSON structures stored in `encrypted_content` after client-side decryption.
All text fields below are encrypted. Numeric fields above (in `entries` table) are open.

### DAILY_CHECKIN
```json
{
  "v": 1,
  "time_of_day": "morning",
  "notes": "free text reflection...",
  "focus_score": 7,
  "social_battery": 6,
  "stress_score": 3
}
```

### EMOTIONAL_STATE
```json
{
  "v": 1,
  "resentment": {
    "expectation": "What I expected from the other person",
    "reality": "What they actually did or said",
    "trigger": "What specifically triggered this"
  },
  "guilt": {
    "my_action": "What I did",
    "perceived_expectation": "What I think others expected from me"
  },
  "shame": {
    "action": "What I did",
    "ideal_self": "How my ideal self would have acted"
  },
  "fear": {
    "threat": "What threat I perceive",
    "missing_solution": "What resource or solution I lack"
  },
  "reflection": "What insight did I get from this?",
  "cognitive_distortion": "all-or-nothing / catastrophizing / mind reading / etc."
}
```
*Note: Scores (resentment_score, guilt_score, etc.) are in the open `entries` table columns.*

### GRATITUDE
```json
{
  "v": 1,
  "items": ["specific thing 1", "specific thing 2", "specific thing 3"]
}
```

### SKILL_SESSION
```json
{
  "v": 1,
  "custom_metrics": { "bpm": 120, "session_type": "sparring", "intensity": 8 },
  "what_worked": "free text...",
  "what_to_improve": "free text..."
}
```

### SLEEP
```json
{
  "v": 1,
  "bedtime": "23:30",
  "wake_time": "07:00",
  "dream_notes": "optional free text"
}
```

### MEAL
```json
{
  "v": 1,
  "meal_type": "lunch",
  "foods": ["chicken breast", "buckwheat", "vegetables"],
  "calories_estimate": 600,
  "protein_estimate": 45,
  "notes": "felt heavy after"
}
```

### SUPPLEMENT
```json
{
  "v": 1,
  "name": "Vitamin D3",
  "dose": 5000,
  "unit": "IU"
}
```

### BODY_METRICS
```json
{
  "v": 1,
  "weight_kg": 78.5,
  "body_fat_pct": 16.2,
  "chest_cm": 98,
  "waist_cm": 82,
  "hips_cm": 94,
  "bicep_cm": 35,
  "notes": "measured in the morning before eating"
}
```

### THOUGHT / JOURNAL
```json
{
  "v": 1,
  "content": "free text...",
  "mood_score": 7
}
```

### GOAL_UPDATE
```json
{
  "v": 1,
  "goal_title": "Run 5km",
  "progress_pct": 60,
  "status": "in_progress",
  "reflection": "What helped, what blocked me"
}
```

### BELIEF
```json
{
  "v": 1,
  "statement": "I believe that...",
  "confidence": 8,
  "category": "self / relationships / world / future",
  "notes": "Why I hold this belief"
}
```

---

## 6. Frontend Crypto Module (`lib/crypto.ts`)

Implement these exact functions using the built-in **Web Crypto API** (no external libraries):

```typescript
// Derive KEK from master password + salt (run once on login)
async function deriveKEK(password: string, saltHex: string): Promise<CryptoKey>

// Generate a random DEK for a new entry
async function generateDEK(): Promise<CryptoKey>

// Encrypt plaintext JSON for storage
async function encryptEntry(plaintextJson: string, kek: CryptoKey): Promise<{
  encryptedContent: string,  // base64
  encryptedDek: string       // base64
}>

// Decrypt an entry received from server
async function decryptEntry(
  encryptedContent: string,
  encryptedDek: string,
  kek: CryptoKey
): Promise<string>
```

**IMPORTANT:** KEK is derived once on login and stored **only in React state (memory)**. Never write KEK to localStorage, sessionStorage, or any persistent storage. On page refresh, user re-enters password.

---

## 7. Offline-First Architecture (Dexie.js)

User saves entry → immediately encrypted in browser → stored in IndexedDB with `status: 'pending'` → UI shows it instantly (optimistic update) → background SyncManager sends POST /api/entries/sync → on success, status becomes `synced`.

**Offline queue schema (IndexedDB via Dexie.js):**
```typescript
interface PendingEntry {
  localId: string           // local UUID
  serverId?: string         // server UUID after sync
  timestamp: string         // ISO UTC
  entryType: string
  openMetrics: Record<string, number | boolean | null>
  tags: string[]
  skillId?: string
  habitId?: string
  encryptedContent: string  // base64
  encryptedDek: string      // base64
  status: 'pending' | 'synced' | 'error'
}
```

---

## 8. API Endpoints (FastAPI)

### Auth
- `POST /api/auth/register` → `{ salt }` (generates and stores salt, returns it to client)
- `POST /api/auth/login` → `{ access_token, salt }`
- `POST /api/auth/refresh` → `{ access_token }`

All other endpoints require `Authorization: Bearer <token>`.

### Skills & Habits
- `GET /api/skills` → List with metric_schema
- `POST /api/skills` → Create skill
- `PUT /api/skills/{id}` → Update skill
- `GET /api/habits` → List habits
- `POST /api/habits` → Create habit
- `PUT /api/habits/{id}` → Update habit

### Entries (Core)
- `POST /api/entries/sync` → Accepts array of entries (encrypted), saves to DB
  - Request: `[{ id, timestamp, entry_type, open_metrics, tags, skill_id, habit_id, context_id, encrypted_content, encrypted_dek }]`
  - Response: `{ saved: [ids], errors: [] }`
- `GET /api/entries` → Returns metadata + encrypted blobs (client decrypts)
  - Params: `start_date, end_date, entry_type, skill_id, tags`
- `GET /api/entries/{id}` → Single entry

### Analytics (uses OPEN numeric fields — no decryption needed)
- `GET /api/analytics/trends` → Mood, energy, anxiety over time
  - Params: `metric, period (7d/30d/90d/1y)`
- `GET /api/analytics/correlations` → sleep_quality vs mood_score, etc.
- `GET /api/analytics/habits` → Completion rates per habit
- `GET /api/analytics/skills` → Session frequency + avg quality per skill
- `GET /api/analytics/psychological` → resentment/guilt/shame/fear scores over time

### Export
- `GET /api/export/metadata` → All open metrics in JSON (no decryption)
- `POST /api/export/full` → Client must download all encrypted entries, decrypt locally, and assemble final JSON

---

## 9. Frontend Pages

### `/` and `/today` — PRIMARY SCREEN (Phase 6+)
Today + chat: briefing from open metrics, conversation thread, sticky composer (text + voice).
The agent proposes structured entries via client-side function calling; the user confirms cards (or auto-commits only when they explicitly asked to save). Manual forms remain at `/checkin` as fallback.

### `/checkin` — manual forms (fallback)
Dynamic form that changes based on selected entry_type.
- Default: DAILY_CHECKIN with mood/energy sliders + quick notes
- Type selector: Emotion | Skill | Habit | Gratitude | Sleep | Body | Thought
- Each type shows its specific fields
- Submit → encrypt → add to offline queue → sync

### `/dashboard`
- Today's summary widgets: mood trend, energy, habit completion ring
- Gap chart: resentment/guilt/shame/fear scores (last 30 days)
- Quick-add shortcut buttons

### `/analytics`
- Time-series graphs with date range selector (7d/30d/90d)
- Correlation charts (sleep vs mood, etc.)
- Skill progress charts with custom metrics
- Habit heatmap (GitHub-style calendar)

### `/skills`
- List of skills with last session info
- Skill builder: define name, color, custom metric schema
- Per-skill page: session history + progress chart

### `/psychology`
- Emotional state history (scores visible, text encrypted)
- Pattern insights: "Which days have highest resentment?"
- Gratitude log

### `/journal`
- Free-form thoughts, beliefs, goals
- Search by tags and date (works on open metadata without decryption)

### `/timeline`
Former journal: thoughts / gratitude / emotional history with tag filter and on-demand decrypt.

### `/insights`
Tabs over Dashboard, Psychology, Skills, Habits, Analytics (open-metric graphs unchanged).

### `/settings`
- LLM provider (OpenRouter / Ollama), model, API key wrapped with KEK
- Context policy for what the agent may decrypt into a prompt
- Export data
- Change master password (requires re-encryption of all DEKs)

---

## 10. Key Graphs to Implement

| Graph | Chart Type | Data Source |
|---|---|---|
| Mood / Energy / Anxiety over time | LineChart | `entries.mood_score, energy_score, anxiety_score` (open) |
| Sleep duration vs quality | BarChart + Line | `entries.sleep_hours, sleep_quality` (open) |
| Psychological gap scores | LineChart (4 lines) | `resentment/guilt/shame/fear_score` (open) |
| Skill session frequency + quality | BarChart + Line | `entries` filtered by skill_id (open) |
| Habit completion heatmap | Calendar Heatmap | `entries.habit_completed` (open) |
| Sleep vs Mood correlation | ScatterPlot | `sleep_quality` vs `mood_score` (both open) |
| Body metrics over time | LineChart | From decrypted BODY_METRICS entries |

---

## 11. Development Phases

### Phase 1 — Core foundation (do this first, get approval before Phase 2)
- [ ] Docker Compose: postgres + fastapi + vite frontend
- [ ] DB models (all tables) + Alembic migration
- [ ] Auth endpoints (register, login with salt return)
- [ ] `crypto.ts` module (deriveKEK, encryptEntry, decryptEntry)
- [ ] POST /api/entries/sync + GET /api/entries (basic)
- [ ] RESULT: Can encrypt an entry and sync it to server

### Phase 2 — Daily check-in (get approval before Phase 3)
- [ ] `/checkin` page with dynamic form (type selector)
- [ ] Dexie.js offline queue + SyncManager
- [ ] `/dashboard` with mood/energy widgets
- [ ] Basic LineChart for mood over time

### Phase 3 — Psychology module
- [ ] EMOTIONAL_STATE entry form (gap model fields)
- [ ] GRATITUDE form
- [ ] Gap chart (4 emotion score lines)
- [ ] `/psychology` page

### Phase 4 — Skills & Habits
- [ ] Skill builder UI (create skill with custom metric_schema)
- [ ] SKILL_SESSION entry form (renders fields from metric_schema dynamically)
- [ ] Habit management + HABIT_LOG form
- [ ] Habit heatmap calendar
- [ ] Skill progress chart

### Phase 5 — Analytics & Polish
- [ ] Correlation charts
- [ ] Body metrics tracking
- [ ] Sleep log
- [ ] JSON export (client-side decrypt + assemble)
- [ ] Search/filter by tags

### Phase 6 — AI capture (Today + client-side agent)
- [ ] Today is the home route: briefing (open metrics + gaps) + day thread + composer
- [ ] Client-side OpenAI-compatible tool loop (browser → OpenRouter or host Ollama). LifeLog FastAPI never sees chat plaintext and never proxies the LLM.
- [ ] API key stored in IndexedDB wrapped with the KEK (same AES-GCM as entries). Chat turns stored as ciphertext in Dexie (`chat_turns`), not on Postgres.
- [ ] Tool profiles: cloud gets the full catalog; local 7B (GTX 1070 8GB, Q4, 4k–8k ctx) gets four tools — `get_today_snapshot`, `propose_entries`, `show_chart`, `search_entries`.
- [ ] `propose_entries` returns confirm cards; `commit_entries` / user Save call existing `encryptAndEnqueue`. Do not invent numeric scores that were not in the utterance. Inferred scores never auto-commit.
- [ ] Provenance in encrypted JSON: `provenance` (`user_stated` | `agent_extracted` | `agent_inferred`), `confidence`, `source_turn_id`, `user_confirmed`. Open tags may include `agent` / `confirmed`.
- [ ] `show_chart` renders Recharts in the thread (trends, scatter, habit heatmap, skill bars) from open metrics / existing components.
- [ ] Mobile-first shell: bottom tab bar (Today, Timeline, Insights, Settings), `viewport-fit=cover`, `100dvh`, `visualViewport` so the keyboard does not cover the composer, tap targets ≥ 44px.
- [ ] `/checkin` remains as fallback when the model is unavailable.

**E2EE invariant (unchanged):** the LifeLog server stores ciphertext + open numbers only. OpenRouter sees the current chat plus tool results the client chose to send. A local Ollama model sees that payload on-device only.

---

## 12. Rules the Agent Must Follow

1. **Never decrypt on the server.** The server API returns encrypted blobs. Period.
2. **Never log decrypted user content.** Only log entry IDs, types, timestamps.
3. **All datetimes in UTC** (TIMESTAMPTZ in PostgreSQL, ISO 8601 in API).
4. **UUID for all primary keys** (not integers).
5. **Separate Pydantic schemas from SQLAlchemy models** — different files.
6. **One user only** — this is a personal single-user app. No multi-tenancy needed.
7. **All routes protected by JWT** except /api/auth/register and /api/auth/login.
8. **Alembic for all DB changes** — never use `create_all()` in production code.
9. **JSONB for metric_schema and tags** — enables flexible schema without migrations.
10. **Proceed phase by phase** — after completing Phase 1, stop and show results. Wait for go-ahead.

---

## 13. Pre-Start Checklist

- [ ] Docker Desktop installed and running
- [ ] Cursor with Plan Agent mode enabled
- [ ] Understood: client encrypts text, server stores binary blobs
- [ ] Understood: numeric metrics stay open for analytics
- [ ] Understood: build phase by phase, not everything at once
- [ ] Decided your first skills to track (e.g. boxing, guitar, programming)

---

*When starting, paste this file and say:*
**"Read ARCHITECTURE.md carefully. Confirm you understood the 5 points from the top. Then propose your implementation plan for Phase 1 only. Wait for my approval."**
