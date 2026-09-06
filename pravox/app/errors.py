class AppError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class UpstreamError(AppError):
    def __init__(self, code="upstream_unavailable", status_code=None):
        super().__init__(code, "Внешний сервис временно недоступен. Попробуйте позже; запрос не списан.", 503)
        self.status_code = status_code
