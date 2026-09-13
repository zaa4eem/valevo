import os

import uvicorn

from config import WEBAPP_HOST, WEBAPP_PORT


if __name__ == "__main__":
    uvicorn.run(
        "webapp.api:app",
        host=WEBAPP_HOST,
        port=WEBAPP_PORT,
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "*").strip() or "*",
        server_header=False,
        access_log=True,
        log_level=os.getenv("WEBAPP_LOG_LEVEL", "info").strip().lower() or "info",
        timeout_keep_alive=10,
        limit_concurrency=150,
        workers=1,  # SQLite + in-process mutation limiter: deliberately one worker.
    )
