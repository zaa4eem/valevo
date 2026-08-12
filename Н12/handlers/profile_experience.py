from aiogram import Router

from aiogram.types import Message

from database.experience import (
    get_experience
)

router = Router()


@router.message(
    lambda message:
    message.text == "🏎 Мой опыт"
)
async def my_experience(
    message: Message
):

    exp = await get_experience(
        message.from_user.id
    )

    hours = exp // 60
    minutes = exp % 60

    level = "Новичок"

    if hours >= 100:
        level = "LEGEND"

    elif hours >= 50:
        level = "PRO"

    elif hours >= 20:
        level = "Опытный"

    await message.answer(
        (
            "🏎 Профиль пилота\n\n"

            f"⏱ Опыт езды: {hours}ч {minutes}м\n"
            f"🏆 Уровень: {level}"
        )
    )