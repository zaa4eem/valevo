"""Безопасная подготовка существующей БД перед обновлением проекта.

Запускать из корня проекта на клубном ПК:
    python scripts/safe_update_db.py

Скрипт:
- проверяет целостность SQLite;
- делает резервную копию в backups/;
- запускает init_db(), который только добавляет недостающие таблицы/поля;
- не удаляет пользователей, круги и старые данные.
"""

import asyncio
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from config import DB_NAME, BACKUP_DIR
from database.db import init_db


def main() -> int:
    db_path = Path(DB_NAME)
    if not db_path.exists():
        print(f"ОШИБКА: БД не найдена: {db_path}")
        return 1

    with sqlite3.connect(db_path) as con:
        result = con.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        print(f"ОШИБКА: integrity_check не прошёл: {result}")
        return 2

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"{db_path.stem}_before_update_{datetime.now():%Y%m%d_%H%M%S}{db_path.suffix}"
    shutil.copy2(db_path, backup_path)
    print(f"Бэкап создан: {backup_path}")

    asyncio.run(init_db())

    with sqlite3.connect(db_path) as con:
        result = con.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        print(f"ОШИБКА после миграции: integrity_check={result}")
        print(f"Бэкап сохранён: {backup_path}")
        return 3

    print("БД успешно подготовлена. Данные пользователей сохранены.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
