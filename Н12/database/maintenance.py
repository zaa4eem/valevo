import asyncio
import logging
import shutil
from datetime import datetime
from pathlib import Path

import aiosqlite

from config import BACKUP_DIR, DB_NAME

logger = logging.getLogger(__name__)

# Сколько дней хранить резервные копии. Без чистки папка backups растёт
# бесконечно — при ежедневном бэкапе за пару лет работы клуба это гигабайты
# копий, которые никто не откроет. 14 дней достаточно, чтобы откатиться на
# любую точку за две недели, а не только на "вчера".
DEFAULT_BACKUP_RETENTION_DAYS = 14


async def sqlite_integrity_check() -> str:
    async with aiosqlite.connect(DB_NAME, timeout=30) as db:
        cursor = await db.execute("PRAGMA integrity_check")
        row = await cursor.fetchone()
        await cursor.close()
        return row[0] if row else "unknown"


async def create_sqlite_backup(prefix: str = "valevo") -> Path:
    """Снимок базы через нативный SQLite backup API — безопасно даже при
    активном WAL и параллельной записи, в отличие от простого copy файла."""
    source = Path(DB_NAME)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = BACKUP_DIR / f"{prefix}_{timestamp}.db"

    async with aiosqlite.connect(DB_NAME, timeout=30) as src:
        async with aiosqlite.connect(str(target), timeout=30) as dst:
            await src.backup(dst)

    wal = source.with_suffix(source.suffix + "-wal")
    shm = source.with_suffix(source.suffix + "-shm")
    for extra in (wal, shm):
        if extra.exists():
            shutil.copy2(extra, BACKUP_DIR / f"{extra.name}.{timestamp}")
    return target


def prune_old_backups(keep_days: int = DEFAULT_BACKUP_RETENTION_DAYS, prefix: str = "valevo") -> int:
    """Удаляет файлы бэкапов старше keep_days дней. Возвращает число удалённых."""
    if not BACKUP_DIR.exists():
        return 0
    cutoff = datetime.now().timestamp() - keep_days * 86400
    removed = 0
    for path in BACKUP_DIR.glob(f"{prefix}_*"):
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            logger.warning("Не удалось удалить старый бэкап %s", path)
    return removed


async def run_scheduled_backup(bot=None, keep_days: int = DEFAULT_BACKUP_RETENTION_DAYS) -> None:
    """Обёртка для планировщика: бэкап + чистка старых копий + уведомление
    админу только при сбое (успех проходит тихо — не нужно поздравлять
    админа с бэкапом каждый день, но пропущенный бэкап он должен узнать сразу,
    а не когда он понадобится и его не окажется)."""
    from utils.error_reporter import report_admin_error  # локальный импорт: избегаем цикла на старте

    try:
        target = await create_sqlite_backup()
        removed = prune_old_backups(keep_days)
        logger.info("Бэкап базы создан: %s (удалено старых копий: %s)", target, removed)
    except Exception as exc:
        logger.exception("Не удалось создать плановый бэкап базы")
        await report_admin_error(
            bot,
            context="Плановый бэкап базы данных",
            error=exc,
            extra_advice="Резервная копия за сегодня не создана — проверьте место на диске и права на папку backups.",
            dedup_key="scheduled_backup",
        )


if __name__ == "__main__":
    print(asyncio.run(create_sqlite_backup()))
