FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home pravox && mkdir /data && chown pravox:pravox /data
COPY app ./app
COPY static ./static
COPY manage.py ./manage.py
USER 10001:10001
EXPOSE 8000
CMD ["gunicorn", "app.web:application", "--bind", "0.0.0.0:8000", "--worker-class", "gthread", "--workers", "2", "--threads", "4", "--timeout", "45", "--graceful-timeout", "30", "--limit-request-line", "4094", "--limit-request-field_size", "16384"]
