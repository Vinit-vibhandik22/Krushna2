# Krishna Sindhu — Environment Variables Guide

## Critical context first

**Vercel serves only the frontend dashboard** (static Vite build of `frontend/`).
The FastAPI backend never runs there, so these variables have **no effect if
pasted into Vercel** — harmless, but dead weight. They belong on the platform
that runs the backend (Render / Railway / Fly.io / local `.env`).

Two exceptions where a Vercel variable *would* matter:
- `VITE_*`-prefixed variables (baked into the frontend build) — not used yet.
- If you later add a `VITE_API_BASE` to point the dashboard at your hosted backend.

## What each variable does (from `backend/config.py` + `.env.example`)

| Variable | Default | Used for |
|---|---|---|
| `CDSE_USER` / `CDSE_PASS` | empty | Copernicus Data Space account — Sentinel-1 catalogue + full-product downloads. **Without it: no scene scanning.** |
| `SH_CLIENT_ID` / `SH_CLIENT_SECRET` | empty | Sentinel Hub OAuth — fetches only the AOI window (few MB) instead of multi-GB products. Optional but strongly recommended. |
| `SH_RESOLUTION_M` | `40` | SAR raster resolution via Sentinel Hub |
| `AOI_BBOX` | `21.8,58.9,30.6,60.7` | Surveillance rectangle `lon0,lat0,lon1,lat1` |
| `AISSTREAM_API_KEY` | — | aisstream.io key. **Note:** the merged `backend/config.py` on main does not reference it yet (it's in `.env.example` and a stale compiled `.pyc`) — the AIS provider currently polls Digitraffic, which needs no key. It appears your teammate's branch was mid-add of an aisstream provider. Keep the key if they're about to land it; otherwise it's inert. |
| `AIS_POLL_SECONDS` | `30` | AIS refresh interval |
| `MET_REFRESH_SECONDS` | `3600` | Wind/current/wave field refresh |
| `SAT_POLL_SECONDS` | `600` | Sentinel-1 catalogue poll |
| `DRIFT_HOURS_BACK` | `18` | Hindcast window (origin estimate) |
| `DRIFT_HOURS_FWD` | `24` | Forecast cone window |
| `PARTICLES` | `100` code / `600` example | Lagrangian particle count (higher = slower, smoother) |
| `DATA_DIR` | `data` | Where scenes/landmask/models live |
| `DB_PATH` | `data/app.db` | SQLite path |
| `API_KEY` | empty | If set, all `/api/*` routes require `X-API-Key` |
| `SCENE_CACHE_MAX_GB` | `10` | Disk cap before oldest scenes are pruned |
| `SCENE_TTL_DAYS` | `7` | Scene age limit regardless of status |

## Ready-to-paste backend `.env`

```env
# --- Copernicus / Sentinel Hub (free: https://dataspace.copernicus.eu) ---
CDSE_USER=your_cdse_email
CDSE_PASS=your_cdse_password
SH_CLIENT_ID=your_sh_oauth_client_id
SH_CLIENT_SECRET=your_sh_oauth_client_secret
SH_RESOLUTION_M=40

# --- Area of interest ---
# Gulf of Finland (current default):      21.8,58.9,30.6,60.7
# Indian waters (per your .env.example):  68.0,8.0,92.0,24.0
AOI_BBOX=21.8,58.9,30.6,60.7

# --- AIS ---
AISSTREAM_API_KEY=your_aisstream_key_here
AIS_POLL_SECONDS=30
MET_REFRESH_SECONDS=3600
SAT_POLL_SECONDS=600

# --- Drift model ---
DRIFT_HOURS_BACK=18
DRIFT_HOURS_FWD=24
PARTICLES=300

# --- Storage / ops ---
DATA_DIR=data
DB_PATH=data/app.db
API_KEY=
SCENE_CACHE_MAX_GB=10
SCENE_TTL_DAYS=7
```

## Platform notes

- **Render/Railway**: also set the start command
  `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` and add a **persistent
  disk** mounted at `data/` (SQLite + scene cache don't survive ephemeral filesystems).
- **Frontend on Vercel + backend elsewhere**: the dashboard calls `/api/*`
  relative to its own origin — add a rewrite/proxy from the Vercel domain to
  your backend, or CORS middleware on the backend for the Vercel domain
  (see `DEPLOY.md`).
- Never commit the real `.env` (gitignored); only `.env.example` is tracked.
