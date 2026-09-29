# FRONTEND HANDOFF — Krishna Sindhu (spill2source)

> Context document for whoever takes over frontend work. Read top to bottom;
> it contains everything needed to continue without archaeology.
> Last updated: 2026-09-29 · main @ `54bc31f`

---

## 1. What this is

**Krishna Sindhu / SlickTrace** — an oil-spill intelligence dashboard.
FastAPI backend (already deployed + handled by others) + **React 18 + Vite +
MapLibre GL** frontend. The flagship feature is a scripted **DEMO** that walks
through: SAR upload → pipeline processing → slick detection → ocean/current
flow → forward forecast → backtracking the slick to its release origin →
suspect vessel ranking. All demo data is local (frontend-only); live data
comes from the backend.

- **GitHub:** https://github.com/Vinit-vibhandik22/Krushna2 (branch `main`)
- **Backend (live):** https://krushna2-production.up.railway.app
- **Frontend (deployed):** https://krushna2.vercel.app (auto-deploys on push to `main`)

---

## 2. Working-space directories (repo root = `spill2source/`)

```
spill2source/
├── frontend/                  ← ALL frontend work happens here
│   ├── src/
│   │   ├── App.jsx            ← root component, demo state machine, polling, wiring
│   │   ├── api.js             ← API layer: base URL, timeouts, endpoint map (EP), wsUrl()
│   │   ├── styles-new.css     ← main stylesheet (HUD theme; ~490 lines)
│   │   ├── styles.css         ← legacy/shared styles (toast, misc)
│   │   ├── components/
│   │   │   ├── MapView.jsx    ← THE BIG ONE (~1300 lines): MapLibre map, all layers,
│   │   │   │                    flow particles, corridor playback, fleet, click handling
│   │   │   ├── SarIngestModal.jsx   ← fake SAR upload dialog (demo gate)
│   │   │   ├── ProcessingOverlay.jsx← 11s "pipeline running" fullscreen overlay
│   │   │   ├── DemoSubmit.jsx       ← older unused component (candidate for deletion)
│   │   │   ├── Header.jsx, LeftPanel.jsx, SlickDetail.jsx, VesselCard.jsx,
│   │   │   ├── LoginPage.jsx, TelemetryStatusBar.jsx
│   │   ├── data/
│   │   │   ├── demoData.js    ← STATIC fallback demo dataset (small box near -89,29)
│   │   │   └── gulfFleet.js   ← 50 named GoM ships, seeded positions (mulberry32)
│   ├── public/demo/           ← REAL pipeline artifacts the demo now loads:
│   │   ├── detection.geojson  (slick polygon, FeatureCollection)
│   │   ├── corridor.geojson   (29 polygon time-slices, props: hours_prior 0–26,
│   │   │                       centroid_longitude/latitude, timestamp)
│   │   ├── origin.json        (estimated_origin.primary_centroid + time_window_utc)
│   │   └── suspects.geojson   (15 vessels; cluster re-anchored near -89.96, 27.77)
│   ├── .env                   ← VITE_API_URL (gitignored — never commit)
│   ├── .env.example           ← tracked template
│   ├── vite.config.js         ← dev proxy: /api and /ws → http://localhost:8000
│   └── dist/                  ← build output (gitignored; backend serves it)
├── backend/                   ← DO NOT TOUCH without asking the team (deployed by others;
│                                 recent Dockerfile/requirements-deploy.txt commits are theirs)
├── vercel.json                ← deploy config + /api rewrite → Railway (repo root!)
├── run.bat                    ← one-command local start (Windows)
├── DEPLOY.md, ENV-GUIDE.md    ← deploy + env-var docs (read these too)
└── working-backend/           ← untracked, 44MB, NOT part of the repo — leave alone
```

