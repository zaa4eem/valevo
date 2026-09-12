"""Человеческие сообщения об ошибках для администраторов.

Зачем модуль существует. Раньше админам прилетало сырьё двух видов:

    ⚠️ Необработанная ошибка в боте (update_id=482):
    TypeError: 'NoneType' object is not subscriptable

    ⚠️ Valevo Bonus не начислен автоматически
    Причина: card_not_found

По такому сообщению нельзя понять ни что сломалось, ни насколько это срочно,
ни — главное — что теперь делать руками. Админ клуба не разработчик: строка
"card_not_found" для него не диагноз, а шум, который через неделю начинают
игнорировать вместе с действительно важными.

Здесь собран каталог всех ошибок, которые реально возникают в этом проекте:
коды статусов YCLIENTS, исключения Telegram, сбои SQLite и питоновские
исключения уровня "баг в коде". Для каждой известна причина и конкретные шаги
по устранению. Неизвестная ошибка тоже не теряется — она уходит админу с
честной пометкой "нужен разработчик" и техническими деталями для логов.

Единственная точка отправки ошибок админам: report_admin_error().
"""

from __future__ import annotations

import html
import logging
import time
from dataclasses import dataclass, field

from config import ADMIN_IDS, SUPPORT_CHAT_ID

logger = logging.getLogger(__name__)

# Одинаковые ошибки часто идут пачкой: цикл по 20 пилотам, где каждый падает на
# одном и том же недоступном API, залил бы админу 20 идентичных сообщений.
# В пределах этого окна повторы одной и той же ошибки не отправляются.
DEDUP_WINDOW_SECONDS = 15 * 60

_last_sent: dict[str, float] = {}


@dataclass
class ErrorInfo:
    """Разобранная ошибка: что показать админу вместо кода."""

    title: str
    what: str
    fix: list[str] = field(default_factory=list)
    severity: str = "warning"  # warning | critical | info

    @property
    def emoji(self) -> str:
        return {"critical": "🔴", "warning": "🔧", "info": "ℹ️"}.get(self.severity, "🔧")


