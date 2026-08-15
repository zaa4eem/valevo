"""
Точка входа мини-приложения VALEVO (Telegram Mini App).

Отдельный процесс от основного бота (main.py), как и tv_board.py —
слушает свой порт, наружу проксируется через reverse proxy (домен valivo.online).
"""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "webapp.api:app",
        host="0.0.0.0",
        port=int(os.getenv("WEBAPP_PORT", "8020")),
    )
