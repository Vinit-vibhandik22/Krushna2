import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { gulfFleetFC } from '../data/gulfFleet.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// In MapLibre GL JS v6+, Vite requires explicit worker URL configuration
if (maplibregl.setWorkerUrl) {
  maplibregl.setWorkerUrl(workerUrl)
}

// Raster basemaps. MapLibre has no {s} subdomain token, so OSM is expanded into
// explicit per-subdomain URLs. maxzoom is each service's real limit — MapLibre
// overzooms (stretches) past it instead of showing blank tiles.
export const BASEMAPS = {
  dark: {
    name: 'Dark Maritime',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxzoom: 16,
  },
  ocean: {
    name: 'Ocean Topo',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri, GEBCO, NOAA, Garmin',
    maxzoom: 13,
  },
  satellite: {
    name: 'Satellite Imagery',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxzoom: 18,
  },
  osm: {
    name: 'OpenStreetMap',
    tiles: [
      'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
    ],
    attribution: '&copy; OpenStreetMap contributors',
    maxzoom: 19,
  },
}

const C = {
  abyss: '#0B1326', hull: '#171F33', line: '#334155',
  foam: '#DAE2FD', dim: '#86948A',
  amber: '#F59E0B', cyan: '#38BDF8', spill: '#EF4444', good: '#10B981',
}

// Gulf of Finland AOI. MapLibre takes [lon, lat] — the opposite of Leaflet.
const HOME = { center: [80.0, 16.0], zoom: 5 }

// Atmosphere. Alpha below 1 at low zoom lets the starfield behind the canvas
// show through, so the Earth reads as a planet in space, not a flat disc.
const SKY = {
  'sky-color': '#0A1832',
  'sky-horizon-blend': 0.6,
  'horizon-color': '#1E4E8C',
  'horizon-fog-blend': 0.55,
  'fog-color': '#0B1326',
  'fog-ground-blend': 0.1,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 5, 0.5, 7, 0],
}

const EMPTY = { type: 'FeatureCollection', features: [] }

// Overlay draw order, bottom → top. The basemap is re-inserted below the first
// of these that exists, so switching basemap never reshuffles the overlays.
const OVERLAY_ORDER = [
  'risk-fill', 'corridor-fill', 'slick-fill', 'slick-line', 'cone-line',
  'footprint-fill', 'footprint-line', 'drift-back', 'drift-fwd',
  'track-line', 'track-start', 'vessels', 'suspects',
]

