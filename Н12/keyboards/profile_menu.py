from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton
)


def build_profile_menu(notify_standings: bool = True) -> InlineKeyboardMarkup:
    """Меню профиля с переключателем уведомлений об общем зачёте.

    Переключатель нужен именно отдельной кнопкой: единственная альтернатива для
    пилота, которому уведомления о смещении в топ-5 не нужны — замьютить бота
    целиком, а вместе с ними он потерял бы и решения по заявкам, и напоминания
    о бронях.
    """
    toggle_text = (
        "🔔 Зачёт: уведомления вкл"
        if notify_standings
        else "🔕 Зачёт: уведомления выкл"
    )
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✏️ Изменить ник", callback_data="change_nick"),
            InlineKeyboardButton(text="🔄 Обновить", callback_data="refresh_profile"),
        ],
        [
            InlineKeyboardButton(text=toggle_text, callback_data="toggle_standings_notify"),
        ],
    ])


# Обратная совместимость для мест, где состояние переключателя не важно.
profile_menu = build_profile_menu()
