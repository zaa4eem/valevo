FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN useradd --create-home --shell /usr/sbin/nologin botuser

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .
RUN mkdir -p /app/logs /app/backups /app/data && chown -R botuser:botuser /app

USER botuser

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 CMD python healthcheck.py || exit 1

CMD ["bash", "scripts/start.sh"]