# --------------------------------------------------------------------------
# Каталог: код/тип ошибки -> человеческое описание и шаги решения
# --------------------------------------------------------------------------
# Ключи — ровно те строки, которые встречаются в коде проекта: статусы из
# services/yclients_service.py, названия классов исключений aiogram/aiohttp
# и характерные куски текста сообщений SQLite.
ERROR_CATALOG: dict[str, ErrorInfo] = {
    # ---- YCLIENTS: связь клиента и карта лояльности ----
    "card_not_found": ErrorInfo(
        title="Нет карты Valevo Bonus у клиента",
        what="Клиент в YCLIENTS найден, но карты лояльности «Valevo Bonus» у него нет, "
             "поэтому начислить бонус некуда.",
        fix=[
            "Откройте карточку клиента в YCLIENTS → раздел «Лояльность»",
            "Выпустите карту «Valevo Bonus» вручную",
            "Нажмите «🔁 Повторить очередь» в админ-меню — бот доначислит сам",
        ],
    ),
    "create_failed": ErrorInfo(
        title="YCLIENTS не дал выпустить карту",
        what="Бот попытался выпустить карту «Valevo Bonus» автоматически, но API отказал. "
             "Чаще всего выпуск карт через API запрещён настройками филиала.",
        fix=[
            "Выпустите карту клиенту вручную в YCLIENTS",
            "Если так происходит со всеми — отключите автовыпуск: "
            "YCLIENTS_AUTO_CREATE_LOYALTY_CARDS=0 в .env",
        ],
    ),
    "no_card_type": ErrorInfo(
        title="Не указан тип карты лояльности",
        what="В настройках не заполнен YCLIENTS_LOYALTY_CARD_TYPE_ID — бот не знает, "
             "карту какого типа выпускать.",
        fix=[
            "В YCLIENTS откройте «Лояльность» → тип карты «Valevo Bonus» и скопируйте её ID",
            "Впишите его в .env как YCLIENTS_LOYALTY_CARD_TYPE_ID",
            "Перезапустите бота",
        ],
        severity="critical",
    ),
    "no_client_id": ErrorInfo(
        title="Пилот не связан с YCLIENTS",
        what="У пилота в базе бота нет yclients_client_id — бот не знает, какому клиенту "
             "начислять бонус.",
        fix=[
            "Сверьте телефон пилота в боте и в YCLIENTS — они должны совпадать",
            "Запустите «🔄 Синхронизация YCLIENTS» в админ-меню",
            "Если клиента в YCLIENTS нет — заведите его, затем повторите очередь",
        ],
    ),
    "client_not_found": ErrorInfo(
        title="Клиент не найден по телефону",
        what="Телефон, указанный пилотом в боте, не находится среди клиентов YCLIENTS.",
        fix=[
            "Проверьте телефон в профиле пилота — опечатка или другой номер",
            "Заведите клиента в YCLIENTS с этим номером",
            "После этого синхронизация подхватит его автоматически",
        ],
        severity="info",
    ),
    "yclients_error": ErrorInfo(
        title="YCLIENTS не подтвердил транзакцию",
        what="Запрос на начисление ушёл, но API не вернул подтверждения. "
             "Деньги не потеряны — операция сохранена в очереди.",
        fix=[
            "Проверьте баланс карты клиента в YCLIENTS",
            "Если начисления нет — бот повторит сам при следующем проходе очереди",
        ],
    ),
    "issuing": ErrorInfo(
        title="Неизвестен статус выплаты Valevo Bonus",
        what="Предыдущее закрытие месяца упало ровно между вызовом YCLIENTS и сохранением "
             "результата. Неизвестно, прошло ли начисление, поэтому автоповтор остановлен — "
             "иначе есть риск начислить бонус дважды.",
        fix=[
            "Откройте карту клиента в YCLIENTS и посмотрите историю операций",
            "Если начисления нет — начислите вручную на указанную сумму",
            "Если есть — ничего делать не нужно, просто закройте это сообщение",
        ],
        severity="critical",
    ),
    "disabled": ErrorInfo(
        title="Интеграция YCLIENTS выключена",
        what="Начисление не выполнено, потому что интеграция отключена настройками.",
        fix=[
            "Проверьте в .env: YCLIENTS_ISSUE_CASHBACK, YCLIENTS_AUTO_SYNC",
            "Если выключено намеренно — начисляйте бонусы вручную",
        ],
        severity="info",
    ),
    "credentials_missing": ErrorInfo(
        title="Не заполнены токены YCLIENTS",
        what="Нет доступа к API: не заданы YCLIENTS_COMPANY_ID, YCLIENTS_PARTNER_TOKEN "
             "или YCLIENTS_USER_TOKEN.",
        fix=[
            "Заполните все три значения в .env",
            "Перезапустите бота",
            "Затем нажмите «🔁 Повторить очередь» — накопленные начисления уйдут",
        ],
        severity="critical",
    ),
    "zero_amount": ErrorInfo(
        title="Сумма начисления равна нулю",
        what="Запрошено начисление на 0 💎 — YCLIENTS такие операции не принимает.",
        fix=["Проверьте настройку YCLIENTS_BONUS_RUB_PER_HOUR в .env"],
        severity="info",
    ),
    "no_bonus": ErrorInfo(
        title="Награда без бонусных часов",
        what="Для этого места не задано бонусных часов, начислять нечего.",
        fix=["Проверьте таблицу BONUS_HOURS в services/monthly_reset.py"],
        severity="info",
    ),
    "delivery_failed": ErrorInfo(
        title="Заявка не доставлена администраторам",
        what="Ни один админ не получил карточку заявки: бот не может им написать.",
        fix=[
            "Каждый админ из ADMIN_IDS должен сам написать боту /start хотя бы раз",
            "Проверьте, что бот не заблокирован у админов",
            "Сверьте ADMIN_IDS в .env с реальными Telegram ID",
        ],
        severity="critical",
    ),

    # ---- Telegram ----
    "TelegramForbiddenError": ErrorInfo(
        title="Пилот заблокировал бота",
        what="Сообщение не доставлено, потому что пользователь закрыл диалог с ботом. "
             "Это нормальная ситуация, а не поломка.",
        fix=["Ничего делать не нужно — пилот сам разблокирует бота, когда вернётся"],
        severity="info",
    ),
    "TelegramRetryAfter": ErrorInfo(
        title="Сработал лимит Telegram на отправку",
        what="Слишком много сообщений подряд — Telegram временно попросил притормозить.",
        fix=["Ничего делать не нужно, бот подождёт и повторит отправку сам"],
        severity="info",
    ),
    "TelegramBadRequest": ErrorInfo(
        title="Telegram отклонил запрос",
        what="Обычно это безобидное «message is not modified» (текст не изменился) "
             "или попытка отредактировать слишком старое сообщение.",
        fix=[
            "Если сообщение единичное — можно игнорировать",
            "Если повторяется постоянно — пришлите техническую деталь разработчику",
        ],
        severity="info",
    ),
    "TelegramNetworkError": ErrorInfo(
        title="Нет связи с Telegram",
        what="Бот временно не смог достучаться до серверов Telegram.",
        fix=[
            "Проверьте интернет на клубном ПК",
            "Если связь есть, а ошибка повторяется — перезапустите бота",
        ],
    ),

    # ---- Сеть / внешние API ----
    "ClientConnectorError": ErrorInfo(
        title="Нет связи с YCLIENTS",
        what="Бот не смог подключиться к api.yclients.com.",
        fix=[
            "Проверьте интернет на клубном ПК",
            "Операция сохранена в очереди — после восстановления связи уйдёт сама",
        ],
    ),
    "ServerTimeoutError": ErrorInfo(
        title="YCLIENTS не ответил вовремя",
        what="Запрос ушёл, но ответа за отведённое время не пришло.",
        fix=["Обычно проходит само; операция осталась в очереди и будет повторена"],
    ),
    "TimeoutError": ErrorInfo(
        title="Внешний сервис не ответил вовремя",
        what="Превышено время ожидания ответа.",
        fix=["Обычно проходит само; при повторении проверьте интернет"],
    ),

    # ---- База данных ----
    "database is locked": ErrorInfo(
        title="База данных занята",
        what="Файл базы заблокирован другим процессом — чаще всего открыт в DB Browser "
             "или запущен второй экземпляр бота.",
        fix=[
            "Закройте DB Browser / другие программы, открывшие valevo.db",
            "Убедитесь, что бот запущен ровно в одном экземпляре (STOP.bat, затем START)",
        ],
        severity="critical",
    ),
    "attempt to write a readonly database": ErrorInfo(
        title="База данных недоступна на запись",
        what="Файл valevo.db (или его -wal/-shm рядом) стал доступен только для чтения "
             "на уровне Windows. Затронуто ВСЁ: новые круги, рейтинг, эталоны, брони — "
             "ничего не сохраняется, хотя старые данные при этом видны нормально.",
        fix=[
            "Снимите флажок «Только для чтения» с valevo.db (и .db-wal/.db-shm рядом), "
            "если он выставлен: ПКМ → Свойства, или attrib -r в PowerShell",
            "Убедитесь, что файл базы не открыт в DB Browser/Excel и бот не запущен "
            "второй копией",
            "Если папка с базой синхронизируется OneDrive/Google Диском — перенесите её "
            "в обычную локальную папку вне синхронизации",
            "Проверьте права папки для пользователя, от которого запущен бот "
            "(Свойства папки → Безопасность → должно быть «Изменение»)",
            "Проверьте, не поместил ли антивирус файл в карантин",
            "После исправления — STOP.bat, затем заново запустить бота",
        ],
        severity="critical",
    ),
    "UNIQUE constraint failed": ErrorInfo(
        title="Попытка создать дубликат записи",
        what="Значение, которое должно быть уникальным (номер пилота, телефон, "
             "позывной), уже занято другим пилотом.",
        fix=[
            "Посмотрите в технической детали, какое поле конфликтует",
            "Выберите другое значение или освободите занятое у прежнего владельца",
        ],
    ),
    "no such column": ErrorInfo(
        title="Структура базы устарела",
        what="Код ожидает колонку, которой нет в файле базы — база из старой версии бота.",
        fix=[
            "Остановите бота",
            "Сделайте копию valevo.db в папку backups",
            "Запустите бота заново — миграции применятся при старте",
        ],
        severity="critical",
    ),
    "no such table": ErrorInfo(
        title="В базе нет нужной таблицы",
        what="Код обращается к таблице, которой нет — база не инициализирована или "
             "используется не тот файл.",
        fix=[
            "Проверьте путь DB_NAME в .env",
            "Перезапустите бота — недостающие таблицы создаются при старте",
        ],
        severity="critical",
    ),

    # ---- Ошибки уровня кода ----
    "_code_bug": ErrorInfo(
        title="Ошибка в коде бота",
        what="Внутренний сбой, который пользователь исправить не может: бот получил "
             "данные не того вида, которого ожидал.",
        fix=[
            "Функция, где это произошло, скорее всего не сработала — проверьте результат вручную",
            "Перешлите это сообщение разработчику вместе с технической деталью",
            "Подробности есть в logs/bot.log по времени этого сообщения",
        ],
        severity="critical",
    ),
}