function hydroCoord(lat, lon) {
  const f = (v, pos, neg) => {
    const d = Math.floor(Math.abs(v))
    const m = (Math.abs(v) - d) * 60
    return `${String(d).padStart(2, '0')}°${m.toFixed(1)}′${v >= 0 ? pos : neg}`
  }
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`
}

function escapeHtml(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Spinning the globe past the antimeridian pushes lon beyond ±180; wrap it back
// so the coordinate readout never reads 400°E.
const wrapLon = (lon) =>
  (lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180)

const fc = (features) => ({ type: 'FeatureCollection', features })

// MapLibre circle radii are in pixels, so a metric radius has to become a real
// polygon. Small-angle approximation is plenty at forecast-cone scales.
function circleRing(lon, lat, radiusKm, steps = 72) {
  const dLat = radiusKm / 110.574
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLon = radiusKm / (111.32 * Math.max(Math.abs(cosLat), 1e-6))
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2
    ring.push([lon + dLon * Math.cos(th), lat + dLat * Math.sin(th)])
  }
  return ring
}

const midpoint = (coords) =>
  coords && coords.length ? coords[Math.floor(coords.length / 2)] : null

function ringCentroid(ring) {
  if (!ring || !ring.length) return null
  // GeoJSON rings repeat the first vertex last; counting it twice drags the
  // label toward that corner.
  const first = ring[0]
  const last = ring[ring.length - 1]
  const pts = ring.length > 2 && last && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring
  let x = 0
  let y = 0
  for (const c of pts) {
    x += c[0]
    y += c[1]
  }
  return [x / pts.length, y / pts.length]
}

// The `background` layer paints the globe's surface (not the space around it),
// so it doubles as the deep-ocean fill while raster tiles stream in.
function buildStyle(bm) {
  return {
    version: 8,
    // glyphs for symbol text layers (ship-name labels)
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    projection: { type: 'globe' },
    sky: SKY,
    sources: {
      basemap: {
        type: 'raster',
        tiles: bm.tiles,
        tileSize: 256,
        minzoom: 0,
        maxzoom: bm.maxzoom ?? 18,
        attribution: bm.attribution,
      },
    },
    layers: [
      { id: 'globe-surface', type: 'background', paint: { 'background-color': C.abyss } },
      { id: 'basemap', type: 'raster', source: 'basemap' },
    ],
  }
}

// Every overlay is created once as an empty GeoJSON source; updates are pure
// setData() calls, which keeps the globe from rebuilding layers on each poll.
function addOverlays(map) {
  const src = (id) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
  }
  ;['s-risk', 's-slicks', 's-vessels', 's-cone', 's-footprint',
    's-back', 's-fwd', 's-track', 's-track-start', 's-suspects', 's-corridor', 's-gulf'].forEach(src)

  const layer = (def) => {
    if (!map.getLayer(def.id)) map.addLayer(def)
  }

  layer({
    id: 'risk-fill', type: 'fill', source: 's-risk',
    paint: { 'fill-color': C.amber, 'fill-opacity': ['get', 'o'] },
  })
  layer({
    id: 'slick-fill', type: 'fill', source: 's-slicks',
    paint: { 'fill-color': C.spill, 'fill-opacity': 0.35 },
  })
  layer({
    id: 'slick-line', type: 'line', source: 's-slicks',
    paint: { 'line-color': C.spill, 'line-width': 2, 'line-opacity': 0.95 },
  })
  layer({
    id: 'cone-line', type: 'line', source: 's-cone',
    paint: { 'line-color': C.cyan, 'line-width': 1, 'line-opacity': 0.4, 'line-dasharray': [2, 2] },
  })
  layer({
    id: 'footprint-fill', type: 'fill', source: 's-footprint',
    paint: { 'fill-color': C.spill, 'fill-opacity': 0.45 },
  })
  layer({
    id: 'footprint-line', type: 'line', source: 's-footprint',
    paint: { 'line-color': C.spill, 'line-width': 2.5, 'line-opacity': 1 },
  })
  layer({
    id: 'drift-back', type: 'line', source: 's-back',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': C.amber, 'line-width': 2.2, 'line-opacity': 0.9,
      'line-dasharray': [2, 2.5],
    },
  })

  layer({
    id: 'drift-fwd', type: 'line', source: 's-fwd',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': C.cyan, 'line-width': 2.2, 'line-opacity': 0.85,
      'line-dasharray': [3, 2],
    },
  })
  layer({
    id: 'track-line', type: 'line', source: 's-track',
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': C.amber, 'line-width': 2.5, 'line-opacity': 0.9,
      'line-dasharray': [2.5, 2],
    },
  })
  layer({
    id: 'track-start', type: 'circle', source: 's-track-start',
    paint: { 'circle-radius': 4, 'circle-color': C.amber, 'circle-opacity': 1 },
  })
  layer({
    id: 'vessels', type: 'circle', source: 's-vessels',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.4, 8, 3.8, 13, 6],
      'circle-color': C.good,
      'circle-opacity': 0.85,
      'circle-stroke-width': 1.5,
      // Nav status 15 = "undefined" in AIS; grey those hulls out.
      'circle-stroke-color': ['case', ['==', ['get', 'navStat'], 15], '#475569', C.good],
    },
  })

  // Suspects layer - colored by suspicion_level, radius scaled by total_score
  layer({
    id: 'suspects', type: 'circle', source: 's-suspects',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'total_score'], 0, 6, 100, 18],
      'circle-color': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#EF4444',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#F59E0B',
        '#10B981'
      ],
      'circle-opacity': 0.9,
      'circle-stroke-width': 2,
      'circle-stroke-color': ['case',
        ['==', ['get', 'is_dark_ship'], true], '#ffffff',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#7f1d1d',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#92400e',
        '#065f46'
      ],
      'circle-stroke-dasharray': ['case', ['==', ['get', 'is_dark_ship'], true], [4, 2], ['literal', []]],
    },
  })

  // 50-ship Gulf fleet: small neutral dots + name labels (demo ambience)
  layer({
    id: 'gulf-ships', type: 'circle', source: 's-gulf',
    layout: { 'visibility': 'none' },
    paint: {
      'circle-radius': 4,
      'circle-color': '#9AE6DF',
      'circle-opacity': 0.85,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#0B1326',
    },
  })
  layer({
    id: 'gulf-ship-labels', type: 'symbol', source: 's-gulf',
    layout: {
      'visibility': 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
    },
    paint: {
      'text-color': '#DAE2FD',
      'text-halo-color': '#05080A',
      'text-halo-width': 1.2,
    },
    minzoom: 7.5,
  })

  // Corridor layer - time-sliced backtrack polygons with hours_prior opacity
  layer({
    id: 'corridor-fill', type: 'fill', source: 's-corridor',
    paint: {
      'fill-color': C.amber,
      'fill-opacity': ['get', 'opacity'],
    },
  })
}

function getBoundsFromGeoJSON(fc) {
  if (!fc?.features?.length) return null
  const coords = []
  const extract = (g) => {
    if (!g) return
    if (g.type === 'Point') coords.push(g.coordinates)
    else if (g.type === 'LineString') coords.push(...g.coordinates)
    else if (g.type === 'Polygon') coords.push(...g.coordinates.flat())
    else if (g.type === 'MultiPolygon') coords.push(...g.coordinates.flat(2))
  }
  fc.features.forEach((f) => extract(f.geometry))
  if (!coords.length) return null
  const ok = coords.filter((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]))
  if (ok.length < 2) return null
  const b = new maplibregl.LngLatBounds(ok[0], ok[0])
  ok.forEach((c) => b.extend(c))
  return b
}

// --- Flow field animation utilities ----------------------------------------
function createFlowParticle(center, type, idx) {
  // Random seed within bbox around center (approx 0.8 degrees)
  const spread = 0.4
  const angle = Math.random() * Math.PI * 2
  const dist = Math.random() * spread
  const lon = center[0] + Math.cos(angle) * dist
  const lat = center[1] + Math.sin(angle) * dist * 0.7 // flatten for latitude
  const length = 0.08 + Math.random() * 0.05 // line length in degrees
  return {
    id: `${type}-${idx}`,
    type,
    lon,
    lat,
    length,
    progress: Math.random(), // 0-1 along the flow direction
    // curvature seed: each particle follows a slightly different arc, producing
    // swept schematic streamlines instead of straight darts
    curve: (Math.random() - 0.5) * 1.6,
    heading: null,
    trail: [],
  }
}

function stepFlowParticle(p, config, bbox) {
  const baseDir = (config[p.type].direction * Math.PI) / 180
  if (p.heading == null) p.heading = baseDir
  // ease heading back toward the base flow so curves stay coherent, while the
  // per-particle `curve` bias bends each path into an arc
  p.heading += p.curve * 0.06
  p.heading += (baseDir - p.heading) * 0.03
  const speed = config[p.type].speed
  const dx = Math.cos(p.heading) * speed
  const dy = Math.sin(p.heading) * speed

  p.lon += dx
  p.lat += dy

  // short trail so each stroke reads as a swept curve
  p.trail.push([p.lon, p.lat])
  if (p.trail.length > 14) p.trail.shift()

  // Wrap if outside bbox
  if (p.lon < bbox.minLng || p.lon > bbox.maxLng || p.lat < bbox.minLat || p.lat > bbox.maxLat) {
    const spread = 0.4
    const edge = Math.floor(Math.random() * 4) // 0=left, 1=right, 2=bottom, 3=top
    switch (edge) {
      case 0: // left edge, heading right
        p.lon = bbox.minLng + 0.02
        p.lat = bbox.minLat + Math.random() * (bbox.maxLat - bbox.minLat)
        break
      case 1: // right edge, heading left (but we keep flow dir, so come from opposite)
      default:
        p.lon = bbox.minLng + Math.random() * (bbox.maxLng - bbox.minLng)
        p.lat = bbox.minLat + 0.02
        break
    }
    p.trail = []
    p.heading = null
  }
  return p
}

function particleToFeature(p, config) {
  // Draw the particle's recent path as a smooth curved stroke: the trail is the
  // actual swept arc (heading rotates per step), so lines bow like schematic
  // flow imagery. Fallback stub while the trail warms up.
  let coords
  if (p.trail && p.trail.length > 2) {
    coords = [...p.trail, [p.lon, p.lat]]
  } else {
    const baseDir = (config[p.type].direction * Math.PI) / 180
    const dx = Math.cos(baseDir) * p.length
    const dy = Math.sin(baseDir) * p.length * 0.7
    coords = [[p.lon, p.lat], [p.lon + dx, p.lat + dy]]
  }
  const warm = Math.min((p.trail?.length || 0) / 14, 1)
  return {
    type: 'Feature',
    properties: {
      type: p.type,
      color: config[p.type].color,
      width: config[p.type].width,
      opacity: 0.15 + 0.55 * warm,
    },
    geometry: { type: 'LineString', coordinates: coords },
  }
}

function initFlowSourceAndLayers(map) {
  if (!map.getSource('s-flow')) {
    map.addSource('s-flow', { type: 'geojson', data: EMPTY })
  }
  if (!map.getLayer('flow-lines')) {
    map.addLayer({
      id: 'flow-lines',
      type: 'line',
      source: 's-flow',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': ['get', 'opacity'],
        'line-blur': 0.4,
      },
    })
  }
}

function computeFlowBbox(origin) {
  const spread = 0.55
  return {
    minLng: origin[0] - spread,
    maxLng: origin[0] + spread,
    minLat: origin[1] - spread * 0.7,
    maxLat: origin[1] + spread * 0.7,
  }
}

export default function MapView({
  vessels,
  slicks,
  detail,
  vesselMmsi,
  riskOn,
  riskData,
  showVessels,
  basemapKey,
  projection = 'globe',
  leftPanelOpen,
  rightPanelOpen,
  onSelectSlick,
  onSelectVessel,
  demoDetection,
  flowOn = false,
  flowOrigin = null,
  demoCorridor = null,
  demoOrigin = null,
  demoSuspects = null,
  demoStage = 'idle',
}) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const popupRef = useRef(null)
  const labelsRef = useRef([])
  const pendingFocusRef = useRef(null)

  // Latest props mirrored into a ref so the one-shot map effect and the async
  // style-load callback always render the current data, whatever order they run.
  const dataRef = useRef({
    vessels: null, slicks: [], detail: null,
    riskOn: false, riskData: null, showVessels: true, track: null,
  })
  dataRef.current.vessels = vessels
  dataRef.current.slicks = slicks
  dataRef.current.detail = detail
  dataRef.current.riskOn = riskOn
  dataRef.current.riskData = riskData
  dataRef.current.showVessels = showVessels

  const cbRef = useRef({ onSelectSlick, onSelectVessel })
  cbRef.current = { onSelectSlick, onSelectVessel }

  const projRef = useRef(projection)
  projRef.current = projection

  // Flow field animation refs
  const flowRafRef = useRef(null)
  const flowLastFrameRef = useRef(0)
  const flowParticlesRef = useRef([])
  const flowBboxRef = useRef(null)
  const flowConfigRef = useRef({
    // Water current: cyan, slower
    current: { speed: 0.00008, direction: 45, color: '#38BDF8', width: 1.2 },
    // Wind: amber, faster, slightly different bearing
    wind: { speed: 0.00025, direction: 65, color: '#F59E0B', width: 1.5 },
  })

  // Corridor time-slice state
  const [corridorHours, setCorridorHours] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [legendOpen, setLegendOpen] = useState(true)
  const corridorRafRef = useRef(null)
  const corridorMaxHours = useRef(26)

  // MapLibre has no glyph server configured here, so the "always on" analysis
  // labels are HTML markers rather than symbol layers.
  const clearLabels = () => {
    labelsRef.current.forEach((m) => m.remove())
    labelsRef.current = []
  }

  const addLabel = (map, lngLat, text, anchor = 'left') => {
    if (!lngLat || !Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) return
    const el = document.createElement('div')
    el.className = 'map-label'
    el.textContent = text
    labelsRef.current.push(
      new maplibregl.Marker({ element: el, anchor }).setLngLat(lngLat).addTo(map)
    )
  }

  const addOriginMarker = (map, lngLat, sigmaKm) => {
    const el = document.createElement('div')
    el.className = 'origin-marker'
    el.innerHTML = '<span></span><span></span><span></span>'
    labelsRef.current.push(
      new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map)
    )
    addLabel(map, lngLat, `Estimated Release Point (σ ≈ ${sigmaKm.toFixed(1)} km)`, 'bottom')
  }

  const applyData = useCallback(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const d = dataRef.current
    const setSrc = (id, data) => {
      const s = map.getSource(id)
      if (s) s.setData(data)
    }

    // Spill-risk grid: features are already GeoJSON polygons, so only the
    // per-cell opacity needs deriving.
    let risk = []
    if (d.riskOn && d.riskData?.features?.length) {
      const ps = d.riskData.features.map((f) => f.properties.p)
      const pMin = Math.min(...ps)
      const span = Math.max(Math.max(...ps) - pMin, 1e-6)
      risk = d.riskData.features.map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: { p: f.properties.p, o: 0.05 + 0.55 * ((f.properties.p - pMin) / span) },
      }))
    }
    setSrc('s-risk', fc(risk))

    const slickFeatures = (d.slicks || [])
      .map((s) => {
        const geom = s.geometry?.geometry || s.geometry
        if (!geom || !geom.coordinates) return null
        return {
          type: 'Feature',
          geometry: geom,
          properties: { id: s.id, area_km2: s.area_km2 },
        }
      })
      .filter(Boolean)

    setSrc('s-slicks', fc(slickFeatures))

    // /api/vessels/live is already a GeoJSON FeatureCollection of points.
    setSrc('s-vessels', fc(
      d.showVessels && d.vessels?.features ? d.vessels.features : []
    ))

    clearLabels()

    // --- selected slick: hindcast, forecast, cone, footprint, origin ---------
    const back = []
    const fwd = []
    const cone = []
    const foot = []
    const det = d.detail
    if (det) {
      const bw = det.backward
      const fw = det.forward

      // centroid_path entries arrive as [lon, lat] — already MapLibre's order.
      const bwPts = (bw?.path?.centroid_path || []).filter((p) => p?.[0] != null)
      if (bwPts.length > 1) {
        const coords = bwPts.map((p) => [p[0], p[1]])
        back.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
        addLabel(map, midpoint(coords), 'Backward Drift Hindcast', 'left')
      } else if (bw && bw.origin_lon != null && det.centroid_lon != null) {
        const coords = [[det.centroid_lon, det.centroid_lat], [bw.origin_lon, bw.origin_lat]]
        back.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
        addLabel(map, midpoint(coords), 'Backward Drift Hindcast', 'left')
      }

      const fwPts = (fw?.path?.centroid_path || []).filter((p) => p?.[0] != null)
      if (fwPts.length > 1) {
        const coords = fwPts.map((p) => [p[0], p[1]])
        fwd.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
        addLabel(map, midpoint(coords), 'Forward Forecast', 'left')
      } else if (fwPts.length === 1 && det.centroid_lon != null && (fw?.cone?.length)) {
        const lastCone = fw.cone[fw.cone.length - 1]
        if (lastCone?.lon != null) {
          const coords = [[det.centroid_lon, det.centroid_lat], [lastCone.lon, lastCone.lat]]
          fwd.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
          addLabel(map, midpoint(coords), 'Forward Forecast', 'left')
        }
      }

      const coneList = (fw?.cone || []).filter((k) => k.lon != null)
      coneList.forEach((c, idx) => {
        // Space out circles every 3 hours plus final forecast horizon for a clean presentation
        if (idx % 3 === 2 || idx === coneList.length - 1 || idx === 0) {
          cone.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [circleRing(c.lon, c.lat, c.radius_km)] },
          })
        }
      })

      const geom = det.geometry?.geometry
      if (geom?.coordinates?.length) {
        foot.push({ type: 'Feature', properties: {}, geometry: geom })
        const ring = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0]
        addLabel(map, ringCentroid(ring), 'Detected Slick Footprint (Sentinel-1)', 'bottom')
      }

      if (bw && bw.origin_lon != null) {
        addOriginMarker(map, [bw.origin_lon, bw.origin_lat], bw.origin_sigma_km ?? 0)
      }
    }
    setSrc('s-back', fc(back))
    setSrc('s-fwd', fc(fwd))
    setSrc('s-cone', fc(cone))
    setSrc('s-footprint', fc(foot))

    // --- AIS track of the selected vessel -----------------------------------
    const tr = d.track
    const pts = (tr?.points || []).filter((p) => p?.[0] != null)
    if (pts.length > 1) {
      const coords = pts.map((p) => [p[0], p[1]])
      setSrc('s-track', fc([
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      ]))
      setSrc('s-track-start', fc([
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[0] } },
      ]))

      // Where the vessel was at the estimated release time.
      if (tr.highlight_ts != null) {
        let best = null
        for (const p of pts) {
          if (!best || Math.abs(p[2] - tr.highlight_ts) < Math.abs(best[2] - tr.highlight_ts)) best = p
        }
        if (best) {
          const t = new Date(tr.highlight_ts * 1000)
          const hhmm = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} UTC`
          const el = document.createElement('div')
          el.className = 'at-release'
          el.innerHTML = `<span class="at-dot"></span><span class="at-lbl mono">${escapeHtml(tr.name || `MMSI ${tr.mmsi}`)} · at release ${hhmm}</span>`
          labelsRef.current.push(
            new maplibregl.Marker({ element: el, anchor: 'left' })
              .setLngLat([best[0], best[1]]).addTo(map)
          )
        }
      }
    } else {
      setSrc('s-track', EMPTY)
      setSrc('s-track-start', EMPTY)
    }
  }, [])

  // --- camera --------------------------------------------------------------
  const fitCoords = (coords, maxZoom = 12, padding = 60) => {
    const map = mapRef.current
    const ok = coords.filter((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]))
    if (!map || ok.length < 2) return
    const b = new maplibregl.LngLatBounds(ok[0], ok[0])
    ok.forEach((c) => b.extend(c))
    map.fitBounds(b, { padding, maxZoom, duration: 1200 })
  }

  const focusDetail = useCallback(() => {
    const det = dataRef.current.detail
    if (!det) return
    const coords = []
    for (const p of det.backward?.path?.centroid_path || []) {
      if (p?.[0] != null) coords.push([p[0], p[1]])
    }
    const geom = det.geometry?.geometry
    if (geom?.coordinates?.length) {
      const ring = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0]
      for (const c of ring) coords.push([c[0], c[1]])
    }
    for (const c of (det.forward?.cone || []).filter((k) => k.lon != null).slice(-1)) {
      coords.push([c.lon, c.lat])
    }
    fitCoords(coords, 12, 60)
  }, [])

  const focusTrack = useCallback((tr) => {
    const map = mapRef.current
    const pts = (tr?.points || []).filter((p) => p?.[0] != null)
    if (!map || !pts.length) return
    if (tr.highlight_ts != null) {
      let best = null
      for (const p of pts) {
        if (!best || Math.abs(p[2] - tr.highlight_ts) < Math.abs(best[2] - tr.highlight_ts)) best = p
      }
      if (best) {
        map.flyTo({ center: [best[0], best[1]], zoom: 10, duration: 1200 })
        return
      }
    }
    fitCoords(pts.map((p) => [p[0], p[1]]), 11, 40)
  }, [])

  // --- map init (once) ------------------------------------------------------
  useEffect(() => {
    const bm = BASEMAPS[basemapKey] || BASEMAPS.dark
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: buildStyle(bm),
      center: HOME.center,
      zoom: HOME.zoom,
      minZoom: 1,
      maxZoom: 18,
      maxPitch: 85,
      // Single continuous world / seamless 3D globe (no duplicate repeating tiles)
      renderWorldCopies: false,
      // Placed manually below so it never stacks under the nav control.
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    })
    mapRef.current = map
    window.__map = map

    // one-shot source writer for click handlers inside this effect scope
    const setSrc2 = (id, data) => {
      const s = map.getSource(id)
      if (s) s.setData({ type: 'FeatureCollection', features: [data] })
    }

    // Zoom, compass (drag to rotate) and a pitch indicator for the 3D camera.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

    const popup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 12,
      className: 'hud-popup', maxWidth: '260px',
    })
    popupRef.current = popup

    const onReady = () => {
      if (readyRef.current) return
      readyRef.current = true
      try {
        map.setProjection({ type: projRef.current === 'flat' ? 'mercator' : 'globe' })
      } catch { /* projection unsupported — falls back to mercator */ }
      try {
        map.setSky(SKY)
      } catch { /* sky unsupported — globe still renders */ }
      addOverlays(map)
      applyData()
      if (pendingFocusRef.current) {
        pendingFocusRef.current()
        pendingFocusRef.current = null
      }
    }
    map.on('load', onReady)
    // v6 guard: 'load' can be missed when the style finishes before handlers
    // attach; 'idle' fires after the first full render either way.
    map.once('idle', onReady)

    map.on('error', (e) => {
      // Tile 404s are routine at the edges of a service's zoom range.
      if (e?.error?.status === 404) return
      console.warn('MapLibre:', e?.error?.message || e)
    })

    // --- hover readouts (Leaflet tooltips → a single shared popup) ----------
    const HOVER = [
      ['vessels', (p) => `${escapeHtml(p.name || `MMSI ${p.mmsi}`)} · ${Math.round(p.sog ?? 0)} kn`],
      ['slick-fill', (p) => `Slick #${escapeHtml(p.id)} · ${escapeHtml(p.area_km2)} km²`],
      ['risk-fill', (p) => `Spill risk ${(Number(p.p) * 100).toFixed(0)}%`],
      ['suspects', (p) => `${escapeHtml(p.vessel_name || `MMSI ${p.mmsi}`)} · Score: ${p.total_score}% · ${p.suspicion_level}`],
      ['gulf-ships', (p) => `${escapeHtml(p.name)} · ${escapeHtml(p.type || 'OSV')} · ${Math.round(p.sog ?? 0)} kn`],
    ]
    HOVER.forEach(([id, fmt]) => {
      map.on('mousemove', id, (e) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = id === 'risk-fill' ? '' : 'pointer'
        popup.setLngLat(e.lngLat).setHTML(fmt(f.properties)).addTo(map)
      })
      map.on('mouseleave', id, () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })
    })

    const onVesselClick = (e) => {
      const p = e.features?.[0]?.properties
      if (p) cbRef.current.onSelectVessel(p.mmsi)
    }
    const onSlickClick = (e) => {
      const p = e.features?.[0]?.properties
      if (p) cbRef.current.onSelectSlick(p.id)
    }
    const onSuspectClick = (e) => {
      const f = e.features?.[0]
      const p = f?.properties
      if (p) {
        // geometry (not properties) carries the coordinates
        const c = f.geometry?.coordinates
        const lon = p.lon || p.longitude || c?.[0]
        const lat = p.lat || p.latitude || c?.[1]
        // Dispatch fly-to event for suspect vessel
        if (lon != null && lat != null) {
          window.dispatchEvent(new CustomEvent('fly-to', { detail: { lon, lat } }))
          // Drop a visible placemarker at the suspect so the click has an
          // unmistakable on-map result
          setSrc2('s-track-start', {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [lon, lat] },
          })
          clearLabels()
          addLabel(map, [lon, lat + 0.05], `Suspect: ${p.vessel_name || `MMSI ${p.mmsi}`}`, 'top')
        }
        // Also select the vessel if MMSI available
        if (p.mmsi) cbRef.current.onSelectVessel(p.mmsi)
      }
    }
    map.on('click', 'vessels', onVesselClick)
    map.on('click', 'slick-fill', onSlickClick)
    map.on('click', 'suspects', onSuspectClick)
    map.on('click', 'gulf-ships', (e) => {
      const f = e.features?.[0]
      const p = f?.properties
      const c = f?.geometry?.coordinates
      if (p && c) {
        setSrc2('s-track-start', {
          type: 'Feature', properties: {},
          geometry: { type: 'Point', coordinates: c },
        })
        clearLabels()
        addLabel(map, [c[0], c[1] + 0.05], `Suspect: ${p.name}`, 'top')
        window.dispatchEvent(new CustomEvent('fly-to', { detail: { lon: c[0], lat: c[1] } }))
      }
    })

    // --- coordinate readout -------------------------------------------------
    const strip = document.getElementById('coord-strip')
    map.on('mousemove', (e) => {
      if (!strip) return
      const lat = e.lngLat?.lat
      const lng = e.lngLat?.lng
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        strip.textContent = hydroCoord(lat, wrapLon(lng))
      }
    })
    map.on('mouseout', () => {
      if (strip) strip.textContent = '—′ —′'
    })

    // --- app-level events ---------------------------------------------------
    const onTrack = (e) => {
      dataRef.current.track = e.detail
      applyData()
      if (readyRef.current) focusTrack(e.detail)
      else pendingFocusRef.current = () => focusTrack(e.detail)
    }
    const onFly = (e) => {
      map.flyTo({ center: [e.detail.lon, e.detail.lat], zoom: 10, duration: 1400 })
    }
    const onReset = () => {
      map.flyTo({
        center: HOME.center, zoom: HOME.zoom,
        pitch: 0, bearing: 0, duration: 1200,
      })
    }
    window.addEventListener('vessel-track', onTrack)
    window.addEventListener('fly-to', onFly)
    window.addEventListener('reset-map-view', onReset)

    return () => {
      window.removeEventListener('vessel-track', onTrack)
      window.removeEventListener('fly-to', onFly)
      window.removeEventListener('reset-map-view', onReset)
      clearLabels()
      popup.remove()
      readyRef.current = false
      mapRef.current = null
      map.remove()
    }
    // Basemap and projection are read once here; their own effects handle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- basemap swap: replace only the raster layer, leave overlays alone -----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const bm = BASEMAPS[basemapKey] || BASEMAPS.dark
    const below = OVERLAY_ORDER.find((id) => map.getLayer(id))
    if (map.getLayer('basemap')) map.removeLayer('basemap')
    if (map.getSource('basemap')) map.removeSource('basemap')
    map.addSource('basemap', {
      type: 'raster',
      tiles: bm.tiles,
      tileSize: 256,
      minzoom: 0,
      maxzoom: bm.maxzoom ?? 18,
      attribution: bm.attribution,
    })
    map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, below)
  }, [basemapKey])

  // --- 3D globe ⇄ flat mercator ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    try {
      map.setProjection({ type: projection === 'flat' ? 'mercator' : 'globe' })
      if (projection === 'flat') {
        map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
      }
    } catch { /* older build without globe support */ }
  }, [projection])

  useEffect(() => {
    applyData()
  }, [vessels, showVessels, slicks, riskOn, riskData, applyData])

  // Demo flow: inject pre-run detection GeoJSON and fly to its bounds
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-slicks')
    if (!demoDetection) return

    // Feed to s-slicks source (same layer rendering as live polling)
    src?.setData(demoDetection)

    // Fly to detection bounds with padding
    const bounds = getBoundsFromGeoJSON(demoDetection)
    if (bounds) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 1200 })
    }
  }, [demoDetection])

  useEffect(() => {
    applyData()
    if (!detail) return
    if (readyRef.current) focusDetail()
    else pendingFocusRef.current = focusDetail
  }, [detail, applyData, focusDetail])

  // --- Flow field animation effect -------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    // Parse orientation from flowOrigin if available, else use defaults
    const orientationDeg = flowOrigin?.orientation_deg ?? null
    if (orientationDeg != null) {
      flowConfigRef.current.current.direction = (orientationDeg + 180) % 360 // opposite (source direction)
      flowConfigRef.current.wind.direction = (orientationDeg + 20) % 360 // slight offset
    }

    const origin = flowOrigin ? [flowOrigin.lon, flowOrigin.lat] : null

    if (!flowOn || !origin) {
      // Cleanup: stop animation and clear data
      if (flowRafRef.current) {
        cancelAnimationFrame(flowRafRef.current)
        flowRafRef.current = null
      }
      const s = map.getSource('s-flow')
      if (s) s.setData(EMPTY)
      return
    }

    // Initialize source/layers once
    initFlowSourceAndLayers(map)

    // Set up bbox and particles
    flowBboxRef.current = computeFlowBbox(origin)
    const particles = []
    for (let i = 0; i < 80; i++) particles.push(createFlowParticle(origin, 'current', i))
    for (let i = 0; i < 40; i++) particles.push(createFlowParticle(origin, 'wind', i + 80))
    flowParticlesRef.current = particles

    const step = (ts) => {
      const map = mapRef.current
      if (!map || !flowOn) return

      // Throttle to ~30fps (33ms between frames)
      if (ts - flowLastFrameRef.current < 33) {
        flowRafRef.current = requestAnimationFrame(step)
        return
      }
      flowLastFrameRef.current = ts

      const cfg = flowConfigRef.current
      const bbox = flowBboxRef.current
      const parts = flowParticlesRef.current

      for (const p of parts) {
        stepFlowParticle(p, cfg, bbox)
      }

      const s = map.getSource('s-flow')
      if (s) {
        s.setData({ type: 'FeatureCollection', features: parts.map((p) => particleToFeature(p, cfg)) })
      }

      flowRafRef.current = requestAnimationFrame(step)
    }

    flowRafRef.current = requestAnimationFrame(step)

    return () => {
      if (flowRafRef.current) {
        cancelAnimationFrame(flowRafRef.current)
        flowRafRef.current = null
      }
    }
  }, [flowOn, flowOrigin])

  // --- Corridor time-slice animation -----------------------------------------
  // Reset playback position whenever a new demo scenario arrives so the
  // backtrack animation always replays from 0h.
  useEffect(() => {
    setCorridorHours(0)
    setIsPlaying(false)
  }, [demoCorridor])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!demoCorridor?.features?.length) return

    // Compute max hours from corridor data
    const allHours = demoCorridor.features
      .map(f => f.properties?.hours_prior)
      .filter(h => h != null)
    if (allHours.length) {
      corridorMaxHours.current = Math.max(...allHours)
    }

    // Filter features by current slider value with opacity based on age
    const filtered = demoCorridor.features.filter(f => {
      const h = f.properties?.hours_prior ?? 0
      return h <= corridorHours
    }).map(f => {
      const h = f.properties?.hours_prior ?? 0
      // Older = more transparent; 0 hours = 0.5 opacity, max hours = 0.1
      const opacity = 0.5 - (h / corridorMaxHours.current) * 0.4
      return {
        ...f,
        properties: { ...f.properties, opacity: Math.max(0.1, opacity) }
      }
    })

    // Update corridor source
    const src = map.getSource('s-corridor')
    if (src) {
      src.setData({ type: 'FeatureCollection', features: filtered })
    }

    // Generate simple forward forecast cone by mirroring corridor direction
    if (demoOrigin?.primary_centroid) {
      const originLon = demoOrigin.primary_centroid.longitude
      const originLat = demoOrigin.primary_centroid.latitude
      // Create a forward cone of ~12 hours
      const fwdFeatures = []
      const centroidPath = demoCorridor.features
        .filter(f => f.properties?.centroid_longitude && f.properties?.centroid_latitude)
        .sort((a, b) => (b.properties?.hours_prior ?? 0) - (a.properties?.hours_prior ?? 0))

      if (centroidPath.length >= 2) {
        // Get direction from newest to oldest
        const newest = centroidPath[0]
        const oldest = centroidPath[centroidPath.length - 1]
        const dx = newest.properties.centroid_longitude - oldest.properties.centroid_longitude
        const dy = newest.properties.centroid_latitude - oldest.properties.centroid_latitude
        const dirRad = Math.atan2(dy, dx)

        // Generate forward cone circles (cyan)
        for (let i = 1; i <= 4; i++) {
          const distKm = i * 15 // 15km increments
          const spreadKm = i * 8 // widening spread
          fwdFeatures.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [circleRing(originLon, originLat, spreadKm)] },
          })
        }
      }

      const fwdSrc = map.getSource('s-fwd')
      if (fwdSrc && fwdFeatures.length) {
        fwdSrc.setData({ type: 'FeatureCollection', features: fwdFeatures })
      }

      // Add origin marker if corridor shows max hours
      if (corridorHours >= corridorMaxHours.current * 0.9) {
        clearLabels()
        addOriginMarker(map, [originLon, originLat], 5)
        addLabel(map, [originLon, originLat + 0.05], 'Estimated Release Origin', 'bottom')
      }
    }
  }, [demoCorridor, corridorHours, demoOrigin])

  // --- Suspects layer -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-suspects')
    if (!src) return
    if (demoSuspects?.features?.length) {
      src.setData(demoSuspects)
    } else {
      src.setData(EMPTY)
    }
  }, [demoSuspects])

  // --- Gulf fleet ambience layer: 50 named ships during the demo ------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-gulf')
    if (!src) return
    const demoActive = demoStage !== 'idle' && demoStage !== 'processing' && demoStage !== 'awaiting-upload'
    src.setData(demoActive ? gulfFleetFC() : EMPTY)
    const vis = demoActive ? 'visible' : 'none'
    for (const id of ['gulf-ships', 'gulf-ship-labels']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    }
    if (demoStage === 'idle' || demoStage === 'processing' || demoStage === 'awaiting-upload') {
      // clear any stale suspect placemarker from a previous run
      const ts = map.getSource('s-track-start')
      if (ts) ts.setData(EMPTY)
    }
  }, [demoStage, demoSuspects])

  // Auto-start the backtrack playback when the demo reaches that stage
  useEffect(() => {
    if (demoStage === 'backtrack' && !isPlaying) setIsPlaying(true)
    if ((demoStage === 'idle' || demoStage === 'processing') && isPlaying) {
      setIsPlaying(false)
      setCorridorHours(0)
    }
  }, [demoStage])  // eslint-disable-line react-hooks/exhaustive-deps

  // Playback animation
  useEffect(() => {
    if (!isPlaying) {
      if (corridorRafRef.current) {
        cancelAnimationFrame(corridorRafRef.current)
        corridorRafRef.current = null
      }
      return
    }

    let lastTime = performance.now()
    const step = (now) => {
      if (!isPlaying) return
      const delta = now - lastTime
      if (delta > 200) { // Update every 200ms = 5 steps per second
        lastTime = now
        setCorridorHours(h => {
          const next = h + 1
          if (next > corridorMaxHours.current) {
            setIsPlaying(false)
            return corridorMaxHours.current
          }
          return next
        })
      }
      corridorRafRef.current = requestAnimationFrame(step)
    }
    corridorRafRef.current = requestAnimationFrame(step)

    return () => {
      if (corridorRafRef.current) {
        cancelAnimationFrame(corridorRafRef.current)
        corridorRafRef.current = null
      }
    }
  }, [isPlaying])

  return (
    <div className={`map-wrap ${rightPanelOpen ? 'dock-r-open' : 'dock-r-closed'}`}>
      {/* Deep space + stars, visible through the translucent atmosphere */}
      <div className="space-backdrop" aria-hidden="true" />
      <div ref={boxRef} className="map" />

      {/* Floating Chart Legend (smoothly offsets when left intelligence dock opens) */}
      <div className={`map-legend ${legendOpen ? 'legend-open' : 'legend-collapsed'} ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`}>
        <button
          className="legend-toggle"
          onClick={() => setLegendOpen(v => !v)}
          title={legendOpen ? 'Hide layer key' : 'Show layer key'}
          aria-expanded={legendOpen}>
          {legendOpen ? '▾' : '▸'}
        </button>
        {legendOpen && (
          <div className="legend-body">
            <div className="lg-title">GIS LAYER KEY</div>
            <div><span className="sw slick" /> Detected Slick (Sentinel-1 SAR)</div>
            <div><span className="sw origin" /> Estimated Release Origin</div>
            <div><span className="sw back" /> Backward Drift Hindcast</div>
            <div><span className="sw fwd" /> Forward Forecast Cone</div>
            <div><span className="sw ais" /> Live AIS Vessel Target</div>
            <div><span className="sw suspect" /> Ranked Suspect Vessel</div>
          </div>
        )}
      </div>

      {riskOn && (
        <div className={`risk-legend ${rightPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <span>SPILL RISK</span>
          <span className="ramp" aria-hidden="true" />
          <span className="mono">LOW → HIGH</span>
        </div>
      )}

      {flowOn && flowOrigin && (
        <div className={`flow-legend ${rightPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <div className="fl-row">
            <span className="fl-arrow" style={{ transform: `rotate(${flowConfigRef.current.current.direction}deg)`, color: '#38BDF8' }}>↑</span>
            <span className="fl-label">Current 0.4 m/s</span>
          </div>
          <div className="fl-row">
            <span className="fl-arrow" style={{ transform: `rotate(${flowConfigRef.current.wind.direction}deg)`, color: '#F59E0B' }}>↑</span>
            <span className="fl-label">Wind 6 m/s</span>
          </div>
        </div>
      )}

      {/* Corridor Time Slider UI */}
      {demoCorridor && (
        <div className={`corridor-controls ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <div className="corridor-header">
            <span className="corridor-title">Slide pointer forward to forecast, behind to backtrack</span>
            <span className="corridor-hours mono">{corridorHours.toFixed(0)}h / {corridorMaxHours.current}h</span>
          </div>
          <input
            type="range"
            className="corridor-slider"
            min={0}
            max={corridorMaxHours.current}
            step={1}
            value={corridorHours}
            onChange={(e) => {
              setCorridorHours(Number(e.target.value))
              setIsPlaying(false)
            }}
          />
          <button
            className="corridor-play-btn"
            onClick={() => setIsPlaying(p => !p)}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
        </div>
      )}

      {/* Origin Verdict Banner */}
      {demoOrigin?.primary_centroid && corridorHours >= corridorMaxHours.current * 0.9 && (
        <div className={`origin-verdict ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <div className="verdict-title">Estimated Origin</div>
          <div className="verdict-detail">
            {demoOrigin.time_window_utc?.confidence || demoOrigin.confidence || 'medium'} confidence
            {' — '}
            {demoOrigin.time_window_utc?.hours_prior_min ?? 18}–
            {demoOrigin.time_window_utc?.hours_prior_max ?? 24}h before detection
          </div>
        </div>
      )}

      <div className={`coord-strip mono ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`} id="coord-strip">
        59°54.0′N 025°18.0′E
      </div>
    </div>
  )
}
