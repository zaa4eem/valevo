"""Разовый переход текущего турнира на согласованные правила v3."""

from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from config import DB_NAME
from data.tournament import SCORING_VERSION, classes_gating_promotion, next_main_class
from database.db import get_db, get_setting, set_setting, get_all_pilot_classes, set_pilot_class
from services.tournament import load_month_snapshot, month_bounds
from services.standings_watch import initialize_standings_baselines


async def apply_tournament_update() -> dict:
    migration = f"tournament_rules:{SCORING_VERSION}"
    baseline_guard = f"tournament_baseline:{SCORING_VERSION}"
    backup_path = None
    if not await get_setting(migration):
        # SQLite backup учитывает WAL и не копирует незавершённые записи.
        db_path = Path(DB_NAME).resolve()
        backup_dir = db_path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        backup_path = backup_dir / f"valevo_before_{SCORING_VERSION}_{stamp}.db"
        with sqlite3.connect(str(db_path)) as source, sqlite3.connect(str(backup_path)) as target:
            source.backup(target)

        db = await get_db()
        try:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute("SELECT value FROM bot_settings WHERE key = ?", (migration,))
            already_applied = await cursor.fetchone()
            if not already_applied:
                await db.execute("UPDATE pilots SET notify_standings = 1")
                # Сохраняем уже открытый уровень прежней четырёхступенчатой
                # лестницы. Это перенос доступа, а не переименование результатов:
                # круги/эталоны BTCC никогда не превращаются в F4.
                await db.execute("""
                    UPDATE pilot_class_status SET current_class = CASE current_class
                        WHEN 'BTCC' THEN 'GT500'
                        WHEN 'DTM' THEN 'GT500'
                        WHEN 'GT500' THEN 'DTM'
                        WHEN 'Touge' THEN 'DTM'
                        ELSE current_class END,
                        updated_at = CURRENT_TIMESTAMP
                """)
                await db.execute(
                    "INSERT INTO bot_settings(key, value) VALUES (?, ?)",
                    (migration, month_bounds()[0]),
                )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        finally:
            await db.close()

    snapshot = await load_month_snapshot(*month_bounds())
    if not await get_setting(baseline_guard):
        # Уже принятые круги текущего сезона участвуют в новом расчёте сразу.
        # За разовый пересчёт не выдаём повторные награды и сообщения.
        classes = await get_all_pilot_classes()
        for tid in snapshot.participants:
            current = classes.get(tid, "MX-5")
            target = current
            while next_main_class(target) and any(
                snapshot.class_score_for(tid, name)["qualifies"]
                for name in classes_gating_promotion(target)
            ):
                target = next_main_class(target)
            if target != current:
                await set_pilot_class(tid, target, snapshot.month_key)
        await initialize_standings_baselines(snapshot, force=True)
        await set_setting(baseline_guard, snapshot.month_key)
    else:
        await initialize_standings_baselines(snapshot)

    return {
        "season": snapshot.month_key,
        "participants": len(snapshot.overall_ranking()),
        "backup": str(backup_path) if backup_path else None,
    }