# Типы исключений, которые всегда означают "баг в коде", а не внешний сбой.
_CODE_BUG_TYPES = {
    "TypeError", "ValueError", "AttributeError", "KeyError", "IndexError",
    "NameError", "ZeroDivisionError", "UnboundLocalError", "AssertionError",
}


def describe_error(error: object) -> ErrorInfo:
    """Подбирает человеческое описание для кода статуса или исключения.

    Порядок разбора важен: сначала точное совпадение по коду/типу (самое
    надёжное), затем поиск характерных подстрок в тексте (SQLite и YCLIENTS
    отдают диагноз именно текстом), и только потом — общий разбор по типу
    исключения.
    """
    if isinstance(error, ErrorInfo):
        return error

    if isinstance(error, BaseException):
        type_name = type(error).__name__
        text = f"{type_name}: {error}"
    else:
        type_name = ""
        text = str(error or "").strip()

    if not text:
        return ERROR_CATALOG["_code_bug"]

    # 1. Точное совпадение по коду статуса или имени класса исключения.
    for key in (text, type_name):
        if key and key in ERROR_CATALOG:
            return ERROR_CATALOG[key]

    # 2. Характерные подстроки. Сообщения SQLite и YCLIENTS приходят текстом,
    #    поэтому ключ приходится искать внутри строки.
    lowered = text.lower()
    if "credentials are missing" in lowered or "credentials" in lowered and "yclients" in lowered:
        return ERROR_CATALOG["credentials_missing"]
    for key, info in ERROR_CATALOG.items():
        if key.startswith("_"):
            continue
        if key.lower() in lowered:
            return info

    # 3. Исключение известного "багового" типа.
    if type_name in _CODE_BUG_TYPES:
        return ERROR_CATALOG["_code_bug"]

    # 4. Неизвестное — честно говорим, что нужен разработчик, но не молчим.
    return ErrorInfo(
        title="Неизвестная ошибка",
        what="Такая ошибка не описана в справочнике бота, автоматически определить "
             "причину не получилось.",
        fix=[
            "Проверьте, выполнилось ли действие, при котором возникла ошибка",
            "Перешлите это сообщение разработчику — техническая деталь ниже",
            "Полный след ошибки есть в logs/bot.log по времени сообщения",
        ],
        severity="warning",
    )


