from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    KeyboardButton,
    WebAppInfo,
)

from config import ADMIN_IDS, SUPER_ADMIN_IDS, WEBAPP_BASE_URL


def webapp_deep_link_keyboard(tab: str, text: str) -> InlineKeyboardMarkup | None:
    """Инлайн-кнопка под уведомлением, открывающая мини-приложение сразу на
    нужной вкладке (#profile, #leaders, ...) — см. main.js:getStartParam().
    None, если WEBAPP_BASE_URL не настроен (та же защита, что и в get_menu)."""
    if not WEBAPP_BASE_URL:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=text, web_app=WebAppInfo(url=f"{WEBAPP_BASE_URL}#{tab}"))
    ]])


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