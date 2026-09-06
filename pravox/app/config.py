import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class Config:
    db_path: str = "data/pravox.sqlite3"
    bot_token: str = field(default="", repr=False)
    admin_id: int = 6021377014
    channel: str = "@pravoXru"
    public_url: str = ""
    ai_key: str = field(default="", repr=False)
    ai_base: str = "https://api.openai.com/v1"
    ai_model: str = ""
    ai_backend: str = "responses"
    gigachat_auth_key: str = field(default="", repr=False)
    gigachat_scope: str = "GIGACHAT_API_PERS"
    ollama_url: str = "http://ollama:11434"
    auth_ttl: int = 3600
    free_requests: int = 3
    max_question: int = 6000
    requests_per_minute: int = 6
    ai_timeout: int = 120
    worker_threads: int = 3
    history_days: int = 90
    operator_name: str = ""
    support_contact: str = ""
    ai_provider_name: str = ""
    input_price: float = 0
    output_price: float = 0

    @classmethod
    def from_env(cls):
        fields = {
            "db_path": ("DATABASE_PATH", str), "bot_token": ("BOT_TOKEN", str),
            "admin_id": ("ADMIN_TELEGRAM_ID", int), "channel": ("CHANNEL_USERNAME", str),
            "public_url": ("PUBLIC_URL", str), "ai_key": ("AI_API_KEY", str),
            "ai_base": ("AI_BASE_URL", str), "ai_model": ("AI_MODEL", str),
            "ai_backend": ("AI_BACKEND", str), "ollama_url": ("OLLAMA_URL", str),
            "gigachat_auth_key": ("GIGACHAT_AUTH_KEY", str), "gigachat_scope": ("GIGACHAT_SCOPE", str),
            "ai_timeout": ("AI_TIMEOUT", int),
            "worker_threads": ("WORKER_THREADS", int), "history_days": ("HISTORY_DAYS", int),
            "operator_name": ("OPERATOR_NAME", str), "support_contact": ("SUPPORT_CONTACT", str),
            "ai_provider_name": ("AI_PROVIDER_NAME", str),
            "input_price": ("INPUT_USD_PER_MILLION", float),
            "output_price": ("OUTPUT_USD_PER_MILLION", float),
        }
        args = {key: cast(os.environ[name]) for key, (name, cast) in fields.items() if os.environ.get(name)}
        return cls(**args)

    @property
    def channel_url(self):
        return "https://t.me/" + self.channel.lstrip("@")

    @property
    def base_path(self):
        return urlparse(self.public_url).path.rstrip("/")

    @property
    def origin(self):
        parsed = urlparse(self.public_url)
        return parsed.scheme + "://" + parsed.netloc

    @property
    def ai_ready(self):
        return bool(self.ai_model and (self.ai_backend == "ollama" or self.ai_key or self.gigachat_auth_key))

    @property
    def local_ai(self):
        return self.ai_backend == "ollama"

    @property
    def ollama_url_valid(self):
        try:
            url = urlparse(self.ollama_url)
            return (url.scheme == "http" and url.hostname in ("ollama", "localhost", "127.0.0.1", "::1")
                    and not url.username and not url.password and not url.query and not url.fragment
                    and url.path in ("", "/") and url.port == 11434)
        except ValueError:
            return False

    def validate(self):
        problems = []
        if not self.bot_token:
            problems.append("BOT_TOKEN")
        url = urlparse(self.public_url)
        if (url.scheme != "https" or not url.hostname or url.query or url.fragment or url.username
                or not re.fullmatch(r"(?:/[A-Za-z0-9_-]+)*", self.base_path)):
            problems.append("PUBLIC_URL: HTTPS URL with an optional safe path required")
        if not self.ai_ready:
            problems.append("AI credentials / AI_MODEL")
        if self.ai_backend not in ("responses", "ollama", "gigachat"):
            problems.append("AI_BACKEND: responses, ollama or gigachat required")
        if self.local_ai and not self.ollama_url_valid:
            problems.append("OLLAMA_URL: local Ollama on port 11434 required")
        if self.ai_backend == "responses" and urlparse(self.ai_base).scheme != "https":
            problems.append("AI_BASE_URL: HTTPS required")
        if self.ai_backend == "gigachat" and (not self.gigachat_auth_key or self.gigachat_scope not in ("GIGACHAT_API_PERS", "GIGACHAT_API_CORP")):
            problems.append("GIGACHAT_AUTH_KEY / GIGACHAT_SCOPE")
        return problems


STATIC_ROOT = Path(__file__).resolve().parent.parent / "static"
