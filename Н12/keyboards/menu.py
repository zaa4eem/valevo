from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton,
    WebAppInfo,
)

from config import ADMIN_IDS, WEBAPP_BASE_URL


def get_menu(user_id):

    keyboard = []

    # Кнопка мини-приложения работает только в личных чатах и только с
    # настоящим https-адресом — без WEBAPP_BASE_URL Telegram отклонит всю
    # клавиатуру целиком, поэтому кнопку добавляем только если адрес задан.
    if WEBAPP_BASE_URL:
        keyboard.append([
            KeyboardButton(
                text="🚀 Открыть VALEVO App",
                web_app=WebAppInfo(url=WEBAPP_BASE_URL),
            )
        ])

    keyboard += [
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