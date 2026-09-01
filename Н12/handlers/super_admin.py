"""Панель супер-админа: ручная коррекция рейтинга и финансовая отчётность.

Отдельный, более узкий круг людей поверх обычных ADMIN_IDS (см. config.py) —
доступ только тем, кто в SUPER_ADMIN_IDS. Обычные админы эту панель не видят
и не имеют доступа к её callback'ам, даже если знают формат данных.

Здесь только READ-операции и ОДНО чётко ограниченное действие с записью —
коррекция рейтинга, и то не иначе как с обязательной причиной и полным
аудит-логом (кто, кому, сколько, почему, когда). Ничего массового или
необратимого (рассылка, закрытие сезона, управление списком админов) сюда
намеренно не добавлено — такие действия либо уже есть в обычной админ-панели
(рассылка), либо требуют отдельного явного запроса."""

from __future__ import annotations

import html
import logging
import shutil
from datetime import datetime

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from config import BACKUP_DIR, DATA_DIR, MOSCOW_TZ, SUPER_ADMIN_IDS
from data.tournament import CLASS_LADDER
from database.db import (
    apply_rating_correction,
    get_admin_action_log,
    get_backup_dir_status,
    get_bonus_wallet_history,
    get_bonus_wallet_summary,
    get_pending_yclients_operations,
    get_pilot_by_number,
    get_pilot_by_telegram_id,
    get_pilot_by_username,
    get_season_awards_history,
    get_setting,
)
from services.tournament import month_bounds
from utils.message_style import DIVIDER, header

router = Router()
logger = logging.getLogger(__name__)


def is_super_admin(uid: int) -> bool:
    return uid in SUPER_ADMIN_IDS


def super_admin_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="⚙️ Коррекция рейтинга", callback_data="sa:rating:start")],
        [InlineKeyboardButton(text="💰 Финансовая сводка", callback_data="sa:finance:overview")],
        [InlineKeyboardButton(text="🩺 Статус бота", callback_data="sa:status")],
        [InlineKeyboardButton(text="📜 Журнал правок", callback_data="sa:log")],
    ])


def _cancel_keyboard(callback_data: str = "sa:cancel") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data=callback_data)]])


def _normalize_pilot_row(row) -> dict | None:
    """get_pilot_by_number/get_pilot_by_telegram_id уже отдают dict, а
    get_pilot_by_username — сырой tuple (SELECT *) без изменений с самого
    начала проекта. Трогать её формат нельзя (используется в другом месте,
    handlers/admin.py, по позиционному индексу) — здесь просто приводим
    результат к единому виду для поиска, без изменения самой функции."""
    if row is None or isinstance(row, dict):
        return row
    # Порядок колонок ровно как в CREATE TABLE pilots:
    # id, telegram_id, username, phone, display_name, pilot_number, rating, ...
    return {
        "telegram_id": row[1],
        "username": row[2],
        "phone": row[3],
        "display_name": row[4],
        "pilot_number": row[5],
        "rating": row[6],
    }


async def _find_pilot(query: str) -> dict | None:
    """Ищет пилота по номеру (если ввод — число) или по username (@ отбрасывается)."""
    query = query.strip().lstrip("@")
    if query.isdigit():
        pilot = await get_pilot_by_number(int(query))
        if pilot:
            return pilot
    return _normalize_pilot_row(await get_pilot_by_username(query))


def _pilot_line(pilot: dict) -> str:
    name = pilot.get("display_name") or pilot.get("username") or pilot["telegram_id"]
    number = f"#{pilot['pilot_number']}" if pilot.get("pilot_number") else "—"
    return f"👤 {html.escape(str(name))} ({number}) · id {pilot['telegram_id']}"


# ======================== ГЛАВНОЕ МЕНЮ ========================

@router.message(F.text == "👑 Супер-админ")
async def super_admin_start(message: Message, state: FSMContext):
    if not is_super_admin(message.from_user.id):
        return
    await state.clear()
    await message.answer(
        f"{header('👑', 'Панель супер-админа')}\n\nВыберите раздел:",
        reply_markup=super_admin_menu(),
    )


@router.callback_query(F.data == "sa:cancel")
async def super_admin_cancel(callback: CallbackQuery, state: FSMContext):
    if not is_super_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await state.clear()
    await callback.message.edit_text(
        f"{header('👑', 'Панель супер-админа')}\n\nВыберите раздел:",
        reply_markup=super_admin_menu(),
    )
    await callback.answer()


# ======================== КОРРЕКЦИЯ РЕЙТИНГА ========================

class RatingCorrection(StatesGroup):
    pilot = State()
    delta = State()
    reason = State()


@router.callback_query(F.data == "sa:rating:start")
async def rating_correction_start(callback: CallbackQuery, state: FSMContext):
    if not is_super_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await state.set_state(RatingCorrection.pilot)
    await callback.message.edit_text(
        f"{header('⚙️', 'Коррекция рейтинга')}\n\n"
        "Введите номер пилота (#42) или username, кому корректируем рейтинг.",
        reply_markup=_cancel_keyboard(),
    )
    await callback.answer()


