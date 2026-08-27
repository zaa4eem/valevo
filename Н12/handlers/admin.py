import json
import asyncio
import logging

from aiogram import Router, F
from aiogram.filters import Command, StateFilter
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
)

from config import ADMIN_IDS, GROUP_ID
from utils.error_reporter import format_admin_error
from utils.message_style import DIVIDER, header
from services.tournament import check_and_process_promotion, month_bounds, live_class_score
from services.achievements import check_achievements_after_lap
from services.standings_watch import rebaseline_standings, refresh_standings_after_lap
from services.tournament import rank_month_overall
from services.weekcup_service import close_weekcup
from utils.time_parser import time_to_ms
from data.tournament import CLASS_LADDER
from keyboards.menu import get_menu
from keyboards.disciplines import get_disciplines_keyboard
from keyboards.tracks import get_tracks_keyboard
from keyboards.admin_menu import admin_menu
from keyboards.admin_pilots import (
    pilot_manage_keyboard,
    rating_keyboard,
    bonus_minutes_keyboard,
)
from database.db import (
    add_lap, delete_lap, get_pilot_by_username, get_all_pilots,
    get_pilot_by_telegram_id, get_pilot_by_number,
    update_pilot_rating, update_pilot_number,
    clear_all_laps, get_db,
    add_track, remove_track, get_all_disciplines, get_tracks_for_discipline,
    get_disciplines_with_current_results, get_current_discipline_results,
    get_current_ranked_lap,
    get_class_benchmark, get_all_class_benchmarks, set_class_benchmark,
)
from services.leaderboard import build_leaderboard
from services.yclients_service import (
    get_client, update_balance, get_client_total_hours,
    get_valevo_bonus_balance, change_valevo_bonus
)
from services.yclients_auto import issue_or_queue_valevo_bonus, auto_sync_pilot_with_yclients

router = Router()
logger = logging.getLogger(__name__)

# Держим сильные ссылки на фоновые задачи — без этого asyncio может собрать
# их сборщиком мусора до завершения (создание таска само по себе ссылку не
# держит), и уведомления/удаления/очистка клавиатур будут тихо не срабатывать.
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

# ======================== HELPERS ========================
async def safe_delete_message(bot, chat_id, msg_id):
    try: await bot.delete_message(chat_id, msg_id)
    except: pass

async def delete_later(msg, delay=10):
    await asyncio.sleep(delay)
    try: await msg.delete()
    except: pass

async def cleanup_undo_state(msg: Message, delay: int):
    # Раньше здесь был await state.clear() — но state это общий FSMContext
    # на (chat, user), а не привязанный к конкретному кругу. finish_lap уже
    # чистит state сам сразу после создания этой задачи (см. ниже); если админ
    # успевал начать СЛЕДУЮЩИЙ ввод времени в эти же 30 секунд, этот таймер
    # прилетал прямо посреди нового флоу и стирал его состояние — новое время
    # переставало приниматься без единой ошибки. Тут достаточно снять кнопку.
    await asyncio.sleep(delay)
    try:
        await msg.edit_reply_markup(reply_markup=None)
    except: pass

def is_admin(uid): return uid in ADMIN_IDS

# ======================== STATES ========================
class AddLap(StatesGroup):
    discipline = State()
    track = State()
    pilot_number = State()
    lap_time = State()

class ChangePilotNumber(StatesGroup):
    number = State()

class BalanceAction(StatesGroup):
    waiting_for_amount = State()

class ClearTableConfirm(StatesGroup):
    wait = State()

class Broadcast(StatesGroup):
    waiting_for_text = State()
    confirm = State()

class TrackAdd(StatesGroup):
    waiting_for_discipline = State()
    waiting_for_track_name = State()

class TrackRemove(StatesGroup):
    waiting_for_discipline = State()
    waiting_for_track_name = State()

class BenchmarkSet(StatesGroup):
    waiting_for_track = State()
    waiting_for_time = State()

# ======================== АДМИН-МЕНЮ ========================
@router.message(F.text == "🛠 Панель администратора")
async def admin_panel(message: Message):
    if not is_admin(message.from_user.id):
        await message.answer("⛔ Доступ запрещён")
        return
    await message.answer("🛠 <b>Панель администратора</b>", reply_markup=admin_menu)

@router.message(F.text == "🔙 Назад")
async def back_to_menu(message: Message):
    await message.answer("🏁 Главное меню", reply_markup=get_menu(message.from_user.id))

# ======================== ОЧИСТКА ТАБЛИЦЫ ========================
@router.message(F.text == "🗑 Очистить таблицу")
async def clear_table_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id): return
    await state.set_state(ClearTableConfirm.wait)
    await message.answer(
        f"{header('⚠️', 'Очистка таблицы')}\n\n"
        "Вы уверены, что хотите удалить ВСЕ круги из таблицы?\n"
        "Напишите в точности: Я уверен что я делаю\n\n"
        "Для отмены нажмите '🔙 Назад'."
    )

@router.message(ClearTableConfirm.wait, F.text == "🔙 Назад")
async def clear_table_cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Операция отменена.", reply_markup=admin_menu)

@router.message(ClearTableConfirm.wait)
async def clear_table_confirm(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    if (message.text or "").strip() == "Я уверен что я делаю":
        await clear_all_laps()
        await message.answer("✅ Таблица рекордов полностью очищена. Рейтинг пилотов сохранён.", reply_markup=admin_menu)
    else:
        await message.answer("❌ Текст не совпадает. Операция отменена.", reply_markup=admin_menu)
    await state.clear()

# ======================== РАССЫЛКА ========================
@router.message(F.text == "📢 Рассылка")
async def broadcast_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return

    await state.set_state(Broadcast.waiting_for_text)

    kb = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="❌ Отменить")]],
        resize_keyboard=True
    )

    await message.answer(
        f"{header('📢', 'Рассылка')}\n\n"
        "Отправьте сообщение для рассылки.\n\n"
        "Поддерживается:\n"
        "• текст\n"
        "• фото\n"
        "• фото с подписью\n\n"
        "Это сообщение получат все зарегистрированные пилоты.",
        reply_markup=kb
    )


