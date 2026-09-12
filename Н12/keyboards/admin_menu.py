from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
from config import SUPER_ADMIN_IDS


def _super_admin_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="👥 Пилоты"), KeyboardButton(text="⏱️ Установить время")],
            [KeyboardButton(text="➕ Добавить трассу"), KeyboardButton(text="➖ Удалить трассу")],
            [KeyboardButton(text="🗑 Удалить время"), KeyboardButton(text="🗑 Очистить таблицу")],
            [KeyboardButton(text="🏆 Закрыть Week CUP")],
            [KeyboardButton(text="🎯 Эталоны месяца")],
            [KeyboardButton(text="📢 Рассылка"), KeyboardButton(text="🔙 Назад")],
        ], resize_keyboard=True, one_time_keyboard=False,
    )


# Используется после завершения супер-админских FSM-сценариев.
admin_menu = _super_admin_menu()


def get_admin_menu(user_id: int) -> ReplyKeyboardMarkup:
    if user_id in SUPER_ADMIN_IDS:
        return admin_menu
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="⏱️ Установить время")], [KeyboardButton(text="🔙 Назад")]],
        resize_keyboard=True, one_time_keyboard=False,
    )
