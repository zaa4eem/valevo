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
            KeyboardButton(text="🗑 Удалить время")
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
# "🗑 Очистить таблицу" и "🏆 Закрыть Week CUP" перенесены в панель
# "👑 Супер-админ" (SUPER_ADMIN_IDS) — это необратимые операции сразу над
# всей таблицей/сезоном, а не над одной записью, поэтому уровень доступа к
# ним выше обычного ADMIN_IDS.