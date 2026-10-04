# Deployment Guide — Krishna Sindhu

## What deploys where

| Piece | Platform | Notes |
|---|---|---|
| **Frontend** (React/Vite HUD) | **Vercel** | Static SPA, this repo root is the deploy target |
| **Backend** (FastAPI: SAR ingest, drift, attribution, WebSocket) | Render / Railway / Fly.io / local | Needs long-lived process + WebSocket; **not** serverless-friendly |

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

### Pointing the dashboard at a live backend (optional)

The frontend calls `/api/*` and `/ws` relative to its own origin. To connect a
hosted backend:

1. Deploy the FastAPI app (e.g. Render: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`).
2. Add a Vercel rewrite (or an env-driven proxy) mapping `/api` and `/ws` to
   the backend URL — or set `VITE_API_BASE` in the frontend and use it in
   `src/api.js` if you prefer explicit base URLs.
3. If the backend runs on a different domain, add CORS middleware there
   (`fastapi.middleware.cors`) for the Vercel domain.

### Not included in the deploy (by design)

- `data/` (AIS history, scenes, land mask) — regenerable, gitignored except the two model files
- `my-backend/`, `working-backend/` — vendored experiment copies, not needed by Vercel
- Playwright test artifacts and screenshot scripts (see `frontend/.vercelignore`)
