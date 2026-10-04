import { useState, useMemo, useEffect } from 'react'

const STATUS_LABEL = {
  catalogued: 'In Orbit Queue',
  fetching: 'Fetching AOI',
  downloading: 'Downloading',
  downloaded: 'Downloaded',
  processing: 'Processing SAR',
  detected: 'Candidates Found',
  clear: 'Sea Clear',
  error: 'Scan Error',
}

function utc(ts) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())} ${d.toLocaleString('en-US', { month: 'short' })} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

function timeAgo(ts) {
  if (!ts) return '—'
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Parse Sentinel-1 filename into structured data
function parseSceneFilename(name) {
  if (!name) return null
  // Format: S1A_IW_GRDH_1SDV_20260925T235632_20260925T235653_004741_008E08_CD66.SAFE
  const base = name.replace('.SAFE', '')
  const parts = base.split('_')
  if (parts.length < 9) return { raw: base }

  const satellite = parts[0] // S1A
  const mode = parts[1] // IW
  const product = parts[2] // GRDH
  const polar = parts[3] // 1SDV
  const startTime = parts[4] // 20260925T235632
  const stopTime = parts[5] // 20260925T235653
  const mission = parts[6] // 004741
  const orbit = parts[7] // 008E08
  const id1 = parts[8] // CD66
  const id2 = parts[9] || '' // C0G

  // Parse datetime
  const year = startTime.slice(0, 4)
  const month = startTime.slice(4, 6)
  const day = startTime.slice(6, 8)
  const hour = startTime.slice(9, 11)
  const minute = startTime.slice(11, 13)
  const second = startTime.slice(13, 15)

  return {
    satellite,
    mode,
    product,
    polar,
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
    orbit,
    id1,
    id2,
    raw: base,
  }
}

export default function LeftPanel({
  events,
  scenes,
  slicks,
  riskStatus,
  riskData,
  selectedSlickId,
  onOpenSlick,
  onScanScene,
  onSelectVessel,
  suspects,
  onSelectSuspect,
  demoStage,
  verdict,
  sarUpload,
}) {
  const [tab, setTab] = useState('slicks')
  const [alertFilter, setAlertFilter] = useState('all')
  const [alertSearch, setAlertSearch] = useState('')
  const [expandedSuspect, setExpandedSuspect] = useState(null)

  useEffect(() => {
    if (suspects?.features?.length > 0 || demoStage === 'suspects') {
      setTab('suspects')
    }
  }, [suspects, demoStage])

  const alertCounts = useMemo(() => {
    const res = { all: events.length, alert: 0, warning: 0, info: 0 }
    for (const e of events) {
      if (e.severity === 'alert' || e.severity === 'spill') res.alert++
      else if (e.severity === 'warning' || e.severity === 'gap') res.warning++
      else res.info++
    }
    return res
  }, [events])

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (alertFilter === 'alert' && e.severity !== 'alert' && e.severity !== 'spill') return false
      if (alertFilter === 'warning' && e.severity !== 'warning' && e.severity !== 'gap') return false
      if (alertFilter === 'info' && e.severity !== 'info' && e.severity !== 'action') return false
      if (alertSearch) {
        const q = alertSearch.toLowerCase()
        return (e.message || '').toLowerCase().includes(q) || (e.category || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [events, alertFilter, alertSearch])

  const counts = {
    events: events.length,
    slicks: slicks.length,
    scenes: scenes.length + (sarUpload ? 1 : 0),
    risk: riskStatus?.n_positive || 0,
    suspects: suspects?.features?.length || 0,
  }

  const sortedSuspects = useMemo(() => {
    if (!suspects?.features?.length) return []
    return [...suspects.features]
      .sort((a, b) => (b.properties?.total_score || 0) - (a.properties?.total_score || 0))
      .map((f, idx) => ({ ...f, rank: idx + 1 }))
  }, [suspects])

  const topRisk = (riskData?.features || [])
    .map((f) => ({ p: f.properties.p, ring: f.geometry.coordinates[0] }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 10)

  // Feature weight labels - readable names
  const FEATURE_NAMES = {
    dist_shore_km: 'Shore Distance',
    lon: 'Longitude',
    dist_terminal_km: 'Terminal Proximity',
    lat: 'Latitude',
  }

  return (
    <aside className="panel left">
      <div className="tabs" role="tablist">
        {[
          {
            id: 'slicks',
            label: 'SLICKS',
            svg: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10A8 8 0 0 0 4 12c0 6 8 10 8 10z" />
              </svg>
            ),
          },
          {
            id: 'scenes',
            label: 'SCENES',
            svg: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            ),
          },
          {
            id: 'events',
            label: 'ALERTS',
            svg: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            ),
          },
          {
            id: 'risk',
            label: 'RISK',
            svg: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            ),
          },
          {
            id: 'suspects',
            label: 'SUSPECTS',
            svg: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            ),
          },
        ].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.svg}</span>
            <span className="tab-label">{t.label}</span>
            {counts[t.id] > 0 && (
              <span className={`tab-badge mono ${t.id === 'risk' ? 'risk-badge' : ''}`}>
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="panel-body">
        {tab === 'slicks' && (
          <ul className="feed slicks-feed">
            {slicks.length === 0 && (
              <div className="empty-state-terminal">
                <div className="terminal-header-line">
                  <span className="terminal-label">ACTIVE PASS</span>
                  <span className="terminal-sep">·</span>
                  <span className="terminal-value">MARITIME SURVEILLANCE AOI</span>
                </div>
                <div className="terminal-progress-wrap">
                  <div className="terminal-progress-bar">
                    <div className="terminal-progress-fill"></div>
                  </div>
                  <span className="terminal-status">MONITORING</span>
                </div>
                <div className="terminal-meta">
                  <span>Sentinel-1 SAR C-Band Synthetic Aperture Radar</span>
                </div>
                <div className="terminal-stats">
                  <div className="terminal-stat">
                    <span className="terminal-stat-label">Coverage:</span>
                    <span className="terminal-stat-value">Active Swath</span>
                  </div>
                  <div className="terminal-stat">
                    <span className="terminal-stat-label">Status:</span>
                    <span className="terminal-stat-value">Nominal</span>
                  </div>
                </div>
              </div>
            )}
            {slicks.map((s) => (
              <li key={s.id}>
                <button
                  className={`row slick-row ${selectedSlickId === s.id ? 'on' : ''}`}
                  onClick={() => onOpenSlick(s.id)}>
                  <div className="slick-row-top">
                    <span className="slick-id-tag">SLICK #{s.id}</span>
                    <span className="slick-area-pill mono">{s.area_km2} km²</span>
                  </div>
                  <div className="slick-row-meta">
                    <span className="mono dim">{utc(s.detected_at)}</span>
                    <span className="conf-badge mono">{(s.confidence * 100).toFixed(0)}% CONF</span>
                  </div>
                  {s.age_estimate_h != null && (
                    <span className="slick-age-chip mono">Est. Age: ~{Number(s.age_estimate_h).toFixed(1)} hrs</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === 'scenes' && (
          <ul className="feed scenes-feed">
            {sarUpload && (
              <li key="uploaded-sar-scene">
                <div
                  className="scene-card"
                  style={{
                    borderColor: 'rgba(245, 166, 35, 0.45)',
                    background: 'rgba(245, 166, 35, 0.06)',
                    boxShadow: '0 2px 10px rgba(245, 166, 35, 0.1)',
                  }}
                >
                  <div className="scene-card-header-row">
                    <div className="scene-mode-chips">
                      <span
                        className="scene-chip"
                        style={{
                          background: '#F5A623',
                          color: '#080C10',
                          fontWeight: '700',
                          letterSpacing: '0.05em',
                        }}
                      >
                        USER INGEST
                      </span>
                      <span className="scene-chip">IW</span>
                      <span className="scene-chip">GRDH</span>
                      <span className="scene-chip">VV+VH</span>
                    </div>
                    <span className="scene-size mono">
                      {sarUpload.size ? `${(sarUpload.size / (1024 * 1024)).toFixed(1)} MB` : '~48 MB'}
                    </span>
                  </div>

                  <div
                    className="scene-datetime mono"
                    style={{
                      color: '#F8FAFC',
                      fontWeight: 600,
                      wordBreak: 'break-all',
                      fontSize: '11px',
                      lineHeight: '1.3',
                      margin: '4px 0',
                    }}
                    title={sarUpload.name}
                  >
                    🛰️ {sarUpload.name}
                  </div>

                  <div className="scene-card-footer">
                    <div className="scene-fragments mono">
                      <span className="scene-fragment" style={{ color: '#34D399', borderColor: 'rgba(52, 211, 153, 0.3)' }}>
                        RAM ONLY
                      </span>
                      <span className="scene-fragment">GOM AOI</span>
                    </div>
                    <span className="scene-status-badge st-detected" style={{ background: '#3DAD6E', color: '#080C10', fontWeight: 'bold' }}>
                      PROCESSED
                    </span>
                  </div>
                </div>
              </li>
            )}
            {scenes.length === 0 && !sarUpload && (
              <div className="empty-state-box">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <p className="empty-title">Polling Copernicus Catalogue</p>
                <p className="empty-desc">Connecting to Sentinel-1 OData catalog stream...</p>
              </div>
            )}
            {scenes.map((s) => {
              const parsed = parseSceneFilename(s.name)
              return (
                <li key={s.product_id}>
                  <div className="scene-card">
                    <div className="scene-card-header-row">
                      <div className="scene-mode-chips">
                        <span className="scene-chip">{parsed?.mode || 'IW'}</span>
                        <span className="scene-chip">{parsed?.product || 'GRDH'}</span>
                        <span className="scene-chip">{parsed?.polar?.replace('1S', '') || 'DV'}</span>
                      </div>
                      <span className="scene-size mono">~{Math.round(s.size_mb * 0.5)} MB</span>
                    </div>
                    <div className="scene-datetime mono">
                      {parsed?.date || utc(s.sensed_start).split(' ').slice(0, 2).join(' ')}
                      <span className="scene-time-sep">·</span>
                      {parsed?.time ? `${parsed.time} UTC` : utc(s.sensed_start).split(' ').slice(2).join(' ')}
                    </div>
                    <div className="scene-card-footer">
                      <div className="scene-fragments mono">
                        {(parsed?.orbit || s.product_id?.slice(-12, -6)) && (
                          <span className="scene-fragment">{parsed?.orbit || s.product_id?.slice(-12, -6)}</span>
                        )}
                        {parsed?.id1 && <span className="scene-fragment">{parsed.id1}</span>}
                        {parsed?.id2 && <span className="scene-fragment">{parsed.id2}</span>}
                      </div>
                      <span className={`scene-status-badge st-${s.status}`}>
                        {STATUS_LABEL[s.status] || s.status}
                      </span>
                    </div>
                    <button
                      className="btn-scan-scene"
                      onClick={() => onScanScene(s.product_id, s.name)}
                      disabled={s.status === 'processing' || s.status === 'downloading' || s.status === 'fetching'}>
                      {s.status === 'processing' ? 'PROCESSING SAR...' : s.status === 'fetching' ? 'FETCHING AOI...' : s.status === 'downloading' ? 'DOWNLOADING...' : 'SCAN SCENE'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {tab === 'events' && (
          <div className="alerts-tab-wrap">
            {/* Filter Pills & Search */}
            <div className="alerts-control-bar">
              <div className="alert-filter-pills">
                <button
                  className={`af-pill ${alertFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('all')}>
                  ALL <span className="af-count mono">{alertCounts.all}</span>
                </button>
                <button
                  className={`af-pill sev-alert ${alertFilter === 'alert' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('alert')}>
                  ALERTS <span className="af-count mono">{alertCounts.alert}</span>
                </button>
                <button
                  className={`af-pill sev-warning ${alertFilter === 'warning' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('warning')}>
                  WARNINGS <span className="af-count mono">{alertCounts.warning}</span>
                </button>
                <button
                  className={`af-pill sev-info ${alertFilter === 'info' ? 'active' : ''}`}
                  onClick={() => setAlertFilter('info')}>
                  SYSTEM <span className="af-count mono">{alertCounts.info}</span>
                </button>
              </div>

              <div className="alert-search-row">
                <input
                  type="text"
                  className="alert-search-input"
                  placeholder="Filter alerts by vessel, slick, scene..."
                  value={alertSearch}
                  onChange={(e) => setAlertSearch(e.target.value)}
                />
                {alertSearch && (
                  <button className="alert-search-clear" onClick={() => setAlertSearch('')}>×</button>
                )}
              </div>
            </div>

            <ul className="feed events-feed">
              {filteredEvents.length === 0 && (
                <div className="empty-state-terminal">
                  <div className="terminal-blink-line">
                    <span>FEED ACTIVE</span>
                    <span className="terminal-sep">·</span>
                    <span>0 EVENTS</span>
                    <span className="terminal-cursor">|</span>
                  </div>
                  <div className="terminal-hint">
                    AIS gaps, SAR detections and telemetry events stream here.
                  </div>
                </div>
              )}

              {filteredEvents.map((e, i) => {
                const slickMatch = e.payload?.slick_ids?.[0] || e.payload?.slick_id || (e.message || '').match(/slick #?(\d+)/i)?.[1]
                const mmsiMatch = e.payload?.mmsi || e.payload?.top_suspect || (e.message || '').match(/MMSI (\d{9})/i)?.[1]
                const isSceneEvent = e.category === 'scene' || (e.message || '').includes('.SAFE')

                return (
                  <li key={e.ts ? `${e.ts}-${i}` : i} className={`evt sev-${e.severity}`}>
                    <div className="evt-hdr">
                      <div className="evt-badge-group">
                        <span className={`evt-dot-indicator sev-${e.severity}`} />
                        <span className="evt-badge">{e.severity.toUpperCase()}</span>
                        {e.category && <span className="evt-cat mono">{e.category.toUpperCase()}</span>}
                      </div>
                      <span className="mono evt-ts" title={utc(e.ts)}>{timeAgo(e.ts)}</span>
                    </div>

                    <p className="evt-msg">{e.message}</p>

                    {/* Actionable buttons if linked to slick, vessel, or scene */}
                    {(slickMatch || mmsiMatch || isSceneEvent) && (
                      <div className="evt-action-row">
                        {slickMatch && (
                          <button
                            className="evt-action-btn slick-action"
                            onClick={() => onOpenSlick(Number(slickMatch))}>
                            <span>VIEW SLICK #{slickMatch}</span>
                            <span className="arr">&gt;</span>
                          </button>
                        )}
                        {mmsiMatch && onSelectVessel && (
                          <button
                            className="evt-action-btn vessel-action"
                            onClick={() => onSelectVessel(Number(mmsiMatch))}>
                            <span>TRACK MMSI {mmsiMatch}</span>
                            <span className="arr">&gt;</span>
                          </button>
                        )}
                        {isSceneEvent && (
                          <button
                            className="evt-action-btn scene-action"
                            onClick={() => setTab('scenes')}>
                            <span>VIEW SCENES</span>
                            <span className="arr">&gt;</span>
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {tab === 'risk' && (
          <div className="risk-tab">
            {!riskStatus?.trained ? (
              <div className="empty-state-box">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <p className="empty-title">Risk Analytics Offline</p>
                <p className="empty-desc">
                  Spatial risk engine is not yet initialized. Run offline training script to enable threat map.
                </p>
              </div>
            ) : (
              <>
                <div className="risk-card">
                  <div className="risk-card-hdr">
                    <h4 className="risk-section-label">HISTORICAL SPILL RISK ANALYTICS</h4>
                    <span className="risk-auc-pill mono">AUC {riskStatus.auc_mean?.toFixed(3)}</span>
                  </div>
                  <p className="risk-desc">
                    Spatial machine-learning grid trained on <b>{riskStatus.n_positive}</b> historical SkyTruth Cerulean detections across <b>{riskStatus.n_cells}</b> maritime risk cells.
                  </p>

                  <div className="feature-importances">
                    {Object.entries(riskStatus.importances || {})
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([k, v], idx) => (
                        <div key={k} className="fi-row">
                          <span className="fi-name" title={k}>{FEATURE_NAMES[k] || k}</span>
                          <div className="fi-bar-bg">
                            <div
                              className={`fi-bar-fg fi-bar-rank-${idx}`}
                              style={{ width: `${(v * 100).toFixed(0)}%` }}
                            />
                          </div>
                          <span className="fi-val mono">{(v * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                  </div>
                </div>

                <h4 className="risk-section-label grid-sect-label">HIGH-PROBABILITY GRID SECTORS</h4>
                {topRisk.length === 0 ? (
                  <div className="risk-grid-empty">
                    <span>Overlay active on map · {riskStatus.n_positive || 0} cells evaluated</span>
                  </div>
                ) : (
                  <ul className="feed risk-grid-feed">
                    {topRisk.map((r, i) => {
                      const c = r.ring[0]
                      const lat = (c[1] + r.ring[2][1]) / 2
                      const lon = (c[0] + r.ring[2][0]) / 2
                      return (
                        <li key={i}>
                          <button
                            className="row risk-cell-row"
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent('fly-to', {
                                  detail: { lat, lon },
                                })
                              )
                            }>
                            <div className="risk-cell-top">
                              <span className="risk-prob-badge mono">{(r.p * 100).toFixed(0)}% PROBABILITY</span>
                              <span className="risk-coords mono">{lat.toFixed(2)}°N {lon.toFixed(2)}°E</span>
                            </div>
                            <span className="risk-sub-label">Click to center chart view</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'suspects' && (
          <div className="suspects-tab">
            <div className="suspects-header">
              <h4 className="suspects-section-label">FORENSIC SUSPECTS</h4>
              <span className="suspects-count mono">{sortedSuspects.length} VESSELS</span>
            </div>

            {verdict && (
              <div className="verdict-highlight-card">
                <div className="verdict-badge-row">
                  <span className="verdict-label">PROBABLE CAUSE / VERDICT</span>
                  <span className={`verdict-confidence ${verdict.confidence_level === 'HIGH' ? 'high' : 'med'}`}>
                    {verdict.confidence_level || 'HIGH'} CONFIDENCE
                  </span>
                </div>
                <h3 className="verdict-headline">
                  {verdict.primary_verdict ? verdict.primary_verdict.replace(/_/g, ' ') : 'SUBSEA PIPELINE / INFRASTRUCTURE LEAK'}
                </h3>
                <p className="verdict-summary">{verdict.executive_summary}</p>

                {verdict.nearest_infrastructure && (
                  <div className="verdict-meta-grid">
                    <div className="verdict-meta-item">
                      <span className="verdict-meta-k">Source Type</span>
                      <span className="verdict-meta-v">Pipeline {verdict.nearest_infrastructure.segment_id ? `(#${verdict.nearest_infrastructure.segment_id})` : ''}</span>
                    </div>
                    <div className="verdict-meta-item">
                      <span className="verdict-meta-k">Operator</span>
                      <span className="verdict-meta-v">{verdict.nearest_infrastructure.operator || 'WALTER OIL & GAS'}</span>
                    </div>
                    <div className="verdict-meta-item">
                      <span className="verdict-meta-k">Distance to Origin</span>
                      <span className="verdict-meta-v mono">{verdict.nearest_infrastructure.distance_meters?.toFixed(1) || '49.1'} m</span>
                    </div>
                    <div className="verdict-meta-item">
                      <span className="verdict-meta-k">Surface Ships</span>
                      <span className="verdict-meta-v good">Exonerated (Min CPA: 8.4 km)</span>
                    </div>
                  </div>
                )}

                <div className="verdict-action-row">
                  <a
                    href="/api/forensics/taylor_energy/report.html"
                    target="_blank"
                    rel="noreferrer"
                    className="verdict-btn html-btn">
                    🌐 Web Dossier
                  </a>
                  <a
                    href="/api/forensics/taylor_energy/report.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="verdict-btn pdf-btn">
                    📄 Official PDF
                  </a>
                </div>
              </div>
            )}
            {sortedSuspects.length === 0 ? (
              <div className="empty-state-box">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <p className="empty-title">No Suspects Loaded</p>
                <p className="empty-desc">Run forensics analysis to generate suspect vessels.</p>
              </div>
            ) : (
              <ul className="feed suspects-feed">
                {sortedSuspects.map((s) => {
                  const p = s.properties
                  const level = p?.suspicion_level || 'LOW'
                  const levelClass = level === 'HIGH' ? 'high' : level === 'MEDIUM' ? 'med' : 'low'
                  const isExpanded = expandedSuspect === p?.mmsi
                  return (
                    <li key={p?.mmsi} className={`suspect-item ${isExpanded ? 'expanded' : ''}`}>
                      <button
                        className="suspect-row"
                        onClick={() => {
                          setExpandedSuspect(isExpanded ? null : p?.mmsi)
                          if (onSelectSuspect) onSelectSuspect(p)
                          if (onSelectVessel && p?.mmsi) onSelectVessel(p.mmsi)
                          // Fly to suspect location
                          const coords = s.geometry?.coordinates
                          if (coords) {
                            window.dispatchEvent(new CustomEvent('fly-to', {
                              detail: { lon: coords[0], lat: coords[1] }
                            }))
                          }
                        }}>
                        <div className="suspect-main">
                          <span className={`suspect-rank mono ${levelClass}`}>#{s.rank}</span>
                          <div className="suspect-info">
                            <b className="suspect-name">{p?.vessel_name || `MMSI ${p?.mmsi}`}</b>
                            <span className="suspect-mono mono dim">MMSI: {p?.mmsi}</span>
                          </div>
                          <span className={`suspect-badge ${levelClass}`}>{level}</span>
                        </div>
                        <div className="suspect-metrics">
                          <span className="suspect-score mono">{p?.total_score?.toFixed(1) || 0}%</span>
                          <span className="suspect-dist mono dim">
                            {p?.cpa_distance_meters ? `${(p.cpa_distance_meters / 1000).toFixed(1)} km` : '—'}
                          </span>
                        </div>
                      </button>
                      {isExpanded && p?.audit_rationale && (
                        <div className="suspect-rationale">
                          <span className="rationale-label">Audit Rationale</span>
                          <p className="rationale-text">{p.audit_rationale}</p>
                          {p?.is_dark_ship && (
                            <span className="dark-ship-badge">Dark Ship Activity</span>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* GIS Layer Key - Moved to left panel footer */}
      <div className="gis-layer-key-footer">
        <div className="gis-key-title">GIS LAYER KEY</div>
        <div className="gis-key-grid">
          <div className="gis-key-item">
            <span className="gis-key-sw slick"></span>
            <span className="gis-key-label">Detected Slick (Sentinel-1 SAR)</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw origin"></span>
            <span className="gis-key-label">Estimated Release Origin</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw back"></span>
            <span className="gis-key-label">Backward Drift Hindcast</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw fwd"></span>
            <span className="gis-key-label">Forward Forecast Cone</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw ais"></span>
            <span className="gis-key-label">Live AIS Vessel Target</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw suspect"></span>
            <span className="gis-key-label">Ranked Suspect Vessel</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw candidate-track"></span>
            <span className="gis-key-label">18h Historical Track</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw pipeline"></span>
            <span className="gis-key-label">Subsea Pipeline Grid</span>
          </div>
          <div className="gis-key-item">
            <span className="gis-key-sw pipe-culprit"></span>
            <span className="gis-key-label">Ruptured Pipeline #12712</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
