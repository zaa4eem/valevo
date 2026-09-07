import json
import re
import time
import uuid
from .errors import AppError
from .db import decode_message
from .telegram import split_message


class Service:
    def __init__(self, config, database, telegram, ai):
        self.config, self.db, self.telegram, self.ai = config, database, telegram, ai

    def user(self, ident):
        row = self.db.one("SELECT * FROM users WHERE id=?", (ident,))
        if not row:
            raise AppError("unauthorized", "Откройте бота заново.", 401)
        return row

    def require_admin(self, user_id):
        if user_id != self.config.admin_id:
            raise AppError("forbidden", "Доступ разрешён только администратору.", 403)

    def profile(self, user_id):
        user = self.user(user_id)
        user["is_admin"] = user_id == self.config.admin_id
        user["free_remaining"] = max(0, self.config.free_requests - user["used"])
        return user

    def check_membership(self, user_id):
        subscribed, status = self.telegram.membership(user_id)
        now = time.time()
        self.db.execute("""UPDATE users SET member_status=?,member_checked=?,
          joined_after_gate=CASE WHEN ? AND gate_seen IS NOT NULL THEN COALESCE(joined_after_gate,?) ELSE joined_after_gate END
          WHERE id=?""", (status,now,subscribed,now,user_id))
        return {"subscribed": subscribed, "status": status, "checked_at": now}

    def new_conversation(self, user_id, mode):
        if mode not in ("citizen", "student"):
            raise AppError("invalid_mode", "Выберите режим гражданина или студента.")
        with self.db.connection(write=True) as db:
            if db.execute("SELECT 1 FROM jobs WHERE user_id=? AND state IN ('queued','running')", (user_id,)).fetchone():
                raise AppError("busy", "Дождитесь текущего ответа.", 409)
            return self.db.new_conversation(db,user_id,mode)

    def activate(self, user_id, conversation_id):
        with self.db.connection(write=True) as db:
            conversation = db.execute("SELECT * FROM conversations WHERE id=? AND user_id=?", (conversation_id,user_id)).fetchone()
            if not conversation:
                raise AppError("not_found", "Диалог не найден.", 404)
            if db.execute("SELECT 1 FROM jobs WHERE user_id=? AND state IN ('queued','running')", (user_id,)).fetchone():
                raise AppError("busy", "Дождитесь текущего ответа.", 409)
            db.execute("UPDATE users SET active_conversation=?,mode=? WHERE id=?", (conversation_id,conversation["mode"],user_id))

    def history(self, user_id, conversation_id):
        if not self.db.one("SELECT id FROM conversations WHERE id=? AND user_id=?", (conversation_id,user_id)):
            raise AppError("not_found", "Диалог не найден.", 404)
        return [decode_message(r) for r in self.db.rows("SELECT m.*,j.state job_state FROM messages m JOIN jobs j ON j.id=m.job_id WHERE m.conversation_id=? AND m.user_id=? ORDER BY m.id", (conversation_id,user_id))]

    def submit(self, user_id, question, client_id, surface, conversation_id=None):
        if conversation_id is not None and (not isinstance(conversation_id,str) or not re.fullmatch(r"[a-f0-9]{32}",conversation_id)):
            raise AppError("invalid_conversation", "Некорректный диалог.")
        if not isinstance(question,str) or not 1 <= len(question.strip()) <= self.config.max_question:
            raise AppError("invalid_question", f"Напишите вопрос длиной от 1 до {self.config.max_question} символов.")
        if not isinstance(client_id,str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,100}",client_id):
            raise AppError("invalid_request_id", "Обновите приложение и повторите запрос.")
        if surface not in ("telegram", "miniapp"):
            raise AppError("invalid_surface", "Неизвестный способ обращения.")
        question = question.strip()
        existing = self.db.one("SELECT * FROM jobs WHERE user_id=? AND client_id=?", (user_id,client_id))
        if existing:
            if existing["question"] != question:
                raise AppError("idempotency_conflict", "Этот идентификатор уже использован для другого запроса.", 409)
            return self.public_job(existing)
        user = self.user(user_id)
        if user["blocked"]:
            raise AppError("blocked", "Доступ к сервису ограничен. Обратитесь в поддержку.", 403)
        if not user["consent"]:
            raise AppError("consent_required", "Сначала ознакомьтесь с условиями обработки обращений.", 403)
        if not self.config.ai_ready:
            raise AppError("ai_not_configured", "ИИ ещё не подключён. Запрос не списан.", 503)
        membership_checked = False
        if user_id != self.config.admin_id and user["used"] >= self.config.free_requests:
            if not self.check_membership(user_id)["subscribed"]:
                self.db.execute("UPDATE users SET gate_seen=COALESCE(gate_seen,?) WHERE id=?", (time.time(),user_id))
                raise AppError("subscription_required", "Три бесплатных запроса использованы. Подпишитесь на @pravoXru, чтобы продолжить бесплатно.", 403)
            membership_checked = True
        now, job_id = time.time(), uuid.uuid4().hex
        with self.db.connection(write=True) as db:
            existing = db.execute("SELECT * FROM jobs WHERE user_id=? AND client_id=?", (user_id,client_id)).fetchone()
            if existing:
                if existing["question"] != question:
                    raise AppError("idempotency_conflict", "Идентификатор запроса уже использован.", 409)
                return self.public_job(dict(existing))
            if db.execute("SELECT 1 FROM jobs WHERE user_id=? AND state IN ('queued','running')", (user_id,)).fetchone():
                raise AppError("busy", "Предыдущий вопрос ещё обрабатывается. Дождитесь ответа.", 409)
            user = dict(db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())
            if user_id != self.config.admin_id and user["used"] >= self.config.free_requests and not membership_checked:
                raise AppError("retry_membership", "Повторите запрос для проверки подписки.", 409)
            count = db.execute("SELECT count(*) FROM jobs WHERE user_id=? AND created>?", (user_id,now-60)).fetchone()[0]
            if count >= self.config.requests_per_minute:
                raise AppError("rate_limited", "Слишком много запросов. Подождите минуту.", 429)
            if db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0] >= 200:
                raise AppError("queue_full", "Сервис занят. Попробуйте немного позже.", 503)
            conv_id = conversation_id or user["active_conversation"]
            if conv_id:
                conv = db.execute("SELECT * FROM conversations WHERE id=? AND user_id=?", (conv_id,user_id)).fetchone()
                if not conv:
                    raise AppError("not_found", "Диалог не найден.", 404)
                mode = conv["mode"]
            else:
                mode = user["mode"]
                conv_id = self.db.new_conversation(db,user_id,mode)
            db.execute("UPDATE users SET active_conversation=?,mode=?,last_seen=? WHERE id=?", (conv_id,mode,now,user_id))
            db.execute("UPDATE conversations SET title=CASE WHEN title='Новый диалог' THEN ? ELSE title END,updated=? WHERE id=?", (question[:70],now,conv_id))
            db.execute("""INSERT INTO jobs(id,user_id,conversation_id,client_id,question,mode,surface,created)
              VALUES(?,?,?,?,?,?,?,?)""", (job_id,user_id,conv_id,client_id,question,mode,surface,now))
            db.execute("INSERT INTO messages(conversation_id,user_id,role,text,surface,created,job_id) VALUES(?,?,'user',?,?,?,?)", (conv_id,user_id,question,surface,now,job_id))
        return self.get_job(user_id,job_id)

    @staticmethod
    def public_job(row):
        return {key: row[key] for key in ["id","conversation_id","state","error_code","created","finished"]}

    def get_job(self, user_id, job_id):
        job = self.db.one("SELECT * FROM jobs WHERE id=? AND user_id=?", (job_id,user_id))
        if not job:
            raise AppError("not_found", "Запрос не найден.", 404)
        return self.public_job(job)

    def process_one(self):
        with self.db.connection(write=True) as db:
            row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return False
            job = dict(row)
            db.execute("UPDATE jobs SET state='running',started=? WHERE id=?", (time.time(),job["id"]))
        start = time.monotonic()
        try:
            history = self.db.rows("""SELECT m.role,m.text FROM messages m JOIN jobs j ON j.id=m.job_id
              WHERE m.conversation_id=? AND j.state='done' AND j.id<>? ORDER BY m.id DESC LIMIT 12""", (job["conversation_id"],job["id"]))
            answer = self.ai.answer(job["question"],job["mode"],list(reversed(history)))
            counted = answer.kind in ("answer", "clarify")
            now, sources = time.time(), json.dumps(answer.sources,ensure_ascii=False)
            with self.db.connection(write=True) as db:
                if db.execute("SELECT state FROM jobs WHERE id=?", (job["id"],)).fetchone()[0] != "running":
                    return True
                db.execute("""UPDATE jobs SET state='done',finished=?,answer=?,sources=?,input_tokens=?,output_tokens=?,
                  search_calls=?,latency=?,counted=? WHERE id=?""", (now,answer.text,sources,answer.input_tokens,answer.output_tokens,answer.search_calls,now-job["created"],int(counted),job["id"]))
                db.execute("UPDATE users SET used=used+? WHERE id=?", (int(counted),job["user_id"]))
                db.execute("INSERT INTO messages(conversation_id,user_id,role,text,sources,surface,created,job_id) VALUES(?,?,'assistant',?,?,?,?,?)", (job["conversation_id"],job["user_id"],answer.text,sources,job["surface"],now,job["id"]))
                db.execute("UPDATE conversations SET updated=? WHERE id=?", (now,job["conversation_id"]))
                if job["surface"] == "telegram":
                    heading = "Уточним детали" if answer.kind == "clarify" else "Учебный разбор" if job["mode"] == "student" else "Разбор вопроса"
                    text = "**" + heading + "**\n\n" + answer.text
                    if answer.sources:
                        text += "\n\n**Источники**\n" + "\n\n".join(f"[{i+1}] {s['title']}\n{s['url']}" for i,s in enumerate(answer.sources))
                    used = db.execute("SELECT used FROM users WHERE id=?", (job["user_id"],)).fetchone()[0]
                    if counted and used == 3 and job["user_id"] != self.config.admin_id:
                        text += "\n\n**Продолжим бесплатно**\nВы использовали первые 3 запроса. Чтобы задать следующий, подпишитесь на канал правоХ:\n" + self.config.channel_url + "\n\nОплата не требуется."
                    for part, chunk in enumerate(split_message(text)):
                        db.execute("INSERT INTO outbox(user_id,text,created,job_id,part) VALUES(?,?,?,?,?)", (job["user_id"],chunk,now,job["id"],part))
        except Exception as error:
            code = error.code if isinstance(error,AppError) else "internal_error"
            with self.db.connection(write=True) as db:
                changed = db.execute("UPDATE jobs SET state='failed',finished=?,error_code=?,latency=? WHERE id=? AND state='running'", (time.time(),code,time.time()-job["created"],job["id"])).rowcount
                if changed and job["surface"] == "telegram":
                    text = "**Ответ пока не готов**\n\nНе удалось подготовить проверяемый ответ. Попробуйте отправить вопрос позже.\n\nЗапрос не списан."
                    db.execute("INSERT INTO outbox(user_id,text,created,job_id,part) VALUES(?,?,?,?,0)", (job["user_id"],text,time.time(),job["id"]))
        return True

    def clear_history(self, user_id):
        with self.db.connection(write=True) as db:
            if db.execute("SELECT 1 FROM jobs WHERE user_id=? AND state IN ('queued','running')", (user_id,)).fetchone():
                raise AppError("busy", "Сначала дождитесь завершения текущего запроса.", 409)
            db.execute("DELETE FROM conversations WHERE user_id=?", (user_id,))
            db.execute("DELETE FROM outbox WHERE user_id=?", (user_id,))
            db.execute("UPDATE jobs SET question='',answer=NULL,sources='[]',conversation_id=NULL WHERE user_id=?", (user_id,))
            db.execute("UPDATE users SET active_conversation=NULL WHERE id=?", (user_id,))

    def feedback(self, user_id, message_id, value):
        if type(message_id) is not int:
            raise AppError("invalid_feedback", "Некорректный ответ для оценки.")
        if type(value) is not int or value not in (-1,1):
            raise AppError("invalid_feedback", "Выберите оценку ответа.")
        if not self.db.execute("UPDATE messages SET feedback=? WHERE id=? AND user_id=? AND role='assistant'", (value,message_id,user_id)):
            raise AppError("not_found", "Ответ не найден.", 404)
