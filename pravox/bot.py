import signal
import threading
import time
from .errors import AppError, UpstreamError
from .stats import summary
from .message_style import welcome_text, mode_text, error_text
from .web import create_application


def privacy_text(config):
    return (f"правоХ хранит ваш Telegram ID, имя, историю вопросов и ответов до {config.history_days} дней. " +
            ("В тестовом режиме вопрос обрабатывает локальная модель на сервере правоХ. Поиска и проверки актуальности законов нет. " if config.local_ai else "Вопрос и последние сообщения текущего диалога передаются подключённому ИИ-сервису; при поиске формируется поисковый запрос. ") +
            "Не отправляйте паспортные данные, банковские реквизиты и чужие личные сведения. "
            "Историю на стороне правоХ можно удалить командой /delete; счётчик обращений и статистика использования сохраняются. "
            "Резервные копии хранятся до 7 дней. Удаление в правоХ не удаляет переписку в Telegram или данные, уже обработанные внешним провайдером. "
            "Ответы ИИ могут содержать ошибки: проверяйте источники, а для сложного дела обращайтесь к специалисту.\n\n"
            f"Оператор: {config.operator_name or 'сведения будут добавлены перед публичным запуском'}.\n"
            f"ИИ-провайдер: {config.ai_provider_name or 'ещё не выбран'}.\n"
            f"Связь: {config.support_contact or config.channel_url}.")


