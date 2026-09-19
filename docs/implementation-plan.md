# LifeLog implementation plan

Короткий живой ориентир. Статус считается `checked` только при указанном доказательстве.

**Updated:** 2026-09-19
**Branch:** `main`
**Archive:** [полный подробный план до Iteration I](implementation-plan-archive.md)

## Stable invariants and decisions

### Security, ownership, encryption

- Каждая локальная и серверная сущность принадлежит конкретному `owner_user_id`; чужие FK и связи отклоняются.
- Локальные строки без `owner_user_id` — orphan: их нельзя автоматически привязать к вошедшему пользователю.
- Привязка orphan допустима только после расшифровки текущим KEK и явного подтверждения пользователя.
- JWT подтверждает сессию, но не владение KEK. После reload нужен verifier или успешная расшифровка существующего ciphertext.
- Login ограничен пятью неудачами за 300 секунд на `(IP, username)`; успешный вход сбрасывает счётчик.
- Refresh сохраняет исходный JWT `iat`; rolling token не переживает абсолютный 30-дневный потолок сессии.
- `kdf_version=1` означает исходный PBKDF2-SHA256/100k; неизвестная версия отклоняется, а не подменяется параметрами.
- KEK живёт только в памяти, не сохраняется в local/session storage и сбрасывается при logout или смене сессии.
- Сервер хранит ciphertext и метаданные, но не расшифровывает diary/life payload и не логирует payload/ciphertext.
- Логи sync содержат только счётчики и reason codes.
- Plaintext дневника — данные, а не переключатель разрешений; контекст модели ограничен единым envelope и бюджетом уникальных расшифровок.
- Принятый memory item — согласие пользователя с формулировкой, а не доказанный факт.
- Production-сборка не должна содержать DEV probes/globals или синтетические обработчики.
- Схема меняется только миграциями Alembic; проверки диапазонов не исправляют и не clamp существующие данные молча.

### Product semantics

- Модель только предлагает изменения. Persist происходит после явного Save в карточке или форме.
- `auto_commit` и `user_confirmed` от модели игнорируются; `auto_save_enabled` зарезервирован, по умолчанию `false`, UI нет.
- Шкалы сохраняемых score — строго 1–10 во frontend, API и CHECK constraints; out-of-range — ошибка, missing остаётся missing.
- Отсутствующий `habit_completed` не означает `true`.
- `source_turn_id` — id сообщения пользователя; Save создаёт отдельный `confirmation_event_id`.
- Goals, memory, planned actions и feedback — отдельные зашифрованные сущности с явными owner-checked связями.
- Feedback разделяет наблюдаемый outcome и решение continue/complete/stop; «помогло» не является доказательством причины.
- Режимы Record / Analyze / Review используют один model endpoint и разные фиксированные tool allowlists; модель не добавляет инструменты.
- Record допускает свободный текст и не требует заполнения каждой шкалы; Analyze выдаёт предложения карточками; Review сначала получает детерминированный briefing.
- Неизвестные UUID удаляются до показа; приложение не изобретает crisis/helpline content.
- Due reminder вычисляется из `review_at`, ближайшего таймера и refetch при открытии; push-уведомлений нет.
- Full export объединяет server и local state, пагинирует все списки, сохраняет версии/очередь/tombstones/conflicts и честный decrypt report.

### Time, metrics, calendar days

- Instants хранятся в UTC; timezone аккаунта — валидная IANA zone.
- Entry хранит входной `recorded_at` и snapshot `event_timezone`, чтобы будущая смена пояса не переписала прошлые дни.
- Calendar day — civil date в `event_timezone`, иначе в timezone аккаунта.
- Для SLEEP `timestamp` означает wake/end; ночь относится к локальной дате пробуждения.
- «Вчера вечером» означает 20:00 предыдущего дня в timezone аккаунта.
- Idempotency fingerprint не включает `recorded_at` и `event_timezone`.
- Метрика явно задаёт scale/unit/range/aggregation/filters; missing пропускается.
- Session minutes суммируются по дням, mood усредняется с `n`; habit metrics требуют `habit_id`.
- Trends/correlations возвращают период, observations и coverage; joint `n < 3` даёт `insufficient` и пустые points.
- Сравнения выбирает пользователь, optional lag явный; скрытых корреляций и nightly rollups нет.

### Sync, offline, deletion

