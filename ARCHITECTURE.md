# Архитектура сервиса онлайн-очередей

Документ — контекст для Claude Code. Держать в корне проекта и ссылаться из `CLAUDE.md`.

**Стек:** FastAPI (Python 3.12, async) + PostgreSQL 16 + Redis 7 + React (Vite, TypeScript). Деплой — docker compose, вход через nginx во frontend-контейнере.

---

## 1. Ключевая модель: очередь и кабинет

В интерфейсе админ создаёт **кабинеты**. Технически у каждого кабинета есть **очередь** — именно к ней привязаны QR-код, талоны, геозона и расписание. По умолчанию кабинет и очередь создаются вместе (1:1). Если админ объединяет несколько кабинетов в одну очередь (пул: пять окон ЦОНа на одну услугу), то несколько кабинетов ссылаются на одну очередь, а вызов идёт в освободившийся кабинет.

Это единственная модель, которая закрывает и «QR на кабинет», и пул без переделки схемы.

---

## 2. Схема базы данных

### Стойки выдачи талонов (отдельно от учёта времени)

`queue_kiosks` принадлежит организации: название, UUID выбранных очередей, язык, флаг печати (по умолчанию false), ширина бумаги 58/80 мм, одноразовый шестизначный код подключения с TTL 24 часа, SHA-256 отдельного device token, heartbeat и soft-delete. Администратор организации управляет ими через `/api/admin/queue-kiosks`; `/unpair` отзывает устройство и выдаёт новый код. Все изменения аудируются, коды и токены в аудит не попадают.

Публичный экран `/kiosk` использует `/api/queue-kiosk/pair`, затем собственный заголовок `X-Queue-Kiosk-Token` для `/state`, `/tickets`, `/receipts/{request_id}` и `/receipts/{request_id}/print`. Токен учёта времени и staff-cookie не заменяют эту авторизацию. Выдача ограничена выбранными очередями активной организации; действует общий сервис талонов, расписание, пауза и суточный лимит. Поскольку это физическое доверенное устройство без телефона посетителя, QR/геозона и ограничение по cookie посетителя здесь не применяются; как у регистратора, `client_id = null`. Выдача ограничена 20 запросами в минуту на стойку, подключение — 5 попытками в минуту на IP.

`queue_kiosk_issues` хранит уникальную пару `(kiosk_id, request_id)`, уникальный `ticket_id` и неизменяемый JSON-снимок талона. Блокировка строки стойки сериализует выдачу, повторы, отзыв и изменение настроек. Запись выдачи и обычный талон сохраняются одной транзакцией; событие публикуется после commit. Повтор с тем же UUID возвращает тот же талон, даже после изменения доступности очереди; другой queue_id с тем же UUID даёт 409. GET восстановления ничего не выдаёт. На устройстве UUID незавершённого запроса хранится в sessionStorage; таймаут 15 секунд допускает повтор с прежним UUID, а не создание нового.

Талон получает `created_at` в момент вставки после блокировки очереди и присвоения номера (PostgreSQL `clock_timestamp()`), а не по времени начала транзакции. При равном `created_at` FIFO-порядок вызова опирается на порядковый номер талона (`tickets.number`), UUID — лишь последний запасной критерий. Вернувшиеся талоны по-прежнему имеют приоритет по `called_at`.

Печать разрешается сервером для каждого запроса: возвращается сохранённый талон и текущая ширина бумаги. В журнал попадает только `queue_kiosk.print_requested`, не подтверждение физической печати. Повтор печати не вызывает `/tickets`. Отдельный CSS-макет содержит организацию, услугу, крупный номер, дату/время и инструкцию ждать вызова; личных данных и приватных ссылок нет. Сброс экрана через 45 секунд приостанавливается на время диалога печати. Миграция `a5c7e9f1b3d6` добавляет таблицы и значение enum `kiosk`; после появления таких талонов старый backend несовместим. Автоматический downgrade запрещён, предпочтительно исправление вперёд; восстановление — только по отдельному плану из проверенной копии.

Все первичные ключи — `uuid`. Все `created_at`/`updated_at` — `timestamptz`. Время везде UTC, часовой пояс организации применяется только при отображении и при суточном сбросе нумерации.