@router.message(Broadcast.waiting_for_text)
async def broadcast_text(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return

    if message.text == "❌ Отменить":
        await state.clear()
        await message.answer("🚫 Рассылка отменена.", reply_markup=admin_menu)
        return

    if message.photo:
        await state.update_data(
            photo=message.photo[-1].file_id,
            caption=message.caption or ""
        )

        preview = (
            f"{header('🖼', 'Предпросмотр рассылки')}\n\n"
            f"{message.caption or '(без подписи)'}"
        )

    elif message.text:
        await state.update_data(
            text=message.text.strip()
        )

        preview = (
            f"{header('📝', 'Предпросмотр рассылки')}\n\n"
            f"{message.text.strip()}"
        )

    else:
        await message.answer("❌ Можно отправить только текст или фотографию.")
        return

    await state.set_state(Broadcast.confirm)

    kb = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="✅ Отправить")],
            [KeyboardButton(text="❌ Отменить")]
        ],
        resize_keyboard=True
    )

    await message.answer(
        preview + "\n\nПодтвердите отправку.",
        reply_markup=kb
    )


@router.message(Broadcast.confirm, F.text == "✅ Отправить")
async def broadcast_send(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return

    data = await state.get_data()

    text = data.get("text")
    photo = data.get("photo")
    caption = data.get("caption", "")

    pilots = await get_all_pilots()

    sent = 0
    failed = 0

    for pilot in pilots:
        try:

            if photo:
                await message.bot.send_photo(
                    pilot["telegram_id"],
                    photo=photo,
                    caption=f"{caption}\n\n❤️ С уважением, администрация ВАЛЕВО!"
                )

            else:
                await message.bot.send_message(
                    pilot["telegram_id"],
                    f"🏁 <b>ВАЛЕВО сим рейсинг клуб уведомляет:</b>\n\n"
                    f"{text}\n\n"
                    f"❤️ С уважением, администрация ВАЛЕВО!"
                )

            sent += 1
            await asyncio.sleep(0.05)

        except Exception as e:
            logger.warning(
                f"Не удалось отправить рассылку пилоту {pilot['telegram_id']}: {e}"
            )
            failed += 1

    await message.answer(
        f"{header('✅', 'Рассылка завершена')}\n\n"
        f"Отправлено: {sent}\n"
        f"Не удалось отправить: {failed}",
        reply_markup=admin_menu
    )

    await state.clear()


@router.message(Broadcast.confirm, F.text == "❌ Отменить")
@router.message(Broadcast.waiting_for_text, F.text == "❌ Отменить")
async def broadcast_cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "🚫 Рассылка отменена.",
        reply_markup=admin_menu
    )