class Bot:
    def __init__(self, service):
        self.s,self.tg,self.db,self.config=service,service.telegram,service.db,service.config

    def consent_keyboard(self):
        rows=[[{"text":"Прочитал · начать","callback_data":"accept"}]]
        if self.config.public_url:
            rows.append([{"text":"Обработка обращений","url":self.config.public_url+"/privacy"}])
        return rows

    def handle(self, update):
        callback=update.get("callback_query")
        msg=(callback or {}).get("message") or update.get("message")
        user=(callback or {}).get("from") or (msg or {}).get("from")
        if not msg or not user or user.get("is_bot") or msg.get("chat",{}).get("type")!="private":
            return
        uid=user["id"]
        if msg["chat"]["id"]!=uid:return
        profile=self.db.register(user)
        if callback:
            self.tg.call("answerCallbackQuery",{"callback_query_id":callback["id"]})
            data=callback.get("data","")
            try:
                if data=="accept":
                    self.db.execute("UPDATE users SET consent=? WHERE id=?",(time.time(),uid))
                    self.tg.send(uid,"**С чего начнём?**\n\nВыберите «Для жизни» или «Для учёбы» — либо просто напишите вопрос.\n\nМожно общаться здесь или в приложении: история общая.",self.tg.menu_keyboard(uid==self.config.admin_id))
                elif data=="check_membership":
                    result=self.s.check_membership(uid)
                    self.tg.send(uid,"**Подписка подтверждена ✓**\n\nОтправьте вопрос ещё раз — предыдущий не был отправлен автоматически. Дальнейшее общение бесплатно." if result["subscribed"] else "**Пока не вижу подписку**\n\nПодпишитесь на канал правоХ, затем нажмите «Проверить подписку».",self.tg.menu_keyboard() if result["subscribed"] else self.tg.gate_keyboard())
                elif data.startswith("mode:"):
                    mode=data.split(":",1)[1]
                    self.s.new_conversation(uid,mode)
                    self.tg.send(uid,mode_text(mode))
                elif data.startswith("conv:"):
                    self.s.activate(uid,data.split(":",1)[1])
                    self.tg.send(uid,"**Продолжим диалог**\n\nОтправьте следующий вопрос. Контекст переписки в приложении доступен и здесь.")
                elif data=="delete_confirm":
                    self.s.clear_history(uid)
                    self.tg.send(uid,"**История удалена**\n\nТексты диалогов удалены из правоХ. Статистика и счётчик запросов сохранены.\n\nСообщения в самом Telegram удаляются отдельно.")
            except AppError as error:
                self.tg.send(uid,error_text(error))
            return
        text=msg.get("text","").strip()
        command=text.split(maxsplit=1)[0].split("@")[0].lower() if text else ""
        if command in ("/start","/help"):
            if not profile["consent"]:
                self.tg.send(uid,welcome_text(),self.consent_keyboard())
            else:
                self.tg.send(uid,"**правоХ · главное меню**\n\nНапишите вопрос или выберите режим ниже.\n\n**Ваши диалоги**\n/new — начать новый\n/history — продолжить предыдущий\n/app — открыть приложение\n\n**Данные и условия**\n/privacy — обработка обращений\n/delete — удалить историю\n\n"+("Доступ администратора." if uid==self.config.admin_id else "Без подписки на канал осталось запросов: "+str(max(0,3-profile["used"]))+".\nЗатем — бесплатно для подписчиков @pravoXru."),self.tg.menu_keyboard(uid==self.config.admin_id))
        elif command=="/privacy":self.tg.send(uid,privacy_text(self.config))
        elif command=="/app":
            self.tg.send(uid,"**правоХ · приложение**\n\nПродолжайте разговор в удобном формате. Диалоги и счётчик запросов общие с этим чатом.",self.tg.menu_keyboard(uid==self.config.admin_id))
        elif command=="/admin":
            if uid!=self.config.admin_id:
                self.tg.send(uid,"Этот раздел доступен только администратору.");return
            data=summary(self.db,self.config)
            self.tg.send(uid,f"**правоХ · статистика**\nПоследние 30 дней · UTC\n\nПользователей всего: {data['users_total']}\nНовых: {data['users_new']}\nDAU / WAU / MAU: {data['dau']} / {data['wau']} / {data['mau']}\nЗапросов: {data['requests']}\nГотовых: {data['completed']}\nОшибок: {data['failed']}\nВ очереди: {data['pending']}\nУвидели требование подписки: {data['gate_users']}\nПодтвердили после него: {data['converted_users']}\n\nПодробные отчёты и CSV — в приложении.",self.tg.menu_keyboard(True))
        elif command=="/history":
            rows=self.db.rows("SELECT id,title FROM conversations WHERE user_id=? ORDER BY updated DESC LIMIT 10",(uid,))
            keyboard=[[{"text":r["title"][:45],"callback_data":"conv:"+r["id"]}] for r in rows]
            self.tg.send(uid,"**Ваши диалоги**\n\nВыберите, какой разговор продолжить:" if rows else "**Здесь появятся ваши диалоги**\n\nНапишите первый вопрос — история сохранится автоматически.",keyboard or None)
        elif command=="/delete":
            self.tg.send(uid,"**Удалить историю?**\n\nВсе тексты диалогов на стороне правоХ будут удалены без возможности восстановления.\n\nСтатистика и счётчик запросов сохранятся. Сообщения в Telegram останутся.",[[{"text":"Удалить историю","callback_data":"delete_confirm"}]])
        elif command in ("/new","/student","/citizen"):
            try:
                mode=command[1:] if command!="/new" else profile["mode"]
                self.s.new_conversation(uid,mode)
                self.tg.send(uid,mode_text(mode))
            except AppError as error:self.tg.send(uid,error_text(error))
        elif text.startswith("/"):
            self.tg.send(uid,"**Команда не найдена**\n\nОткройте меню: /start. Или просто напишите вопрос.")
        elif not text:
            self.tg.send(uid,"**Пришлите вопрос текстом**\n\nПока я не разбираю вложения и голосовые сообщения. Опишите ситуацию или скопируйте нужный фрагмент без личных данных.")
        else:
            try:
                self.s.submit(uid,text,"tg:"+str(update["update_id"]),"telegram")
                self.tg.send(uid,"**Готовлю ответ…**\n\nРазберу ваш вопрос и отправлю ответ в этот чат.")
            except AppError as error:
                keyboard=self.tg.gate_keyboard() if error.code=="subscription_required" else self.consent_keyboard() if error.code=="consent_required" else None
                self.tg.send(uid,error_text(error),keyboard)

    def deliver_one(self):
        row=self.db.one("""SELECT o.* FROM outbox o WHERE o.delivered IS NULL AND o.attempts<8 AND o.next_attempt<=?
          AND NOT EXISTS(SELECT 1 FROM outbox p WHERE p.user_id=o.user_id AND p.id<o.id AND p.delivered IS NULL AND p.attempts<8)
          ORDER BY o.id LIMIT 1""",(time.time(),))
        if not row:return False
        try:
            self.tg.send(row["user_id"],row["text"])
            self.db.execute("UPDATE outbox SET delivered=? WHERE id=?",(time.time(),row["id"]))
        except UpstreamError as error:
            attempts=8 if error.status_code in (400,403) else row["attempts"]+1
            self.db.execute("UPDATE outbox SET attempts=?,next_attempt=? WHERE id=?",(attempts,time.time()+min(300,2**attempts),row["id"]))
        return True


def main():
    app=create_application();bot=Bot(app.s);stopped=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda *_:stopped.set())
    webhook=bot.tg.call("getWebhookInfo")
    if webhook.get("url"):
        raise SystemExit("Bot has an active webhook. Review it before switching to polling; no changes made.")
    def deliver():
        while not stopped.is_set():
            try:
                if not bot.deliver_one():stopped.wait(1)
            except Exception:stopped.wait(3)
    thread=threading.Thread(target=deliver,daemon=True);thread.start()
    while not stopped.is_set():
        try:
            updates=bot.tg.call("getUpdates",{"offset":int(bot.db.setting("telegram_offset","0")),"timeout":25,"allowed_updates":["message","callback_query"]},timeout=35)
            for update in updates:
                bot.handle(update)
                bot.db.set_setting("telegram_offset",update["update_id"]+1)
        except Exception:
            # Never log exception URLs: Telegram request URLs contain the bot token.
            print("telegram: delivery or polling unavailable; retrying",flush=True);stopped.wait(5)
    thread.join(timeout=20)


if __name__=="__main__":main()