### organizations
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | |
| name | text | |
| slug | text unique | для URL и демо |
| timezone | text | default `Asia/Almaty` |
| default_language | enum(kk, ru, en) | |
| logo_url, brand_color | text null | брендирование ТВ |
| plan | enum(trial, basic, pro) | |
| trial_ends_at | timestamptz null | |
| one_ticket_per_org | bool | default false: лимит «один активный талон» действует в рамках очереди; true — в рамках всей организации |
| is_active | bool | |
| deleted_at | timestamptz null | Архивация без удаления очередей, талонов и аудита |
| video_large_upload_enabled | bool | Ручное расширение лимита одного видео с 50 до 100 МБ суперадминистратором |

### users
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | |
| email | citext unique | |
| password_hash | text | bcrypt |
| full_name | text | |
| role | enum(superadmin, org_admin, operator, registrar) | |
| organization_id | uuid null FK | null только у superadmin |
| totp_secret | text null | 2FA, обязательна для superadmin и org_admin |
| auth_version | integer | Входит в JWT; увеличивается при сбросе 2FA и отзывает прежние сессии/ожидающие коды |
| is_active | bool | |
| deleted_at | timestamptz null | Архивный пользователь не может войти; история сохраняется |
| last_login_at | timestamptz null | |

### queues
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | |
| organization_id | uuid FK | |
| name | text | «Терапевт, каб. 12» |
| ticket_prefix | text | «A», «B» — для номера на табло |
| status | enum(open, paused, closed) | текущее состояние |
| latitude, longitude | numeric null | центр геозоны |
| geo_radius_m | int null | null = проверка геолокации отключена (для локальной разработки и демо) |
| presence_timeout_min | int | default из `.env`, сколько минут на «я здесь» |
| daily_ticket_limit | int null | null = без лимита |
| last_ticket_number | int | счётчик |
| counter_date | date | дата счётчика в TZ организации; если не сегодня — сброс в 0 |
| is_active | bool | |
| deleted_at | timestamptz null | Архивация без удаления талонов и расписания |

### queue_schedules
| Поле | Тип |
|---|---|
| id | uuid |
| queue_id | uuid FK |
| weekday | smallint (0 = пн … 6 = вс) |
| opens_at, closes_at | time |

Нет записей на день — очередь в этот день закрыта. Воркер переводит `status` в `closed` по `closes_at` и в `open` по `opens_at`; ручная пауза оператора имеет приоритет до конца дня.

### cabinets
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | |
| organization_id | uuid FK | |
| queue_id | uuid null FK | к какой очереди подключён |
| label | text | «Кабинет 12», «Окно 3» |
| status | enum(free, busy, paused, offline) | |
| current_ticket_id | uuid null FK tickets | кого обслуживает сейчас |
| is_active | bool | |
| deleted_at | timestamptz null | Архивация без удаления назначений и истории |

### cabinet_operators
`cabinet_id`, `user_id` — какие операторы могут работать в кабинете. Оператор при входе выбирает кабинет из своих.

### clients
Посетитель = устройство. Идентификатор живёт в cookie `qc` (httpOnly, 1 год) с дублем в localStorage.
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | значение cookie |
| fingerprint_hash | text null | UA + экран + TZ, мягкий сигнал |
| language | enum(kk, ru, en) null | |
| last_seen_at | timestamptz | |

### push_subscriptions
`id`, `client_id FK`, `endpoint text unique`, `keys jsonb`, `created_at`. Web Push (VAPID).

### tickets
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | |
| organization_id | uuid FK | денормализация для аналитики |
| queue_id | uuid FK | |
| client_id | uuid null FK | null у талонов регистратора и стойки выдачи |
| number | int | порядковый в очереди за день |
| display_number | text | «A-042» |
| status | enum(waiting, called, confirmed, serving, served, no_show, left, transferred) | |
| source | enum(qr, registrar, transfer, kiosk) | |
| cabinet_id | uuid null FK | кто вызвал / обслужил |
| called_by | uuid null FK users | |
| call_count | int | default 0, растёт при повторном вызове |
| transferred_from | uuid null FK tickets | цепочка при переводе |
| created_at, called_at, confirmed_at, serving_started_at, finished_at | timestamptz | для аналитики ожидания и приёма |
| rating | smallint null | 1–5 |
| rating_comment | text null | |

