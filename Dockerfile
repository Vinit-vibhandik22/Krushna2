# Railway backend image — Krishna Sindhu / SPILL2SOURCE
# (FastAPI REST+WebSocket API, live AIS/met/satellite scheduler, U-Net detector)
#
# Why a Dockerfile instead of Railpack/Nixpacks auto-detection:
#   * the app module is backend.main:app — auto-detection would guess "main:app";
#   * the repo has requirements.txt AND uv.lock while pyproject.toml declares no
#     [project.dependencies], so a uv-based auto-build would install nothing;
#   * torch is installed from the CPU-only index — the default PyPI wheel drags
#     ~2 GB of CUDA libraries this server never uses.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgomp1: OpenMP runtime needed by the CPU wheels of torch / scipy / scikit-learn
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) CPU-only torch first, so the requirements step below sees it satisfied
#    (2.14.0 matches uv.lock; the CPU index serves it as 2.14.0+cpu)
RUN pip install "torch==2.14.0" --index-url https://download.pytorch.org/whl/cpu

# 2) the rest of the stack (cached until requirements.txt changes)
COPY requirements.txt .
RUN pip install -r requirements.txt

# 3) land mask (Natural Earth 10 m coastlines) — required by scene detection
#    and shore-distance attribution; fetched from the official CDN at build
#    time. stdlib-only script, so this layer stays cached across code changes.
COPY scripts/fetch_landmask.py scripts/fetch_landmask.py
RUN python scripts/fetch_landmask.py

# 4) application code; data/ carries the trained models the detector loads
COPY . .

EXPOSE 8080

# Railway injects PORT (healthchecks use the same port). Keep a single worker:
# the AIS/met/satellite polling loops live inside this process.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