- Batch sync возвращает HTTP 200 и per-item `created | duplicate | updated | conflict | rejected | deleted`.
- Один плохой item не отменяет siblings; `created`/`duplicate` подтверждаются, `conflict`/`rejected` остаются честно видимыми и не ретраятся бесконечно.
- Повтор одинакового fingerprint идемпотентен; другой ciphertext при той же базе версий проходит только через CAS.
- CAS использует `UPDATE ... WHERE id=? AND version=?`; stale version не перезаписывает сервер.
- Очередь фиксирует snapshot `owner + id + payload + local_rev` до первого await.
- `local_rev`/`inflight_rev`, selective ack и mutex не позволяют старому ack стереть новую локальную правку.
- SaveScope захватывается до async encrypt; stale load/decrypt/agent/token/export results проверяют account/session/KEK guard перед записью в state.
- Account switch или logout отменяет stream callbacks, tool rounds, decrypt и export; поздний результат старой сессии игнорируется.
- Delete/Undo создаёт versioned `pending_delete` tombstone, а не только удаляет строку из Dexie.
- Повтор delete отсутствующей или уже удалённой сущности идемпотентно возвращает `deleted`.
- GET, analytics и export не воскрешают soft-deleted строки; tombstones применяются даже при пустой локальной очереди.
- Server version переносится на оставшуюся pending revision; stale success/conflict/reject/delete ack не портит новую ревизию.
- LifeOp завершается только после ack частей именно этой ревизии; новая операция supersedes старую, меньший `status_seq` не откатывает состояние.
- Conflict хранит обе версии до явного выбора пользователя.
- Локальный life snapshot остаётся доступным offline; Web Locks и IDB transactions координируют вкладки.

## Remaining limits

- Login password сейчас одновременно используется сервером для bcrypt и локально для PBKDF2→KEK. Скомпрометированный API видит пароль при login и потенциально может вывести KEK; это не гарантия «сервер никогда не сможет прочесть дневник».
- Отдельный encryption secret, никогда не покидающий устройство, отложен до спроектированной миграции; custom PAKE не вводится.
- Физическое затирание ранее записанных plaintext-байтов на диске не обещается.
- Bind-mount backend/frontend через Docker Desktop для `/media/dev/SSD/...` остаётся заблокированным; проверки выполнялись на host stack и service Postgres.
- OpenRouter/Ollama не вызывались; реальные model-provider ответы и D allowlists проверены только synthetic/unit путями.
- Точный UI-сценарий account switch во время encrypt и lost-ack retry остаётся unit/synthetic-covered, не повторён как отдельный browser dance.
- Задержанный refresh аккаунта A после входа в B не перехватывался отдельно в UI; stale-token guard покрыт авто-тестами.
- Ранний отдельный Undo acceptance не повторялся целиком; delete/tombstone поведение позднее покрыто unit, live API и Playwright two-context.
- `today` charts всё ещё используют 7d enum open-metrics API, отдельного 1-day периода нет.
- Старая LLM settings строка `id=default` не auto-attach к аккаунту; настройки агента нужно сохранить заново.
- Первый browser full export содержал одну diary page; multi-page merge покрыт unit, но не отдельным большим UI dataset.
- Готовый 14-дневный набор для weekly review не засевался в UI; вычисления и flags покрыты авто-тестами.
- E2E cleanup tombstone-ит созданные entities, но API удаления user отсутствует: после тестов остаются пустые synthetic users.
- Login throttle хранится в памяти одного процесса и сбрасывается при рестарте; это приемлемо только для заявленного localhost/single-worker профиля.
- PBKDF2 остаётся на 100k для совместимости. Version 2 не активирована; для неё сначала нужен opaque bridge старого KEK под новым KEK, иначе существующие `encrypted_dek` станут недоступны.
- JWT по-прежнему не имеет server-side revoke list; абсолютный потолок ограничивает продление, но не отзывает уже выданный токен.
- `docker-compose.yml` официально остаётся localhost-only development profile и не должен публиковаться в internet/untrusted LAN.
- `toEntryPayload()` по-прежнему не переносит `goal_id` в sync payload; это зафиксировано characterization-тестом и не входит в outbox-релиз.
- Legacy Dexie stores `entries` / `life_queue` / `life_ops` остаются в схеме v8 (copy-only). Их удаление — отдельная последующая schema version после подтверждённого релиза.

## Changelog

- **Iteration A:** proposal-only model flow, context envelope, KEK verifier, account isolation и честные privacy формулировки.
- **Iteration B:** per-item sync, CAS delete/undo, timezone/calendar semantics, aggregation contract, шкалы 1–10 и paged export.
- **Iteration C:** encrypted goals/memory/actions/feedback, owner-checked links и rebuildable accepted-memory profile.
- **Iteration D:** Record/Analyze/Review allowlists, deterministic review briefing и due reminder.
- **Iteration E:** SaveScope, revisioned queue, selective ack, tombstones, offline Life merge, synthetic agent cycle и full export.
- **Iteration F:** immutable queue snapshot, server-version carry-forward, local cache, conflict choice, context budget и weekly review.
- **Iteration G:** outcome отдельно от решения, durable atomic feedback, historical week rules и production Dexie queue.
- **Iteration H:** plaintext removal from `life_ops`, transaction race fixes, stale session/export guards, historical correction и two-context tombstones.

