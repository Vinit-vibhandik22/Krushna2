import { useEffect, useRef, useCallback, useState } from 'react'
import { getJSON, postJSON } from './api.js'
import Header from './components/Header.jsx'
import MapView, { BASEMAPS } from './components/MapView.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import SlickDetail from './components/SlickDetail.jsx'
import VesselCard from './components/VesselCard.jsx'
import LoginPage from './components/LoginPage.jsx'
import TelemetryStatusBar from './components/TelemetryStatusBar.jsx'
import SarUploadModal from './components/SarUploadModal.jsx'
import { loadDemoData } from './demoData.js'

// Demo pacing (ms) - realistic backend pipeline computation
const PROCESSING_MS = 3600   // Backend hydrodynamic processing simulation
const STAGE_GAP_MS = 3200    // Paced reveal of each stage (3.2s per stage)

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
  const [sarModalOpen, setSarModalOpen] = useState(false)
  const [uploadedSarInfo, setUploadedSarInfo] = useState(null)

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('krishnasindhu_theme', next)
      return next
    })
  }, [])
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [showVessels, setShowVessels] = useState(true)
  const [showPipelines, setShowPipelines] = useState(true)
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
      const st = await getJSON('/api/status')
      setStatus(st)
      // When status check succeeds, clear any persistent backend error toast
      setToast((prev) => (prev && prev.includes('Backend unreachable') ? null : prev))

      const [v, sc, sl, ev] = await Promise.all([
        getJSON('/api/vessels/live').catch(() => null),
        getJSON('/api/scenes').catch(() => []),
        getJSON('/api/slicks').catch(() => []),
        getJSON('/api/events?limit=60').catch(() => []),
      ])
      if (v) setVessels(v)
      if (sc) setScenes(sc)
      if (sl) setSlicks(sl)
      if (ev) setEvents(ev)

      if (!riskStatusRef.current) {
        getJSON('/api/risk/status')
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
        getJSON('/api/risk/grid?min_p=0.05')
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
      ws = new WebSocket(`${proto}://${location.host}/ws`)

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
            getJSON(`/api/slicks/${msg.slick_id}`).then(setDetail)
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
      const d = await getJSON(`/api/slicks/${id}`)
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
      const r = await postJSON(`/api/scenes/${pid}/scan`)
      showToast(r.slick_ids?.length
        ? `Scan complete — ${r.slick_ids.length} oil-candidate patch(es)`
        : 'Scan complete — sea clear')
      await refreshAll()
    } catch (e) { showToast(e.message) }
  }, [showToast, refreshAll])

  const reanalyze = useCallback(async (id) => {
    showToast('Hindcast + attribution running…')
    try {
      await postJSON(`/api/slicks/${id}/analyze`)
      await openSlick(id)
      showToast('Analysis complete')
    } catch (e) { showToast(e.message) }
  }, [showToast, openSlick])

  const selectVessel = useCallback((mmsi) => {
    setVesselMmsi(mmsi)
    setVesselDetails(null)
    if (!mmsi) return
    setRightPanelOpen(true)

    // Check if it's an evaluated suspect from demo data for immediate rich telemetry
    const demoSuspect = demoData?.suspects?.features?.find(f => f.properties?.mmsi === mmsi)
    if (demoSuspect) {
      const p = demoSuspect.properties
      const c = demoSuspect.geometry?.coordinates || []
      setVesselDetails({
        mmsi: p.mmsi,
        name: p.vessel_name || `MMSI ${p.mmsi}`,
        flag: 'GULF OF MEXICO',
        type_label: `Type ${p.vessel_type || 'Commercial'} · ${p.suspicion_level} Suspicion (${p.total_score}%)`,
        call_sign: p.callsign || '—',
        live: {
          lat: c[1],
          lon: c[0],
          sog: p.speed_knots,
          cog: p.course_deg,
          ts: p.cpa_timestamp_utc ? Math.floor(new Date(p.cpa_timestamp_utc).getTime() / 1000) : null,
        },
        audit_rationale: p.audit_rationale,
      })
    }

    // Check if demoData has pre-computed 18h backtrack trajectory
    const demoTrackData = demoData?.trajectories?.[String(mmsi)]
    if (demoTrackData && demoTrackData.points?.length > 1) {
      const pts = demoTrackData.points.map(p => [p.lon, p.lat, p.ts, p.sog, p.cog])
      const demoSuspect = demoData?.suspects?.features?.find(f => f.properties?.mmsi === mmsi)
      const cpaTs = demoSuspect?.properties?.cpa_timestamp_utc
      const tr = {
        mmsi,
        name: demoTrackData.name,
        highlight_ts: cpaTs ? Math.floor(new Date(cpaTs).getTime() / 1000) : null,
        points: pts
      }
      window.dispatchEvent(new CustomEvent('vessel-track', { detail: tr }))
    }

    getJSON(`/api/vessels/${mmsi}/details`)
      .then((d) => {
        if (d && Object.keys(d).length) setVesselDetails(d)
      })
      .catch(() => {})
    getJSON(`/api/vessels/${mmsi}/track?hours=18`)
      .then((tr) => {
        if (tr && tr.points?.length > 1) {
          const demoSuspect = demoData?.suspects?.features?.find(f => f.properties?.mmsi === mmsi)
          if (demoSuspect) {
            tr.name = demoSuspect.properties?.vessel_name
            const cpaTs = demoSuspect.properties?.cpa_timestamp_utc
            if (cpaTs) tr.highlight_ts = Math.floor(new Date(cpaTs).getTime() / 1000)
          }
          window.dispatchEvent(new CustomEvent('vessel-track', { detail: tr }))
        }
      })
      .catch(() => {})
  }, [demoData])

  const resetAOI = useCallback(() => {
    window.dispatchEvent(new CustomEvent('reset-map-view'))
  }, [])

  const handleLogout = useCallback(() => {
    setUserSession(null)
    localStorage.removeItem('krishnasindhu_session')
  }, [])

  // Demo flow handlers - trigger SAR upload prompt
  const handleOpenDemo = useCallback(() => {
    setSarModalOpen(true)
  }, [])

  // Execute demo simulation with uploaded SAR image metadata (in-memory only, no server persistence)
  const handleConfirmSarUpload = useCallback(async (sarInfo) => {
    setUploadedSarInfo(sarInfo)
    setDemoData(null)
    setFlowOn(false)
    setDemoStage('processing')
    setToast(sarInfo?.name ? `[BACKEND] Dispatching SAR scene: ${sarInfo.name}...` : 'Starting oil spill forensic simulation...')

    try {
      // Phase 1: Simulate backend task execution (querying CMEMS current grids & Open-Meteo wind field)
      await new Promise(resolve => setTimeout(resolve, 1800))
      setToast('Querying Copernicus CMEMS ocean currents & NOAA NDBC 10m wind fields...')

      // Phase 2: Simulate Lagrangian particle solver allocation & AIS corridor indexing
      await new Promise(resolve => setTimeout(resolve, 1800))
      setToast('Running reverse Runge-Kutta 2 particle dispersion across 18h voyage window...')
      await new Promise(resolve => setTimeout(resolve, 1200))

      const data = await loadDemoData()
      if (sarInfo) {
        data.sarUpload = {
          name: sarInfo.name,
          size: sarInfo.size,
          previewUrl: sarInfo.previewUrl,
          isBenchmark: sarInfo.isBenchmark,
        }
      }
      setDemoData(data)
      setDemoStage('detected')
      setToast(
        sarInfo?.name
          ? `SAR imagery (${sarInfo.name}) processed · Oil slick footprint localized`
          : 'Oil slick footprint detected from Sentinel-1 SAR imagery'
      )

      // Sequential stage beats (3.2 seconds between each beat for realistic pacing)
      setTimeout(() => {
        setFlowOn(true)
        setDemoStage('flow')
        const firstPoly = data.detection?.features?.[0]?.geometry?.coordinates?.[0]
        if (firstPoly?.length) {
          const sum = firstPoly.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0])
          setFlowOrigin({ lon: sum[0] / firstPoly.length, lat: sum[1] / firstPoly.length, orientation_deg: null })
        }
        setToast('Sea surface current & wind vector flow field active')
      }, STAGE_GAP_MS)

      setTimeout(() => {
        setDemoStage('forecast')
        setToast('Projecting forward drift trajectory cones (OpenDrift downstream)...')
      }, STAGE_GAP_MS * 2)

      setTimeout(() => {
        setDemoStage('backtrack')
        setToast('Reverse Lagrangian hydrodynamic backtrack corridor resolved (Taylor MC-20)')
      }, STAGE_GAP_MS * 3)

      setTimeout(() => {
        setDemoStage('suspects')
        setToast('18h historical AIS transits correlated · Forensic suspect leaderboard generated!')
      }, STAGE_GAP_MS * 4)
    } catch (err) {
      console.error('Failed to load demo scenario', err)
      setToast('Error loading demo scenario: ' + err.message)
    }
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
          onToggleVessels={() => setShowVessels((v) => !v)}
          showPipelines={showPipelines}
          onTogglePipelines={() => setShowPipelines((p) => !p)}
          basemapKey={basemapKey}
          projection={projection}
          leftPanelOpen={leftPanelOpen}
          rightPanelOpen={rightPanelOpen}
          onSelectSlick={openSlick}
          onSelectVessel={selectVessel}
          demoDetection={demoData?.detection}
          flowOn={flowOn}
          onToggleFlow={() => setFlowOn((v) => !v)}
          flowOrigin={flowOrigin}
          demoCorridor={demoData?.corridor}
          demoOrigin={demoData?.origin}
          demoSuspects={demoData?.suspects}
          demoTracks={demoData?.tracks}
          demoTrajectories={demoData?.trajectories}
          demoPipelines={demoData?.pipelines}
          demoStage={demoStage}
          metVectors={demoData?.metVectors}
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
        showPipelines={showPipelines}
        onTogglePipelines={() => setShowPipelines((p) => !p)}
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
            verdict={demoData?.dossier?.forensic_verdict}
            demoStage={demoStage}
            sarUpload={demoData?.sarUpload}
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

      {/* 6. SAR Image Upload Modal (Prompts user when DEMO clicked) */}
      <SarUploadModal
        isOpen={sarModalOpen}
        onClose={() => setSarModalOpen(false)}
        onConfirm={handleConfirmSarUpload}
      />

      {/* 7. Notification Toast */}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)} title="Click to dismiss">
          <span>{toast}</span>
          <button className="toast-close-btn" aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  )
}
