from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton,
    WebAppInfo
)

from config import STAFF_IDS, WEBAPP_URL


def get_menu(user_id):

    keyboard = [
        *([[KeyboardButton(text="🚀 Открыть VALEVO", web_app=WebAppInfo(url=WEBAPP_URL))]] if WEBAPP_URL else []),
        [KeyboardButton(text="🎟 Забронировать")],
        [
            KeyboardButton(text="⏱ Установить время"),
            KeyboardButton(text="👤 Профиль")
        ],
        [
            KeyboardButton(text="🏆 Таблица лидеров"),
            KeyboardButton(text="🏆 ТОП-10")
        ],
        [
            KeyboardButton(text="❓ Информация"),
            KeyboardButton(text="📩 Сообщить в поддержку")
        ],
        [KeyboardButton(text="🎁 Пригласить друга")],
    ]

    # Кнопка только админам

    if user_id in STAFF_IDS:

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