@router.message(RatingCorrection.pilot)
async def rating_correction_pilot(message: Message, state: FSMContext):
    if not is_super_admin(message.from_user.id):
        return
    pilot = await _find_pilot(message.text or "")
    if not pilot:
        await message.answer("❌ Пилот не найден. Введите номер или username ещё раз.", reply_markup=_cancel_keyboard())
        return

    await state.update_data(target_id=pilot["telegram_id"])
    await state.set_state(RatingCorrection.delta)
    await message.answer(
        f"{_pilot_line(pilot)}\n"
        f"📈 Текущий рейтинг: <b>{pilot['rating']}</b>\n\n"
        "Введите изменение рейтинга: <code>+5</code> или <code>-10</code>.",
        reply_markup=_cancel_keyboard(),
    )


@router.message(RatingCorrection.delta)
async def rating_correction_delta(message: Message, state: FSMContext):
    if not is_super_admin(message.from_user.id):
        return
    text = (message.text or "").strip().replace(" ", "")
    try:
        delta = int(text)
    except ValueError:
        await message.answer(
            "❌ Нужно целое число со знаком, например <code>+5</code> или <code>-10</code>.",
            reply_markup=_cancel_keyboard(),
        )
        return
    if delta == 0:
        await message.answer("❌ Изменение не может быть нулевым.", reply_markup=_cancel_keyboard())
        return

    await state.update_data(delta=delta)
    await state.set_state(RatingCorrection.reason)
    await message.answer(
        "Укажите причину правки — она попадёт в журнал и её увидят остальные супер-админы "
        "(например: «отмена ошибочно засчитанного круга #128»).",
        reply_markup=_cancel_keyboard(),
    )


@router.message(RatingCorrection.reason)
async def rating_correction_reason(message: Message, state: FSMContext):
    if not is_super_admin(message.from_user.id):
        return
    reason = (message.text or "").strip()
    if len(reason) < 3:
        await message.answer("❌ Слишком коротко. Опишите причину правки подробнее.", reply_markup=_cancel_keyboard())
        return

    data = await state.get_data()
    target_id = data["target_id"]
    delta = data["delta"]
    pilot = await get_pilot_by_telegram_id(target_id)

    await state.update_data(reason=reason)
    await state.set_state(None)

    sign = "+" if delta > 0 else ""
    await message.answer(
        f"{header('⚠️', 'Подтвердите коррекцию')}\n\n"
        f"{_pilot_line(pilot)}\n"
        f"Текущий рейтинг: <b>{pilot['rating']}</b>\n"
        f"Изменение: <b>{sign}{delta}</b> → станет <b>{pilot['rating'] + delta}</b>\n"
        f"Причина: <i>{html.escape(reason)}</i>",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✅ Применить", callback_data="sa:rating:confirm")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="sa:cancel")],
        ]),
    )


@router.callback_query(F.data == "sa:rating:confirm")
async def rating_correction_confirm(callback: CallbackQuery, state: FSMContext):
    if not is_super_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    data = await state.get_data()
    target_id = data.get("target_id")
    delta = data.get("delta")
    reason = data.get("reason")
    if target_id is None or delta is None or not reason:
        await callback.answer("Сессия истекла, начните заново.", show_alert=True)
        await state.clear()
        return

    new_rating = await apply_rating_correction(callback.from_user.id, target_id, delta, reason)
    await state.clear()

    if new_rating is None:
        await callback.message.edit_text("❌ Пилот больше не найден — правка не применена.")
        await callback.answer()
        return

    sign = "+" if delta > 0 else ""
    await callback.message.edit_text(
        f"{header('✅', 'Рейтинг скорректирован')}\n\n"
        f"Изменение: <b>{sign}{delta}</b>\n"
        f"Новый рейтинг: <b>{new_rating}</b>",
    )
    await callback.answer("Готово")

    # Взаимная видимость между супер-админами: раз доступ на двоих, каждый
    # должен видеть действия другого без отдельного похода в журнал.
    for admin_id in SUPER_ADMIN_IDS:
        if admin_id == callback.from_user.id:
            continue
        try:
            await callback.bot.send_message(
                admin_id,
                f"⚙️ <b>Коррекция рейтинга</b>\n\n"
                f"Кто: <code>{callback.from_user.id}</code>\n"
                f"Кому: <code>{target_id}</code>\n"
                f"Изменение: {sign}{delta} → {new_rating}\n"
                f"Причина: {html.escape(reason)}",
            )
        except Exception:
            logger.warning("Не удалось уведомить супер-админа %s о правке рейтинга", admin_id)


# ======================== ФИНАНСОВАЯ СВОДКА ========================