def format_admin_error(
    context: str,
    error: object,
    details: dict | None = None,
    extra_advice: str | None = None,
) -> str:
    """Готовое сообщение админу: что, где, почему и что теперь делать."""
    info = describe_error(error)

    technical = error if not isinstance(error, BaseException) else f"{type(error).__name__}: {error}"
    technical_text = str(technical or "").strip() or "—"

    lines = [f"{info.emoji} <b>{html.escape(info.title)}</b>", ""]
    lines.append(f"📍 <b>Где:</b> {html.escape(str(context))}")

    for label, value in (details or {}).items():
        lines.append(f"• <b>{html.escape(str(label))}:</b> {html.escape(str(value))}")

    lines.append("")
    lines.append(f"❓ <b>Что случилось:</b> {html.escape(info.what)}")

    if info.fix:
        lines.append("")
        lines.append("🛠 <b>Что делать:</b>")
        for step_number, step in enumerate(info.fix, start=1):
            lines.append(f"{step_number}. {html.escape(step)}")

    if extra_advice:
        lines.append("")
        lines.append(f"ℹ️ {html.escape(extra_advice)}")

    lines.append("")
    lines.append(f"<i>Техническая деталь:</i> <code>{html.escape(technical_text[:400])}</code>")

    return "\n".join(lines)