**Индексы:**
- `(queue_id, status, created_at)` — выборка очереди.
- Частичный уникальный `(client_id, queue_id) WHERE status IN ('waiting','called','confirmed','serving')` — один активный талон на устройство в очереди. При `one_ticket_per_org` — дополнительная проверка в сервисе.
- `(organization_id, created_at)` — аналитика.

### tv_screens
| Поле | Тип | Примечание |
|---|---|---|
| id | uuid | |
| organization_id | uuid FK | |
| queue_id | uuid null FK | null = общее табло зала |
| name | text | |
| pairing_code | text null | 6 цифр, показывается на экране до привязки |
| device_token | text null | выдаётся после привязки, хранится на устройстве |
| language | enum | |
| last_seen_at | timestamptz null | |
| display_mode | text(queue, schedule, media) | Отдельные ТВ для очереди, расписания и роликов с объявлениями |
| slide_seconds | int | Время показа слайда расписания или изображения, 5–120 секунд |
| ads_enabled | bool | Разрешение рекламы на конкретном ТВ, по умолчанию false |
| media_playlist_mode | text(all, selected) | Повторять все активные материалы либо только отмеченные |
| selected_media_ids | uuid[] | Выбранные материалы конкретного ТВ; ID проверяются по организации |
| queue_selection_mode | text(all, selected) | Для общего табло: все активные очереди либо только отмеченные |
| selected_queue_ids | uuid[] | Выбранные очереди общего табло; ID проверяются по организации |
| cabinet_selection_mode | text(all, selected) | Показывать вызовы всех либо только отмеченных кабинетов |
| selected_cabinet_ids | uuid[] | Выбранные кабинеты; ID проверяются по организации |

### departments и department_schedule_items
`departments`: `id`, `organization_id`, `name`, `is_active`, `sort_order`.
`department_schedule_items`: `id`, `department_id`, `doctor_name`, `service_name?`, `room?`, `weekday` (0–6), `starts_at`, `ends_at`, `sort_order`. Время локальное в часовом поясе организации. XLSX-импорт разворачивает ячейки Пн–Вс в записи по дням; ТВ собирает их обратно в таблицу с одной строкой на врача. Все семь дней видны одновременно; при длинном списке врачей перелистываются только строки отделения, затем экран переходит к следующему отделению.

### attendance_departments, attendance_employees, attendance_employee_schedules и attendance_events
`attendance_departments`: `id`, `organization_id`, `name`, `is_active`; собственный справочник учёта времени, без связи с `departments`, врачами расписания или ТВ. Уникальность имени в организации; API дополнительно отклоняет дубликаты без учёта регистра/краевых пробелов. `attendance_employees` хранит отдельную карточку сотрудника, `department_id FK attendance_departments.id`, резервное текстовое название отделения, должность, личный код в виде digest, зашифрованный шаблон лица и состояние регистрации. Сотрудники из `department_schedule_items` автоматически не создаются. `attendance_employee_schedules`: `organization_id`, `employee_id`, `weekday` (0–6), `starts_at`, `ends_at`; для сотрудника допускается не более одного интервала на день, время локальное в часовом поясе организации. `attendance_events` хранит фактические `in`/`out` с источником, временем и данными исправления. Подробный отчёт сравнивает первую отметку прихода и последнюю отметку ухода с планом, но отработанное время считает только по закрытым парам `in → out`, исключая перерывы и не добавляя отсутствующий уход. Сотрудники без графика в расчёт плановых смен не входят и явно показываются администратору.

### tv_media и tv_media_chunks
`tv_media`: `id`, `organization_id`, `title`, `kind` (`video` или `advertisement`), MIME, ожидаемый размер, загруженный размер, готовность, активность, порядок, дата создания. `tv_media_chunks`: `(media_id, chunk_index)` и бинарный фрагмент до 512 КБ. Это позволяет загружать 50/100 МБ через стандартный лимит nginx, хранить файлы устойчиво к пересозданию контейнера и отдавать байтовые диапазоны для воспроизведения. Реклама фильтруется по `ads_enabled` ТВ. Экран `schedule` получает только выбранные для него отделения, `media` — только ролики и объявления. Медиаэкран по кругу воспроизводит все активные материалы либо выбранные для него; видео идёт до конца, одиночный ролик повторяется. Между материалами видеоплеер на короткое время размонтируется, чтобы декодер Android TV освободился; ошибочный элемент временно пропускается и повторно пробуется через 30 секунд. Для вертикального видео свободные края заполняет размытая копия того же ролика, чёткий кадр остаётся целым. При миграции прежние экраны `signage` становятся `schedule`. Хранение медиа увеличивает объём PostgreSQL и бэкапов.

