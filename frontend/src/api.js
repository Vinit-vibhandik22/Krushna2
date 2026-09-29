// API base: Vercel/production points at the Railway FastAPI backend; in dev
// the Vite proxy (vite.config.js) handles /api -> localhost:8000, so the base
// stays empty unless VITE_API_URL is set explicitly.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const DEFAULT_TIMEOUT_MS = 20000

function fullUrl(url) {
  if (/^https?:\/\//i.test(url)) return url // absolute URLs pass through
  return `${API_BASE}${url}`
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s: ${url}`)
    }
    // TypeError from fetch = network failure / DNS / CORS-blocked
    throw new Error(`Backend unreachable (${url}). ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function getJSON(url) {
  const r = await fetchWithTimeout(fullUrl(url))
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    throw new Error(detail.detail || `${url}: HTTP ${r.status}`)
  }
  return r.json()
}

export async function postJSON(url) {
  const r = await fetchWithTimeout(fullUrl(url), { method: 'POST' })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    throw new Error(detail.detail || `${url}: HTTP ${r.status}`)
  }
  return r.json()
}

// Absolute URL builder for non-fetch uses (WebSocket, links).
export function wsUrl(path) {
  if (/^wss?:\/\//i.test(path)) return path
  const base = API_BASE || `${location.protocol}//${location.host}`
  return `${base.replace(/^http/, 'ws')}${path}`
}

export const EP = {
  status: '/api/status',
  vesselsLive: '/api/vessels/live',
  track: (mmsi, hours = 12) => `/api/vessels/${mmsi}/track?hours=${hours}`,
  scenes: '/api/scenes',
  scanScene: (pid) => `/api/scenes/${pid}/scan`,
  slicks: '/api/slicks',
  slickDetail: (id) => `/api/slicks/${id}`,
  analyzeSlick: (id) => `/api/slicks/${id}/analyze`,
  events: '/api/events',
  riskStatus: '/api/risk/status',
  riskGrid: (minP = 0) => `/api/risk/grid?min_p=${minP}`,
  vesselDetails: (mmsi) => `/api/vessels/${mmsi}/details`,
}
