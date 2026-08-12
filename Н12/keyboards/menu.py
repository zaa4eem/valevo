from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton
)

from config import ADMIN_IDS


def get_menu(user_id):

    keyboard = [
        [
            KeyboardButton(text="🎟 Забронировать"),
            KeyboardButton(text="👤 Профиль")
        ],
        [
            KeyboardButton(text="🏆 Таблица лидеров"),
            KeyboardButton(text="🏆 ТОП-10")
        ],
        [KeyboardButton(text="⏱ Установить время")],
        [
            KeyboardButton(text="❓ Информация"),
            KeyboardButton(text="📩 Сообщить в поддержку")
        ],
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