from fastapi import APIRouter, Depends, HTTPException
from services.booking_statistics import summary


def create_finance_router(current_user):
    router = APIRouter(prefix='/api/admin/finance')

    def require_super(user=Depends(current_user)):
        if not user.is_super_admin:
            raise HTTPException(403, 'Доступ только для супер-администратора')
        return user

    async def call(function, **kwargs):
        try:
            return await function(**kwargs)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.get('')
    async def get_summary(date_from: str | None = None, date_to: str | None = None, source: str | None = None, user=Depends(require_super)):
        return await call(summary, date_from=date_from, date_to=date_to, source=source)

    return router
