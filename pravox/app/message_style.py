"""Small, escaped Telegram HTML renderer; never trust HTML from a model."""
import html
import re

_INLINE = re.compile(r"\*\*([^*\n]+)\*\*|\x60([^\x60\n]+)\x60")
_HEADINGS = {
    "Кратко", "Что это значит", "Что делать", "Что делать дальше",
    "Порядок действий", "Правовое основание", "Нормативная база",
    "На что обратить внимание", "Важно", "Вывод", "Пример", "Источники",
}


def _inline(text):
    parts, end = [], 0
    for match in _INLINE.finditer(text):
        parts.append(html.escape(text[end:match.start()], quote=False))
        tag = "b" if match.group(1) is not None else "code"
        value = match.group(1) if tag == "b" else match.group(2)
        parts.append("<" + tag + ">" + html.escape(value, quote=False) + "</" + tag + ">")
        end = match.end()
    parts.append(html.escape(text[end:], quote=False))
    return "".join(parts)


def render_message(text):
    """Support headings, bold, inline code and bullets, escaping everything else."""
    lines = []
    for line in text.split("\n"):
        heading = re.match(r"^#{1,6}\s+(.+?)\s*#*\s*$", line)
        if heading:
            title = heading.group(1)
            if title.startswith("**") and title.endswith("**"):
                title = title[2:-2]
            lines.append("<b>" + html.escape(title, quote=False) + "</b>")
        elif line.strip().rstrip(":") in _HEADINGS:
            lines.append("<b>" + html.escape(line, quote=False) + "</b>")
        else:
            line = re.sub(r"^(\s*)[-*]\s+", r"\1• ", line)
            lines.append(_inline(line))
    return "\n".join(lines)


def welcome_text():
    return (
        "⚖️ **правоХ**\nПраво на понятном языке.\n\n"
        "ИИ-помощник по праву России — для жизни и учёбы.\n\n"
        "💬 **Для жизни**\n"
        "Объясню правовые вопросы простыми словами и помогу наметить следующие шаги.\n\n"
        "🎓 **Для учёбы**\n"
        "Разберём тему, юридический термин или учебную задачу.\n\n"
        "✨ **Без оплаты**\n"
        "Первые 3 запроса — без подписки на канал. Затем — бесплатно для подписчиков @pravoXru.\n\n"
        "ИИ может ошибаться. Не отправляйте личные и платёжные данные.\n"
        "Перед началом прочитайте условия обработки обращений: /privacy. "
        "Нажимая «✅ Всё понятно · начать», вы подтверждаете ознакомление."
    )


def mode_text(mode):
    if mode == "student":
        return (
            "🎓 **Учебный разбор**\n\n"
            "Пришлите тему, термин или условие задачи. "
            "Можно указать предмет и что именно вызывает затруднение.\n\n"
            "Новый диалог открыт. Предыдущие доступны в /history."
        )
    return (
        "💬 **Разберём вашу ситуацию**\n\n"
        "Расскажите, что произошло, когда и какого результата вы хотите добиться. "
        "Имена и другие личные данные можно заменить.\n\n"
        "Новый диалог открыт. Предыдущие доступны в /history."
    )


def error_text(error):
    titles = {
        "subscription_required": "✨ Продолжим бесплатно",
        "consent_required": "👋 Перед первым вопросом",
        "rate_limited": "⏳ Небольшая пауза",
    }
    return "**" + titles.get(error.code, "💬 Не удалось продолжить") + "**\n\n" + error.message


def menu_text(profile, admin=False):
    mode = "🎓 Для учёбы" if profile["mode"] == "student" else "💬 Для жизни"
    if admin:
        access = "🛡 Доступ администратора"
    elif profile["used"] < 3:
        access = "✨ Без подписки на канал: " + str(3 - profile["used"]) + " из 3 запросов"
    else:
        access = "✨ Дальше — бесплатно при подписке на @pravoXru"
    return (
        "⚖️ **правоХ · главное меню**\n\n"
        "С чем помочь сегодня?\n"
        "Напишите вопрос своими словами или выберите действие ниже.\n\n"
        "**Текущий режим**\n" + mode + "\n\n" + access + "\n\n"
        "Новая тема? Выберите режим — откроется отдельный диалог. "
        "Предыдущие разговоры доступны в истории."
    )


def examples_text(mode):
    if mode == "student":
        return (
            "💡 **Идеи для учебного вопроса**\n\n"
            "① Объясни разницу между ничтожной и оспоримой сделкой.\n\n"
            "② Помоги разобрать задачу по уголовному процессу — пришлю условие.\n\n"
            "③ Проверь мой ответ по теме «Состав преступления».\n\n"
            "Скопируйте пример или напишите свой вопрос. Можно добавить предмет и курс."
        )
    return (
        "💡 **С чего можно начать**\n\n"
        "① Магазин отказался принять возврат. Какие обстоятельства нужно уточнить?\n\n"
        "② Задерживают зарплату. Как подготовиться к обращению к работодателю?\n\n"
        "③ На что обратить внимание в договоре аренды квартиры?\n\n"
        "Скопируйте пример или опишите свою ситуацию. Сам просмотр примеров запрос не расходует."
    )
