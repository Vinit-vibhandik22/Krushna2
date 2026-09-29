FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8000
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 libgomp1 && rm -rf /var/lib/apt/lists/*

RUN pip install --index-url https://download.pytorch.org/whl/cpu torch

COPY backend/requirements-deploy.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

COPY backend/ /app/backend/
COPY data/unet_model.pt data/risk_model.joblib /app/data/

RUN useradd -m -u 1000 app && chown -R app:app /app
USER app

EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
