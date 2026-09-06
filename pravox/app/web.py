import json
import html
import mimetypes
import re
import time
from http import HTTPStatus
from urllib.parse import parse_qs
from .ai import LegalAI
from .auth import validate_init_data
from .config import Config, STATIC_ROOT
from .db import Database
from .errors import AppError
from .service import Service
from .stats import summary,users_page,requests_page,csv_export
from .telegram import Telegram


class WebApplication:
    def __init__(self, service):
        self.s, self.config, self.db = service,service.config,service.db

    def __call__(self, env, start_response):
        headers = [("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),("Referrer-Policy","no-referrer"),
            ("Permissions-Policy","camera=(), microphone=(), geolocation=()"),
            ("Content-Security-Policy","default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'none'")]
        try:
            status, body, content_type = self.route(env)
        except AppError as error:
            status,body,content_type = error.status,{"error":error.code,"message":error.message},"application/json"
        except Exception:
            status,body,content_type = 500,{"error":"internal_error","message":"Не удалось выполнить действие. Попробуйте позже."},"application/json"
        if isinstance(body,(dict,list)):
            body = json.dumps(body,ensure_ascii=False).encode()
        elif isinstance(body,str):
            body = body.encode()
        headers.extend([("Content-Type",content_type+"; charset=utf-8"),("Content-Length",str(len(body)))])
        start_response(f"{status} {HTTPStatus(status).phrase}",headers)
        return [body]

    def route(self, env):
        path,method = env.get("PATH_INFO","/"),env.get("REQUEST_METHOD","GET")
        prefix = self.config.base_path
        if prefix and path != "/healthz":
            if path == prefix:
                path = "/"
            elif path.startswith(prefix + "/"):
                path = path[len(prefix):]
            else:
                raise AppError("not_found", "Страница не найдена.", 404)
        if method == "GET" and path == "/healthz":
            self.db.one("SELECT 1 ok")
            return 200,{"status":"ok"},"application/json"
        if method == "GET" and path == "/api/public":
            return 200,{"channel_url":self.config.channel_url,"free_requests":3,"ai_ready":self.config.ai_ready,
                "bot_username":self.db.setting("bot_username"),"history_days":self.config.history_days,
                "operator_name":self.config.operator_name,"support_contact":self.config.support_contact,
                "ai_provider_name":self.config.ai_provider_name,"local_ai":self.config.local_ai},"application/json"
        if method == "GET" and path in ("/","/app","/privacy"):
            page=(STATIC_ROOT/"index.html").read_text().replace("__BASE_PATH__",html.escape(prefix,quote=True))
            return 200,page,"text/html"
        assets = {"/assets/app.js":"app.js","/assets/styles.css":"styles.css","/favicon.svg":"favicon.svg"}
        if method == "GET" and path in assets:
            file = STATIC_ROOT/assets[path]
            return 200,file.read_bytes(),mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if not path.startswith("/api/"):
            raise AppError("not_found","Страница не найдена.",404)
        auth = env.get("HTTP_AUTHORIZATION","")
        raw = auth[4:] if auth.startswith("tma ") else ""
        user = validate_init_data(raw,self.config.bot_token,self.config.auth_ttl)
        uid = user["id"]
        self.db.register(user)
        query = parse_qs(env.get("QUERY_STRING",""))
        body = {}
        if method in ("POST","DELETE"):
            origin = env.get("HTTP_ORIGIN")
            if origin and origin != self.config.origin:
                raise AppError("origin_invalid","Недопустимый источник запроса.",403)
            try:
                length = int(env.get("CONTENT_LENGTH") or "0")
            except ValueError:
                raise AppError("invalid_body","Некорректный запрос.")
            if not 0 <= length <= 30000:
                raise AppError("too_large","Слишком большой запрос.",413)
            if length:
                if not env.get("CONTENT_TYPE","").startswith("application/json"):
                    raise AppError("invalid_content_type","Ожидается JSON.",415)
                try:
                    body = json.loads(env["wsgi.input"].read(length))
                except (ValueError,UnicodeError):
                    raise AppError("invalid_body","Некорректный JSON.")
                if not isinstance(body,dict):
                    raise AppError("invalid_body","Некорректный JSON.")
        data = None
        if method=="GET" and path=="/api/me":
            data={"user":self.s.profile(uid),"conversations":self.db.rows("SELECT * FROM conversations WHERE user_id=? ORDER BY updated DESC",(uid,)),
                "active_job":self.db.one("SELECT id,conversation_id,state FROM jobs WHERE user_id=? AND state IN ('queued','running')",(uid,))}
        elif method=="POST" and path=="/api/consent":
            if body.get("accepted") is not True:
                raise AppError("consent_required","Подтвердите ознакомление с условиями.")
            self.db.execute("UPDATE users SET consent=? WHERE id=?",(time.time(),uid))
            data={"ok":True}
        elif method=="POST" and path=="/api/conversations":
            data={"id":self.s.new_conversation(uid,body.get("mode","citizen"))}
        elif method=="POST" and re.fullmatch(r"/api/conversations/[a-f0-9]{32}/activate",path):
            self.s.activate(uid,path.split("/")[3]);data={"ok":True}
        elif method=="GET" and re.fullmatch(r"/api/conversations/[a-f0-9]{32}",path):
            data={"messages":self.s.history(uid,path.split("/")[3])}
        elif method=="POST" and path=="/api/ask":
            data=self.s.submit(uid,body.get("question"),body.get("client_id"),"miniapp",body.get("conversation_id"))
            return 202,data,"application/json"
        elif method=="GET" and re.fullmatch(r"/api/jobs/[a-f0-9]{32}",path):
            data=self.s.get_job(uid,path.rsplit("/",1)[1])
        elif method=="POST" and path=="/api/membership":
            data=self.s.check_membership(uid)
        elif method=="DELETE" and path=="/api/history":
            self.s.clear_history(uid);data={"ok":True}
        elif method=="POST" and path=="/api/feedback":
            self.s.feedback(uid,body.get("message_id"),body.get("value"));data={"ok":True}
        elif path.startswith("/api/admin/"):
            self.s.require_admin(uid)
            if method=="POST" and path=="/api/admin/export-to-telegram":
                kind=body.get("kind","daily")
                try:days=min(90,max(1,int(body.get("days",30))))
                except (TypeError,ValueError):raise AppError("invalid_filter","Некорректный период.")
                if kind=="users":rows=users_page(self.db,0,100000)
                elif kind=="requests":rows=requests_page(self.db,0,100000)
                elif kind=="daily":rows=summary(self.db,self.config,days)["daily"]
                else:raise AppError("invalid_export","Неизвестный отчёт.")
                self.s.telegram.send_document(uid,"pravox-"+kind+".csv",csv_export(rows))
                return 200,{"ok":True},"application/json"
            if method!="GET":
                raise AppError("not_found","Действие не найдено.",404)
            try:
                days=int(query.get("days",["30"])[0]);offset=max(0,int(query.get("offset",["0"])[0]))
            except ValueError:
                raise AppError("invalid_filter","Некорректный период.")
            if path=="/api/admin/stats":data=summary(self.db,self.config,days)
            elif path=="/api/admin/users":data={"rows":users_page(self.db,offset)}
            elif path=="/api/admin/requests":data={"rows":requests_page(self.db,offset)}
            elif path=="/api/admin/export.csv":
                kind=query.get("kind",["daily"])[0]
                if kind=="users":rows=users_page(self.db,0,100000)
                elif kind=="requests":rows=requests_page(self.db,0,100000)
                elif kind=="daily":rows=summary(self.db,self.config,days)["daily"]
                else:raise AppError("invalid_export","Неизвестный отчёт.")
                return 200,csv_export(rows),"text/csv"
        if data is None:
            raise AppError("not_found","Действие не найдено.",404)
        return 200,data,"application/json"


def create_application(config=None):
    config=config or Config.from_env()
    return WebApplication(Service(config,Database(config.db_path),Telegram(config),LegalAI(config)))


_application = None
def application(environ,start_response):
    global _application
    if _application is None:
        _application=create_application()
    return _application(environ,start_response)