### audit_logs
| Поле | Тип |
|---|---|
| id | bigserial |
| organization_id | uuid null |
| actor_type | enum(user, client, system) |
| actor_id | uuid null |
| action | text («ticket.called», «queue.paused», «user.created») |
| entity_type, entity_id | text, uuid |
| payload | jsonb |
| ip | inet null |
| created_at | timestamptz |

Superadmin видит всё, org_admin — только по своей `organization_id`.

---

## 3. Машина состояний талона

```
waiting ──call-next──▶ called ──confirm / start──▶ confirmed ──start──▶ serving ──finish──▶ served
   │                     │                                                   
   │                     ├──timeout / no-show──▶ no_show ──return──▶ waiting
   │                     └──recall (call_count+1, остаётся called)
   ├──leave (клиент)──▶ left
   └──transfer──▶ transferred  (создаётся новый талон в другой очереди, source=transfer)
```

- `call-next` берёт самый старый `waiting`, переводит в `called`, пишет `cabinet_id`, `called_at`, ставит кабинет в `busy`.
- Клиент нажал «я здесь» → `confirmed`. Оператор может начать приём сразу из `called`, минуя `confirmed`.
- Воркер каждые 10 секунд: талоны в `called` старше `presence_timeout_min` → `no_show`, кабинет освобождается, отправляется push «вы пропустили вызов».
- `return` из `no_show` ставит талон в начало очереди (по `called_at`, а не по `created_at`), чтобы человек не ждал заново.
- Все переходы — только через `services/tickets.py`, никаких прямых `UPDATE status` из роутов.

---

## 4. Живой QR-код

Токены **stateless**, подписаны HMAC (`QR_TOKEN_SECRET`), в Redis не хранятся. QR одной очереди содержит JWT с `q` (queue_id), `nbf`, `exp`, `jti`. QR общего табло содержит `s` (screen_id) вместо `q`.

**Выдача пачки.** ТВ запрашивает `GET /api/tv/qr-batch` и получает `server_time` плюс список токенов на `QR_TOKEN_BATCH_MINUTES` вперёд. Токен *i* действует с `t0 + i·TTL` по `t0 + (i+1)·TTL + 15 s` — перекрытие в 15 секунд, чтобы сканирование в момент смены кода не отваливалось. ТВ переключает коды по своему таймеру, синхронизированному с `server_time`, и запрашивает новую пачку, когда осталось меньше 3 минут. Если сеть упала — экран продолжает крутить оставшиеся коды и показывает значок «нет связи».

**Сканирование.** QR содержит `https://<домен>/q?t=<token>`. Страница `/q` берёт геолокацию браузера и вызывает `POST /api/public/scan`. Сервер проверяет по порядку:
1. подпись, `nbf`, `exp`;
2. очередь `open`, расписание, `daily_ticket_limit`;
3. геозона: если `geo_radius_m` не null — расстояние (haversine) от координат клиента до центра ≤ радиус; координаты не переданы → отказ;
4. у клиента нет активного талона в этой очереди (или организации).

Для общего табло `/q` отправляет QR в `POST /public/scan-options`. Сервер проверяет срок и подпись, находит актуальные активные очереди, назначенные экрану, и выдаёт подписанный `selection_token` с `ss` (screen_id) на `QR_SELECTION_TTL_SECONDS` (по умолчанию 5 минут). Посетитель выбирает очередь на телефоне и отправляет `POST /public/scan` с этим токеном и `queue_id`. Сервер повторно проверяет назначение очереди экрану и применяет те же ограничения расписания, геозоны, дневного лимита и активного талона, что и для QR отдельной очереди. Изменение настроек табло сразу прекращает выдачу талонов для убранной очереди. Выбор кабинетов управляет только показом вызовов, но не распределением талонов внутри очереди.

