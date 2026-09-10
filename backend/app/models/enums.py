import enum


class Language(str, enum.Enum):
    kk = "kk"
    ru = "ru"
    en = "en"


class Plan(str, enum.Enum):
    trial = "trial"
    basic = "basic"
    pro = "pro"


class UserRole(str, enum.Enum):
    superadmin = "superadmin"
    org_admin = "org_admin"
    operator = "operator"
    registrar = "registrar"


class QueueStatus(str, enum.Enum):
    open = "open"
    paused = "paused"
    closed = "closed"


class CabinetStatus(str, enum.Enum):
    free = "free"
    busy = "busy"
    paused = "paused"
    offline = "offline"


class TicketStatus(str, enum.Enum):
    waiting = "waiting"
    called = "called"
    confirmed = "confirmed"
    serving = "serving"
    served = "served"
    no_show = "no_show"
    left = "left"
    transferred = "transferred"


class TicketSource(str, enum.Enum):
    qr = "qr"
    registrar = "registrar"
    transfer = "transfer"


class AuditActorType(str, enum.Enum):
    user = "user"
    client = "client"
    system = "system"
