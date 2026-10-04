import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'

// High-definition public NASA Earth textures
const EARTH_DAY_URL = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
const EARTH_NIGHT_URL = 'https://unpkg.com/three-globe/example/img/earth-night.jpg'

// Incident data - realistic maritime oil spill locations
const INCIDENTS = [
  { id: 'INC-2847', lat: 54.5, lon: -12.0, name: 'North Sea Platform', status: 'Confirmed', area: '3.2km²', confidence: 94 },
  { id: 'INC-1923', lat: 27.5, lon: -90.5, name: 'Gulf of Mexico', status: 'Confirmed', area: '8.7km²', confidence: 97 },
  { id: 'INC-4451', lat: 2.8, lon: 101.5, name: 'Strait of Malacca', status: 'Investigating', area: '1.4km²', confidence: 78 },
  { id: 'INC-3129', lat: 60.5, lon: -1.5, name: 'Shetland Islands', status: 'Confirmed', area: '2.1km²', confidence: 91 },
  { id: 'INC-5621', lat: 43.5, lon: 28.0, name: 'Black Sea', status: 'Confirmed', area: '5.3km²', confidence: 89 },
]

// Convert lat/lon to 3D position on sphere
function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  const x = -(radius * Math.sin(phi) * Math.cos(theta))
  const z = radius * Math.sin(phi) * Math.sin(theta)
  const y = radius * Math.cos(phi)
  return new THREE.Vector3(x, y, z)
}

/**
 * Atmospheric Outer Limb Scattering Shader (FrontSide Additive)
 * Thin, razor-sharp atmospheric cyan halo.
 */
const AtmosphereShader = {
  vertexShader: `
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    void main() {
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    uniform vec3 uSunPosition;
    uniform vec3 uCameraPos;
    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 V = normalize(uCameraPos - vWorldPosition);
      vec3 L = normalize(uSunPosition - vWorldPosition);
      float NdotV = max(0.0, dot(N, V));
      float rim = 1.0 - NdotV;
      float rimIntensity = pow(rim, 5.5);
      float sunDot = dot(N, L);
      vec3 amberGlow = vec3(0.96, 0.65, 0.14);
      vec3 deepSienna = vec3(0.25, 0.12, 0.02);
      vec3 atmosColor = mix(deepSienna, amberGlow, clamp(sunDot + 0.4, 0.0, 1.0));
      gl_FragColor = vec4(atmosColor * 1.3, rimIntensity * 0.80);
    }
  `
}

/**
 * SAR Sweep Radar Shader - rotating scan line
 */
