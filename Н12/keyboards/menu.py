from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton
)

from config import ADMIN_IDS, SUPER_ADMIN_IDS


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

    # Отдельная кнопка для узкого круга супер-админов — независимо от того,
    # состоит ли человек ещё и в ADMIN_IDS.
    if user_id in SUPER_ADMIN_IDS:
        keyboard.append(
            [
                KeyboardButton(
                    text="👑 Супер-админ"
                )
            ]
        )

    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True
    )