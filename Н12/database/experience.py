import aiosqlite

from config import DB_NAME


async def add_experience(
    telegram_id,
    minutes
):

    async with aiosqlite.connect(DB_NAME) as db:

        await db.execute(
            '''
            UPDATE pilots
            SET experience_minutes =
            COALESCE(experience_minutes, 0) + ?
            WHERE telegram_id = ?
            ''',
            (
                minutes,
                telegram_id
            )
        )

        await db.commit()


async def get_experience(
    telegram_id
):

    async with aiosqlite.connect(DB_NAME) as db:

        cursor = await db.execute(
            '''
            SELECT experience_minutes
            FROM pilots
            WHERE telegram_id = ?
            ''',
            (telegram_id,)
        )

        row = await cursor.fetchone()

        if not row:
            return 0

        return row[0] or 0