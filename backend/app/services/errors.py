class ServiceError(Exception):
    """Business-rule violation raised from a service function.

    Caught by the global handler in app/main.py and turned into
    {"detail": {"code": ..., **extra}} with the given status_code — keeps
    services decoupled from FastAPI/HTTPException.
    """

    def __init__(self, code: str, status_code: int, **extra):
        self.code = code
        self.status_code = status_code
        self.extra = extra
        super().__init__(code)
