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
- Финальный полный прогон Iteration I Wave 1 после 1.7 пока не выполнялся.

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
- **1.7 docs:** подробный документ перенесён в архив без потери текста; основной план сокращён. Финальный полный прогон Wave 1 не заявлен и не выполнялся.
