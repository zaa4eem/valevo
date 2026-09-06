import signal
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from .web import create_application


def main():
    app=create_application()
    stopped=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):
        signal.signal(sig,lambda *_:stopped.set())
    def loop():
        while not stopped.is_set():
            try:
                if not app.s.process_one():stopped.wait(1)
            except Exception:
                print("worker: retrying after internal storage error",flush=True)
                stopped.wait(3)
    with ThreadPoolExecutor(max_workers=app.config.worker_threads) as pool:
        futures=[pool.submit(loop) for _ in range(app.config.worker_threads)]
        last_cleanup=0
        while not stopped.wait(15):
            try:
                now=time.time()
                with app.db.connection(write=True) as db:
                    stale=list(db.execute("SELECT id,user_id,surface FROM jobs WHERE state='running' AND started<?",(now-app.config.ai_timeout-180,)))
                    for job in stale:
                        db.execute("UPDATE jobs SET state='failed',error_code='worker_interrupted',finished=? WHERE id=?",(now,job["id"]))
                        if job["surface"]=="telegram":
                            db.execute("INSERT OR IGNORE INTO outbox(user_id,text,created,job_id,part) VALUES(?,?,?,?,0)",(job["user_id"],"Обработка прервалась. Запрос не списан. Повторите вопрос.",now,job["id"]))
                if now-last_cleanup>3600:
                    app.db.cleanup(app.config.history_days)
                    app.db.backup(Path(app.config.db_path).parent/"backups")
                    last_cleanup=now
            except Exception:
                print("worker: maintenance failed; will retry",flush=True)
        for future in futures:future.result()


if __name__=="__main__":main()
