import { useEffect, useState, useMemo } from 'react'

// Sentinel-1A orbital period is approximately 98 minutes
// For demo purposes, we simulate passes every 98 minutes from a base time
const ORBITAL_PERIOD_MIN = 98
const BASE_PASS_TIME = new Date('2026-09-26T12:00:00Z').getTime()

function useNextAcquisition() {
  const [countdown, setCountdown] = useState({ minutes: 47, seconds: 0, totalSec: 2820 })

  useEffect(() => {
    const calculateNextPass = () => {
      const now = Date.now()
      const elapsed = now - BASE_PASS_TIME
      const periods = Math.floor(elapsed / (ORBITAL_PERIOD_MIN * 60 * 1000))
      const nextPass = BASE_PASS_TIME + (periods + 1) * ORBITAL_PERIOD_MIN * 60 * 1000
      const remaining = Math.max(0, nextPass - now)
      return {
        minutes: Math.floor(remaining / 60000),
        seconds: Math.floor((remaining % 60000) / 1000),
        totalSec: Math.floor(remaining / 1000)
      }
    }

    setCountdown(calculateNextPass())
    const interval = setInterval(() => {
      setCountdown(calculateNextPass())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return countdown
}

export default function TelemetryStatusBar({ vessels, slicks, scenes, events }) {
  const [utcTime, setUtcTime] = useState(new Date())
  const countdown = useNextAcquisition()

  useEffect(() => {
    const interval = setInterval(() => setUtcTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const fmtTime = (d) =>
    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

  // Count active incidents from events
  const activeIncidents = useMemo(() => {
    if (!events || events.length === 0) return 0
    return events.filter(e => {
      const age = (Date.now() / 1000) - (e.ts || 0)
      return age < 3600 // Active if within last hour
    }).length
  }, [events])

  // Calculate SAR confidence from latest scene/meta (placeholder for real data)
  const sarConfidence = 98.4

  return (
    <div className="telemetry-status-bar">
      <div className="telemetry-item">
        <span className="telemetry-label">[SENTINEL-1A PASS]</span>
        <span className="telemetry-val">{fmtTime(utcTime)} UTC</span>
      </div>

      <span className="telemetry-sep">|</span>

      <div className="telemetry-item">
        <span className="telemetry-val alert">{activeIncidents}</span>
        <span className="telemetry-label">ACTIVE INCIDENTS</span>
      </div>

      <span className="telemetry-sep">|</span>

      <div className="telemetry-item">
        <span className="telemetry-label">NEXT ACQUISITION:</span>
        <span className="telemetry-val countdown">
          {countdown.minutes}m{String(countdown.seconds).padStart(2, '0')}s
        </span>
      </div>

      <span className="telemetry-sep">|</span>

      <div className="telemetry-item confidence">
        <span className="telemetry-label">SAR CONF:</span>
        <span className="telemetry-val">{sarConfidence.toFixed(1)}%</span>
        <div className="confidence-bar">
          <div
            className="confidence-fill"
            style={{ width: `${sarConfidence}%` }}
          />
        </div>
      </div>

      <span className="telemetry-sep">|</span>

      <div className="telemetry-item status">
        <span className="status-dot" aria-hidden="true" />
        <span className="status-text">NOMINAL</span>
      </div>
    </div>
  )
}
