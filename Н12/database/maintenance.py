import asyncio
import shutil
from datetime import datetime
from pathlib import Path

import aiosqlite

from config import BACKUP_DIR, DB_NAME


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


if __name__ == "__main__":
    print(asyncio.run(create_sqlite_backup()))
