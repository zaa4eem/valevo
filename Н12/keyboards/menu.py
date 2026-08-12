from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton
)

from config import ADMIN_IDS


def get_menu(user_id):

    keyboard = [
        [
            KeyboardButton(text="🏆 Leaderboard"),
            KeyboardButton(text="🏆 ТОП-10")
        ],
        [
            KeyboardButton(text="🎟 Забронировать"),
            KeyboardButton(text="👤 Профиль")
        ],
        [
            KeyboardButton(text="❓ Информация"),
            KeyboardButton(text="📩 Сообщить в поддержку")
        ],
        [KeyboardButton(text="⏱ Установить время")],
    ]

    # Кнопка только админам

    if user_id in ADMIN_IDS:

        keyboard.append(
            [
                KeyboardButton(
                    text="🛠 Панель администратора"
                )
            ]
        )

    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True
    )