# Архитектура сервиса онлайн-очередей

Документ — контекст для Claude Code. Держать в корне проекта и ссылаться из `CLAUDE.md`.

**Стек:** FastAPI (Python 3.12, async) + PostgreSQL 16 + Redis 7 + React (Vite, TypeScript). Деплой — docker compose, вход через nginx во frontend-контейнере.

---

## 1. Ключевая модель: очередь и кабинет

В интерфейсе админ создаёт **кабинеты**. Технически у каждого кабинета есть **очередь** — именно к ней привязаны QR-код, талоны, геозона и расписание. По умолчанию кабинет и очередь создаются вместе (1:1). Если админ объединяет несколько кабинетов в одну очередь (пул: пять окон ЦОНа на одну услугу), то несколько кабинетов ссылаются на одну очередь, а вызов идёт в освободившийся кабинет.

Это единственная модель, которая закрывает и «QR на кабинет», и пул без переделки схемы.

---

## 2. Схема базы данных

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
| is_active | bool | |
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
| client_id | uuid null FK | null у талонов регистратора |
| number | int | порядковый в очереди за день |
| display_number | text | «A-042» |
| status | enum(waiting, called, confirmed, serving, served, no_show, left, transferred) | |
| source | enum(qr, registrar, transfer) | |
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

Токены **stateless**, подписаны HMAC (`QR_TOKEN_SECRET`), в Redis не хранятся. Формат — JWT с полями `q` (queue_id), `nbf`, `exp`, `jti`.

**Выдача пачки.** ТВ запрашивает `GET /api/tv/qr-batch` и получает `server_time` плюс список токенов на `QR_TOKEN_BATCH_MINUTES` вперёд. Токен *i* действует с `t0 + i·TTL` по `t0 + (i+1)·TTL + 15 s` — перекрытие в 15 секунд, чтобы сканирование в момент смены кода не отваливалось. ТВ переключает коды по своему таймеру, синхронизированному с `server_time`, и запрашивает новую пачку, когда осталось меньше 3 минут. Если сеть упала — экран продолжает крутить оставшиеся коды и показывает значок «нет связи».

**Сканирование.** QR содержит `https://<домен>/q?t=<token>`. Страница `/q` берёт геолокацию браузера и вызывает `POST /api/public/scan`. Сервер проверяет по порядку:
1. подпись, `nbf`, `exp`;
2. очередь `open`, расписание, `daily_ticket_limit`;
3. геозона: если `geo_radius_m` не null — расстояние (haversine) от координат клиента до центра ≤ радиус; координаты не переданы → отказ;
4. у клиента нет активного талона в этой очереди (или организации).

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
- CRUD `/admin/queues`, `/admin/queues/{id}/schedule`
- CRUD `/admin/cabinets`, `POST /admin/cabinets/{id}/operators`
- CRUD `/admin/users` (operator, registrar)
- CRUD `/admin/tv-screens` (+ генерация `pairing_code`)
- `GET /admin/analytics?from&to&queue_id?` — среднее ожидание, время приёма по операторам, пики по часам и дням, доля неявок, средняя оценка
- `GET /admin/audit-logs?from&to&action?`
- `PATCH /admin/organization` — брендирование, язык, `one_ticket_per_org`

### Superadmin
- CRUD `/sa/organizations`, `POST /sa/organizations/{id}/admins`
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

1. Модели, миграции, auth с ролями, создание superadmin при старте.
2. Superadmin: организации и админы. Admin: очереди, кабинеты, операторы.
3. QR-токены, `POST /public/scan`, страница посетителя с восстановлением по cookie.
4. Оператор: `call-next`, `no-show`, `return`, `finish`; воркер таймаутов.
5. WebSocket для ТВ, оператора и посетителя; экран ТВ с живым QR.
6. Регистратор, «я здесь», выход из очереди.
7. Web Push, прогноз ожидания.
8. Аналитика и журнал действий.
9. Расписание, лимиты, суточный сброс, пул кабинетов, табло зала, TTS, брендирование, оценка.
