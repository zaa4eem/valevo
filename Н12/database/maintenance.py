import asyncio
import logging
import shutil
import time
from datetime import datetime
from pathlib import Path

import aiosqlite

from config import BACKUP_DIR, DB_NAME

logger = logging.getLogger(__name__)


async def sqlite_integrity_check() -> str:
    async with aiosqlite.connect(DB_NAME, timeout=30) as db:
        cursor = await db.execute("PRAGMA integrity_check")
        row = await cursor.fetchone()
        await cursor.close()
        return row[0] if row else "unknown"


async def create_sqlite_backup(prefix: str = "valevo") -> Path:
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


async def run_db_backup(keep_days: int = 14) -> Path:
    """Ежедневный бэкап БД + удаление копий старше keep_days дней."""
    path = await create_sqlite_backup()
    cutoff = time.time() - keep_days * 86400
    removed = 0
    for pattern in ("valevo_????????_??????.db", "valevo.db-*.*"):
        for old in BACKUP_DIR.glob(pattern):
            try:
                if old != path and old.stat().st_mtime < cutoff:
                    old.unlink()
                    removed += 1
            except OSError:
                logger.warning("Не удалось удалить старый бэкап %s", old, exc_info=True)
    logger.info(
        "Бэкап БД создан: %s (%.1f МБ), удалено старых копий: %d",
        path.name, path.stat().st_size / 1_048_576, removed,
    )
    return path


if __name__ == "__main__":
    print(asyncio.run(create_sqlite_backup()))
