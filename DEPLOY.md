# Deployment Guide — Krishna Sindhu

## What deploys where

| Piece | Platform | Notes |
|---|---|---|
| **Frontend** (React/Vite HUD) | **Vercel** | Static SPA, this repo root is the deploy target |
| **Backend** (FastAPI: SAR ingest, drift, attribution, WebSocket) | **Railway** (Dockerfile included) / Render / Fly.io / local | Needs one long-lived process + WebSocket; **not** serverless-friendly |

Vercel serves only the dashboard. The demo button works fully offline (bundled
demo data), so the deployed site is always usable; live AIS / scenes /
detection require the backend running separately.

## Vercel setup (no config needed in UI)

`vercel.json` at repo root already sets:
- **Build**: `cd frontend && npm install && npm run build`
- **Output**: `frontend/dist`
- **SPA rewrites**: every non-`/api` path → `/index.html`
- **Immutable caching** for hashed `/assets/*`

### Steps
1. Push this repo to GitHub (done).
2. Vercel → **Add New Project** → import `Vinit-vibhandik22/Krushna2`.
3. Framework preset auto-detects **Vite**. Leave build settings as-is
   (vercel.json overrides everything).
4. Deploy. First build ~2 min.

### Pointing the dashboard at a live backend

See **Railway setup (backend)** below — it covers both the `/api` rewrite route
and the direct-base-URL route (with `CORS_ORIGINS`).

### Not included in the deploy (by design)

- `data/` (AIS history, scenes, land mask) — regenerable, gitignored except the two model files
- `my-backend/`, `working-backend/` — vendored experiment copies, not needed by Vercel
- Playwright test artifacts and screenshot scripts (see `frontend/.vercelignore`)

## Railway setup (backend) — already configured in the repo

Everything Railway needs ships with the code; the dashboard setup is a few clicks:

- **`Dockerfile`** (repo root — Railway always builds with it when present):
  - `python:3.11-slim` (matches `requires-python >= 3.11`)
  - installs **CPU-only torch 2.14.0** from `download.pytorch.org/whl/cpu`
    (the default PyPI wheel drags ~2 GB of CUDA libraries this server never uses)
  - installs the rest from `requirements.txt`, then fetches the Natural Earth
    land mask that scene detection and shore-distance attribution need
  - starts `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
- **`/health`** — unauthenticated 2xx probe for Railway healthchecks.
- **`CORS_ORIGINS`** (optional) — comma-separated browser origins allowed to
  call this API; only needed when the dashboard calls this backend cross-origin.

> Why a Dockerfile instead of auto-detection? Railpack/Nixpacks would guess the
> start command `uvicorn main:app` (ours is `backend.main:app`), and with both
> `requirements.txt` and `uv.lock` present it may pick `uv` — whose
> `pyproject.toml` declares no dependencies. The Dockerfile removes both guesses.

### Steps

1. Railway → **New Project → Deploy from GitHub repo** → select
   `Vinit-vibhandik22/Krushna2`. No build/start command needed.
2. **Variables** → add the ones you want from the table below. You can deploy
   with *none* and still get live AIS and demo behaviour.
3. **Settings → Healthcheck Path** → `/health` (300 s timeout is fine; first
   boot imports torch, which takes a few seconds).
4. **Settings → Networking → Generate Domain** → that URL is the backend base.
5. *(Recommended)* **Add a Volume** mounted at **`/data`** and set
   `DB_PATH=/data/app.db` — SQLite history then survives redeploys.
   ⚠️ Do **not** mount a volume at `/app/data`: it would hide the trained models
   baked into the image.
6. *(Recommended)* **Settings → Resources** → at least **1 GB RAM** (torch +
   scipy + rasterio stack).
7. *(Optional)* **Settings → Source → Watch Paths**: `backend/**`, `data/**`,
   `Dockerfile`, `.dockerignore`, `requirements.txt` — so frontend-only pushes
   don't rebuild the backend image.

### Recommended variables

| Variable | Value | Notes |
|---|---|---|
| `CDSE_USER` / `CDSE_PASS` | your Copernicus account | enables scene scanning (catalogue polling works without it) |
| `SH_CLIENT_ID` / `SH_CLIENT_SECRET` | Sentinel Hub OAuth client | fetches just the AOI window (few MB) instead of full products — strongly recommended |
| `DB_PATH` | `/data/app.db` | only with the `/data` volume |
| `SCENE_CACHE_MAX_GB` | `2` | container disk is ephemeral; the 10 GB default can fill it |
| `SCENE_TTL_DAYS` | `3` | same reason |
| `AOI_BBOX` | unset (Gulf of Finland default) or `68.0,8.0,92.0,24.0` (Indian waters) | a bigger AOI means a heavier shore-grid warm-up and larger fetches |
| `CORS_ORIGINS` | `https://<vercel-domain>` | only for direct cross-origin calls |
| `API_KEY` | **leave empty** | the dashboard never sends `X-API-Key`; setting it 401s the whole frontend |

**Do not scale this service to multiple replicas** — the AIS/met/satellite
polling loops live inside the process (volumes also block replicas).

### Wiring the dashboard to the Railway backend

The dashboard calls `/api/*` and `/ws` relative to its own origin. Two options:

- **Vercel rewrite for `/api`** (no CORS changes): add to `vercel.json`
  `{ "source": "/api/(.*)", "destination": "https://<backend>.up.railway.app/api/$1" }`.
  Note: WebSockets (`/ws`) do **not** proxy through Vercel rewrites.
- **Direct base URL** (also gets the live WebSocket): point the frontend at the
  Railway URL (e.g. `VITE_API_BASE` used in `src/api.js`) and set
  `CORS_ORIGINS=https://<vercel-domain>` on Railway.
