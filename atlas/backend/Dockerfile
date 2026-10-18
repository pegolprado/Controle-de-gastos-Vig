FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por fonts-dejavu-core postgresql-client \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --home /app atlas
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN mkdir -p /data/storage && chown -R atlas /data
USER atlas
ENV STORAGE_DIR=/data/storage
EXPOSE 8000
# migrações antes de subir a API (idempotente)
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_WORKERS:-2}"]
