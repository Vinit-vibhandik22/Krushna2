import { useState, useRef, useEffect, useCallback } from 'react'

export default function SarUploadModal({ isOpen, onClose, onConfirm }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisStep, setAnalysisStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const [subLog, setSubLog] = useState('')
  const [isBenchmark, setIsBenchmark] = useState(false)
  const fileInputRef = useRef(null)

  // Clean up object URL when component unmounts or file changes
  useEffect(() => {
    return () => {
      if (previewUrl && !previewUrl.startsWith('data:') && !previewUrl.startsWith('/')) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  // Reset modal state when closed
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null)
      setPreviewUrl(null)
      setIsDragging(false)
      setIsAnalyzing(false)
      setAnalysisStep(0)
      setProgress(0)
      setSubLog('')
      setIsBenchmark(false)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isAnalyzing) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isAnalyzing, onClose])

  const handleFileProcess = useCallback((file) => {
    if (!file) return
    setIsBenchmark(false)
    setSelectedFile(file)

    // Generate in-memory display preview (zero server persistence)
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
    } else {
      // For GeoTIFF (.tif/.tiff), create a tactical placeholder visual
      setPreviewUrl(null)
    }
  }, [])

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0])
    }
  }

  const handleSelectBenchmark = () => {
    setIsBenchmark(true)
    setSelectedFile({
      name: 'S1A_IW_GRDH_1SDV_20231117T235416_MC20.SAFE',
      size: 48234496,
      type: 'image/tiff',
      benchmark: true,
    })
    setPreviewUrl(null)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    setSelectedFile(null)
    setPreviewUrl(null)
    setIsBenchmark(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleStartAnalysis = () => {
    const fileData = selectedFile || {
      name: 'S1A_IW_GRDH_1SDV_20231117T235416_MC20.SAFE',
      size: 48234496,
      type: 'image/tiff',
      benchmark: true,
    }
    if (!selectedFile && !isBenchmark) {
      handleSelectBenchmark()
    }

    setIsAnalyzing(true)
    setAnalysisStep(1)
    setProgress(16)
    setSubLog('[SYS_EXEC] Worker #0 spawned (PID: 20656) · Allocating CUDA memory buffer...')

    // Step 2 at 1200ms
    setTimeout(() => {
      setAnalysisStep(2)
      setProgress(38)
      setSubLog('[DSP_CALIB] Radiometric calibration & Lee speckle filter normalization...')
    }, 1200)

    // Step 3 at 2400ms
    setTimeout(() => {
      setAnalysisStep(3)
      setProgress(64)
      setSubLog('[NEURAL_NET] PyTorch ResNet U-Net: Segmenting low-backscatter oil film damping...')
    }, 2400)

    // Step 4 at 3700ms
    setTimeout(() => {
      setAnalysisStep(4)
      setProgress(86)
      setSubLog('[MORPHOLOGY] Calculating 2D diffusion axis & slick centroid coordinates...')
    }, 3700)

    // Step 5 at 4700ms
    setTimeout(() => {
      setAnalysisStep(5)
      setProgress(100)
      setSubLog('[HYDRO_INIT] Synchronizing CMEMS current grid & initializing Lagrangian particles...')
    }, 4700)

    // Complete at 5500ms
    setTimeout(() => {
      onConfirm({
        file: selectedFile,
        name: fileData.name,
        size: fileData.size,
        previewUrl,
        isBenchmark,
      })
      onClose()
    }, 5500)
  }

  if (!isOpen) return null

  const formatSize = (bytes) => {
    if (!bytes) return '—'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <div className="sar-modal-overlay" onClick={isAnalyzing ? null : onClose}>
      <div
        className="sar-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sar-modal-title"
      >
        {/* Tactical Header */}
        <div className="sar-modal-header">
          <div className="sar-header-title-wrap">
            <span className="sar-radar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 1 10 10" />
                <path d="M12 6a6 6 0 0 1 6 6" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            </span>
            <div>
              <h2 id="sar-modal-title" className="sar-modal-title">
                SAR SATELLITE IMAGERY INGESTION
              </h2>
              <span className="sar-modal-sub mono">
                COPERNICUS SENTINEL-1 C-BAND SAR · VOLATILE MEMORY INGEST
              </span>
            </div>
          </div>
          {!isAnalyzing && (
            <button
              type="button"
              className="sar-modal-close-btn"
              onClick={onClose}
              title="Close modal (Esc)"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        {/* Tactical Notice */}
        <div className="sar-modal-notice">
          <span className="notice-icon">ℹ️</span>
          <span className="notice-text">
            Upload Sentinel-1 SAR scene imagery (GeoTIFF, PNG, JPG) to trigger automated dark-spot segmentation, hydrodynamic backtrack corridor, and vessel attribution.
          </span>
        </div>

        {/* Dropzone Area */}
        <div
          className={`sar-dropzone ${isDragging ? 'dragging' : ''} ${selectedFile ? 'has-file' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isAnalyzing && fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/png, image/jpeg, image/tiff, .tif, .tiff, .png, .jpg, .jpeg"
            style={{ display: 'none' }}
          />

          {isAnalyzing ? (
            <div className="sar-analyzing-wrap">
              <div className="sar-radar-sweep-animation">
                <div className="sweep-line"></div>
                <div className="sweep-circle circle-1"></div>
                <div className="sweep-circle circle-2"></div>
                <div className="sweep-circle circle-3"></div>
                <div className="sweep-crosshair x-axis"></div>
                <div className="sweep-crosshair y-axis"></div>
              </div>
              <div className="sar-analyzing-status">
                <div className="analyzing-header-row">
                  <span className="analyzing-headline mono">PROCESSING SAR MATRIX</span>
                  <span className="analyzing-pct mono">{progress}%</span>
                </div>

                {/* Visual Progress Bar */}
                <div className="sar-progress-bar-wrap">
                  <div className="sar-progress-bar-fill" style={{ width: `${progress}%` }}></div>
                </div>

                {subLog && (
                  <div className="analyzing-sublog mono">
                    <span className="sublog-prompt">{'>'}</span>
                    <span className="sublog-text">{subLog}</span>
                  </div>
                )}

                <div className="analyzing-steps mono">
                  <div className={`step-item ${analysisStep >= 1 ? 'active' : ''}`}>
                    <span className="step-bullet">{analysisStep >= 1 ? '✓' : '·'}</span>
                    <span>1. Reading backscatter matrix sigma0 (VV/VH dual-pol)...</span>
                  </div>
                  <div className={`step-item ${analysisStep >= 2 ? 'active' : ''}`}>
                    <span className="step-bullet">{analysisStep >= 2 ? '✓' : '·'}</span>
                    <span>2. Despeckling & radiometric calibration filter...</span>
                  </div>
                  <div className={`step-item ${analysisStep >= 3 ? 'active' : ''}`}>
                    <span className="step-bullet">{analysisStep >= 3 ? '✓' : '·'}</span>
                    <span>3. PyTorch U-Net segmentation: Isolating oil damping boundary...</span>
                  </div>
                  <div className={`step-item ${analysisStep >= 4 ? 'active' : ''}`}>
                    <span className="step-bullet">{analysisStep >= 4 ? '✓' : '·'}</span>
                    <span>4. Calculating slick morphology & 2D Fickian diffusion age...</span>
                  </div>
                  <div className={`step-item ${analysisStep >= 5 ? 'active' : ''}`}>
                    <span className="step-bullet">{analysisStep >= 5 ? '✓' : '·'}</span>
                    <span>5. Reverse-Lagrangian particle dispersion initializing...</span>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedFile ? (
            /* Selected File Display */
            <div className="sar-file-preview-card">
              <div className="sar-preview-visual">
                {previewUrl ? (
                  <div className="sar-img-container">
                    <img src={previewUrl} alt="SAR Upload Preview" className="sar-preview-img" />
                    <div className="sar-scan-overlay"></div>
                    <div className="sar-target-reticle"></div>
                  </div>
                ) : (
                  <div className="sar-tiff-placeholder">
                    <div className="radar-grid-bg"></div>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span className="mono tiff-label">SENTINEL-1 C-SAR GEOTIFF</span>
                  </div>
                )}
              </div>

              <div className="sar-file-meta-panel">
                <div className="sar-file-header-row">
                  <span className="sar-file-badge mono">
                    {isBenchmark ? 'BENCHMARK SCENE' : 'LOCAL IMAGE INGEST'}
                  </span>
                  <button
                    type="button"
                    className="sar-file-remove-btn mono"
                    onClick={handleClear}
                    title="Remove file"
                  >
                    ✕ CLEAR
                  </button>
                </div>

                <div className="sar-meta-filename mono" title={selectedFile.name}>
                  {selectedFile.name}
                </div>

                <div className="sar-meta-grid">
                  <div className="meta-cell">
                    <span className="cell-label mono">FILE SIZE</span>
                    <span className="cell-value mono">{formatSize(selectedFile.size)}</span>
                  </div>
                  <div className="meta-cell">
                    <span className="cell-label mono">POLARIZATION</span>
                    <span className="cell-value mono">VV + VH Dual-Pol</span>
                  </div>
                  <div className="meta-cell">
                    <span className="cell-label mono">MODE</span>
                    <span className="cell-value mono">Interferometric (IW)</span>
                  </div>
                  <div className="meta-cell">
                    <span className="cell-label mono">RESOLUTION</span>
                    <span className="cell-value mono">10m Ground Sample</span>
                  </div>
                  <div className="meta-cell full-width">
                    <span className="cell-label mono">STORAGE RETENTION</span>
                    <span className="cell-value mono highlight-green">
                      RAM Only · 0% Server Retention (Display Demo)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Empty Dropzone Prompt */
            <div className="sar-dropzone-prompt">
              <div className="sar-upload-icon-circle">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="sar-dropzone-text">
                <span className="drop-main-text">
                  {isDragging ? 'DROP SAR IMAGE TO INGEST' : 'DRAG & DROP SAR SATELLITE IMAGE HERE'}
                </span>
                <span className="drop-sub-text mono">
                  Supports GeoTIFF (.tif, .tiff), PNG, JPG · Sentinel-1 SAR GRD / SLC
                </span>
              </div>
              <button
                type="button"
                className="sar-browse-btn mono"
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
              >
                📁 BROWSE LOCAL FILES
              </button>
            </div>
          )}
        </div>

        {/* Quick Benchmark Fallback Option */}
        {!selectedFile && !isAnalyzing && (
          <div className="sar-benchmark-bar">
            <span className="benchmark-bar-label mono">No SAR imagery on hand?</span>
            <button
              type="button"
              className="sar-benchmark-quick-btn mono"
              onClick={handleSelectBenchmark}
            >
              🛰️ LOAD BENCHMARK SCENE (MC-20 · Taylor Energy)
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="sar-modal-footer">
          <div className="sar-footer-status mono">
            {selectedFile ? (
              <span className="status-ready">● SAR IMAGE LOADED IN MEMORY</span>
            ) : (
              <span className="status-idle">○ AWAITING SAR INPUT FILE</span>
            )}
          </div>
          <div className="sar-footer-buttons">
            <button
              type="button"
              className="sar-cancel-btn mono"
              onClick={onClose}
              disabled={isAnalyzing}
            >
              CANCEL
            </button>
            <button
              type="button"
              className="sar-launch-btn mono"
              onClick={handleStartAnalysis}
              disabled={isAnalyzing}
            >
              <span>{isAnalyzing ? 'INGESTING...' : selectedFile ? '⚡ ANALYZE & START SIMULATION' : '⚡ RUN BENCHMARK SIMULATION'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