def _should_send(dedup_key: str | None) -> bool:
    """Гасит повторы одной и той же ошибки внутри окна дедупликации."""
    if not dedup_key:
        return True
    now = time.monotonic()
    last = _last_sent.get(dedup_key)
    if last is not None and (now - last) < DEDUP_WINDOW_SECONDS:
        return False
    _last_sent[dedup_key] = now

    # Чистим протухшие ключи, чтобы словарь не рос бесконечно за время
    # непрерывной работы бота (месяцами без перезапуска).
    if len(_last_sent) > 500:
        for key, sent_at in list(_last_sent.items()):
            if (now - sent_at) >= DEDUP_WINDOW_SECONDS:
                _last_sent.pop(key, None)

    return True


async def report_admin_error(
    bot,
    context: str,
    error: object,
    details: dict | None = None,
    extra_advice: str | None = None,
    *,
    to_all_admins: bool = False,
    dedup_key: str | None = None,
) -> None:
    """Единая точка отправки ошибок админам.

    По умолчанию пишет в SUPPORT_CHAT_ID — рутина не должна дублироваться всем
    админам сразу. to_all_admins=True оставлено для действительно критичного
    (бот не может работать вообще).

    dedup_key по умолчанию собирается из контекста и текста ошибки, поэтому
    цикл, падающий на одном и том же сбое для двадцати пилотов, пришлёт одно
    сообщение, а не двадцать.
    """
    if bot is None:
        return

    if dedup_key is None:
        error_text = f"{type(error).__name__}" if isinstance(error, BaseException) else str(error)
        dedup_key = f"{context}|{error_text}"

    if not _should_send(dedup_key):
        logger.info("Повтор ошибки подавлен дедупликацией: %s", dedup_key)
        return

    text = format_admin_error(context, error, details, extra_advice)

    recipients: list[int] = []
    if to_all_admins:
        recipients = list(ADMIN_IDS)
    elif SUPPORT_CHAT_ID:
        recipients = [SUPPORT_CHAT_ID]
    elif ADMIN_IDS:
        recipients = [ADMIN_IDS[0]]

    for chat_id in recipients:
        try:
            await bot.send_message(chat_id, text)
        except Exception:
            # Сообщать об ошибке отправки сообщения об ошибке через ту же
            # отправку сообщений — прямой путь к бесконечной рекурсии.
            logger.warning("Не удалось отправить админу %s сообщение об ошибке", chat_id)