Parent directory (`D:\krushnasindhu\`) contains scratch stuff (playwright
dumps, node_modules, test PNGs) — ignore it entirely; the git repo is
`spill2source/`.

---

## 3. Running things locally

```bash
# Frontend dev (hot reload, port 5173; /api + /ws proxied to :8000)
cd frontend
npm install
npm run dev

# Production build (what the backend actually serves)
npm run build        # → frontend/dist/

# Full stack (backend + built dashboard on ONE port)
# Windows: run.bat, or manually:
.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# → open http://127.0.0.1:8000  (backend serves frontend/dist + /api)
```

**Critical workflow fact:** when serving via `:8000`, the backend serves
`frontend/dist` **from disk**. After any source change you must `npm run build`
again (no restart needed — files are read per-request). Hot reload only exists
in `npm run dev` mode.

Build takes ~10s–2.5min depending on machine load. Green = `✓ built in …s`.

---

## 4. Environment variables

| Var | Where | Effect |
|---|---|---|
| `VITE_API_URL` | `frontend/.env` (local) / Vercel dashboard (prod) | API base for `api.js`. Unset → relative `/api/*` → Vite proxy (dev) or Vercel rewrite (prod). Currently set to `https://krushna2-production.up.railway.app` in `.env`. |
| all CDSE/SH/AISSTREAM etc. | backend only | No frontend effect (see ENV-GUIDE.md) |

`.env` is **gitignored** (`.env.*` ignored, `!.env.example` allowed). Never
commit real env files; update `.env.example` when adding vars.

---

## 5. API layer & connectivity (read before touching fetch calls)

`frontend/src/api.js` is the single API chokepoint:

- `API_BASE` = `import.meta.env.VITE_API_URL || ''` (trailing slash stripped)
- 20s `AbortController` timeout on every request; network/CORS failures become
  `Error('Backend unreachable (url) …')`
- `EP` map — every endpoint in one object (`EP.status`, `EP.vesselsLive`,
  `EP.track(mmsi,hours)`, `EP.scenes`, `EP.scanScene(pid)`, `EP.slicks`,
  `EP.slickDetail(id)`, `EP.analyzeSlick(id)`, `EP.events`,
  `EP.riskStatus`, `EP.riskGrid(minP)`, `EP.vesselDetails(mmsi)`). **Always add
  new endpoints here**, never inline URLs.
- `wsUrl('/ws')` for the WebSocket (live AIS feed).

**CORS reality (measured, don't re-litigate):** the Railway backend
allowlists vercel.app-style origins; it returns **400 on preflights from
`http://127.0.0.1:8000`** and no ACAO for `localhost:5173`. Therefore:

- From a browser page served at `:8000` or `:5173`, **direct** calls to Railway fail.
  - `:5173` works anyway via the Vite **proxy** (same-origin).
  - `:8000` calls `/api` on its own origin (backend is right there) — also fine.
  - The only broken combo was `VITE_API_URL` set while serving at `:8000` —
    the "Backend unreachable" toast used to pop; **it is now permanently
    suppressed** (App.jsx `showToast` filters it; logs to console instead).
- In production, `vercel.json` rewrites `/api/*` → Railway (same-origin), and
  `VITE_API_URL` (if set in Vercel dashboard) points fetch directly at Railway.

Live feeds legitimately show `WAIT` in offline/demo situations — that's by
design, don't "fix" it.

---

## 6. The demo system (most-touched area)

### State machine (App.jsx)

`demoStage`: `idle → awaiting-upload → processing → detected → flow →
forecast → backtrack → suspects → idle`

- **`awaiting-upload`** — `SarIngestModal` shows. Drag-drop/file-picker (files
  are never read — pure illusion), scene list w/ size badges, **Run Detection**
  disabled until ≥1 file. Run plays ~2.6s of ingest lines
  (`INGEST_LINES`, `INGEST_MS = 2600` in SarIngestModal.jsx) then calls
  `startDemoPipeline()`.
- **`processing`** — `ProcessingOverlay` fullscreen (11s): spinner, cycling
  status lines, progress %.
- Constants in App.jsx: `PROCESSING_MS = 11000`, `STAGE_GAP_MS = 3000`.
  Stage beats: detected @11s, flow @14s (also sets `flowOn` + `flowOrigin`
  centroid), forecast @17s, backtrack @20s (auto-starts playback), suspects @23s.
- Data load: `loadDemoData()` (App.jsx) fetches `/demo/*.geojson` +
  `/demo/origin.json` (BASE_URL-aware), **hoists `estimated_origin` fields to
  top level** (MapView expects `origin.primary_centroid`), falls back to
  static `data/demoData.js` if fetch fails.
- MapView must treat `awaiting-upload` like `idle`/`processing`
  (demo-inactive) so no layers leak early — already handled in the fleet
  effect; keep it that way for any new demo-gated layer.

### Backtrack / corridor playback (MapView.jsx)

- Corridor = 29 polygons, each `properties.hours_prior` 0–26.
- `corridorHours` state drives a filter (`h <= corridorHours`); playback adds
  +1h per 200ms via `requestAnimationFrame`; **resets to 0 on every new
  `demoCorridor`** (was a stuck-at-26h bug once — don't regress).
- Reaches backtrack stage → effect auto-plays (`setIsPlaying(true)`).
- At `corridorHours >= max*0.9`: origin placemarker + "Estimated Release
  Origin" label + verdict banner (reads `demoOrigin.primary_centroid`,
  `time_window_utc.confidence/hours_prior_min/max`).
- Forward forecast cone is generated by MapView from corridor centroids
  (needs ≥2 slices with `centroid_*` — the data has 28/29).
- UI: `.corridor-controls` panel, title = "Slide pointer forward to forecast,
  behind to backtrack" (user-requested wording — don't change back),
  slider + ▶/⏸ button.
- Semantics: slider value = hours BACK in time (0h = detection, 26h = release).
  User has floated inverting the slider so 0h sits right — open suggestion.

### Demo data geometry (important!)

The real artifacts are around **lon -90.4…-89.6, lat 27.3…28.1** (Green
Canyon, GoM): slick centroid ≈ `(-90.22, 27.77)`, origin ≈ `(-89.957, 27.765)`.
The static fallback in `data/demoData.js` sits near `(-89, 29)` — legacy.
Suspects.geojson was shifted by `(-0.9272, -1.2445)` to anchor on the origin —
if you regenerate it, re-apply that anchoring relative to `origin.json`.

### 50-ship ambient fleet

`data/gulfFleet.js` — 50 real GoM vessel names (Hornbeck/Harvey/SEACOR/
Chouest/Guice/Candies + the 15 suspects), deterministic `mulberry32(20260928)`
scatter in box **lon -90.62…-89.82, lat 27.27…28.27** (matches the scene).
Export `gulfFleetFC()`. Rendered by MapView `s-gulf` source → `gulf-ships`
circle layer + `gulf-ship-labels` symbol layer (labels minzoom 7.5, font
'Noto Sans Regular', glyphs from `demotiles.maplibre.org`). Hover shows a
tooltip row; click drops a placemarker via `setSrc2('s-track-start', …)` +
`addLabel` + fly-to (same handler as suspects).

---

## 7. MapView.jsx quick map (so you don't have to re-read 1300 lines)

- `buildStyle()` — style assembly; `glyphs` URL required for symbol layers.
- Sources: `s-slicks, s-origin, s-back, s-fwd, s-track, s-track-start,
  s-suspects, s-corridor, s-gulf` (+ basemap raster sources).
- `onReady` guard: uses `map.on('load')` **and** `map.once('idle')` — v6 can
  miss `load` in some embeds. Keep both.
- Flow layer: curved particles (trail buffer 14, per-particle `curve`/`heading`,
  round caps/joins, warm-in opacity 0.15→0.70). Flow legend shows current/wind
  arrows. `flowOrigin` must be set before particles spawn (App sets it from the
  detection ring — handles both Feature and FeatureCollection shapes).
- `applyData()` handles live vessels/slicks/risk grid.
- Legend (`GIS LAYER KEY`) is collapsible via `.legend-toggle` (▾/▸).
- Suspicion: any layer you add must be registered in the HOVER list + the
  demo-inactive gating, or it will leak into idle state.

Styling lives in `src/styles-new.css` (+ a few things in `styles.css`).
Palette: cyan `#38BDF8`, amber `#F59E0B`, spill `#EF4444`, foam `#DAE2FD`,
hull `#171F33`, abyss `#0B1326`. Light mode exists via `data-theme` on
`.app-hud` — test both when touching colors.

---

## 8. Deploy (Vercel)

- `vercel.json` at **repo root** (not frontend/): builds `frontend/dist`,
  SPA rewrite `/(?!api/).* → /index.html`, immutable cache for `/assets/*`,
  and `/api/:path* → https://krushna2-production.up.railway.app/api/:path*`.
- Push to `main` → auto-deploy. Verify at krushna2.vercel.app.
- Note: Vercel rewrites can't proxy WebSockets — the `/ws` live feed only
  works when `VITE_API_URL` is set in the Vercel dashboard (WebSocket then
  connects to Railway directly). Absent that, live AIS shows WAIT — demo
  unaffected.

---

## 9. Conventions & house rules

- **Commits:** imperative subject, body bullets explaining *why*, e.g.
  `feat: corridor slider hint label; suppress backend-unreachable toast`.
  Recent history: `54bc31f` (SAR modal), `0bd40a2` (hint label + toast),
  `dd4ac53` (merge), `b5ae16e` (demo pipeline overhaul + Railway wiring),
  `34a0b20` (ENV-GUIDE).
- Before pushing: `npm run build` must be green. Grep for
  `localhost:8000` in `frontend/src` (only a comment in api.js should match).
- Never commit: `frontend/.env`, anything in `frontend/dist`, `working-backend/`,
  `data/` runtime files.
- `backend/` is your teammate's-teams' territory now — coordinate before
  touching it.
- Git identity on this machine is a placeholder (`Your Name`) — set your own
  before committing if you care about attribution.
- LF→CRLF warnings on commit are normal here; ignore them.

---

## 10. Known quirks / gotchas

1. **Live feeds vs demo independence:** the demo is 100% frontend-local.
   Backend being down only affects live panels + the (suppressed) toast.
2. **`DemoSubmit.jsx` is dead code** (superseded by SarIngestModal +
   ProcessingOverlay). Safe to delete in a cleanup commit.
3. **`data/demoData.js` static fallback** is intentionally the OLD location —
   only used if `public/demo/*` fetch fails.
4. **Occluded windows freeze `requestAnimationFrame`** (headless/hidden
   preview): corridor autoplay and flow particles appear frozen while timers
   still run. Not a code bug — verify animations in a visible window.
5. **Login gate:** normally the app starts at a login screen with a
   LOAD_DEMO_CREDENTIALS shortcut; some flows (already-authed localStorage
   session) skip it.
6. When you change `corridor.geojson` hours range, `corridorMaxHours`
   adapts automatically (computed from data), but check the verdict-banner
   threshold (0.9×max) and the origin window text.

---

## 11. Open items / nice-to-haves (in rough priority)

1. **Visual QA on a real screen:** curved flow strokes, ship hover labels
   (glyph font renders?), suspect-click placemarker, corridor visibly moving —
   all verified functionally but not yet eyeballed on camera.
2. **Slider inversion** (0h right / −26h left) so backtracking reads as
   physical time. Optional hour labels.
3. **Real UTC timestamps** on corridor slices (props exist: `timestamp`) for
   a proper hindcast timeline.
4. **Preset scene chips** in SarIngestModal ("Sentinel-1 · Green Canyon pass")
   for one-click demo start during presentations.
5. **Demo video recording** for SIH (sequence is now complete).
6. Delete `DemoSubmit.jsx`; consider code-splitting the >500kB chunk Vite
   warns about.
7. Backend CORS allowlist for `localhost` dev origins would make direct-Railway
   dev possible — needs the backend team, not you.