@router.callback_query(F.data == "sa:finance:overview")
async def finance_overview(callback: CallbackQuery, state: FSMContext):
    if not is_super_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await state.clear()
    summary = await get_bonus_wallet_summary()
    await callback.message.edit_text(
        f"{header('💰', 'Финансовая сводка')}\n\n"
        f"Всего начислено: <b>{summary['total_issued']:g} 💎</b>\n"
        f"Всего списано: <b>{summary['total_spent']:g} 💎</b>\n"
        f"Доступно (не сгорело): <b>{summary['total_available']:g} 💎</b>\n"
        f"В очереди на выдачу: <b>{summary['total_pending']:g} 💎</b>\n"
        f"Записей в кошельке: {summary['entries']}\n\n"
        "Чтобы посмотреть историю конкретного пилота — пришлите его номер или username.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data="sa:cancel")],
        ]),
    )
    await state.set_state(FinanceLookup.pilot)
    await callback.answer()


class FinanceLookup(StatesGroup):
    pilot = State()


@router.message(FinanceLookup.pilot)
async def finance_pilot_lookup(message: Message, state: FSMContext):
    if not is_super_admin(message.from_user.id):
        return
    pilot = await _find_pilot(message.text or "")
    if not pilot:
        await message.answer("❌ Пилот не найден. Введите номер или username ещё раз.")
        return

    wallet = await get_bonus_wallet_history(pilot["telegram_id"])
    awards = await get_season_awards_history(pilot["telegram_id"])

    lines = [_pilot_line(pilot), DIVIDER, ""]

    if wallet:
        lines.append("💎 <b>Кошелёк Valevo Bonus (последние записи)</b>")
        for entry in wallet:
            status_icon = {"issued": "✅", "pending": "⏳", "expired": "⌛"}.get(entry["yclients_status"], "•")
            lines.append(
                f"{status_icon} {entry['created_at']} · {entry['source']} · "
                f"<b>{entry['amount']:g} 💎</b>"
                f"{' · ' + html.escape(entry['reason']) if entry.get('reason') else ''}"
            )
        lines.append("")
    else:
        lines.append("💎 Кошелёк пуст — начислений не было.")
        lines.append("")

    if awards:
        lines.append("🏆 <b>Сезонные награды</b>")
        for a in awards:
            place_text = f"{a['place']} место" if a["place"] else a["reason"]
            bonus_text = ""
            if a["yclients_bonus_rub"]:
                bonus_text = f" · {a['yclients_bonus_rub']:g} 💎 ({a['yclients_status']})"
            lines.append(
                f"{a['season_key']} · {place_text} · +{a['rating_delta']} рейтинга{bonus_text}"
            )
    else:
        lines.append("🏆 Сезонных наград пока не было.")

    await state.clear()
    await message.answer(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ В меню", callback_data="sa:cancel")],
        ]),
    )


# ======================== СТАТУС БОТА ========================

@router.callback_query(F.data == "sa:status")
async def bot_status(callback: CallbackQuery, state: FSMContext):
    if not is_super_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await state.clear()

    started_at = await get_setting("bot_started_at") or "неизвестно"
    heartbeat = await get_setting("db_watchdog_heartbeat") or "ещё не проверялась"

    pending_ops = await get_pending_yclients_operations(limit=1000)

    backup_status = await get_backup_dir_status()
    backup_line = (
        f"{backup_status['latest_mtime']} ({backup_status['count']} копий хранится)"
        if backup_status.get("latest") else "ещё не создавался"
    )

    try:
        usage = shutil.disk_usage(str(DATA_DIR))
        disk_line = f"{usage.free / (1024**3):.1f} ГБ свободно из {usage.total / (1024**3):.1f} ГБ"
    except OSError:
        disk_line = "не удалось определить"

    month_key = month_bounds()[0]

    await callback.message.edit_text(
        f"{header('🩺', 'Статус бота')}\n\n"
        f"🚀 Запущен: <b>{started_at}</b>\n"
        f"💾 Последняя проверка записи в базу: <b>{heartbeat}</b>\n"
        f"📦 Последний бэкап: <b>{backup_line}</b>\n"
        f"💽 Место на диске: <b>{disk_line}</b>\n"
        f"🔄 В очереди YCLIENTS: <b>{len(pending_ops)}</b>\n"
        f"📅 Текущий сезон: <b>{month_key}</b>",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data="sa:cancel")],
        ]),
    )
    await callback.answer()


# ======================== ЖУРНАЛ ПРАВОК ========================

@router.callback_query(F.data == "sa:log")
async def action_log(callback: CallbackQuery, state: FSMContext):
    if not is_super_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await state.clear()

    entries = await get_admin_action_log(limit=15)
    if not entries:
        text = f"{header('📜', 'Журнал правок')}\n\nПравок ещё не было."
    else:
        lines = [header("📜", "Журнал правок (последние 15)"), ""]
        for e in entries:
            sign = "+" if (e["delta"] or 0) > 0 else ""
            delta_text = f" ({sign}{e['delta']})" if e["delta"] is not None else ""
            lines.append(
                f"{e['created_at']} · <code>{e['actor_telegram_id']}</code> → "
                f"<code>{e['target_telegram_id']}</code>{delta_text}\n"
                f"    {html.escape(e['reason'])}"
            )
        text = "\n".join(lines)

    await callback.message.edit_text(
        text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data="sa:cancel")],
        ]),
    )
    await callback.answer()
