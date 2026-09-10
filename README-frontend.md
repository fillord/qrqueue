# Frontend — шаг 4b (вход персонала, панель оператора)

Что реализовано в этом шаге (см. `ARCHITECTURE.md`, разделы 6 Auth/Operator, 7, 9 шаг 4b):

- `src/app/AuthContext.tsx` — сессия персонала: `GET /api/auth/me` на старте (cookie httpOnly,
  сама сессия недоступна фронту напрямую), `login()`/`logout()`. Любой `401` от `api/client.ts`
  шлёт `window` событие `api:unauthorized`; контекст сбрасывает пользователя, и
  `ProtectedRoute` сам уводит на `/login` на следующем рендере — не нужно, чтобы каждый вызов
  API знал про авторизацию.
- `src/app/ProtectedRoute.tsx` + `roleHome.ts` — защищённый роут с проверкой роли; несовпадение
  роли уводит на «домашний» маршрут пользователя, а не даёт 404/403 на чужом экране.
- `/login` (`pages/login/LoginPage.tsx`) — `POST /api/auth/login` → `GET /api/auth/me`.
  `{totp_required: true}` обрабатывается как ошибка «2FA не поддерживается» (сам бэкенд пока
  всегда возвращает `false` — это на будущее). После входа редирект по роли: `operator` →
  `/operator`, `registrar`/`org_admin`/`superadmin` → соответствующие заглушки «в разработке»
  (`pages/placeholder/InDevelopmentPage.tsx`).
- `/operator` (`pages/operator/CabinetSelectPage.tsx`) — карточки из `GET /api/operator/cabinets`.
  Один кабинет или уже запомненный в `localStorage` (`lib/operatorCabinet.ts`) — выбирается
  автоматически (`POST .../select` продлевает TTL Redis-ключа) без клика.
- `/operator/queue` (`pages/operator/OperatorQueuePage.tsx`) — рабочий экран:
  - опрос `GET /api/operator/queue` каждые 3с через `hooks/useOperatorQueue.ts` (транспорт
    изолирован для замены на WebSocket в шаге 5);
  - слева текущий талон (номер, статус, живой таймер с момента `called_at` —
    `hooks/useElapsedSeconds.ts`, счётчик повторных вызовов) и кнопки только для допустимых по
    машине состояний переходов;
  - `Завершить`/`Не явился`/`Перевести` освобождают кабинет (`cabinet_status` → `free`), но
    экран **не** вызывает следующего талона сам — это осознанное решение оператора, отдельная
    кнопка «Вызвать следующего» (или пробел);
  - справа — ожидающие (время ожидания) и «Не явились сегодня» с «Вернуть в очередь»;
  - шапка — кабинет/очередь (название подтягивается точечно из уже существующих
    `GET /operator/cabinets` и `GET /operator/queues`, в ответ `/operator/queue` бэкенд их не
    добавляет), счётчик ожидающих, «Пауза» (с причиной, модалка) / «Возобновить»; при паузе —
    затемнение рабочей области и плашка;
  - «Перевести» — модалка со списком из `GET /api/operator/queues`;
  - горячие клавиши (пробел/Enter/F), подсказка в подвале;
  - `409`/`404` от действий (`cabinet_busy`, `queue_empty`, `invalid_transition`,
    `cabinet_has_no_queue`, `active_ticket`, `cabinet_not_paused`, `target_queue_unavailable`) —
    тост (`hooks/useToasts.ts` + `components/ToastStack.tsx`) без перезагрузки экрана;
    `cabinet_not_selected` — сброс `localStorage` и редирект на `/operator` (там кабинет
    перевыбирается автоматически, см. выше).
- `/t/:id` (`pages/ticket/TicketPage.tsx`) — статусы `called`/`serving` теперь показывают
  «Вас вызывают! Подойдите к «{{label}}».» / «Идёт приём. Кабинет: «{{label}}».» из
  `ticket.cabinet.label` (поле в `TicketDetailOut` появилось в шаге 4a, фронт до сих пор его не
  использовал — закрыто в этом шаге).
- Бэкенд в этом шаге не менялся: `GET /api/operator/queue` и `GET /api/operator/queues` уже
  отдавали всё нужное (`called_at`/`call_count`/`no_show` в `OperatorQueueOut`,
  `schemas/operator.py`) на момент начала работы.
- Строки — только через i18n, `kk`/`ru`/`en` (`app/locales/*.json`), новые разделы: `auth`,
  `login`, `placeholder`, `operator`.

## Проверка сборки

```bash
cd frontend
npm install
npm run build        # tsc -b && vite build — без ошибок TypeScript
```

## Запуск

```bash
docker compose up -d --build
docker compose exec backend alembic upgrade head   # если ещё не накатано
```

- http://localhost:8080 — собранный фронт (nginx), `/api/` и `/ws/` проксируются на backend.

## Ручной сквозной тест

Админ-панели ещё нет, поэтому организация/очередь/кабинет/оператор на этом шаге заводятся через
`curl` (суперадмин создаётся автоматически из `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` в `.env`).
Весь сценарий ниже прогнан через `curl` при подготовке задачи — см. коммит для точных вызовов.

1. Поднять стек, залогиниться суперадмином, создать организацию, админа, кабинет (очередь
   создаётся автоматически 1:1), оператора и назначить его на кабинет — как в разделе 8/9
   ARCHITECTURE.md, через `/api/sa/...` и `/api/admin/...`.
2. **Вход оператором**: открыть `http://localhost:8080/login`, ввести email/пароль оператора →
   редирект на `/operator`.
3. **Выбор кабинета**: один кабинет — выбирается сам, редирект на `/operator/queue` без клика
   (несколько — показываются карточки, кликнуть по нужной).
4. **Два талона через `/q` в двух окнах**: получить QR-токен очереди
   (`GET /api/admin/queues/QUEUE_ID/qr-batch?organization_id=ORG_ID`), открыть
   `http://localhost:8080/q?t=<token>` в обычном окне и в окне инкогнито — два разных талона
   (А-001, А-002), у каждого своя `/t/:id`.
5. **Вызвать**: на `/operator/queue` нажать «Вызвать следующего» (или пробел) — берётся А-001,
   кабинет `busy`, справа остаётся А-002.
6. **На странице талона А-001** видно «Вас вызывают! Подойдите к «Кабинет 1».» — `cabinet.label`
   подставлен из ответа `GET /api/public/tickets/:id`.
7. **Завершить**: «Начать приём» (или Enter) → «Завершить» (или `F`) — талон переходит в
   `served`, кабинет освобождается (`cabinet_status` → `free`), но экран остаётся без активного
   талона — следующий сам по себе не вызывается.
8. **Вызвать следующего снова**: нажать «Вызвать следующего» (или пробел) ещё раз — берётся
   А-002. Так по одному нажатию на каждый талон, без автоматики.