### Iteration I — Wave 1 progress

- **1.1 checked (git + test run):** незавершённый Playwright two-context сценарий закоммичен и прошёл; reports/results/blob/cache игнорируются.
- **1.2 checked (git):** `tsconfig.tsbuildinfo` удалён из индекса; TypeScript и stray pytest cache-файлы игнорируются.
- **1.3 checked (config + test runs):** GitHub Actions запускает backend Ruff/unit, frontend typecheck/unit/component и live API с Postgres + Alembic; отдельно установлен чистый Ruff baseline без изменения runtime-контракта.
- **1.4 checked (test run):** unit tests используют `fake-indexeddb` и production Dexie paths — 139/139 passed, skip 0.
- **1.5 checked (test run):** Playwright CT для AuthContext session races — 2/2 passed.
- **1.6 checked (test run):** Playwright E2E account/sync race scenarios — 5/5 passed.
- **1.7 checked (docs):** подробный документ перенесён в архив без потери текста; основной план сокращён.
- **Wave 1 final matrix checked:** `tsc` passed; frontend unit 139/139, component 2/2; Ruff passed; backend unit 35 passed + 5 live skipped; live mode 40/40; Playwright E2E 5/5.

### Iteration I — Wave 2 progress

- **2.1 checked (unit + live):** первичная выборка entry sync ограничена `Entry.user_id`; чужой UUID по-прежнему получает явный `rejected/id_unavailable`.
- **2.2 checked (unit + live):** process-local limiter `(IP, username)` возвращает 429 после пяти неудач за 300 секунд; успешный вход сбрасывает счётчик.
- **2.3 checked (migration + unit + live):** Alembic 0009 добавляет `users.kdf_version=1`; register/login возвращают версию, клиент выбирает строго v1-параметры. PBKDF2 не изменён.
- **2.4 checked (unit + live):** refresh сохраняет исходный `iat`, отказывает после 30 дней и ограничивает `exp` абсолютным потолком.
- **2.5 checked (unit + live):** `GET /api/life` поддерживает `limit/offset/next_offset`; вызов без limit остаётся полным, текущий клиент прозрачно объединяет страницы.
- **2.6 checked (docs):** поддерживаемая граница развёртывания зафиксирована как localhost-only; dev compose прямо запрещено считать production-профилем.
- **Wave 2 final matrix checked:** `tsc` passed; frontend unit 142/142, component 2/2; Ruff passed; backend unit 44 passed + 6 live skipped; live mode 50/50; Playwright E2E 5/5; Alembic current `0009 (head)`.
- **Run note:** первая live-попытка ошибочно попала в старый uvicorn на занятом `:8001` и дала 2 ожидаемых несовпадения старого API; изолированный новый процесс на `:8011` прошёл 50/50.

### Iteration I — Wave 3 progress

- **3.1 checked (design):** единый Dexie `outbox` с entity/operation union, coordinator-строками и двухуровневым ack; `goal_id` omission в `toEntryPayload()` зафиксирован characterization-тестом и не исправлялся.
- **3.2 checked (migration):** Dexie v8 copy-only переносит `entries` / `life_queue` / `life_ops` в `outbox`, сохраняет ISO/epoch даты, historical operation rev и legacy stores; abort оставляет читаемую v7, старая вкладка получает `versionchange`.
- **3.3 checked (runtime):** claim snapshot в Dexie-транзакции до сети; один `flushOutbox` под существующим `withSyncLock`; backend endpoints не изменены.
- **3.4 checked (coordinator):** `feedback_and_action` / `feedback_correction` живут в operation-строках; exact conflict/rejected на feedback или action → `action_conflict`; `submission_id` после `done` не создаёт новую запись.
- **3.5 checked (cutover):** merge/export/tombstones/liveQuery читают outbox; runtime больше не пишет в legacy tables; очистка stores отложена.
- **Wave 3 final matrix checked:** `tsc` passed; frontend unit 149/149, component 3/3; Ruff passed; backend unit 44 passed + 6 live skipped; live mode 50/50 на изолированном `:8011`; Playwright E2E 5/5 на `:5173`.
- **Run note:** host `:8001` всё ещё отдаёт старый API без `kdf_version`; live-матрица, как в волне 2, прогонялась на новом uvicorn `:8011`. Chromium CT покрывает v7→v8 copy, abort-upgrade и `versionchange` старой вкладки.
