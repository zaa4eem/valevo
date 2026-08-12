import asyncio
import sys
from pathlib import Path

from config import DB_NAME, validate_required_settings
from database.maintenance import sqlite_integrity_check


async def main() -> int:
    validate_required_settings()
    db_path = Path(DB_NAME)
    if not db_path.exists():
        print(f"DB_NOT_FOUND: {db_path}", file=sys.stderr)
        return 1
    result = await sqlite_integrity_check()
    if result != "ok":
        print(f"DB_INTEGRITY_FAILED: {result}", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