Токен многоразовый в пределах TTL: несколько человек у одного экрана сканируют один и тот же код. Защита от повторов — на уровне клиента, не токена.

---

## 5. Реальное время

Redis pub/sub, канал `queue:{queue_id}`. Бэкенд публикует события, WebSocket-менеджер раздаёт их подписчикам.

| Событие | Кто получает |
|---|---|
| `ticket.created` | ТВ, оператор |
| `ticket.called` | ТВ, оператор, клиент этого талона (+ push) |
| `ticket.updated` (любой переход) | ТВ, оператор, клиент |
| `queue.status` (open/paused/closed) | ТВ, оператор, клиенты |
| `position` (пересчёт позиций) | клиенты очереди |

Клиент дополнительно получает push через Web Push, когда его позиция ≤ 3 и когда его вызвали. Push не заменяет WebSocket, а дублирует на случай закрытого браузера.

Переподключение: все WS-клиенты при reconnect делают `GET` актуального состояния, а не полагаются на пропущенные события.

---

## 6. API

Все ответы — JSON. Аутентификация персонала — JWT в httpOnly cookie, ТВ — `device_token` в заголовке, посетитель — cookie `qc`. Префикс `/api`.

### Auth
- `POST /auth/login` → cookie; если у роли включена 2FA — ответ `{"totp_required": true}`
- `POST /auth/totp` — второй шаг
- `POST /auth/logout`
- `GET /auth/me`

Если единственный суперадминистратор теряет TOTP, восстановление выполняется из доверенной серверной консоли командой `scripts/recover_superadmin_totp.py` после проверки действующего пароля. Команда допускает только `SUPERADMIN_EMAIL`, очищает TOTP, увеличивает `auth_version` и создаёт запись аудита. Следующий вход требует новой привязки TOTP; веб-обхода второго фактора нет.

### Public (посетитель)
- `POST /public/scan` `{token, lat?, lng?, fingerprint?}` → талон; создаёт клиента и cookie при первом визите
- `GET /public/me/tickets` — активные талоны устройства (для восстановления страницы после перезагрузки)
- `GET /public/tickets/{id}` — талон, позиция, прогноз ожидания, состояние очереди
- `POST /public/tickets/{id}/confirm` — «я здесь»
- `POST /public/tickets/{id}/leave`
- `POST /public/tickets/{id}/rate` `{rating, comment?}` — только для `served`
- `POST /public/push/subscribe`
- `WS /ws/ticket/{id}`

### TV
- `POST /tv/pair` `{code}` → `device_token`
- `GET /tv/state` — очередь (или все очереди зала): текущий вызов, число ожидающих, статус
- `GET /tv/qr-batch`
- `WS /ws/tv`

### Operator
- `GET /operator/cabinets` — мои кабинеты; `POST /operator/cabinets/{id}/select`
- `GET /operator/queue` — список ожидающих текущей очереди
- `POST /operator/call-next`
- `POST /operator/tickets/{id}/recall` | `/no-show` | `/return` | `/start` | `/finish`
- `POST /operator/tickets/{id}/transfer` `{queue_id}`
- `POST /operator/cabinet/pause` `{reason?}` | `/resume`
- `WS /ws/operator`

### Registrar
- `GET /registrar/queues`
- `POST /registrar/tickets` `{queue_id, note?}` → талон без клиента, номер называется устно или печатается

### Admin (org_admin, в рамках своей организации)
- CRUD `/admin/queues`, `/admin/queues/{id}/schedule`: `DELETE` архивирует очередь после завершения активных талонов и архивации кабинетов; `GET ?include_archived=true` показывает архив, `POST /admin/queues/{id}/restore` восстанавливает выключенной и закрытой
- CRUD `/admin/cabinets`, `POST /admin/cabinets/{id}/operators`: `DELETE` архивирует кабинет без активного обслуживания, `GET ?include_archived=true` показывает архив, `POST /admin/cabinets/{id}/restore` восстанавливает выключенным; назначения и история сохраняются
- CRUD `/admin/users` (operator, registrar): удаление архивирует запись, `POST /admin/users/{id}/restore` возвращает её деактивированной
- CRUD `/admin/tv-screens` (+ генерация `pairing_code`)
- CRUD `/admin/departments` и `/admin/departments/{id}/schedule` — отделения, врачи, кабинеты и часы приёма по дням недели
- `POST /admin/departments/import` — проверенный XLSX-импорт; атомарно заменяет расписание отделений из файла в пределах организации
- `/admin/tv-media` — метаданные, загрузка частями, завершение, активация, удаление; `/tv/media/{id}` — публичная выдача активного материала с HTTP Range
- `GET /admin/analytics?from&to&queue_id?` — среднее ожидание, время приёма по операторам, пики по часам и дням, доля неявок, средняя оценка
- `GET /admin/audit-logs?from&to&action?`
- `PATCH /admin/organization` — брендирование, язык, `one_ticket_per_org`

