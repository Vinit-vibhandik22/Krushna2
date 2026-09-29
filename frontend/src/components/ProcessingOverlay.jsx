import { useEffect, useState } from 'react'

// Color palette: spill #EF4444, cyan #38BDF8, amber #F59E0B
const C = {
  hull: '#171F33',
  foam: '#DAE2FD',
  dim: '#86948A',
  amber: '#F59E0B',
  cyan: '#38BDF8',
}

const STATUS_LINES = [
  'Ingesting SAR scene…',
  'Running U-Net segmentation…',
  'Vectorizing detection…',
  'Correlating drift model…',
  'Ranking suspect vessels…',
]

// Full-screen pipeline illusion shown while demoStage === 'processing'.
// Purely presentational: driven by durationMs, cleans up its own timer.
export default function ProcessingOverlay({ durationMs = 11000 }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const iv = setInterval(() => {
      const elapsed = Date.now() - start
      setProgress(Math.min((elapsed / durationMs) * 100, 100))
      if (elapsed >= durationMs) clearInterval(iv)
    }, 60)
    return () => clearInterval(iv)
  }, [durationMs])

  const statusIdx = Math.min(
    Math.floor((progress / 100) * STATUS_LINES.length),
    STATUS_LINES.length - 1
  )

  return (
    <div className="processing-overlay" role="status" aria-live="polite">
      <div className="processing-card">
        <div className="processing-spinner">
          {[...Array(12)].map((_, i) => (
            <span key={i} style={{ '--i': i }} />
          ))}
        </div>
        <p className="processing-status">{STATUS_LINES[statusIdx]}</p>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="progress-pct">{Math.round(progress)}%</p>
      </div>

      <style>{`
        .processing-overlay {
          position: fixed;
          inset: 0;
          background: rgba(2, 4, 9, 0.9);
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: procFadeIn 0.2s ease;
        }
        @keyframes procFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .processing-card {
          width: 320px;
          padding: 32px;
          background: ${C.hull};
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          text-align: center;
          animation: procSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
        }
        @keyframes procSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .processing-spinner {
          width: 48px;
          height: 48px;
          margin: 0 auto 20px;
          position: relative;
        }
        .processing-spinner span {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 12px;
          background: ${C.cyan};
          border-radius: 2px;
          transform: translate(-50%, -50%) rotate(calc(var(--i) * 30deg)) translateY(-18px);
          opacity: calc(1 - (var(--i) * 0.08));
          animation: spinnerPulse 1.2s linear infinite;
          animation-delay: calc(var(--i) * 0.1s);
        }
        @keyframes spinnerPulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 1; }
        }
        .processing-status {
          font-size: 13px;
          color: ${C.foam};
          margin: 0 0 20px 0;
          min-height: 20px;
        }
        .progress-bar {
          height: 4px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, ${C.cyan}, ${C.amber});
          border-radius: 2px;
          transition: width 0.06s linear;
        }
        .progress-pct {
          font-size: 12px;
          font-weight: 600;
          color: ${C.dim};
          margin: 0;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  )
}
