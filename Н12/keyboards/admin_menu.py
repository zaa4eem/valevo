from aiogram.types import (
    ReplyKeyboardMarkup,
    KeyboardButton
)

admin_menu = ReplyKeyboardMarkup(
    keyboard=[
        [
            KeyboardButton(text="👥 Пилоты"),
            KeyboardButton(text="⏱️ Установить время")
        ],
        [
            KeyboardButton(text="➕ Добавить трассу"),
            KeyboardButton(text="➖ Удалить трассу")
        ],
        [
            KeyboardButton(text="🗑 Удалить время"),
            KeyboardButton(text="🗑 Очистить таблицу")
        ],
        [
            KeyboardButton(text="🏆 Закрыть Week CUP")
        ],
        [
            KeyboardButton(text="🎯 Эталоны месяца")
        ],
        [KeyboardButton(text="🔙 Назад"),
         KeyboardButton(text="📢 Рассылка")
        ]
    ],
    resize_keyboard=True,
    one_time_keyboard=False
)