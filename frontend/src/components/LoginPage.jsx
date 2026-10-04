import { useState, useCallback, useEffect } from 'react'
import EarthBackground from './EarthBackground.jsx'

export default function LoginPage({ onLoginSuccess, theme, onToggleTheme }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sceneLoaded, setSceneLoaded] = useState(false)

  const handleSceneLoaded = useCallback(() => {
    setSceneLoaded(true)
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    if (!email || !email.includes('@')) {
      setError('Invalid credentials')
      return
    }

    if (!password || password.length < 4) {
      setError('Invalid credentials')
      return
    }

    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      if (onLoginSuccess) {
        onLoginSuccess({ email, role: 'Intelligence Officer' })
      }
    }, 1200)
  }

  const [demoFilled, setDemoFilled] = useState(false)

  const handleFillDemo = (autoSubmit = false) => {
    const demoEmail = 'command@spill2source.io'
    const demoPassword = 'maritime2026'
    setEmail(demoEmail)
    setPassword(demoPassword)
    setError('')
    setDemoFilled(true)
    setTimeout(() => setDemoFilled(false), 2500)

    if (autoSubmit && onLoginSuccess) {
      setLoading(true)
      setTimeout(() => {
        setLoading(false)
        onLoginSuccess({ email: demoEmail, role: 'Intelligence Officer' })
      }, 700)
    }
  }

  return (
    <div className={`login-page-container ${sceneLoaded ? 'loaded' : ''}`}>
      {/* Left: Live Globe with Data Overlay (65%) */}
      <div className="login-globe-panel">
        <EarthBackground onLoaded={handleSceneLoaded} />

        {/* Top Header - Minimal */}
        <header className="login-top-header">
          <div className="login-brand">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L19.5 12.5L30 16L19.5 19.5L16 30L12.5 19.5L2 16L12.5 12.5L16 2Z" fill="#F5A623" />
            </svg>
            <span>Krishna Sindhu</span>
          </div>
          <div className="login-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              className="header-btn theme-toggle-btn"
              onClick={onToggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              style={{ padding: '6px 8px' }}
            >
              {theme === 'dark' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <div className="login-header-status">
              <span className="status-dot" />
              <span>SYSTEM ONLINE</span>
            </div>
          </div>
        </header>

        {/* Editorial Hero Block */}
        <div className="editorial-hero">
          <h1 className="editorial-headline">
            Satellite SAR Surveillance. Automated Forensic Attribution.
          </h1>
          <p className="editorial-body">
            Real-time radar oil-spill detection, hydrodynamic backtracking, and vessel kinematics.
          </p>
          <div className="editorial-telemetry">
            <span className="telemetry-coords mono">SENTINEL-1 C-BAND SAR</span>
            <span className="telemetry-sep">/</span>
            <span className="telemetry-timestamp mono">REVERSE LAGRANGIAN</span>
            <span className="telemetry-sep">/</span>
            <span className="telemetry-accuracy mono">98.4% ACCURACY</span>
          </div>
        </div>
      </div>

      {/* Right: Terminal Auth Panel (35%) - Flush Edge, No Radius, No Glass */}
      <div className="login-terminal-panel">
        <div className="terminal-header">
          <span className="terminal-prompt">{'>'}</span>
          <span className="terminal-title">ACCESS SYSTEM</span>
        </div>

        {error && (
          <div className="terminal-error">
            <span className="error-code">AUTH_FAILED</span>
            <span className="error-msg">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="terminal-form">
          <div className="terminal-field">
            <label>Access System</label>
            <input
              type="email"
              placeholder="operator@agency.gov"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              spellCheck="false"
            />
          </div>

          <div className="terminal-field">
            <label>Clearance Key</label>
            <div className="terminal-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="terminal-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
              >
                {showPassword ? '[HIDE]' : '[SHOW]'}
              </button>
            </div>
          </div>

          <div className="terminal-options">
            <label className="terminal-checkbox">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span className="checkmark" />
              <span>PERSIST_SESSION</span>
            </label>
          </div>

          <button
            type="submit"
            className={`terminal-submit ${loading ? 'loading' : ''}`}
            disabled={loading}
          >
            {loading ? 'AUTHENTICATING...' : 'AUTHENTICATE'}
          </button>
        </form>

        <div className="terminal-footer">
          <div className="demo-credentials-card">
            <div className="demo-card-header">
              <div className="demo-card-title-wrap">
                <span className="demo-card-icon">⚡</span>
                <span className="demo-card-title">DEMO CREDENTIALS</span>
              </div>
              <span className="demo-card-badge">ONE-CLICK ACCESS</span>
            </div>
            <div className="demo-card-creds">
              <div className="demo-cred-row">
                <span className="demo-cred-label">USER:</span>
                <span className="demo-cred-val mono">command@spill2source.io</span>
              </div>
              <div className="demo-cred-row">
                <span className="demo-cred-label">KEY:</span>
                <span className="demo-cred-val mono">maritime2026</span>
              </div>
            </div>
            <div className="demo-card-actions">
              <button
                type="button"
                className={`demo-fill-btn ${demoFilled ? 'filled' : ''}`}
                onClick={() => handleFillDemo(false)}
                title="Autofill Demo Credentials into the login form"
                disabled={loading}
              >
                <span>{demoFilled ? '✓ LOADED' : 'LOAD CREDENTIALS'}</span>
              </button>
              <button
                type="button"
                className="demo-instant-btn"
                onClick={() => handleFillDemo(true)}
                title="One-click instant login as Demo Operator"
                disabled={loading}
              >
                <span>⚡ QUICK LOGIN</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
