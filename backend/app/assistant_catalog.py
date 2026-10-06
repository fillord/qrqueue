from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AssistantCapability:
    id: str
    roles: tuple[str, ...]
    route: str
    label: str
    instructions: str


ALL_STAFF = ("superadmin", "org_admin", "operator", "registrar")


# This is the product manual supplied to the model. Keep labels identical to the
# Russian interface. Routes and action ids are stable machine-readable anchors;
# the model must select one of them instead of inventing a destination.
CAPABILITIES: tuple[AssistantCapability, ...] = (
    AssistantCapability("profile.personal", ALL_STAFF, "/profile", "Настройки профиля — личные данные", "Нажать имя или фото справа сверху; изменить имя или фотографию; сохранить. Email здесь не меняется."),
    AssistantCapability("profile.password", ALL_STAFF, "/profile", "Настройки профиля — пароль", "Нажать имя или фото справа сверху; в блоке «Пароль и безопасность» ввести текущий и новый пароль; сохранить."),
    AssistantCapability("profile.assistant", ALL_STAFF, "/profile", "Настройки профиля — помощник", "Нажать имя или фото справа сверху; в блоке помощника отдельно включить питомца и ответы ИИ."),

    AssistantCapability("admin.home", ("org_admin",), "/admin", "Главная", "Показывает готовность настройки, ожидающих посетителей, активные очереди и состояние экранов."),
    AssistantCapability("admin.problems", ("org_admin",), "/admin/problems", "Центр проблем", "Выбрать фильтр «Все», «Критические» или «Предупреждения»; открыть предложенный раздел для исправления."),
    AssistantCapability("admin.organization", ("org_admin",), "/admin/organization", "Настройки организации", "Изменить название, ссылку на логотип, цвет бренда, язык, часовой пояс и правило одного активного талона; нажать «Сохранить»."),
    AssistantCapability("admin.report", ("org_admin",), "/admin/daily-report", "Дневной отчёт", "Выбрать дату; посмотреть выданные, обслуженные, неявки и среднее ожидание; при необходимости скачать Excel."),
    AssistantCapability("admin.analytics", ("org_admin",), "/admin/analytics", "Аналитика", "Выбрать период и очередь; посмотреть ожидание, обслуживание, неявки, оценки, часы пик и данные операторов."),
    AssistantCapability("admin.audit", ("org_admin",), "/admin/audit-logs", "Журнал действий", "Задать период, тип действия и поиск; открыть запись для разбора изменений."),

    AssistantCapability("queue.create", ("org_admin",), "/admin/queues", "Очереди — создать", "Нажать «Добавить очередь»; заполнить название, префикс, режим и параметры; сохранить."),
    AssistantCapability("queue.manage", ("org_admin",), "/admin/queues", "Очереди — изменить или архивировать", "Найти очередь в таблице; нажать редактирование или архив; изменить поля и сохранить."),
    AssistantCapability("queue.schedule", ("org_admin",), "/admin/queues", "Очереди — график работы", "У нужной очереди открыть недельный график; задать рабочие дни и интервалы; сохранить."),
    AssistantCapability("cabinet.create", ("org_admin",), "/admin/cabinets", "Кабинеты — создать", "Нажать «Добавить кабинет»; указать название; выбрать существующую очередь или автоматическое создание; сохранить."),
    AssistantCapability("cabinet.manage", ("org_admin",), "/admin/cabinets", "Кабинеты — изменить или архивировать", "Найти кабинет; открыть редактирование, назначение операторов или архивирование; сохранить изменения."),
    AssistantCapability("cabinet.assign", ("org_admin",), "/admin/cabinets", "Кабинеты — назначить сотрудников", "У нужного кабинета открыть назначение операторов; отметить сотрудников; сохранить."),
    AssistantCapability("staff.create", ("org_admin",), "/admin/users", "Сотрудники — добавить", "Нажать «Добавить сотрудника»; заполнить имя, email, роль и пароль; сохранить."),
    AssistantCapability("staff.manage", ("org_admin",), "/admin/users", "Сотрудники — найти и изменить", "Использовать поиск, статус, роль и сортировку; у строки сотрудника выбрать редактирование, отключение или архив."),

    AssistantCapability("attendance.summary", ("org_admin",), "/admin/attendance", "Учёт рабочего времени — обзор", "Выбрать период и отделение; посмотреть плановые и фактические часы, опоздания, ранние уходы, переработку и отсутствие; скачать CSV."),
    AssistantCapability("attendance.departments", ("org_admin",), "/admin/attendance/departments", "Учёт рабочего времени — отделения", "Создать отделение в собственном справочнике учёта времени; можно переименовать, архивировать пустое или восстановить отделение. Этот список не связан с расписаниями и ТВ."),
    AssistantCapability("attendance.employee.create", ("org_admin",), "/admin/attendance/employees", "Учёт рабочего времени — добавить сотрудника", "Создать отделение в «Учёт рабочего времени → Отделения», не в расписании ТВ; заполнить имя, отделение, должность и недельный рабочий график; получить четырёхзначный код. Сотрудники этого раздела независимы от врачей в ТВ-расписании."),
    AssistantCapability("attendance.employee.import", ("org_admin",), "/admin/attendance/employees", "Учёт рабочего времени — импорт Excel", "Скачать шаблон; заполнить сотрудников и существующие отделения; выбрать файл и импортировать. Неизвестное отделение вызовет ошибку строки."),
    AssistantCapability("attendance.face", ("org_admin",), "/admin/attendance/employees", "Учёт рабочего времени — лицо сотрудника", "Открыть сотрудника; зарегистрировать лицо камерой либо проверить ожидающую заявку; лично сверить сотрудника и подтвердить."),
    AssistantCapability("attendance.events", ("org_admin",), "/admin/attendance/events", "Учёт рабочего времени — отметки", "Выбрать дату; добавить ручную отметку или нажать «Исправить»; указать тип, время и обязательную причину."),
    AssistantCapability("attendance.enrollment", ("org_admin",), "/admin/attendance/settings", "Учёт рабочего времени — QR регистрации лица", "Включить регистрацию по QR; распечатать статичный QR; при замене нажать «Сменить QR регистрации»."),
    AssistantCapability("attendance.geo", ("org_admin",), "/admin/attendance/settings", "Учёт рабочего времени — геоограничение", "Включить геопозицию; взять текущее местоположение либо ввести широту и долготу; задать радиус; сохранить."),
    AssistantCapability("attendance.kiosk", ("org_admin",), "/admin/attendance/settings", "Учёт рабочего времени — стойка", "Ввести название стойки; добавить; на компьютере стойки открыть /attendance/kiosk и ввести код подключения. Здесь же можно отвязать или удалить стойку."),

    AssistantCapability("tv.create", ("org_admin",), "/admin/tv-screens", "ТВ-экраны — добавить", "Ввести название экрана; выбрать режим, очередь и язык; нажать «Создать»; ввести код на странице /tv/pair телевизора."),
    AssistantCapability("tv.manage", ("org_admin",), "/admin/tv-screens", "ТВ-экраны — настроить", "У существующего экрана нажать «Настроить»; изменить название, режим, очереди, отделения, язык и параметры; сохранить."),
    AssistantCapability("tv.unpair", ("org_admin",), "/admin/tv-screens", "ТВ-экраны — отвязать", "У нужного экрана нажать «Отвязать ТВ»; после этого на телевизоре потребуется новый код подключения."),
    AssistantCapability("tv.delete", ("org_admin",), "/admin/tv-screens", "ТВ-экраны — удалить", "У нужного экрана нажать «Удалить» и подтвердить."),
    AssistantCapability("tv.preview", ("org_admin",), "/admin/tv-screens", "ТВ-экраны — предпросмотр", "Открыть «Настроить» у экрана; использовать скрытый внутри настроек предпросмотр."),
    AssistantCapability("signage.schedule.import", ("org_admin",), "/admin/signage", "Расписание и ролики — импорт расписания", "Скачать шаблон Excel; заполнить Отделение, Врач, Специализация, Кабинет и Пн–Вс; выбрать файл; импортировать."),
    AssistantCapability("signage.departments", ("org_admin",), "/admin/signage", "Расписание и ролики — отделения", "Создать или изменить отделения и строки недельного расписания; затем выбрать нужные отделения в настройках ТВ."),
    AssistantCapability("signage.media", ("org_admin",), "/admin/signage", "Расписание и ролики — видео и объявления", "Добавить YouTube-видео или плейлист; выбрать активные материалы и порядок повтора. Загруженные с сервера ролики больше не являются основным способом."),

    AssistantCapability("operator.cabinet", ("operator",), "/operator", "Выбор кабинета", "Выбрать доступный кабинет перед началом работы."),
    AssistantCapability("operator.call", ("operator",), "/operator/queue", "Работа с очередью — вызвать", "Нажать вызов следующего посетителя; при необходимости повторить вызов."),
    AssistantCapability("operator.service", ("operator",), "/operator/queue", "Работа с очередью — обслуживание", "После прихода посетителя начать обслуживание; затем завершить, отметить неявку или перенести талон."),
    AssistantCapability("operator.pause", ("operator",), "/operator/queue", "Работа с очередью — пауза", "Открыть управление паузой; указать причину и время; возобновить работу после паузы."),
    AssistantCapability("registrar.ticket", ("registrar",), "/registrar", "Регистратор — выдать талон", "Найти нужную очередь; выбрать её и выдать посетителю талон."),

    AssistantCapability("sa.organizations", ("superadmin",), "/sa/organizations", "Организации — поиск и управление", "Использовать поиск, статус и сортировку; открыть организацию для просмотра и изменения."),
    AssistantCapability("sa.organization.create", ("superadmin",), "/sa/organizations", "Организации — создать", "Нажать «Создать организацию»; заполнить данные организации и первого администратора; сохранить."),
    AssistantCapability("sa.organization.manage", ("superadmin",), "/sa/organizations", "Организации — изменить, архивировать или восстановить", "Открыть организацию; изменить данные, лимит видео и администратора либо архивировать/восстановить."),
    AssistantCapability("sa.users", ("superadmin",), "/sa/users", "Все пользователи — поиск и управление", "Использовать поиск, роль, организацию, статус и сортировку; редактировать, отключать или архивировать пользователя."),
    AssistantCapability("sa.user.create", ("superadmin",), "/sa/users", "Все пользователи — добавить", "Нажать «Добавить пользователя»; выбрать организацию и роль; заполнить имя, email и пароль; сохранить."),
    AssistantCapability("sa.trials", ("superadmin",), "/sa/trial-requests", "Заявки на подключение", "Открыть заявку; проверить данные; одобрить или отклонить."),
    AssistantCapability("sa.analytics", ("superadmin",), "/sa/analytics", "Аналитика платформы", "Выбрать период; посмотреть организации, пользователей, очереди, талоны и активность."),
    AssistantCapability("sa.audit", ("superadmin",), "/sa/audit-logs", "Журнал действий платформы", "Задать период, действие, пользователя или организацию; открыть запись для разбора."),
)