### Superadmin
- CRUD `/sa/organizations` и `/sa/users` (кроме платформенного superadmin); удаление архивирует, `POST /sa/organizations/{id}/restore` и `POST /sa/users/{id}/restore` восстанавливают деактивированными
- `POST /sa/organizations/{id}/admins` — создание администратора организации
- всё из `/admin/*` с параметром `organization_id`
- `GET /sa/audit-logs`, `GET /sa/analytics`

**Права:** каждый роут проверяет роль и принадлежность к организации через одну зависимость `require_role(...)`. Любой доступ к сущности чужой организации — 404, не 403.

**Rate limiting** (Redis): `/public/scan` — 10 запросов в минуту на IP (`CF-Connecting-IP` за Cloudflare), `/auth/login` — 5 в минуту на email, `/tv/pair` — 5 в минуту на IP.

---

## 7. Структура кода

```
backend/
├── alembic/                  миграции
├── app/
│   ├── main.py               FastAPI, роутеры, startup (создание superadmin из .env)
│   ├── config.py             pydantic-settings, читает .env
│   ├── db.py                 async engine, session
│   ├── redis.py              подключение, pub/sub helpers
│   ├── models/               SQLAlchemy: organization, user, queue, cabinet, client, ticket, tv_screen, audit_log
│   ├── schemas/              Pydantic-модели запросов/ответов
│   ├── api/
│   │   ├── auth.py  public.py  tv.py  operator.py  registrar.py  admin.py  superadmin.py
│   │   └── deps.py           get_db, current_user, current_client, current_tv, require_role
│   ├── services/
│   │   ├── tickets.py        машина состояний, единственное место смены статусов
│   │   ├── numbering.py      суточный счётчик, display_number
│   │   ├── qr_tokens.py      выпуск пачки и проверка
│   │   ├── geo.py            haversine
│   │   ├── notifications.py  Web Push
│   │   ├── analytics.py
│   │   └── audit.py
│   ├── ws/
│   │   ├── manager.py        подписки, рассылка из Redis pub/sub
│   │   └── routes.py         /ws/ticket, /ws/tv, /ws/operator
│   └── workers/
│       ├── timeouts.py       called → no_show
│       └── schedules.py      open/closed по расписанию, суточный сброс
└── tests/

frontend/src/
├── app/                      роутер, провайдеры, i18n (kk/ru/en)
├── api/                      клиент к /api, WS-хук с автопереподключением
├── pages/
│   ├── landing/              /            публичный лендинг + демо
│   ├── scan/                 /q           разбор токена, геолокация, POST /scan
│   ├── ticket/               /t/:id       страница посетителя (PWA)
│   ├── tv/                   /tv          экран кабинета и табло зала (fullscreen, TTS)
│   ├── operator/             /operator
│   ├── registrar/            /registrar
│   ├── admin/                /admin
│   └── superadmin/           /sa
├── components/
└── sw.ts                     service worker: push, кэш оболочки
```

---

## 8. Локальная разработка

```bash
docker network create web          # один раз
cp .env.example .env               # заполнить секреты
docker compose up -d --build       # override подхватится сам
docker compose exec backend alembic upgrade head
```

- API: http://localhost:8000/docs
- Собранный фронт: http://localhost:8080
- Для hot reload фронта: `cd frontend && npm run dev` — Vite на :5173 с прокси в `vite.config.ts`:
  ```ts
  server: { proxy: { '/api': 'http://localhost:8000', '/ws': { target: 'ws://localhost:8000', ws: true } } }
  ```
