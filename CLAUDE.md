# Сервис онлайн-очередей

Перед любой задачей прочитай `ARCHITECTURE.md` — там схема БД, машина состояний талона, API, структура кода и порядок реализации. Не отклоняйся от неё без обсуждения.

## Правила
- Стек: FastAPI (async), SQLAlchemy 2.x async, Alembic, PostgreSQL, Redis, React + Vite + TypeScript.
- Все смены статуса талона — только через `app/services/tickets.py`.
- Любое действие персонала пишется в `audit_logs` через `services/audit.py`.
- Секреты и настройки — только из `.env` через `app/config.py`, ничего не хардкодить.
- Доступ к сущности чужой организации — 404, не 403.
- Интерфейс на трёх языках (kk/ru/en), строки через i18n, не в коде.
- Запуск: `docker compose up -d --build`; миграции: `docker compose exec backend alembic upgrade head`.
- `docker-compose*.yml`, `Dockerfile`, `nginx.conf` не менять без явной просьбы.
- После каждого шага из раздела 9 ARCHITECTURE.md проверяй, что контейнеры поднимаются и тесты проходят.
