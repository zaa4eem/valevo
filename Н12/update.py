async def clear_discipline_laps(discipline_name: str):
    db = await get_db()

    await db.execute("""
        DELETE FROM laps
        WHERE discipline_id IN (
            SELECT id FROM disciplines
            WHERE UPPER(name)=UPPER(?)
        )
    """, (discipline_name,))

    await db.commit()
    await db.close()
# это дб.пу

#админ.пу:

from database.db import (clear_discipline_laps,)

@router.message(Command("clearweek"))
async def clear_week_cup(message: Message):
    if not is_admin(message.from_user.id):
        return

    await clear_discipline_laps("WEEK CUP")

    await message.answer(
        "🏆 WEEK CUP очищен.\n\n"
        "Все результаты недельного кубка удалены."
    )



#дб:
await safe_add("private_chat_invited INTEGER DEFAULT 0", "private_chat_invited")

async def was_private_chat_invited(telegram_id):
    db = await get_db()

    cursor = await db.execute(
        "SELECT private_chat_invited FROM pilots WHERE telegram_id = ?",
        (telegram_id,)
    )

    row = await cursor.fetchone()

    await cursor.close()
    await db.close()

    return bool(row[0]) if row else False


async def mark_private_chat_invited(telegram_id):
    db = await get_db()

    await db.execute(
        "UPDATE pilots SET private_chat_invited = 1 WHERE telegram_id = ?",
        (telegram_id,)
    )

    await db.commit()
    await db.close()


async def clear_discipline_laps(discipline_name: str):
    db = await get_db()

    await db.execute("""
        DELETE FROM laps
        WHERE discipline_id IN (
            SELECT id FROM disciplines
            WHERE UPPER(name)=UPPER(?)
        )
    """, (discipline_name,))

    await db.commit()
    await db.close()

#Импортируем в admin.py
from database.db import (
    clear_discipline_laps,
was_private_chat_invited,
mark_private_chat_invited,


@router.message(Command("clearweek"))
async def clear_week_cup(message: Message):

    if not is_admin(message.from_user.id):
        return

    await clear_discipline_laps("WEEK CUP")

    await message.answer(
        "🏆 WEEK CUP очищен.\n\n"
        "Все результаты недельного кубка удалены."
    )

updated_pilot = await get_pilot_by_telegram_id(tid)

new_rating = updated_pilot["rating"]

if new_rating >= 100:

    already_invited = await was_private_chat_invited(tid)

    if not already_invited:

        invite_text = (
            "🏁 Вы достигли 100 рейтинга и получили доступ "
            "в закрытую беседу пилотов VALEVO.\n\n"
            "🔒 Ссылка:\n"
            "ССЫЛКА_НА_ЧАТ"
        )

        try:

            sent = await callback.bot.send_message(
                tid,
                invite_text
            )

            try:
                await callback.bot.pin_chat_message(
                    chat_id=tid,
                    message_id=sent.message_id
                )
            except:
                pass

            await mark_private_chat_invited(tid)

        except Exception as e:
            logger.warning(f"Ошибка отправки инвайта: {e}")