FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN useradd --system --uid 10001 --home /app marx
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
RUN mkdir -p /data && chown marx /data
USER marx
EXPOSE 8000
# Um processo basta: o servidor só autentica (as análises rodam no navegador).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
