# LifeLog architecture — implemented MVP

Updated 2026-10-09. This document describes the current implementation. Original design prompts and phase plans are in [docs/archive](docs/archive/); they are historical, not development instructions or feature guarantees.

## Components and data flow

```mermaid
flowchart LR
    Forms[Manual forms / confirmed proposal] --> Crypto[Browser Web Crypto]
    Crypto --> Queue[Dexie IndexedDB outbox]
    Queue --> Sync[Revision-aware sync manager]
    Sync --> API[FastAPI / ownership validation / CAS]
    API --> PG[(PostgreSQL)]
    PG --> Read[Account-scoped ciphertext + open metrics]
    Read --> Browser[Browser decryption / charts / export]
    Model[Optional OpenRouter or Ollama] --> Proposals[Editable proposals]
    Proposals --> Forms
```

Frontend: React 18, TypeScript, Vite 6, Tailwind 3, TanStack Query, Dexie and Recharts. Backend: Python 3.12+, FastAPI, async SQLAlchemy, asyncpg, Alembic, bcrypt and JWTs. Compose targets a local PostgreSQL 16 development environment. There is no worker service, model orchestration framework or nightly analytics pipeline.

## Storage and ownership

`entries` is the central polymorphic observation table. Each row contains an entry type, time, optional numeric scores and references, encrypted text and a wrapped data key. Skills, habits and context tags are separate open metadata entities. Goals, memory, actions and feedback have encrypted payloads plus open states, links and review dates.

Queries filter by authenticated user. Sync validates referenced skill/habit/context/goal ownership on creates **and updates**. Life endpoints validate their links too. Deleted goals cannot be newly referenced. This application validation complements DB foreign keys; the schema does not enforce all cross-table ownership through composite keys.

Dexie schema v8 uses one `outbox` for entity snapshots/operations, scoped by `owner_user_id`. Legacy stores remain copy-only migration sources. Rows with unknown owners remain orphans; attachment requires successful decryption and user confirmation. No automatic claim occurs at login.

## Encryption and authentication

`frontend/src/lib/crypto.ts` derives a non-extractable KEK with PBKDF2-SHA256 from the full password and per-user salt. KDF v1 is fixed at 100,000 iterations. Each content payload receives a random 256-bit DEK and independent AES-GCM IVs for content and key wrapping. Stored base64 envelopes contain IV, ciphertext and authentication tag. Unknown KDF versions are rejected.

The server stores ciphertext and does not decrypt it in normal execution. The same password is submitted to the login server for bcrypt authentication: an active compromised auth server can derive the key. This is hybrid encryption with a trusted auth/browser boundary. Numeric metrics, relationships, timestamps, tags and some entity names remain open.

AuthContext keeps the KEK in memory. Session storage contains JWT/session metadata, not the key. Reload requires password re-entry; a verifier or existing ciphertext checks the key before encryption is enabled. Account/session guards suppress late refresh, stream, encryption and export callbacks after logout or account switching. Login throttling is in-memory per IP/username; refresh preserves the original session issue time and obeys the absolute expiry ceiling. JWT revocation is not implemented.

New passwords exceeding 72 UTF-8 bytes are rejected at both registration boundaries. Verification preserves the historical bcrypt first-72-byte rule for existing accounts. Encryption still uses the complete original password; suffix changes may authenticate against a legacy hash but fail the KEK check. No password/key reset or KDF migration was introduced.

## Synchronisation and conflicts

A syntactically valid entry batch returns per-item `created`, `duplicate`, `updated`, `deleted`, `conflict` or `rejected` results. Invalid request schema can reject the entire request before item processing. Range/reference validation rejects individual semantic failures. Inserts and updates use savepoints, so a DB constraint error does not cancel valid siblings.

Changed updates and live deletions require the caller's version. SQL writes compare `id + owner + supplied version + non-deleted state`; a concurrent edit causes a conflict, not silent replacement. Deletion increments the version. Repeated matching fingerprints and repeated deletions are idempotent; `goal_id` participates in the fingerprint. Timestamp/timezone checks and finite-number validation apply to updates too.

The browser claims snapshots with owner and local revision before sending. Acknowledgements update only the claimed revision, preserve later local edits and carry server versions forward. Web Locks plus IDB transactions coordinate tabs. Sync is triggered by app lifecycle/connectivity; there is no background guarantee after closing the browser.

A new offline goal is sent before an entry referencing it when the goal does not itself depend on a pending entry. Remaining life entities preserve dependency ordering. Cyclic creation graphs (a new goal linking the same new progress entry that references it) are not a general graph transaction; create/sync the goal first in that case.

Conflicts retain local and server variants until the user chooses. Rejections are visible rather than retried indefinitely. Soft deletions and tombstones prevent stale caches from resurrecting removed items. They do not imply physical erasure.

## AI control and context

The browser sends OpenAI-compatible requests directly to an explicitly configured OpenRouter or Ollama endpoint. Manual forms and deterministic views work with neither configured. The synthetic provider is a development test script, excluded from production execution.

Record/Analyze/Review have fixed tool allowlists. Tools can retrieve bounded permitted context, render charts and propose entries or life items. The model cannot expand its allowlist or provide trusted confirmation. The UI validates/editable proposals; explicit Save creates application confirmation metadata and invokes encryption/outbox persistence. A goal update keeps a known owned goal ID through schema, normalisation, picker, confirmation, encrypted submission and wire payload.

Context policy controls open metadata and a bounded number of decryptions; context auditing records what was revealed. Current user messages and any allowed decrypted context leave the browser in plaintext for the chosen model provider. These controls do not prove immunity to every prompt injection or guarantee cloud-provider privacy. Accepted memory remains a user-approved statement, not an established fact.

## Time, analytics and exports

Instants use UTC and account IANA timezone validation. Recorded timezone snapshots anchor historical calendar days. Sleep is assigned to wake/end day. Metric definitions specify range, unit, aggregation and filters; missing observations remain missing. Trends/correlations expose coverage and observation counts; insufficient samples are reported. Correlation is descriptive, not causal or diagnostic.

Full JSON export merges paginated server entities with owned local revisions, preserves conflicts/queue metadata and includes a decryption/completeness report. Chat turns cover this device only. Metadata-only export omits ciphertext. Decrypted exports need external protection. Import/restore of these snapshots and forgotten-password recovery are not implemented.

## Verification and operating limits

Regression tests exercise invalid updates/foreign references, mixed batches, concurrent writes, DB constraint savepoints, legacy passwords, proposal-to-wire goal links, stale acknowledgements and account switches. Browser tests include a no-provider fictional demo, offline save, relogin/decryption, update/delete through the real queue, export, conflict choice and cross-context deletion. See [actual results and limits](docs/portfolio-preparation-2026-10-09.md).

Compose publishes only localhost ports. It is a development profile with bind mounts, reload and example defaults; public hosting requires a separate reviewed deployment. No Docker run was possible in the preparation environment. Remaining dependency advisories are documented in [security-dependencies.md](docs/security-dependencies.md).

Future design work: stronger separation of authentication/encryption secrets, safe KDF migration, tested backup restoration, general journal editing UI, bundle splitting and richer long-term analysis. No AGI subsystem or autonomous decision engine exists.