- Геозона: у тестовых очередей оставить `geo_radius_m = null`, иначе с ноутбука не встать в очередь.
- Тест «двух устройств»: обычное окно и окно инкогнито — разные cookie, разные клиенты.

---

## 9. Порядок реализации (MVP)

### Дополнение 2026-10-06: рабочий календарь и Telegram

- Собственный справочник учёта времени: `GET/POST /attendance/admin/departments`, `PATCH/DELETE /attendance/admin/departments/{id}`, `POST .../{id}/restore`; административные роли, чужая сущность — 404, все изменения аудируются. DELETE архивирует запись без удаления истории и запрещён при наличии неархивных сотрудников. Запись отделений и назначение/импорт сотрудников сериализованы блокировкой организации. В интерфейсе отдельный маршрут `/admin/attendance/departments`; карточки, шаблон/импорт Excel, сводка, календарь и отчёты не обращаются к API/моделям ТВ.
- Миграция `f4a6b8c0d2e5` после `e3f5a7b9c1d4`: новый `attendance_departments`, перенос только существующих кадровых назначений/текстовых названий с новыми UUID и смена FK сотрудника. Таблицы ТВ, ID сотрудников, биометрия/коды, события, графики, календарь и Telegram не меняются. Неиспользуемые отделения ТВ не копируются. Автоматический downgrade заблокирован: обратное слияние справочников требует отдельного плана и проверенного backup. Предыдущий backend после смены FK не сможет принимать новые назначения по ID ТВ; полноценный откат версии требует согласованного плана, предпочтительно исправление вперёд. Эта доработка пока локальная.
- `attendance_calendar_days`: уникальная пара сотрудник/дата, тип `shift/off/vacation/sick/absence`, время только для смены, основание и автор. Dated-настройка заменяет недельный график. Все записи ограничены организацией и аудируются; фактические отметки не переписываются.
- `services/workforce.py`: единый расчёт плана, закрытых интервалов работы и отклонений для подробного отчёта, календаря, XLSX и напоминаний. Незакрытые интервалы не дополняются; перерывы не включаются в факт.
- API администратора: `GET/POST /attendance/admin/calendar`, `POST /attendance/admin/calendar/{id}/reset`, `GET /attendance/admin/timesheet.xlsx`; административные роли, чужая сущность — 404. Период записи до 366 дней, чтение по месяцу.
- Nullable `telegram_chat_id` в `clients` и `attendance_employees`; API показывает лишь признак подключения. `services/telegram.py` выдаёт одноразовые Redis-ссылки (GETDEL, TTL 600), принимает только личные чаты, проверяет владельца талона. Callback отмены использует существующий `services/tickets.leave`; GET не меняет статус.
- API подключения: `GET/POST /public/tickets/{id}/telegram` для владельца, `POST /attendance/admin/employees/{id}/telegram` для администратора своей организации. `/stop` отзывает связи чата.
- `workers/telegram.py`: polling одного выделенного бота, Redis lease и сохранённый offset; напоминания с дедупликацией и повторной попыткой при сбое доставки. В lifespan задачи включаются только при наличии обеих настроек бота. Токен не логируется, секреты остаются в конфигурации. Сообщения ru/kk/en; внешний webhook не требуется.
- Миграция `e3f5a7b9c1d4` следует за `d2e4f6a8b0c3` и только добавляет таблицу/nullable-поля. Выпуск `ef688ef` установлен на Oracle 6 октября после проверенного backup; Telegram на сервере ещё не настроен.

1. Модели, миграции, auth с ролями, создание superadmin при старте.
2. Superadmin: организации и админы. Admin: очереди, кабинеты, операторы.
3. QR-токены, `POST /public/scan`, страница посетителя с восстановлением по cookie.
4. Оператор: `call-next`, `no-show`, `return`, `finish`; воркер таймаутов.
5. WebSocket для ТВ, оператора и посетителя; экран ТВ с живым QR.
6. Регистратор, «я здесь», выход из очереди.
7. Web Push, прогноз ожидания.
8. Аналитика и журнал действий.
9. Расписание, лимиты, суточный сброс, пул кабинетов, табло зала, TTS, брендирование, оценка.
