import { useEffect, useRef, useState } from 'react'

// Palette: cyan #38BDF8, amber #F59E0B, spill #EF4444
const C = {
  abyss: '#0B1326',
  hull: '#171F33',
  foam: '#DAE2FD',
  dim: '#86948A',
  cyan: '#38BDF8',
  amber: '#F59E0B',
}

const INGEST_LINES = [
  'Establishing ground-station downlink…',
  'Decoding Sentinel-1 CEOS metadata…',
  'Calibrating sigma0 backscatter…',
  'Speckle filtering + terrain correction…',
  'Scene ingested — handing off to detection pipeline…',
]

// Duration of the fake "ingest" after the user confirms upload (ms)
const INGEST_MS = 2600

// Purely presentational illusion: DEMO opens this, the operator "uploads"
// SAR scenes, and Ingest hands off to the processing pipeline.
export default function SarIngestModal({ onCancel, onIngest }) {
  const [files, setFiles] = useState([])
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  // Lock map interaction while the modal is up
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const addFiles = (list) => {
    const imgs = Array.from(list || []).filter((f) =>
      /\.(tif|tiff|png|jpg|jpeg|jp2|safe|zip)$/i.test(f.name)
    )
    setFiles((prev) => [...prev, ...imgs])
  }

  const startIngest = () => {
    if (ingesting) return
    setIngesting(true)
    setProgress(0)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const p = Math.min(((Date.now() - t0) / INGEST_MS) * 100, 100)
      setProgress(p)
      if (p >= 100) {
        clearInterval(iv)
        onIngest?.()
      }
    }, 60)
  }

  const statusIdx = Math.min(
    Math.floor((progress / 100) * INGEST_LINES.length),
    INGEST_LINES.length - 1
  )

  return (
    <div className="sar-ingest-overlay" role="dialog" aria-modal="true" aria-label="SAR scene ingest">
      <div className="sar-ingest-card">
        <div className="sar-ingest-head">
          <div>
            <div className="sar-ingest-kicker">S1 MONITOR · SCENE INGEST</div>
            <h3 className="sar-ingest-title">Upload SAR Images</h3>
          </div>
          <button className="sar-ingest-close" onClick={onCancel} aria-label="Cancel">✕</button>
        </div>

        {!ingesting ? (
          <>
            <div
              className={`sar-dropzone ${dragOver ? 'drag-over' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer?.files) }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".tif,.tiff,.png,.jpg,.jpeg,.jp2,.safe,.zip"
                onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
              />
              <div className="sar-drop-icon" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17,8 12,3 7,8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="sar-drop-primary">
                {files.length
                  ? `${files.length} scene${files.length > 1 ? 's' : ''} selected`
                  : 'Drop Sentinel-1 SAR scenes here'}
              </div>
              <div className="sar-drop-secondary">.tif · .tiff · .jp2 · .SAFE · .zip — or click to browse</div>
            </div>

            {files.length > 0 && (
              <ul className="sar-file-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="sar-file-item">
                    <span className="sar-file-ext">{(f.name.split('.').pop() || 'SAR').toUpperCase()}</span>
                    <span className="sar-file-name" title={f.name}>
                      {f.name.length > 30 ? f.name.slice(0, 18) + '…' + f.name.slice(-9) : f.name}
                    </span>
                    <span className="sar-file-size">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button
                      className="sar-file-remove"
                      aria-label="Remove"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >×</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="sar-ingest-actions">
              <button className="sar-btn-ghost" onClick={onCancel}>Cancel</button>
              <button
                className="sar-btn-run"
                disabled={files.length === 0}
                onClick={startIngest}
              >
                Run Detection
              </button>
            </div>
          </>
        ) : (
          <div className="sar-ingest-progress">
            <div className="sar-ingest-line">{INGEST_LINES[statusIdx]}</div>
            <div className="sar-progress-bar">
              <div className="sar-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="sar-progress-pct">{Math.round(progress)}%</div>
          </div>
        )}
      </div>

      <style>{`
        .sar-ingest-overlay {
          position: fixed;
          inset: 0;
          background: rgba(2, 4, 9, 0.86);
          z-index: 120;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: sarFade 0.18s ease;
        }
        @keyframes sarFade { from { opacity: 0; } to { opacity: 1; } }
        .sar-ingest-card {
          width: 400px;
          max-width: calc(100vw - 48px);
          background: linear-gradient(180deg, ${C.hull} 0%, ${C.abyss} 100%);
          border: 1px solid rgba(56, 189, 248, 0.25);
          border-radius: 12px;
          padding: 20px 22px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
          animation: sarRise 0.24s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes sarRise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .sar-ingest-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        .sar-ingest-kicker {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.18em;
          color: ${C.dim};
        }
        .sar-ingest-title {
          margin: 4px 0 0 0;
          font-size: 16px;
          font-weight: 700;
          color: ${C.foam};
          letter-spacing: 0.02em;
        }
        .sar-ingest-close {
          background: none;
          border: none;
          color: ${C.dim};
          font-size: 14px;
          cursor: pointer;
          padding: 4px 6px;
          border-radius: 6px;
        }
        .sar-ingest-close:hover { color: ${C.foam}; background: rgba(255,255,255,0.06); }
        .sar-dropzone {
          border: 1.5px dashed rgba(56, 189, 248, 0.4);
          border-radius: 10px;
          padding: 26px 18px;
          text-align: center;
          cursor: pointer;
          background: rgba(11, 19, 38, 0.5);
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .sar-dropzone:hover, .sar-dropzone.drag-over {
          border-color: ${C.cyan};
          background: rgba(56, 189, 248, 0.07);
        }
        .sar-dropzone input { display: none; }
        .sar-drop-icon { color: ${C.cyan}; opacity: 0.85; margin-bottom: 8px; }
        .sar-drop-primary { font-size: 13px; color: ${C.foam}; font-weight: 600; }
        .sar-drop-secondary { font-size: 11px; color: ${C.dim}; margin-top: 4px; }
        .sar-file-list {
          list-style: none;
          margin: 12px 0 0 0;
          padding: 0;
          max-height: 148px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sar-file-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 9px;
          background: rgba(11, 19, 38, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 7px;
          font-size: 11px;
        }
        .sar-file-ext {
          font-size: 9px;
          font-weight: 700;
          color: ${C.cyan};
          background: rgba(56, 189, 248, 0.1);
          border-radius: 4px;
          padding: 2px 5px;
        }
        .sar-file-name { flex: 1; color: ${C.foam}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sar-file-size { color: ${C.dim}; font-variant-numeric: tabular-nums; }
        .sar-file-remove {
          background: none;
          border: none;
          color: ${C.dim};
          font-size: 14px;
          cursor: pointer;
          padding: 0 3px;
        }
        .sar-file-remove:hover { color: #EF4444; }
        .sar-ingest-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 16px;
        }
        .sar-btn-ghost {
          background: none;
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: ${C.dim};
          font-size: 12px;
          font-weight: 600;
          padding: 9px 14px;
          border-radius: 7px;
          cursor: pointer;
        }
        .sar-btn-ghost:hover { color: ${C.foam}; border-color: rgba(255,255,255,0.3); }
        .sar-btn-run {
          background: linear-gradient(180deg, ${C.cyan} 0%, ${C.cyan}dd 100%);
          color: #06121f;
          border: none;
          font-size: 12px;
          font-weight: 700;
          padding: 9px 18px;
          border-radius: 7px;
          cursor: pointer;
          letter-spacing: 0.02em;
        }
        .sar-btn-run:hover:not(:disabled) { filter: brightness(1.08); }
        .sar-btn-run:disabled { opacity: 0.4; cursor: not-allowed; }
        .sar-ingest-progress { padding: 26px 4px 12px; text-align: center; }
        .sar-ingest-line { font-size: 12px; color: ${C.foam}; min-height: 18px; margin-bottom: 14px; }
        .sar-progress-bar {
          height: 4px;
          background: rgba(255, 255, 255, 0.07);
          border-radius: 2px;
          overflow: hidden;
        }
        .sar-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, ${C.cyan}, ${C.amber});
          transition: width 0.06s linear;
        }
        .sar-progress-pct {
          margin-top: 10px;
          font-size: 11px;
          font-weight: 600;
          color: ${C.dim};
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  )
}