const SweepShader = {
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    uniform float uProgress;
    uniform vec3 uColor;
    void main() {
      vec2 center = vec2(0.5, 0.5);
      vec2 toCenter = vUv - center;
      float angle = atan(toCenter.y, toCenter.x) + 3.14159265359;
      float dist = length(toCenter) * 2.0;
      float sweepAngle = mod(uTime * 1.5, 6.28318530718);
      float angleDiff = mod(angle - sweepAngle + 6.28318530718, 6.28318530718);
      float sweepIntensity = smoothstep(0.5, 0.0, angleDiff) * smoothstep(0.0, 0.4, dist) * (1.0 - dist * 0.3);
      float trail = smoothstep(0.8, 0.0, angleDiff) * 0.15 * smoothstep(0.0, 0.5, dist);
      float alpha = (sweepIntensity + trail) * 0.6;
      gl_FragColor = vec4(uColor, alpha * smoothstep(1.0, 0.8, dist));
    }
  `
}

/**
 * Generate circular particle texture for subtle pinpoint starfield
 */
function createStarTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)')
  grad.addColorStop(0.35, 'rgba(215, 238, 255, 0.85)')
  grad.addColorStop(1, 'rgba(215, 238, 255, 0.0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(16, 16, 16, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/**
 * Create pulsing marker texture
 */
function createMarkerTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')

  // Outer glow
  const outerGrad = ctx.createRadialGradient(32, 32, 0, 32, 32, 28)
  outerGrad.addColorStop(0, 'rgba(255, 180, 40, 0.0)')
  outerGrad.addColorStop(0.4, 'rgba(255, 160, 30, 0.3)')
  outerGrad.addColorStop(1, 'rgba(255, 140, 20, 0.0)')
  ctx.fillStyle = outerGrad
  ctx.fillRect(0, 0, 64, 64)

  // Core dot
  const coreGrad = ctx.createRadialGradient(32, 32, 0, 32, 32, 8)
  coreGrad.addColorStop(0, 'rgba(255, 200, 80, 1.0)')
  coreGrad.addColorStop(0.5, 'rgba(255, 160, 40, 0.8)')
  coreGrad.addColorStop(1, 'rgba(255, 140, 30, 0.0)')
  ctx.fillStyle = coreGrad
  ctx.fillRect(0, 0, 64, 64)

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function EarthBackgroundComponent({ onLoaded }) {
  const mountRef = useRef(null)
  const [webglError, setWebglError] = useState(false)
  const [activeCallout, setActiveCallout] = useState(null)
  const onLoadedRef = useRef(onLoaded)
  const calloutTimerRef = useRef(null)

  const showCallout = useCallback((incident) => {
    if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current)
    setActiveCallout(incident)
    calloutTimerRef.current = setTimeout(() => setActiveCallout(null), 4000)
  }, [])

  useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      })
    } catch (e) {
      console.warn('WebGL initialization failed, using fallback', e)
      setWebglError(true)
      if (onLoadedRef.current) onLoadedRef.current()
      return
    }

    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight

    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x05070a, 1.0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    // Camera positioned to view smaller lower Earth (30-40% viewport width)
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 1000)
    camera.position.set(0, 0, 6.0)
    camera.lookAt(0, -0.40, 0)

    // Earth group positioned low at lower-center
    const earthGroup = new THREE.Group()
    earthGroup.position.set(0, -3.35, 0)
    earthGroup.rotation.x = -0.10
    earthGroup.rotation.z = -0.04
    earthGroup.rotation.y = 4.65
    scene.add(earthGroup)

    const EARTH_RADIUS = 2.85
    const sphereGeo = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128)

    // Sun position (soft directional light from upper left)
    const sunWorldPos = new THREE.Vector3(-2.2, 1.4, 0.9)

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4)
    sunLight.position.copy(sunWorldPos)
    scene.add(sunLight)

    const ambientLight = new THREE.AmbientLight(0x061020, 0.35)
    scene.add(ambientLight)

    const textureLoader = new THREE.TextureLoader()

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uDayTexture: { value: null },
        uNightTexture: { value: null },
        uSunPosition: { value: sunWorldPos },
        uCameraPos: { value: camera.position }
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        uniform sampler2D uDayTexture;
        uniform sampler2D uNightTexture;
        uniform vec3 uSunPosition;
        uniform vec3 uCameraPos;
        void main() {
          vec3 dayTex = vec3(0.015, 0.06, 0.14);
          vec3 nightTex = vec3(0.0);
          if (texture2D(uDayTexture, vUv).a > 0.0) {
            dayTex = texture2D(uDayTexture, vUv).rgb;
          }
          if (texture2D(uNightTexture, vUv).a > 0.0) {
            nightTex = texture2D(uNightTexture, vUv).rgb;
          }
          vec3 N = normalize(vWorldNormal);
          vec3 L = normalize(uSunPosition - vWorldPosition);
          vec3 V = normalize(uCameraPos - vWorldPosition);
          float sunDot = dot(N, L);
          float landMask = smoothstep(0.02, 0.08, (dayTex.r + dayTex.g) * 0.7 - dayTex.b * 0.5);
          vec3 ocean = vec3(0.003, 0.010, 0.024);
          vec3 landSurface = dayTex * 0.65 + vec3(0.008, 0.014, 0.025);
          vec3 baseSurface = mix(ocean, landSurface, landMask);
          float cityLum = max(nightTex.r, max(nightTex.g, nightTex.b));
          vec3 cityLights = vec3(1.0, 0.80, 0.40) * pow(cityLum, 1.3) * 2.8 * (0.3 + 0.7 * landMask);
          vec3 nightSide = baseSurface * 0.16 + cityLights;
          vec3 daySide = baseSurface * (max(0.0, sunDot) * 0.95 + 0.08);
          if (sunDot > 0.0) {
            vec3 H = normalize(L + V);
            float spec = pow(max(0.0, dot(N, H)), 48.0);
            daySide += vec3(0.9, 0.85, 0.65) * spec * (1.0 - landMask) * 0.28;
          }
          float dayFactor = smoothstep(-0.06, 0.18, sunDot);
          vec3 finalSurface = mix(nightSide, daySide, dayFactor);
          float rim = 1.0 - max(0.0, dot(N, V));
          float rimStrength = pow(rim, 4.8);
          finalSurface += vec3(0.02, 0.70, 0.95) * rimStrength * 0.42;
          gl_FragColor = vec4(finalSurface, 1.0);
        }
      `,
      depthWrite: true,
      depthTest: true
    })

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy() || 16

    textureLoader.load(EARTH_NIGHT_URL, (tex) => {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.anisotropy = maxAnisotropy
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = true
      tex.needsUpdate = true
      earthMat.uniforms.uNightTexture.value = tex
      earthMat.needsUpdate = true
    })

    textureLoader.load(EARTH_DAY_URL, (tex) => {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.anisotropy = maxAnisotropy
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = true
      tex.needsUpdate = true
      earthMat.uniforms.uDayTexture.value = tex
      earthMat.needsUpdate = true
    })

    const earthMesh = new THREE.Mesh(sphereGeo, earthMat)
    earthGroup.add(earthMesh)

    // Atmospheric Horizon Glow Shell (Limb)
    const atmosGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.012, 128, 128)
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: AtmosphereShader.vertexShader,
      fragmentShader: AtmosphereShader.fragmentShader,
      uniforms: {
        uSunPosition: { value: sunWorldPos },
        uCameraPos: { value: camera.position }
      },
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
      depthTest: true
    })
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat)
    earthGroup.add(atmosMesh)

    // === GRID OVERLAY: Lat/Lon wireframe on sphere surface ===
    const gridGroup = new THREE.Group()
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.06
    })

    // Longitude lines (meridians)
    for (let lon = -180; lon < 180; lon += 30) {
      const points = []
      for (let lat = -90; lat <= 90; lat += 5) {
        points.push(latLonToVector3(lat, lon, EARTH_RADIUS * 1.002))
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const line = new THREE.Line(geometry, gridMaterial)
      gridGroup.add(line)
    }

    // Latitude lines (parallels)
    for (let lat = -60; lat <= 60; lat += 30) {
      const points = []
      for (let lon = -180; lon <= 180; lon += 5) {
        points.push(latLonToVector3(lat, lon, EARTH_RADIUS * 1.002))
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const line = new THREE.LineLoop(geometry, gridMaterial)
      gridGroup.add(line)
    }
    earthGroup.add(gridGroup)

    // === SAR SWEEP: Rotating radar scan line ===
    const sweepRadius = EARTH_RADIUS * 1.035
    const sweepGeo = new THREE.PlaneGeometry(sweepRadius * 2, sweepRadius * 2)
    const sweepMat = new THREE.ShaderMaterial({
      vertexShader: SweepShader.vertexShader,
      fragmentShader: SweepShader.fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Vector3(0.96, 0.65, 0.14) }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat)
    sweepMesh.position.set(0, 0, 0)
    sweepMesh.lookAt(camera.position)
    earthGroup.add(sweepMesh)

    // === INCIDENT MARKERS: Pulsing amber dots ===
    const markerTexture = createMarkerTexture()
    const markers = []
    const markerGroup = new THREE.Group()

    INCIDENTS.forEach((incident, index) => {
      const position = latLonToVector3(incident.lat, incident.lon, EARTH_RADIUS * 1.015)

      // Marker sprite
      const spriteMat = new THREE.SpriteMaterial({
        map: markerTexture,
        color: 0xffa020,
        transparent: true,
        blending: THREE.AdditiveBlending
      })
      const sprite = new THREE.Sprite(spriteMat)
      sprite.position.copy(position)
      sprite.scale.set(0.15, 0.15, 0.15)

      // Store incident data and timing on the sprite
      sprite.userData = {
        incident,
        pulseOffset: index * 1.2, // Stagger pulse timing
        baseScale: 0.15
      }

      markers.push(sprite)
      markerGroup.add(sprite)

      // Add small point light at marker location
      const markerLight = new THREE.PointLight(0xff8020, 0.3, 2)
      markerLight.position.copy(position)
      markerGroup.add(markerLight)
    })
    earthGroup.add(markerGroup)

    // Pinpoint Starfield (Subtle, sparse)
    const starCount = 800
    const starGeo = new THREE.BufferGeometry()
    const starPositions = new Float32Array(starCount * 3)
    const starColors = new Float32Array(starCount * 3)
    const starTex = createStarTexture()

    for (let i = 0; i < starCount; i++) {
      const radius = 70 + Math.random() * 100
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 2 - 1)
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      starPositions[i * 3 + 2] = radius * Math.cos(phi)
      starColors[i * 3] = 0.85
      starColors[i * 3 + 1] = 0.90
      starColors[i * 3 + 2] = 0.98
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3))
    const starMat = new THREE.PointsMaterial({
      size: 1.4,
      map: starTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const starField = new THREE.Points(starGeo, starMat)
    scene.add(starField)

    // Mouse parallax (very subtle)
    let mouseX = 0
    let mouseY = 0
    const handleMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 0.03
      mouseY = (e.clientY / window.innerHeight - 0.5) * 0.03
    }
    window.addEventListener('mousemove', handleMouseMove)

    // Raycaster for marker interaction
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    let lastPulsedMarker = null

    // Animation loop
    let animFrameId
    const clock = new THREE.Clock()

    const animate = () => {
      animFrameId = requestAnimationFrame(animate)
      const elapsedTime = clock.getElapsedTime()

      // Rotation loop
      earthGroup.rotation.y += 0.00040

      // SAR sweep rotation
      sweepMat.uniforms.uTime.value = elapsedTime

      // Update sweep plane to face camera
      sweepMesh.lookAt(camera.position)

      // Animate markers - pulsing effect
      markers.forEach((marker, index) => {
        const pulseTime = (elapsedTime + marker.userData.pulseOffset) % 3
        const pulsePhase = Math.sin(pulseTime * Math.PI * 0.67) * 0.5 + 0.5
        const scale = marker.userData.baseScale * (1 + pulsePhase * 0.6)
        marker.scale.set(scale, scale, scale)
        marker.material.opacity = 0.6 + pulsePhase * 0.4

        // Trigger callout at peak of pulse
        if (pulsePhase > 0.95 && lastPulsedMarker !== index) {
          lastPulsedMarker = index
          showCallout(marker.userData.incident)
        }
      })

      // Reset pulse tracking
      if (markers.every((_, i) => i !== lastPulsedMarker)) {
        const currentPulsePhase = (elapsedTime + markers[lastPulsedMarker]?.userData.pulseOffset) % 3
        if (Math.sin(currentPulsePhase * Math.PI * 0.67) * 0.5 + 0.5 < 0.3) {
          lastPulsedMarker = null
        }
      }

      // Camera parallax
      camera.position.x += (mouseX - camera.position.x) * 0.015
      camera.position.y += (-mouseY - camera.position.y) * 0.015

      // Update uniforms
      earthMat.uniforms.uCameraPos.value.copy(camera.position)
      atmosMat.uniforms.uCameraPos.value.copy(camera.position)

      renderer.render(scene, camera)
    }

    animate()
    if (onLoadedRef.current) onLoadedRef.current()

    // Responsive resize handler
    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth || window.innerWidth
      const h = container.clientHeight || window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)

      if (w < 768) {
        camera.position.set(0, 0.20, 6.4)
        earthGroup.position.set(0, -3.50, 0)
      } else if (w < 1100) {
        camera.position.set(0, 0.10, 6.2)
        earthGroup.position.set(0, -3.40, 0)
      } else {
        camera.position.set(0, 0, 6.0)
        earthGroup.position.set(0, -3.35, 0)
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      cancelAnimationFrame(animFrameId)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', handleResize)

      if (calloutTimerRef.current) clearTimeout(calloutTimerRef.current)

      sphereGeo.dispose()
      earthMat.dispose()
      atmosGeo.dispose()
      atmosMat.dispose()
      starGeo.dispose()
      starMat.dispose()
      starTex.dispose()
      markerTexture.dispose()
      sweepGeo.dispose()
      sweepMat.dispose()

      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [showCallout])

  return (
    <>
      <div ref={mountRef} className="space-3d-canvas-container" style={{ cursor: 'crosshair' }} />
      {/* Data Callout Tooltip */}
      {activeCallout && (
        <div className="sar-callout">
          <div className="sar-callout-header">
            <span className="sar-callout-id">{activeCallout.id}</span>
            <span className={`sar-callout-status ${activeCallout.status.toLowerCase()}`}>
              {activeCallout.status}
            </span>
          </div>
          <div className="sar-callout-coords">
            {activeCallout.lat.toFixed(1)}°N {Math.abs(activeCallout.lon).toFixed(1)}°{activeCallout.lon > 0 ? 'E' : 'W'}
          </div>
          <div className="sar-callout-meta">
            <span>{activeCallout.area}</span>
            <span className="sar-callout-confidence">{activeCallout.confidence}% conf</span>
          </div>
        </div>
      )}
    </>
  )
}

const EarthBackground = React.memo(EarthBackgroundComponent)
export default EarthBackground
