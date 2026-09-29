import { useEffect, useRef, useCallback, useState } from 'react'
import { getJSON, postJSON, wsUrl, EP } from './api.js'
import Header from './components/Header.jsx'
import MapView, { BASEMAPS } from './components/MapView.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import SlickDetail from './components/SlickDetail.jsx'
import VesselCard from './components/VesselCard.jsx'
import LoginPage from './components/LoginPage.jsx'
import ProcessingOverlay from './components/ProcessingOverlay.jsx'
import TelemetryStatusBar from './components/TelemetryStatusBar.jsx'

// Demo pacing (ms). Tune PROCESSING_MS for the fake pipeline illusion.
const PROCESSING_MS = 11000  // ~10-13s processing timer
const STAGE_GAP_MS = 3000    // gap between each visible stage

// Demo scenario: real exported pipeline artifacts (time-sliced backtrack
// corridor enables the per-second reverse animation). Falls back to the
// static dataset if the files are missing.
async function loadDemoData() {
  const base = `${import.meta.env.BASE_URL}demo/`
  try {
    const [det, cor, ori, sus] = await Promise.all([
      fetch(`${base}detection.geojson`).then((r) => r.json()),
      fetch(`${base}corridor.geojson`).then((r) => r.json()),
      fetch(`${base}origin.json`).then((r) => r.json()),
      fetch(`${base}suspects.geojson`).then((r) => r.json()),
    ])
    if (det?.features?.length && cor?.features?.length && ori?.estimated_origin && sus?.features?.length) {
      // Hoist estimated_origin fields (primary_centroid, time_window_utc, …)
      // to top level — that's the shape MapView expects for the origin marker.
      const origin = { ...ori, ...ori.estimated_origin }
      return { detection: det, corridor: cor, origin, suspects: sus }
    }
  } catch { /* fall through to static data */ }
  const { loadDemoData: loadStatic } = await import('./data/demoData.js')
  return loadStatic()
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('krishnasindhu_theme') || 'dark'
    } catch {
      return 'dark'
    }
  })

  const [userSession, setUserSession] = useState(() => {
    try {
      const saved = localStorage.getItem('krishnasindhu_session')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [status, setStatus] = useState(null)
  const [vessels, setVessels] = useState(null)
  const [scenes, setScenes] = useState([])
  const [slicks, setSlicks] = useState([])
  const [events, setEvents] = useState([])
  const [selectedSlickId, setSelectedSlickId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [vesselMmsi, setVesselMmsi] = useState(null)
  const [vesselDetails, setVesselDetails] = useState(null)
  const [riskOn, setRiskOn] = useState(false)
  const [riskData, setRiskData] = useState(null)
  const riskStatusRef = useRef(null)
  const [toast, setToast] = useState(null)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)

  // Demo flow state
  const [demoStage, setDemoStage] = useState('idle')
  const [demoData, setDemoData] = useState(null)
  const [flowOn, setFlowOn] = useState(false)
  const [flowOrigin, setFlowOrigin] = useState(null)

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('krishnasindhu_theme', next)
      return next
    })
  }, [])
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [showVessels, setShowVessels] = useState(true)
  const [basemapKey, setBasemapKey] = useState('dark')
  const [projection, setProjection] = useState('globe')
  const toastTimerRef = useRef(null)

  const showToast = useCallback((m) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(String(m))
    toastTimerRef.current = setTimeout(() => setToast(null), 6000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    try {
      const st = await getJSON(EP.status)
      setStatus(st)
      // When status check succeeds, clear any persistent backend error toast
      setToast((prev) => (prev && prev.includes('Backend unreachable') ? null : prev))

      const [v, sc, sl, ev] = await Promise.all([
        getJSON(EP.vesselsLive).catch(() => null),
        getJSON(EP.scenes).catch(() => []),
        getJSON(EP.slicks).catch(() => []),
        getJSON(`${EP.events}?limit=60`).catch(() => []),
      ])
      if (v) setVessels(v)
      if (sc) setScenes(sc)
      if (sl) setSlicks(sl)
      if (ev) setEvents(ev)

      if (!riskStatusRef.current) {
        getJSON(EP.riskStatus)
          .then((rs) => { riskStatusRef.current = rs })
          .catch(() => {})
      }
    } catch {
      showToast('Backend unreachable — start it with run.bat')
    }
  }, [showToast])

  const toggleRisk = useCallback(async () => {
    setRiskOn((prev) => {
      const next = !prev
      if (next && !riskData) {
        getJSON(EP.riskGrid(0.05))
          .then(setRiskData)
          .catch(() => {
            showToast('Risk analytics not initialized — run scripts/train_risk_model.py')
            setRiskOn(false)
          })
      }
      return next
    })
  }, [riskData, showToast])

  useEffect(() => {
    refreshAll()
    const t = setInterval(refreshAll, 15000)
    return () => clearInterval(t)
  }, [refreshAll])

  const slickRef = useRef(null)
  slickRef.current = selectedSlickId
  const detailRef = useRef(null)

  useEffect(() => {
    let ws = null
    let reconnectTimer = null
    let reconnectDelay = 1000
    let closed = false

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(wsUrl('/ws'))

      ws.onopen = () => {
        reconnectDelay = 1000
      }

      ws.onmessage = (m) => {
        let msg
        try { msg = JSON.parse(m.data) } catch { return }
        if (msg.type === 'event') {
          setEvents((prev) => [msg.event, ...prev].slice(0, 80))
          refreshAll()
        } else if (msg.type === 'scene') {
          setScenes((prev) => [{
            product_id: msg.product_id, name: msg.name,
            sensed_start: msg.sensed_start, size_mb: msg.size_mb,
            footprint: msg.footprint, status: 'catalogued',
          }, ...prev])
        } else if (msg.type === 'scene_status') {
          setScenes((prev) => prev.map((s) =>
            s.product_id === msg.product_id ? { ...s, status: msg.status } : s))
        } else if (msg.type === 'analysis_complete') {
          refreshAll()
          if (slickRef.current === msg.slick_id && detailRef.current !== null) {
            getJSON(EP.slickDetail(msg.slick_id)).then(setDetail)
          }
        }
      }

      ws.onclose = () => {
        if (closed) return
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000)
          connect()
        }, reconnectDelay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      closed = true
      if (ws) ws.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [refreshAll])

  detailRef.current = detail

  const openSlick = useCallback(async (id) => {
    setSelectedSlickId(id)
    setRightPanelOpen(true)
    try {
      const d = await getJSON(EP.slickDetail(id))
      setDetail(d)
      // Set flow origin to slick centroid (fallback to geometry centroid)
      if (d?.centroid_lon != null) {
        const orientation = d.morphology_analysis?.orientation_deg ?? null
        setFlowOrigin({ lon: d.centroid_lon, lat: d.centroid_lat, orientation_deg: orientation })
      } else if (d?.geometry?.geometry?.coordinates) {
        // Compute centroid from polygon
        const ring = d.geometry.geometry.coordinates[0]
        if (ring?.length) {
          const sum = ring.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0])
          const centroid = [sum[0] / ring.length, sum[1] / ring.length]
          const orientation = d.morphology_analysis?.orientation_deg ?? null
          setFlowOrigin({ lon: centroid[0], lat: centroid[1], orientation_deg: orientation })
        }
      }
    } catch { /* noop */ }
  }, [])

  const scanScene = useCallback(async (pid, name) => {
    showToast(`Downloading + scanning ${name || pid.slice(0, 10)}…`)
    try {
      const r = await postJSON(EP.scanScene(pid))
      showToast(r.slick_ids?.length
        ? `Scan complete — ${r.slick_ids.length} oil-candidate patch(es)`
        : 'Scan complete — sea clear')
      await refreshAll()
    } catch (e) { showToast(e.message) }
  }, [showToast, refreshAll])

  const reanalyze = useCallback(async (id) => {
    showToast('Hindcast + attribution running…')
    try {
      await postJSON(EP.analyzeSlick(id))
      await openSlick(id)
      showToast('Analysis complete')
    } catch (e) { showToast(e.message) }
  }, [showToast, openSlick])

  const selectVessel = useCallback((mmsi) => {
    setVesselMmsi(mmsi)
    setVesselDetails(null)
    if (!mmsi) return
    setRightPanelOpen(true)
    getJSON(EP.vesselDetails(mmsi))
      .then(setVesselDetails)
      .catch(() => {})
    getJSON(EP.track(mmsi, 18))
      .then((tr) => window.dispatchEvent(
        new CustomEvent('vessel-track', { detail: tr })))
      .catch(() => {})
  }, [])

  const resetAOI = useCallback(() => {
    window.dispatchEvent(new CustomEvent('reset-map-view'))
  }, [])

  const handleLogout = useCallback(() => {
    setUserSession(null)
    localStorage.removeItem('krishnasindhu_session')
  }, [])

  // Demo flow handlers
  const handleOpenDemo = useCallback(() => {
    // Reset and start demo
    setDemoData(null)
    setFlowOn(false)
    setDemoStage('processing')

    // Fake pipeline processing, then reveal the detection
    setTimeout(() => {
      loadDemoData().then((data) => {
        setDemoData(data)
        setDemoStage('detected')

        // Sequential stage beats, each STAGE_GAP_MS after the previous one
        setTimeout(() => {
          setFlowOn(true)
          setDemoStage('flow')
          // Works for both a bare Feature (static data) and a FeatureCollection
          const detFeat = data.detection?.features?.[0] ?? data.detection
          const ring = detFeat?.geometry?.coordinates?.[0]
          if (ring?.length) {
            const sum = ring.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0])
            setFlowOrigin({ lon: sum[0] / ring.length, lat: sum[1] / ring.length, orientation_deg: null })
          }
        }, STAGE_GAP_MS)

        setTimeout(() => setDemoStage('forecast'), STAGE_GAP_MS * 2)
        setTimeout(() => setDemoStage('backtrack'), STAGE_GAP_MS * 3)
        setTimeout(() => setDemoStage('suspects'), STAGE_GAP_MS * 4)
      }).catch(() => setDemoStage('idle'))
    }, PROCESSING_MS)
  }, [])

  if (!userSession) {
    return (
      <div className="app-hud" data-theme={theme}>
        <LoginPage
          onLoginSuccess={(session) => {
            setUserSession(session)
            localStorage.setItem('krishnasindhu_session', JSON.stringify(session))
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>
    )
  }

  return (
    <div className="app-hud" data-theme={theme}>
      {/* Pipeline processing illusion */}
      {demoStage === 'processing' && <ProcessingOverlay durationMs={PROCESSING_MS} />}

      {/* 1. Full Screen Map Base Layer */}
      <div className="map-background">
        <MapView
          vessels={vessels}
          slicks={slicks}
          detail={detail}
          vesselMmsi={vesselMmsi}
          riskOn={riskOn}
          riskData={riskData}
          showVessels={showVessels}
          basemapKey={basemapKey}
          projection={projection}
          leftPanelOpen={leftPanelOpen}
          rightPanelOpen={rightPanelOpen}
          onSelectSlick={openSlick}
          onSelectVessel={selectVessel}
          demoDetection={demoData?.detection}
          flowOn={flowOn}
          flowOrigin={flowOrigin}
          demoCorridor={demoData?.corridor}
          demoOrigin={demoData?.origin}
          demoSuspects={demoData?.suspects}
          demoStage={demoStage}
        />
      </div>

      {/* 2. Floating Top Island Glass Bar */}
      <Header
        status={status}
        riskOn={riskOn}
        onToggleRisk={toggleRisk}
        riskStatus={riskStatusRef.current}
        showVessels={showVessels}
        onToggleVessels={() => setShowVessels((v) => !v)}
        basemapKey={basemapKey}
        onSelectBasemap={setBasemapKey}
        basemaps={BASEMAPS}
        projection={projection}
        onToggleProjection={() => setProjection((p) => (p === 'globe' ? 'flat' : 'globe'))}
        onResetView={resetAOI}
        userSession={userSession}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenDemo={handleOpenDemo}
        flowOn={flowOn}
        onToggleFlow={() => setFlowOn(v => !v)}
      />

      {/* 3. Floating Left Intelligence Dock */}
      <div className={`left-hud-dock ${leftPanelOpen ? 'open' : 'collapsed'}`}>
        <button
          className="dock-toggle-btn"
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          title={leftPanelOpen ? 'Collapse side dock' : 'Expand side dock'}>
          {leftPanelOpen ? '<' : '>'}
        </button>
        {leftPanelOpen && (
          <LeftPanel
            events={events}
            scenes={scenes}
            slicks={slicks}
            riskStatus={riskStatusRef.current}
            riskData={riskData}
            selectedSlickId={selectedSlickId}
            onOpenSlick={openSlick}
            onScanScene={scanScene}
            onSelectVessel={selectVessel}
            suspects={demoData?.suspects}
          />
        )}
      </div>

      {/* 4. Floating Right Inspector Card */}
      <div className={`right-hud-dock ${rightPanelOpen ? 'open' : 'collapsed'}`}>
        <button
          className="dock-toggle-btn right-toggle-btn"
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          title={rightPanelOpen ? 'Collapse inspector dock' : 'Expand inspector dock'}>
          {rightPanelOpen ? '>' : '<'}
        </button>
        {rightPanelOpen && (
          vesselMmsi ? (
            <VesselCard
              details={vesselDetails}
              onShowTrack={selectVessel}
              onClose={() => { setVesselMmsi(null); setVesselDetails(null) }}
            />
          ) : (
            <SlickDetail
              detail={detail}
              selectedSlickId={selectedSlickId}
              onSelectVessel={selectVessel}
              onAnalyze={() => reanalyze(detail?.id)}
              onClose={() => { setDetail(null); setSelectedSlickId(null) }}
              demoData={demoData}
              demoStage={demoStage}
            />
          )
        )}
      </div>

      {/* 5. Telemetry Status Bar */}
      <TelemetryStatusBar
        vessels={vessels}
        slicks={slicks}
        scenes={scenes}
        events={events}
      />

      {/* 6. Notification Toast */}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)} title="Click to dismiss">
          <span>{toast}</span>
          <button className="toast-close-btn" aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  )
}