# ======================== СМЕНА НОМЕРА ========================
@router.callback_query(F.data.startswith("number_"))
async def change_number(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    tid = int(callback.data.split("_")[1])
    await state.update_data(change_number_user=tid)
    await state.set_state(ChangePilotNumber.number)
    await callback.message.edit_text("🏎 Введите новый номер:")

@router.message(ChangePilotNumber.number)
async def save_new_number(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    data = await state.get_data()
    tid = data.get("change_number_user")
    if tid is None:
        await message.answer("❌ Данные смены номера потеряны. Откройте профиль пилота заново.")
        await state.clear()
        return
    try:
        num = int(message.text)
    except (TypeError, ValueError):
        await message.answer("❌ Введите число")
        return
    existing = await get_pilot_by_number(num)
    if existing and existing["telegram_id"] != tid:
        await message.answer("❌ Этот номер уже занят другим пилотом.")
        return
    try:
        changed = await update_pilot_number(tid, num)
    except Exception as exc:
        logger.warning("Не удалось обновить номер пилота %s -> %s: %s", tid, num, exc)
        await message.answer("❌ Этот номер только что заняли. Введите другой номер.")
        return
    if not changed:
        await message.answer("❌ Пилот не найден.")
        await state.clear()
        return
    await message.answer(f"✅ Номер пилота обновлён: #{num}")
    try:
        await message.bot.send_message(tid,
            f"{header('🎱', 'Ваш номер пилота обновлён!!!')}\n\n🏁 ВАЛЕВО сим рейсинг присвоил вам новый уникальный номер: <b>{num}</b>")
    except Exception as e:
        logger.warning(f"Не удалось отправить уведомление о смене номера: {e}")
    await state.clear()

# ======================== ПОИСК ПИЛОТА ПО НОМЕРУ ========================
@router.message(
    StateFilter(None),
    F.text.regexp(r'^\d{1,3}$')
)
async def search_pilot_by_number(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return

    number = int(message.text.strip())
    pilot = await get_pilot_by_number(number)

    if not pilot:
        await message.answer("❌ Пилот с таким номером не найден.")
        return

    name = pilot["display_name"] or pilot["username"]
    bonus_balance = (
        await get_bonus_balance(pilot["yclients_client_id"])
        if pilot.get("yclients_client_id")
        else 0.0
    )

    text = (
        f"{header('👤', 'Профиль пилота')}\n\n"
        f"<b>{name}</b>\n"
        f"🏎 Номер: #{pilot['pilot_number']}\n"
        f"📱 {pilot['phone']}\n"
        f"📈 Рейтинг: {pilot['rating']}\n"
        f"🎁 Бонусный счёт: {bonus_balance:.2f} ₽"
    )

    await message.answer(
        text,
        reply_markup=pilot_manage_keyboard(pilot["telegram_id"]),
    )

# ======================== УСТАНОВКА ВРЕМЕНИ ========================
@router.message(Command("addlap"))
@router.message(F.text.contains("Установить время"))
async def addlap_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    _spawn(delete_later(message, 1))
    await state.clear()
    await state.set_state(AddLap.discipline)
    await message.answer("🏆 Выберите дисциплину:", reply_markup=get_disciplines_keyboard())


@router.callback_query(F.data.startswith("discipline_"))
async def choose_discipline(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    discipline = callback.data.split("_", 1)[1]
    await state.update_data(discipline=discipline)
    await state.set_state(AddLap.track)
    try:
        keyboard = await get_tracks_keyboard(discipline)
    except Exception:
        logger.exception("Не удалось построить клавиатуру трасс для %s", discipline)
        await callback.message.answer("❌ Не удалось загрузить трассы. Попробуйте ещё раз.")
        return
    try:
        await callback.message.edit_text("🗺 Выберите трассу:", reply_markup=keyboard)
    except Exception:
        try:
            await callback.message.answer("🗺 Выберите трассу:", reply_markup=keyboard)
        except Exception:
            logger.exception("Не удалось показать клавиатуру трасс для %s", discipline)
            await callback.message.answer(
                "❌ Не удалось показать список трасс (возможно, слишком длинное название). "
                "Обратитесь к разработчику."
            )


@router.callback_query(F.data.startswith("track_"))
async def choose_track(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    track = callback.data.split("_", 1)[1]
    await state.update_data(track=track)
    await state.set_state(AddLap.pilot_number)
    try:
        await callback.message.edit_text(
            f"🏁 Трасса выбрана: {track}\n\n👤 Введите номер пилота:"
        )
    except Exception:
        await callback.message.answer(
            f"🏁 Трасса выбрана: {track}\n\n👤 Введите номер пилота:"
        )


@router.message(AddLap.pilot_number, F.text.regexp(r'^\d+$'))
async def enter_pilot_number(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    number = int(message.text.strip())
    pilot = await get_pilot_by_number(number)
    if not pilot:
        await message.answer("❌ Пилот с таким номером не найден. Попробуйте ещё раз.")
        return
    await state.update_data(username=pilot["username"], selected_telegram_id=pilot["telegram_id"])
    await safe_delete_message(message.bot, message.chat.id, message.message_id)
    msg = await message.answer("⏱ Введите время круга:\nПример: 01:18.565")
    await state.update_data(bot_message_id=msg.message_id)
    await state.set_state(AddLap.lap_time)


@router.message(AddLap.pilot_number)
async def pilot_number_invalid(message: Message):
    await message.answer("❌ Введите корректный номер пилота (только цифры).")


@router.message(AddLap.lap_time)
async def finish_lap(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    data = await state.get_data()
    lap_text = (message.text or "").strip()
    _spawn(delete_later(message, 1))

    discipline = data.get("discipline")
    username = data.get("username")
    selected_tid = data.get("selected_telegram_id")
    track = data.get("track")
    if not all([discipline, username, selected_tid, track]):
        await message.answer("❌ Данные установки времени потеряны. Начните заново через «Установить время».")
        await state.clear()
        return

    try:
        lap_ms = time_to_ms(lap_text)
    except Exception as e:
        logger.warning(f"Неверный формат времени: {lap_text} ({e})")
        bot_msg = data.get("bot_message_id")
        if bot_msg:
            try:
                await message.bot.edit_message_text(
                    chat_id=message.chat.id, message_id=bot_msg,
                    text="❌ Неверный формат времени\nПример: 01:18.565"
                )
            except Exception:
                pass
        else:
            await message.answer("❌ Неверный формат времени\nПример: 01:18.565")
        return

    lap_id = await add_lap(
        discipline=discipline,
        username=username,
        telegram_id=selected_tid,
        track=track,
        lap_time_text=lap_text,
        lap_time_ms=lap_ms,
    )

    promoted_to = None
    try:
        promoted_to = await check_and_process_promotion(selected_tid, discipline, message.bot)
        await check_achievements_after_lap(
            selected_tid, discipline, message.bot,
            track=track, lap_time_ms=lap_ms, promoted_to=promoted_to,
        )
    except Exception:
        logger.exception("Ошибка турнирного движка после круга (admin, lap_id=%s)", lap_id)

    # Рейтинг теперь начисляется только турнирным движком (переходы/ачивки) —
    # старое начисление за топ-3 лучшего времени за всё время убрано, чтобы
    # не было двух конкурирующих систем очков.
    undo_data = json.dumps({"lap_id": lap_id, "changes": {}}, ensure_ascii=False)
    undo_keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="↩️ Отменить (30 сек)", callback_data=f"undo_lap:{undo_data}")]
    ])
    text = f"{header('✅', 'Круг засчитан!')}\n\n🏆 {discipline}\n👤 @{username}\n🗺 {track}\n⏱ {lap_text}"
    bot_msg = data.get("bot_message_id")
    if bot_msg:
        try:
            sent_msg = await message.bot.edit_message_text(
                chat_id=message.chat.id,
                message_id=bot_msg,
                text=text,
                reply_markup=undo_keyboard,
            )
            _spawn(cleanup_undo_state(sent_msg, 30))
        except Exception:
            await message.answer(text, reply_markup=undo_keyboard)
    else:
        await message.answer(text, reply_markup=undo_keyboard)

    _spawn(send_notifications(
        bot=message.bot,
        discipline=discipline,
        new_username=username,
        lap_text=lap_text,
        selected_tid=selected_tid,
        track=track,
        group_id=GROUP_ID,
        promoted_to=promoted_to,
    ))
    await state.clear()

# ======================== ОТМЕНА УСТАНОВКИ ВРЕМЕНИ ========================
@router.callback_query(F.data.startswith("undo_lap:"))
async def undo_last_lap(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    payload = callback.data.split(":", 1)[1]
    try:
        undo_data = json.loads(payload)
        lap_id = undo_data["lap_id"]
        changes = undo_data["changes"]
    except Exception:
        await callback.answer("Некорректные данные для отмены.", show_alert=True)
        return
    await delete_lap(lap_id)
    for tid_str, delta in changes.items():
        await update_pilot_rating(int(tid_str), -delta)
    await callback.message.edit_text("↩️ Результат отменён. Рейтинг возвращён.")
    await callback.answer("Запись удалена.")

async def remove_undo_button(msg: Message, delay: int):
    await asyncio.sleep(delay)
    try: await msg.edit_reply_markup(reply_markup=None)
    except: pass

# ======================== ПИЛОТЫ (СТАТИСТИКА) ========================
async def _build_pilots_stats() -> tuple[str, InlineKeyboardMarkup]:
    pilots = await get_all_pilots()
    total_pilots = len(pilots)
    db = await get_db()
    try:
        cursor = await db.execute("SELECT COUNT(*) FROM laps")
        total_laps = (await cursor.fetchone())[0]
        cursor = await db.execute("SELECT COUNT(*) FROM disciplines")
        total_disciplines = (await cursor.fetchone())[0]
        cursor = await db.execute(
            "SELECT d.name, COUNT(*) as cnt FROM laps l JOIN disciplines d ON l.discipline_id = d.id "
            "GROUP BY d.name ORDER BY cnt DESC LIMIT 1")
        row = await cursor.fetchone()
        popular_discipline = f"{row[0]} ({row[1]} кругов)" if row else "—"
    finally:
        await db.close()
    text = (
        f"{header('📊', 'Статистика клуба')}\n\n"
        f"👥 Пользователей: <b>{total_pilots}</b>\n"
        f"🏎 Всего кругов: <b>{total_laps}</b>\n"
        f"📚 Дисциплин: <b>{total_disciplines}</b>\n"
        f"🔥 Популярная дисциплина: <b>{popular_discipline}</b>\n\n"
        f"▸ Введите <b>номер пилота</b>, чтобы посмотреть его профиль и управлять им.")
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📋 Список пилотов", callback_data="show_pilots_list")]])
    return text, kb


@router.message(F.text == "👥 Пилоты")
async def pilots_stats(message: Message):
    if not is_admin(message.from_user.id): return
    text, kb = await _build_pilots_stats()
    await message.answer(text, reply_markup=kb)

@router.callback_query(F.data.startswith("pilot_"))
async def pilot_card(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    tid = int(callback.data.split("_")[1])
    pilot = await get_pilot_by_telegram_id(tid)
    if not pilot:
        await callback.message.edit_text("❌ Пилот не найден"); return
    name = pilot.get("display_name") or pilot["username"]
    bonus_balance = await get_bonus_balance(pilot['yclients_client_id']) if pilot.get('yclients_client_id') else 0.0
    text = (
        f"{header('👤', 'Профиль пилота')}\n\n"
        f"<b>{name}</b>\n"
        f"🏎 Номер: #{pilot.get('pilot_number', '—')}\n"
        f"📱 {pilot.get('phone', '—')}\n"
        f"📈 Рейтинг: {pilot.get('rating', 0)}\n"
        f"🎁 Бонусный счёт: {bonus_balance:.2f} ₽")
    await callback.message.edit_text(text, reply_markup=pilot_manage_keyboard(tid))

@router.callback_query(F.data == "back_pilots")
async def back_to_stats(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    text, kb = await _build_pilots_stats()
    await callback.message.edit_text(text, reply_markup=kb)

@router.callback_query(F.data == "show_pilots_list")
async def show_pilots_list(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True); return
    await callback.answer()
    pilots = await get_all_pilots()
    if not pilots:
        await callback.message.answer("В клубе ещё нет пилотов."); return
    lines = [f"@{p['username']} #{p.get('pilot_number', '—')}" for p in pilots]
    await callback.message.answer(f"{header('📋', 'Список пилотов')}\n\n" + "\n".join(lines))

# ======================== РЕЙТИНГ ========================
@router.callback_query(F.data.startswith("rating_plus_"))
async def plus_rating(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    tid = int(callback.data.split("_")[2])
    await callback.message.edit_text("➕ Выберите:", reply_markup=rating_keyboard("+", tid))

@router.callback_query(F.data.startswith("rating_minus_"))
async def minus_rating(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    tid = int(callback.data.split("_")[2])
    await callback.message.edit_text("➖ Выберите:", reply_markup=rating_keyboard("-", tid))

@router.callback_query(F.data.startswith("rate_"))
async def change_rating(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    _, action, amount, tid = callback.data.split("_")
    amount = int(amount); tid = int(tid)
    if action == "-": amount = -amount
    pilot = await get_pilot_by_telegram_id(tid)
    if not pilot: await callback.message.edit_text("❌ Пилот не найден"); return
    old = pilot["rating"]
    await update_pilot_rating(tid, amount)
    name = pilot.get("display_name") or pilot["username"]
    await callback.message.edit_text(f"{header('✅', 'Рейтинг обновлён')}\n\n👤 {name}\n📈 Новый рейтинг: {old + amount}")

# ======================== БАЛАНС (YCLIENTS) ========================
async def get_balance(client_id: int) -> float:
    """Возвращает обычный баланс клиента из YCLIENTS. Может быть отрицательным."""
    client = await get_client(client_id)
    return float(client.get("balance", 0)) if client else 0.0


async def get_bonus_balance(client_id: int) -> float:
    """Возвращает бонусный счёт карты Valevo Bonus."""
    return await get_valevo_bonus_balance(client_id)

@router.callback_query(F.data.startswith("balance_plus_"))
async def balance_plus_start(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    tid = int(callback.data.split("_")[2])
    await state.update_data(balance_tid=tid, balance_action="+")
    await state.set_state(BalanceAction.waiting_for_amount)
    await callback.message.edit_text("🎁 Введите сумму для начисления на бонусный счёт Valevo Bonus (в рублях):")

@router.callback_query(F.data.startswith("balance_minus_"))
async def balance_minus_start(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    tid = int(callback.data.split("_")[2])
    await state.update_data(balance_tid=tid, balance_action="-")
    await state.set_state(BalanceAction.waiting_for_amount)
    await callback.message.edit_text("🎁 Введите сумму для списания с бонусного счёта Valevo Bonus (в рублях):")

@router.message(BalanceAction.waiting_for_amount)
async def balance_amount(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    try:
        amount = float((message.text or "").strip().replace(",", "."))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите положительное число.")
        return

    data = await state.get_data()
    tid = data.get("balance_tid")
    action = data.get("balance_action")
    if tid is None or action is None:
        await message.answer("❌ Данные операции потеряны. Откройте профиль пилота заново.")
        await state.clear()
        return

    pilot = await get_pilot_by_telegram_id(tid)
    if not pilot:
        await message.answer("❌ Пилот не найден.")
        await state.clear()
        return

    if not pilot.get("yclients_client_id"):
        try:
            sync_result = await auto_sync_pilot_with_yclients(tid, pilot.get("phone"), pilot.get("username"))
            pilot = await get_pilot_by_telegram_id(tid)
        except Exception as exc:
            logger.warning("Auto sync before bonus failed: %s", exc)

    delta = amount if action == "+" else -amount
    operation = "Начисление" if delta > 0 else "Списание"
    pilot_name = pilot.get("display_name") or pilot.get("username") or "Пилот"

    result = await issue_or_queue_valevo_bonus(
        telegram_id=tid,
        client_id=pilot.get("yclients_client_id"),
        amount=delta,
        title=f"Valevo Bonus: {operation.lower()} администратором {message.from_user.id}",
        source="admin_manual",
        phone=pilot.get("phone"),
        name=pilot_name,
    )

    if result.get("ok"):
        await message.answer(
            f"{header('✅', 'Бонусный счёт обновлён')}\n\n"
            f"👤 Пилот: {pilot_name}\n"
            f"Операция: {operation} {abs(delta):.2f} ₽\n"
            f"Текущий бонусный счёт: {float(result.get('balance') or 0):.2f} ₽"
        )
        if delta > 0:
            try:
                await message.bot.send_message(
                    tid,
                    (
                        f"🏆 На ваш бонусный счёт Valevo начислено +{amount:g}₽\n\n"
                        "Баланс уже доступен и может быть использован для заездов в клубе.\n\n"
                        "📈 Продолжайте подниматься в рейтинге пилотов, участвуйте в сезоне и занимайте ТОП, "
                        "чтобы получать ещё больше бонусов и наград.\n\n"
                        "Ждём вас на трассе 🏁"
                    )
                )
            except Exception as exc:
                logger.warning("Не удалось отправить уведомление пилоту %s: %s", tid, exc)
    elif result.get("status") == "queued":
        await message.answer(
            f"{header('⚠️', 'Операция в очереди')}\n\n"
            f"👤 Пилот: {pilot_name}\n"
            f"Сумма: {delta:+.2f} ₽\n"
            f"Причина: {result.get('message', 'карта/синхронизация пока недоступна')}\n\n"
            "Бот сам повторит начисление, когда карта Valevo Bonus будет доступна."
        )
    else:
        await message.answer(f"❌ Ошибка YCLIENTS: {result.get('message', 'неизвестная ошибка')}")
    await state.clear()


# ======================== УДАЛЕНИЕ ОДНОГО ВРЕМЕНИ ========================
DELETE_RESULTS_PAGE_SIZE = 8
DELETE_RATING_POINTS = {1: 20, 2: 15, 3: 10}


def _short_button_name(value: str, max_length: int = 22) -> str:
    value = str(value or "Пилот").strip().lstrip("@") or "Пилот"
    return value if len(value) <= max_length else value[:max_length - 1] + "…"


def _delete_results_keyboard(discipline_id: int, results: list, page: int):
    total_pages = max(1, (len(results) + DELETE_RESULTS_PAGE_SIZE - 1) // DELETE_RESULTS_PAGE_SIZE)
    page = max(0, min(page, total_pages - 1))
    start = page * DELETE_RESULTS_PAGE_SIZE
    page_rows = results[start:start + DELETE_RESULTS_PAGE_SIZE]

    keyboard = []
    for row in page_rows:
        label = (
            f"{row['place']}. {_short_button_name(row['display_name'])} "
            f"— {row['lap_time_text']}"
        )
        keyboard.append([
            InlineKeyboardButton(
                text=label,
                callback_data=f"delresult_lap:{row['lap_id']}"
            )
        ])

    navigation = []
    if page > 0:
        navigation.append(
            InlineKeyboardButton(
                text="⬅️",
                callback_data=f"delresult_page:{discipline_id}:{page - 1}"
            )
        )
    navigation.append(
        InlineKeyboardButton(
            text=f"{page + 1}/{total_pages}",
            callback_data="delresult_noop"
        )
    )
    if page + 1 < total_pages:
        navigation.append(
            InlineKeyboardButton(
                text="➡️",
                callback_data=f"delresult_page:{discipline_id}:{page + 1}"
            )
        )
    keyboard.append(navigation)
    keyboard.append([
        InlineKeyboardButton(text="❌ Отмена", callback_data="delresult_cancel")
    ])
    return InlineKeyboardMarkup(inline_keyboard=keyboard)


async def _show_delete_results(callback: CallbackQuery, discipline_id: int, page: int = 0):
    results = await get_current_discipline_results(discipline_id)
    if not results:
        await callback.message.edit_text("❌ В актуальной таблице этой дисциплины нет результатов.")
        return

    discipline = results[0]["discipline"]
    track = results[0]["track"]
    total_pages = max(1, (len(results) + DELETE_RESULTS_PAGE_SIZE - 1) // DELETE_RESULTS_PAGE_SIZE)
    page = max(0, min(page, total_pages - 1))

    await callback.message.edit_text(
        f"{header('🗑', 'Удаление времени')}\n\n"
        f"🏆 Дисциплина: <b>{discipline}</b>\n"
        f"🗺 Актуальная трасса: <b>{track}</b>\n"
        f"👥 Всего мест: <b>{len(results)}</b>\n\n"
        "Выберите любое место из таблицы:",
        reply_markup=_delete_results_keyboard(discipline_id, results, page)
    )


@router.message(F.text == "🗑 Удалить время")
async def delete_result_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return

    await state.clear()
    disciplines = await get_disciplines_with_current_results()

    if not disciplines:
        await message.answer("❌ В таблице пока нет результатов.", reply_markup=admin_menu)
        return

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"{item['name']} — {item['current_track']}",
                    callback_data=f"delresult_disc:{item['id']}"
                )
            ]
            for item in disciplines
        ] + [[InlineKeyboardButton(text="❌ Отмена", callback_data="delresult_cancel")]]
    )

    await message.answer(
        f"{header('🗑', 'Удаление времени из таблицы')}\n\n"
        "Сначала выберите дисциплину. После этого выберите нужное",
        reply_markup=keyboard
    )


@router.callback_query(F.data.startswith("delresult_disc:"))
async def delete_result_choose_discipline(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return

    await callback.answer()
    discipline_id = int(callback.data.split(":", 1)[1])
    await _show_delete_results(callback, discipline_id, page=0)


@router.callback_query(F.data.startswith("delresult_page:"))
async def delete_result_change_page(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return

    _, discipline_id, page = callback.data.split(":", 2)
    await callback.answer()
    await _show_delete_results(callback, int(discipline_id), int(page))


@router.callback_query(F.data == "delresult_noop")
async def delete_result_noop(callback: CallbackQuery):
    await callback.answer()


@router.callback_query(F.data.startswith("delresult_lap:"))
async def delete_result_preview(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return

    lap_id = int(callback.data.split(":", 1)[1])
    row = await get_current_ranked_lap(lap_id)

    if not row:
        await callback.answer(
            "Таблица уже изменилась. Откройте удаление заново.",
            show_alert=True
        )
        return

    pilot_number = f"#{row['pilot_number']}" if row.get("pilot_number") else "—"
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Удалить это время",
                    callback_data=f"delresult_confirm:{lap_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="⬅️ Вернуться к таблице",
                    callback_data=f"delresult_disc:{await _discipline_id_for_delete_row(row)}"
                )
            ],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="delresult_cancel")]
        ]
    )

    await callback.message.edit_text(
        f"{header('⚠️', 'Подтвердите удаление')}\n\n"
        f"🏆 Дисциплина: <b>{row['discipline']}</b>\n"
        f"🗺 Трасса: <b>{row['track']}</b>\n"
        f"📍 Место сейчас: <b>{row['place']}</b>\n"
        f"👤 Пилот: <b>{row['display_name']}</b> ({pilot_number})\n"
        f"⏱ Время: <b>{row['lap_time_text']}</b>\n\n"
        "Удалится конкретная запись этого круга. Если у пилота есть другой "
        "результат на этой трассе, после удаления он автоматически займёт "
        "новое место со своим следующим лучшим временем.",
        reply_markup=keyboard
    )
    await callback.answer()


async def _discipline_id_for_delete_row(row: dict) -> int:
    """Получает id дисциплины для кнопки возврата без хранения текста в callback_data."""
    disciplines = await get_disciplines_with_current_results()
    for item in disciplines:
        if item["name"] == row["discipline"]:
            return int(item["id"])
    return 0


@router.callback_query(F.data.startswith("delresult_confirm:"))
async def delete_result_confirm(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return

    lap_id = int(callback.data.split(":", 1)[1])

    # Повторная проверка прямо перед DELETE: место могло измениться,
    # пока администратор читал подтверждение.
    selected = await get_current_ranked_lap(lap_id)
    if not selected:
        await callback.answer(
            "Запись уже удалена или таблица изменилась. Начните заново.",
            show_alert=True
        )
        return

    discipline_id = await _discipline_id_for_delete_row(selected)
    if not discipline_id:
        await callback.answer("Не удалось определить дисциплину.", show_alert=True)
        return

    old_results = await get_current_discipline_results(discipline_id)
    old_points = {
        row["username"]: DELETE_RATING_POINTS.get(row["place"], 0)
        for row in old_results[:3]
    }

    await delete_lap(lap_id)

    new_results = await get_current_discipline_results(discipline_id)
    new_points = {
        row["username"]: DELETE_RATING_POINTS.get(row["place"], 0)
        for row in new_results[:3]
    }

    # Зеркально корректируем рейтинг тех, чья позиция TOP-3 изменилась.
    for username in set(old_points) | set(new_points):
        delta = new_points.get(username, 0) - old_points.get(username, 0)
        if delta:
            pilot = await get_pilot_by_username(username)
            if pilot:
                await update_pilot_rating(pilot[1], delta)

    replacement = next(
        (row for row in new_results if row["username"] == selected["username"]),
        None
    )
    replacement_text = ""
    if replacement:
        replacement_text = (
            "\n\nℹ️ У пилота остался другой результат:\n"
            f"новое место — <b>{replacement['place']}</b>, "
            f"время — <b>{replacement['lap_time_text']}</b>."
        )

    await callback.message.edit_text(
        f"{header('✅', 'Время удалено')}\n\n"
        f"🏆 {selected['discipline']}\n"
        f"🗺 {selected['track']}\n"
        f"👤 {selected['display_name']}\n"
        f"📍 Было место: {selected['place']}\n"
        f"⏱ Удалено: {selected['lap_time_text']}"
        f"{replacement_text}\n\n"
        "Таблица и позиции пересчитаны автоматически."
    )
    await callback.answer("Время удалено")


@router.callback_query(F.data == "delresult_cancel")
async def delete_result_cancel(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return

    await callback.message.edit_text("❌ Удаление времени отменено.")
    await callback.answer()


# ======================== ТРАССЫ ========================
@router.message(F.text == "➕ Добавить трассу")
async def add_track_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id): return
    disciplines = await get_all_disciplines()
    if not disciplines:
        await message.answer("Нет дисциплин. Сначала создайте хотя бы одну через установку времени."); return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=d, callback_data=f"addtrack_{d}")] for d in disciplines])
    await message.answer("Выберите дисциплину:", reply_markup=kb)
    await state.set_state(TrackAdd.waiting_for_discipline)

@router.callback_query(F.data.startswith("addtrack_"), TrackAdd.waiting_for_discipline)
async def add_track_choose_discipline(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    discipline = callback.data.split("_", 1)[1]
    await state.update_data(discipline=discipline)
    await callback.message.edit_text(f"Введите название трассы для дисциплины «{discipline}»:")
    await state.set_state(TrackAdd.waiting_for_track_name)

MAX_TRACK_NAME_LENGTH = 24


@router.message(TrackAdd.waiting_for_track_name)
async def add_track_save(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    data = await state.get_data()
    discipline = data.get("discipline")
    if not discipline:
        await message.answer("❌ Данные добавления трассы потеряны. Начните заново через «➕ Добавить трассу».")
        await state.clear()
        return
    track_name = (message.text or "").strip()
    if not track_name:
        await message.answer("❌ Введите название трассы текстом.")
        return
    if len(track_name) > MAX_TRACK_NAME_LENGTH:
        await message.answer(
            f"❌ Слишком длинное название (максимум {MAX_TRACK_NAME_LENGTH} символов). "
            "Короткое имя нужно, чтобы кнопка трассы корректно работала в Telegram."
        )
        return
    success, reason = await add_track(discipline, track_name)
    if not success:
        await message.answer("❌ Такая трасса уже есть в этой дисциплине." if reason == "exists" else "❌ Ошибка при добавлении.")
    else:
        await message.answer(f"✅ Трасса «{track_name}» добавлена в дисциплину «{discipline}».")
    await state.clear()

@router.message(F.text == "➖ Удалить трассу")
async def remove_track_start(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id): return
    disciplines = await get_all_disciplines()
    if not disciplines:
        await message.answer("Нет дисциплин."); return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=d, callback_data=f"removetrack_{d}")] for d in disciplines])
    await message.answer("Выберите дисциплину:", reply_markup=kb)
    await state.set_state(TrackRemove.waiting_for_discipline)

@router.callback_query(F.data.startswith("removetrack_"), TrackRemove.waiting_for_discipline)
async def remove_track_choose_discipline(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    discipline = callback.data.split("_", 1)[1]
    tracks = await get_tracks_for_discipline(discipline)
    if not tracks:
        await callback.message.edit_text(f"В дисциплине «{discipline}» нет трасс.")
        await state.clear(); return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t, callback_data=f"deltrack_{discipline}_{t}")] for t in tracks])
    await callback.message.edit_text("Выберите трассу для удаления:", reply_markup=kb)
    await state.set_state(TrackRemove.waiting_for_track_name)

