# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

# System deps kept minimal; SQLite ships with python, httpx is pure-python.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# SQLite database lives on a mounted volume at /data (see docker-compose.yml).
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
