import json
import sqlite3
import time
import uuid
import datetime
import os
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '',
 created REAL NOT NULL, last_seen REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0,
 mode TEXT NOT NULL DEFAULT 'citizen', active_conversation TEXT,
 member_status TEXT NOT NULL DEFAULT 'unknown', member_checked REAL,
 gate_seen REAL, joined_after_gate REAL, consent REAL, blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL DEFAULT 'Новый диалог', mode TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS conv_owner ON conversations(user_id, updated DESC);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), conversation_id TEXT,
 client_id TEXT NOT NULL, question TEXT NOT NULL, mode TEXT NOT NULL, surface TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued', created REAL NOT NULL, started REAL, finished REAL,
 answer TEXT, sources TEXT NOT NULL DEFAULT '[]', error_code TEXT,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 search_calls INTEGER NOT NULL DEFAULT 0, latency REAL, counted INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id, client_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(user_id) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS job_queue ON jobs(state, created);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]',
 surface TEXT NOT NULL, created REAL NOT NULL, job_id TEXT NOT NULL,
 feedback INTEGER, UNIQUE(job_id, role)
);
CREATE INDEX IF NOT EXISTS message_thread ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL,
 created REAL NOT NULL, delivered REAL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
 job_id TEXT, part INTEGER, UNIQUE(job_id, part)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
"""


class Database:
    def __init__(self, path):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=15000")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if write:
                db.commit()
        except Exception:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def rows(self, sql, params=()):
        with self.connection() as db:
            return [dict(r) for r in db.execute(sql, params)]

    def one(self, sql, params=()):
        values = self.rows(sql, params)
        return values[0] if values else None

    def execute(self, sql, params=()):
        with self.connection(write=True) as db:
            return db.execute(sql, params).rowcount

    def register(self, user):
        now = time.time()
        self.execute("""INSERT INTO users(id,first_name,username,created,last_seen) VALUES(?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,last_seen=excluded.last_seen""",
          (user["id"], str(user.get("first_name", ""))[:128], str(user.get("username", ""))[:64], now, now))
        return self.one("SELECT * FROM users WHERE id=?", (user["id"],))

    @staticmethod
    def new_conversation(db, user_id, mode):
        ident, now = uuid.uuid4().hex, time.time()
        db.execute("INSERT INTO conversations(id,user_id,mode,created,updated) VALUES(?,?,?,?,?)", (ident,user_id,mode,now,now))
        db.execute("UPDATE users SET active_conversation=?,mode=? WHERE id=?", (ident,mode,user_id))
        return ident

    def setting(self, key, default=""):
        row = self.one("SELECT value FROM settings WHERE key=?", (key,))
        return row["value"] if row else default

    def set_setting(self, key, value):
        self.execute("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key,str(value)))

    def enqueue_text(self, user_id, text):
        self.execute("INSERT INTO outbox(user_id,text,created) VALUES(?,?,?)", (user_id,text,time.time()))

    def cleanup(self, days):
        cutoff = time.time() - days * 86400
        with self.connection(write=True) as db:
            db.execute("DELETE FROM messages WHERE created<?", (cutoff,))
            db.execute("UPDATE jobs SET question='',answer=NULL,sources='[]' WHERE created<? AND state NOT IN ('queued','running')", (cutoff,))
            db.execute("DELETE FROM outbox WHERE created<?", (cutoff,))
            db.execute("UPDATE conversations SET title='Архивный диалог' WHERE updated<?", (cutoff,))

    def backup(self, folder, keep_days=7):
        folder=Path(folder);folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        stamp=str(datetime.datetime.now(datetime.timezone.utc).date())
        destination=folder/f"pravox-{stamp}.sqlite3"
        if not destination.exists():
            temporary=folder/("snapshot-"+uuid.uuid4().hex+".tmp")
            descriptor=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(descriptor)
            try:
                with self.connection() as source, sqlite3.connect(temporary) as target:source.backup(target)
                os.replace(temporary,destination)
            finally:
                if temporary.exists():temporary.unlink()
        for old in folder.glob("pravox-*.sqlite3"):
            if old.stat().st_mtime < time.time()-keep_days*86400:old.unlink()
        return str(destination)


def decode_message(row):
    result = dict(row)
    result["sources"] = json.loads(result["sources"])
    return result