@router.callback_query(F.data.startswith("deltrack_"), TrackRemove.waiting_for_track_name)
async def remove_track_delete(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    _, discipline, track_name = callback.data.split("_", 2)
    await remove_track(discipline, track_name)
    await callback.message.edit_text(f"✅ Трасса «{track_name}» удалена из дисциплины «{discipline}».")
    await state.clear()

# ======================== ЭТАЛОНЫ МЕСЯЦА (ТУРНИР v2) ========================
def _format_benchmark_ms(ms: int) -> str:
    minutes = ms // 60000
    seconds = (ms % 60000) // 1000
    millis = ms % 1000
    return f"{minutes}:{seconds:02d}.{millis:03d}"


async def _build_benchmarks_screen() -> tuple[str, InlineKeyboardMarkup]:
    month_key = month_bounds()[0]
    benchmarks = await get_all_class_benchmarks(month_key)

    lines = []
    keyboard = []
    for class_name, cfg in CLASS_LADDER.items():
        side_of = cfg.get("side_of")
        role = f"доп. для {side_of}" if side_of else "основной класс"
        bench = benchmarks.get(class_name)
        if bench:
            track = bench.get("track") or "—"
            time_text = _format_benchmark_ms(bench["benchmark_ms"])
            status = f"🗺 {track} — ⏱ {time_text}"
        else:
            status = "не задан"
        lines.append(f"🏁 <b>{class_name}</b> ({role})\n{status}")
        keyboard.append([
            InlineKeyboardButton(
                text=f"{class_name} {'✅' if bench else '⚙️'}",
                callback_data=f"benchmark_class:{class_name}"
            )
        ])

    text = (
        f"{header('🎯', 'Эталоны месяца')}\n\n"
        + "\n\n".join(lines)
        + "\n\nВыберите класс, чтобы установить или обновить эталон:"
    )
    return text, InlineKeyboardMarkup(inline_keyboard=keyboard)


@router.message(F.text == "🎯 Эталоны месяца")
async def benchmarks_list(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.clear()
    try:
        text, kb = await _build_benchmarks_screen()
    except Exception:
        logger.exception("Не удалось построить экран эталонов месяца")
        await message.answer("❌ Не удалось загрузить эталоны месяца. Попробуйте ещё раз.")
        return
    await message.answer(text, reply_markup=kb)


@router.callback_query(F.data.startswith("benchmark_class:"))
async def benchmark_choose_class(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        await callback.answer("⛔ Доступ запрещён", show_alert=True)
        return
    await callback.answer()
    class_name = callback.data.split(":", 1)[1]
    if class_name not in CLASS_LADDER:
        await callback.message.answer("❌ Неизвестный класс.")
        return
    await state.update_data(benchmark_class=class_name)
    await state.set_state(BenchmarkSet.waiting_for_track)
    await callback.message.answer(
        f"🗺 Введите название трассы для класса «{class_name}»\n"
        "(или отправьте «-», чтобы оставить без трассы):"
    )


@router.message(BenchmarkSet.waiting_for_track)
async def benchmark_enter_track(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    track_text = (message.text or "").strip()
    track = None if track_text in ("", "-") else track_text
    await state.update_data(benchmark_track=track)
    await state.set_state(BenchmarkSet.waiting_for_time)
    await message.answer("⏱ Введите эталонное время круга:\nПример: 01:18.565")


@router.message(BenchmarkSet.waiting_for_time)
async def benchmark_enter_time(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await state.clear()
        return
    time_text = (message.text or "").strip()
    try:
        benchmark_ms = time_to_ms(time_text)
    except Exception as e:
        logger.warning(f"Неверный формат эталонного времени: {time_text} ({e})")
        await message.answer("❌ Неверный формат времени\nПример: 01:18.565")
        return

    data = await state.get_data()
    class_name = data.get("benchmark_class")
    track = data.get("benchmark_track")
    if not class_name or class_name not in CLASS_LADDER:
        await message.answer("❌ Данные установки эталона потеряны. Начните заново через «🎯 Эталоны месяца».")
        await state.clear()
        return

    month_key = month_bounds()[0]
    try:
        await set_class_benchmark(
            class_name=class_name,
            month_key=month_key,
            track=track,
            benchmark_ms=benchmark_ms,
            admin_id=message.from_user.id,
        )
    except Exception:
        # Раньше здесь не было try/except: любая ошибка записи в БД (например,
        # блокировка файла на этапе WAL-checkpoint) обрывала хендлер до ответа —
        # админ вводил время и не получал вообще никакой реакции бота, будто
        # сообщение потерялось.
        logger.exception(
            "Не удалось сохранить эталон класса %s за %s", class_name, month_key,
        )
        await message.answer(
            "❌ Не удалось сохранить эталон — сбой при записи в базу.\n"
            "Попробуйте ещё раз через «🎯 Эталоны месяца»."
        )
        await state.clear()
        return

    await state.clear()

    # Смена эталона пересчитывает баллы всего класса разом и может перетряхнуть
    # весь общий зачёт. Обновляем базовую линию БЕЗ рассылки: иначе половина
    # клуба получила бы «вас сместили» из-за административного действия, а не
    # из-за чьего-то круга. Пилоты узнают о новом эталоне из ТВ-табло и таблицы.
    try:
        month_key_now, start_iso, end_iso = month_bounds()
        ranking = await rank_month_overall(month_key_now, start_iso, end_iso)
        await rebaseline_standings(month_key_now, ranking)
    except Exception:
        logger.exception("Не удалось пересчитать базовую линию зачёта после смены эталона")

    await message.answer(
        f"{header('✅', 'Эталон обновлён')}\n\n"
        f"🏁 {class_name}\n"
        f"🗺 {track or '—'}\n"
        f"⏱ {time_text}\n\n"
        "<i>Зачёт пересчитан. Уведомления о смещении по этой правке "
        "пилотам не рассылались.</i>"
    )

    text, kb = await _build_benchmarks_screen()
    await message.answer(text, reply_markup=kb)


# ======================== УВЕДОМЛЕНИЯ ========================
async def _tournament_progress_line(telegram_id: int, discipline: str, promoted_to: str | None = None) -> str:
    """Строка о зачёте в турнире v2 для уведомления пилоту после засчитанного круга.

    Раньше после каждого круга просто писали "время зафиксировано" без единого
    слова о том, идёт ли это в зачёт (нужен минимум стартов в классе за месяц —
    свой на каждой ступени лестницы — + заданный клубом эталон) — человеку
    неоткуда было понять, почему в общем зачёте до сих пор нет баллов.

    promoted_to передаётся, если check_and_process_promotion только что перевёл
    пилота в новый класс по этому же кругу — без этого пилот получал два
    сообщения подряд: "НОВЫЙ КЛАСС ОТКРЫТ! Переходите в BTCC" и following за
    ним "В зачёте турнира: 115 баллов (порог перехода: 80)" ПРО СТАРЫЙ класс
    (MX-5), что выглядело как противоречие — будто переход ещё не состоялся."""
    if discipline not in CLASS_LADDER:
        return ""
    if promoted_to:
        return (
            f"\n\n✅ Класс <b>{discipline}</b> пройден — вы уже переведены в <b>{promoted_to}</b>."
        )
    try:
        month_key, start_iso, end_iso = month_bounds()
        result = await live_class_score(telegram_id, discipline, month_key, start_iso, end_iso)
    except Exception:
        logger.exception("Не удалось посчитать прогресс турнира для %s/%s", telegram_id, discipline)
        return ""

    if result["benchmark"] is None:
        return "\n\n⚠️ На этот месяц эталон для класса пока не задан — в зачёт турнира круг не идёт, но сохранён."
    if result["qualifies"] and result["score"] is not None:
        threshold = CLASS_LADDER[discipline].get("threshold")
        extra = f" (порог перехода: {threshold})" if threshold is not None else ""
        return f"\n\n🏆 В зачёте турнира: <b>{result['score']}</b> баллов{extra}."
    return (
        f"\n\n📊 Зачёт турнира: {result['starts']}/{result['min_starts']} стартов в этом месяце. "
        "Как только наберётся минимум — круг встанет в общий зачёт."
    )


async def send_notifications(bot, discipline, new_username, lap_text, selected_tid, track, group_id, promoted_to=None):
    """Уведомляет пилота о зафиксированном времени и публикует результат в группу.

    Раньше здесь же сравнивались топ-3 лучшего времени за всё время и
    начислялся отдельный рейтинг — это убрано: турнирный движок (переходы
    классов и ачивки) теперь единственный источник рейтинга.
    """
    if selected_tid:
        notify_text = (
            f"🏁 Администратор зафиксировал ваше новое время:\n"
            f"{discipline} | {track} | {lap_text}"
        )
        notify_text += await _tournament_progress_line(selected_tid, discipline, promoted_to)
        try:
            await bot.send_message(selected_tid, notify_text)
        except Exception as e:
            logger.warning(f"Не удалось уведомить пилота {selected_tid}: {e}")

    # Пересчёт зачёта для уведомлений о смещении в топ-5. Изменения только
    # ставятся в очередь — отправкой занимается flush_standings_notifications
    # после дебаунса, поэтому разбор пачки заявок подряд не рассылает волну
    # сообщений на каждую заявку.
    try:
        await refresh_standings_after_lap(bot)
    except Exception:
        logger.exception("Не удалось обновить уведомления о зачёте после круга")

    if group_id:
        leaderboard = await build_leaderboard()
        group_msg = f"{header('🔥', 'Новый результат!')}\n\n🏆 {discipline}\n👤 @{new_username}\n🗺 {track}\n⏱ {lap_text}"
        try:
            await bot.send_message(group_id, group_msg)
            await bot.send_message(group_id, leaderboard)
        except Exception as e: logger.warning(f"Ошибка отправки в группу: {e}")

def is_weekcup_close_button(text: str | None) -> bool:
    if not text:
        return False

    t = text.lower().replace("ё", "е").strip()

    return (
        "закрыть" in t
        and (
            "week" in t
            or "cup" in t
            or "вик" in t
            or "кап" in t
            or "недель" in t
        )
    )


@router.message(F.text.func(is_weekcup_close_button))
async def admin_close_weekcup_button(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        await message.answer("⛔ Доступ запрещён")
        return

    await state.clear()

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Да, закрыть Week CUP",
                    callback_data="admin_close_weekcup_yes"
                )
            ],
            [
                InlineKeyboardButton(
                    text="❌ Отмена",
                    callback_data="admin_close_weekcup_cancel"
                )
            ]
        ]
    )

    await message.answer(
        f"{header('⚠️', 'Закрыть Week CUP?')}\n\n"
        "Будет выполнено:\n"
        "1. Зафиксирован TOP-3.\n"
        "2. 1 месту уйдёт сообщение про суперприз.\n"
        "3. 2 месту будет начислено 1000 ₽.\n"
        "4. 3 месту будет начислено 750 ₽.\n"
        "5. Таблица Week CUP будет очищена.\n\n"
        "Остальные дисциплины не будут затронуты.",
        reply_markup=keyboard
    )


@router.callback_query(F.data == "admin_close_weekcup_cancel")
async def admin_close_weekcup_cancel(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("Нет доступа", show_alert=True)
        return

    await callback.message.edit_text("❌ Закрытие Week CUP отменено.")
    await callback.answer()


@router.callback_query(F.data == "admin_close_weekcup_yes")
async def admin_close_weekcup_yes(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("Нет доступа", show_alert=True)
        return

    await callback.message.edit_text("⏳ Закрываю Week CUP...")

    try:
        report = await close_weekcup(callback.bot)
        await callback.message.answer(report)
        await callback.answer("Week CUP закрыт")
    except Exception as exc:
        logger.exception("Ошибка при закрытии Week CUP")

        await callback.message.answer(
            format_admin_error(
                context="Закрытие Week CUP",
                error=exc,
                extra_advice=(
                    "Таблица Week CUP могла остаться незакрытой — проверьте результаты "
                    "перед повторной попыткой, чтобы не начислить призы дважды."
                ),
            )
        )

        await callback.answer("Ошибка", show_alert=True)