CAPABILITY_IDS = frozenset(item.id for item in CAPABILITIES)

SITE_REFERENCE = """СПРАВОЧНИК ОБЩИХ СЦЕНАРИЕВ (для них action_id может быть null):
- /login: вход по email, паролю и коду двухэтапной проверки, если она включена. Сброс 2FA суперадмина выполняется владельцем сервера, обычной кнопки на странице нет.
- /q: посетитель сканирует QR общего экрана; если к экрану привязано несколько очередей, выбирает нужную и получает талон.
- /t/:id: мобильная страница талона показывает номер, очередь, людей впереди, примерное ожидание, вызов и кабинет. Посетитель может отказаться от талона и оставить оценку после обслуживания.
- /tv/pair: на новом телевизоре вводят код из раздела «ТВ-экраны». /tv показывает выбранный режим: очередь, недельное расписание или YouTube-медиа.
- /attendance/enroll: сотрудник сканирует статичный QR регистрации, вводит четырёхзначный личный код и отправляет лицо; администратор лично проверяет заявку.
- /attendance/phone: сотрудник открывает рабочий QR, вводит личный код, проходит проверку лица и геопозиции (если включена); повторная успешная отметка чередует приход и уход.
- /attendance/kiosk: сначала стойку связывают кодом из настроек. Затем сотрудник нажимает пробел, смотрит в камеру, и система сама распознаёт лицо и чередует приход/уход.
- Email обычного пользователя организации меняет администратор организации. Email администратора организации меняет только суперадмин. Сам пользователь email в профиле не меняет.
- Удаление организаций, очередей, кабинетов и сотрудников выполняется через архив, чтобы сохранить историю. Восстановление доступно там, где показан архив.
- Видео для телевизоров добавляется ссылкой YouTube или плейлистом. Выбранные материалы повторяются; звук может требовать первого взаимодействия с браузером из-за правил автозапуска.
- Расписание Excel: Отделение, Врач, Специализация, Кабинет, Пн, Вт, Ср, Чт, Пт, Сб, Вс. В каждой дневной ячейке один интервал приёма.
"""


def capabilities_for_role(role: str) -> tuple[AssistantCapability, ...]:
    return tuple(item for item in CAPABILITIES if role in item.roles)


def catalog_text(role: str) -> str:
    lines = ["КАРТА OMNIBOOK ДЛЯ ТЕКУЩЕЙ РОЛИ. Выбери action_id только из этого списка:"]
    for item in capabilities_for_role(role):
        lines.append(f"- {item.id} | {item.route} | {item.label}: {item.instructions}")
    return "\n".join(lines) + "\n\n" + SITE_REFERENCE


def action_allowed(action_id: str | None, role: str) -> bool:
    return bool(action_id and any(item.id == action_id and role in item.roles for item in CAPABILITIES))
