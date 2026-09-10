# Frontend — шаг 3 (сканирование и страница талона)

Что реализовано (см. `ARCHITECTURE.md`, разделы 4, 6 Public, 7, 8, 9 шаг 3):

- Инициализация: Vite + React + TypeScript, `react-router-dom`, `i18next`/`react-i18next`,
  обычный CSS с переменными (`src/styles/global.css`), без UI-библиотек.
- `src/app/` — роутер (`router.tsx`), общий `Layout` с шапкой и переключателем языка,
  инициализация i18n (`i18n.ts`) с определением языка по `navigator.language`,
  сохранением выбора в `localStorage` и словарями `kk`/`ru`/`en` в `app/locales/`.
- `src/api/` — `client.ts` (fetch с `credentials: 'include'`, `ApiError` с `code`/`ticketId`
  из тела ответа `{code, ...}`), `public.ts` (типизированные `scan`, `getMyTickets`, `getTicket`),
  `types.ts`.
- `/q` (`pages/scan/ScanPage.tsx`) — сканирование: геолокация с таймаутом 8с (включая отказ,
  таймаут и небезопасный контекст — во всех случаях сканирование всё равно уходит на бэкенд
  без координат), индикатор во время запроса, редирект на `/t/:id` при успехе или при
  `already_in_queue`, человекочитаемые сообщения для остальных кодов ошибок с подсказкой
  «отсканируйте ещё раз» для `token_expired`.
- `/t/:id` (`pages/ticket/TicketPage.tsx`) — номер талона, позиция, «сейчас вызывают»,
  баннер паузы/закрытия очереди, разные блоки под каждый статус талона. Обновление —
  опрос `GET /api/public/tickets/:id` каждые 5с через хук `hooks/useTicket.ts` (транспорт
  инкапсулирован, замена на WebSocket в шаге 5 не потребует правок компонентов). Место под
  кнопки «я здесь»/«выйти» оставлено (`.ticket-page__actions`), сами кнопки — шаг 6.
- Восстановление сеанса: `/` и `/q` без `?t=` дергают `GET /api/public/me/tickets` и, если
  есть активный талон, редиректят на `/t/:id`; последний id талона дублируется в
  `localStorage` (`lib/ticketStorage.ts`). 404 по талону — экран «талон не найден» с кнопкой
  «проверить мои талоны».
- `/` (`pages/landing/LandingPage.tsx`) — заглушка с названием сервиса (после проверки
  восстановления).

## Известное ограничение (закрыто на бэкенде в шаге 4, фронт ещё не обновлён)

Для статуса `called` в разделе 9 шага 3 просят текст «Вас вызывают, подойдите к `<кабинет>`».
На момент шага 3 `GET /api/public/tickets/:id` отдавал только поля талона/очереди — кабинет
наружу не отдавался, поэтому `TicketPage.tsx` показывал общий текст без названия кабинета.

В шаге 4 бэкенд стал отдавать `cabinet: {id, label}` в этом ответе, когда талон
`called`/`confirmed`/`serving` (см. `app/schemas/public.py: TicketDetailOut.cabinet`,
`app/services/tickets.py: build_ticket_detail`). Шаг 4 фронтенд не трогал (по условию задачи),
так что `TicketPage.tsx` → `StatusBlock` пока не использует это поле — это предстоит сделать в
следующем фронтенд-шаге: подставить `ticket.cabinet?.label` в текст `ticket.status.called`.

## Проверка сборки

```bash
cd frontend
npm install         # один раз — создаёт package-lock.json
npm run build        # tsc -b && vite build — без предупреждений TypeScript
```

## Запуск

```bash
docker compose up -d --build frontend
```

- http://localhost:8080 — собранный фронт (nginx)
- `location /api/` и `/ws/` в `frontend/nginx.conf` проксируют на `backend:8000` — не менялись.
- Для hot reload: `cd frontend && npm run dev` (Vite на :5173, прокси в `vite.config.ts`
  на `http://localhost:8000` / `ws://localhost:8000`, как в разделе 8 ARCHITECTURE.md — для
  этого backend должен быть поднят локально на :8000, см. `docker-compose.override.yml`).

## Ручной сквозной тест

Админ-панели ещё нет (шаг 2 бэкенда есть, фронт для неё — в следующих шагах), поэтому очередь
и токен на этом шаге берутся напрямую из Swagger/curl.

1. Поднять стек: `docker compose up -d --build` (db, redis, backend, frontend).
   Suggested one-off if superadmin doesn't exist yet: миграции уже накатаны, суперадмин
   создаётся автоматически из `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` в `.env`.
2. Залогиниться суперадмином и создать организацию и очередь **без геозоны**
   (`geo_radius_m` не передавать — с ноутбука/телефона иначе не встать в очередь, см.
   раздел 8 ARCHITECTURE.md):
   ```bash
   curl -c jar.txt -X POST http://localhost:8080/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"<SUPERADMIN_EMAIL>","password":"<SUPERADMIN_PASSWORD>"}'

   curl -b jar.txt -c jar.txt -X POST http://localhost:8080/api/sa/organizations \
     -H 'Content-Type: application/json' \
     -d '{"name":"Тестовая организация","default_language":"ru"}'
   # -> запомнить "id" организации как ORG_ID

   curl -b jar.txt -c jar.txt -X POST "http://localhost:8080/api/admin/queues?organization_id=ORG_ID" \
     -H 'Content-Type: application/json' \
     -d '{"name":"Регистратура","ticket_prefix":"A"}'
   # -> запомнить "id" очереди как QUEUE_ID
   ```
3. Получить пачку токенов и взять первый:
   ```bash
   curl -b jar.txt -c jar.txt "http://localhost:8080/api/admin/queues/QUEUE_ID/qr-batch?organization_id=ORG_ID"
   ```
4. Открыть `http://localhost:8080/q?t=<token>` в обычном окне браузера — должен появиться
   индикатор «встаём в очередь», затем редирект на `/t/:id` с номером **A-001**.
5. Перезагрузить страницу талона — номер и статус остаются на месте (опрос
   `GET /api/public/tickets/:id` каждые 5с через `useTicket`, плюс id талона в
   `localStorage` на случай возврата на `/` или `/q` без токена).
6. Открыть тот же `http://localhost:8080/q?t=<token>` в окне инкогнито (другой `qc`-cookie,
   другой клиент) — должен появиться **второй** талон, A-002, а не редирект на первый.
7. Открыть тот же токен ещё раз в первом (обычном) окне — должен сразу произойти редирект на
   уже существующий талон A-001 (`already_in_queue`), а не создание нового.

Шаги 4–7 воспроизводят ровно то, что было прогнано через `curl` (тот же HTTP-путь через nginx,
`credentials: include`) при подготовке этой задачи — POST `/api/public/scan` → 201 (A-001) →
GET `/api/public/tickets/:id` → 200 (position 1) → повторный POST → 409 `already_in_queue` с
тем же id → POST с чистым cookie jar → 201 (A-002).
