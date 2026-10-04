import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
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

// Primary surveillance AOI (Mississippi Canyon / Gulf of Mexico). MapLibre takes [lon, lat].
const HOME = { center: [-88.97, 28.93], zoom: 10.5 }

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
  'risk-fill', 'pipelines-glow', 'pipelines-line', 'pipelines-culprit',
  'corridor-fill', 'slick-fill', 'slick-line', 'cone-line',
  'footprint-fill', 'footprint-line', 'drift-back', 'drift-fwd',
  'candidate-tracks-glow', 'candidate-tracks',
  'track-line', 'track-start', 'vessels', 'suspects-halo', 'suspects',
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
    's-back', 's-fwd', 's-candidate-tracks', 's-track', 's-track-start', 's-suspects', 's-corridor', 's-pipelines'].forEach(src)

  const layer = (def) => {
    if (!map.getLayer(def.id)) map.addLayer(def)
  }

  layer({
    id: 'risk-fill', type: 'fill', source: 's-risk',
    paint: { 'fill-color': C.amber, 'fill-opacity': ['get', 'o'] },
  })

  // Pipelines underglow
  layer({
    id: 'pipelines-glow', type: 'line', source: 's-pipelines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'is_culprit'], true], '#FF3B30', '#00E5FF'],
      'line-width': ['case', ['==', ['get', 'is_culprit'], true], 8, 3.5],
      'line-opacity': ['case', ['==', ['get', 'is_culprit'], true], 0.45, 0.18],
      'line-blur': 2,
    },
  })

  // Pipelines base line
  layer({
    id: 'pipelines-line', type: 'line', source: 's-pipelines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case',
        ['==', ['get', 'is_culprit'], true], '#FF3B30',
        ['==', ['get', 'product'], 'GAS'], '#38BDF8',
        '#00E5FF'
      ],
      'line-width': ['case', ['==', ['get', 'is_culprit'], true], 3.2, 1.4],
      'line-opacity': ['case', ['==', ['get', 'is_culprit'], true], 1.0, 0.75],
    },
  })

  // Ruptured culprit pipeline highlight
  layer({
    id: 'pipelines-culprit', type: 'line', source: 's-pipelines',
    filter: ['==', ['get', 'is_culprit'], true],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#FF3B30',
      'line-width': 4.5,
      'line-opacity': 1.0,
    },
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

  // Candidate vessel 18-hour historical transit tracks
  layer({
    id: 'candidate-tracks-glow', type: 'line', source: 's-candidate-tracks',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#EF4444',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#F59E0B',
        '#64748B'
      ],
      'line-width': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], 5,
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], 3.5,
        2
      ],
      'line-opacity': 0.28,
      'line-blur': 1.5,
    },
  })

  layer({
    id: 'candidate-tracks', type: 'line', source: 's-candidate-tracks',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#EF4444',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#F59E0B',
        '#94A3B8'
      ],
      'line-width': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], 2.4,
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], 1.8,
        1.2
      ],
      'line-opacity': 0.85,
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

  // Suspects outer halo / glow layer
  layer({
    id: 'suspects-halo', type: 'circle', source: 's-suspects',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'total_score'], 0, 10, 50, 16, 100, 26],
      'circle-color': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#EF4444',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#F59E0B',
        '#10B981'
      ],
      'circle-opacity': 0.35,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#EF4444',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#F59E0B',
        '#10B981'
      ],
      'circle-stroke-opacity': 0.7,
    },
  })

  // Suspects core marker layer - colored by suspicion_level, radius scaled by total_score
  layer({
    id: 'suspects', type: 'circle', source: 's-suspects',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'total_score'], 0, 5, 50, 8, 100, 14],
      'circle-color': ['case',
        ['==', ['get', 'suspicion_level'], 'HIGH'], '#EF4444',
        ['==', ['get', 'suspicion_level'], 'MEDIUM'], '#F59E0B',
        '#10B981'
      ],
      'circle-opacity': 0.95,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
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
  if (!fc) return null
  const features = fc.features || (fc.geometry ? [fc] : null)
  if (!features?.length) return null
  const coords = []
  const extract = (g) => {
    if (!g) return
    if (g.type === 'Point') coords.push(g.coordinates)
    else if (g.type === 'LineString') coords.push(...g.coordinates)
    else if (g.type === 'Polygon') coords.push(...g.coordinates.flat())
    else if (g.type === 'MultiPolygon') coords.push(...g.coordinates.flat(2))
  }
  features.forEach((f) => extract(f.geometry || f))
  if (!coords.length) return null
  const ok = coords.filter((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]))
  if (ok.length < 2) return null
  const b = new maplibregl.LngLatBounds(ok[0], ok[0])
  ok.forEach((c) => b.extend(c))
  return b
}

// --- Flow field animation utilities (Copernicus CMEMS & NOAA Data-Driven) ---
// Bilinear spatial interpolation of 2D velocity field from real met-ocean grid
function sampleMetVector(lon, lat, type, metVectors, fallbackConfig) {
  if (!metVectors || !metVectors.grid || !metVectors.metadata) {
    const fallback = fallbackConfig?.[type] || { direction: 45, speed: 0.0001 }
    const rad = ((fallback.direction || 0) * Math.PI) / 180
    return {
      u: Math.cos(rad) * 2.0,
      v: Math.sin(rad) * 2.0,
      speed_ms: 2.0,
      dir_deg: fallback.direction || 0,
      waveHeight: 1.0,
      waveDir: 100,
    }
  }

  const { lons, lats, grid_dims } = metVectors.metadata
  const [nx] = grid_dims
  const minLon = lons[0]
  const maxLon = lons[lons.length - 1]
  const minLat = lats[0]
  const maxLat = lats[lats.length - 1]

  // Clamp coordinates within grid domain bounds
  const cLon = Math.max(minLon, Math.min(maxLon, lon))
  const cLat = Math.max(minLat, Math.min(maxLat, lat))

  // Find bounding cell index [i, j]
  let i = 0
  while (i < lons.length - 2 && cLon > lons[i + 1]) i++
  let j = 0
  while (j < lats.length - 2 && cLat > lats[j + 1]) j++

  const lon0 = lons[i], lon1 = lons[i + 1]
  const lat0 = lats[j], lat1 = lats[j + 1]

  const tx = lon1 > lon0 ? (cLon - lon0) / (lon1 - lon0) : 0
  const ty = lat1 > lat0 ? (cLat - lat0) / (lat1 - lat0) : 0

  const cell00 = metVectors.grid[j * nx + i]
  const cell10 = metVectors.grid[j * nx + (i + 1)]
  const cell01 = metVectors.grid[(j + 1) * nx + i]
  const cell11 = metVectors.grid[(j + 1) * nx + (i + 1)]

  if (!cell00 || !cell10 || !cell01 || !cell11) {
    return { u: 0, v: 0, speed_ms: 0, dir_deg: 0, waveHeight: 1.0, waveDir: 100 }
  }

  const data00 = cell00[type] || cell00.current
  const data10 = cell10[type] || cell10.current
  const data01 = cell01[type] || cell01.current
  const data11 = cell11[type] || cell11.current

  // Bilinear interpolation of u and v velocity components (m/s)
  const uTop = (1 - tx) * data00.u + tx * data10.u
  const uBot = (1 - tx) * data01.u + tx * data10.u
  const u = (1 - ty) * uTop + ty * uBot

  const vTop = (1 - tx) * data00.v + tx * data10.v
  const vBot = (1 - tx) * data01.v + tx * data10.v
  const v = (1 - ty) * vTop + ty * vBot

  // Bilinear interpolation of wave conditions for swell modulation
  const w00 = cell00.wave || { height_m: 1.0, dir_deg: 100 }
  const w10 = cell10.wave || { height_m: 1.0, dir_deg: 100 }
  const w01 = cell01.wave || { height_m: 1.0, dir_deg: 100 }
  const w11 = cell11.wave || { height_m: 1.0, dir_deg: 100 }
  const waveHeight = (1 - ty) * ((1 - tx) * w00.height_m + tx * w10.height_m) + ty * ((1 - tx) * w01.height_m + tx * w11.height_m)
  const waveDir = w00.dir_deg

  const speed_ms = Math.hypot(u, v)
  // Flow bearing angle in degrees (0 = North, 90 = East, 180 = South, 270 = West)
  const dir_deg = (Math.atan2(u, v) * (180 / Math.PI) + 360) % 360

  return { u, v, speed_ms, dir_deg, waveHeight, waveDir }
}

function createFlowParticle(center, type, idx) {
  // Random seed within flow bbox around center (approx 0.5 degrees)
  const spread = 0.5
  const angle = Math.random() * Math.PI * 2
  const dist = Math.random() * spread
  const lon = center[0] + Math.cos(angle) * dist
  const lat = center[1] + Math.sin(angle) * dist * 0.75 // flatten for latitude

  // Streamline visual length in degrees:
  // Wind streamlines are longer (0.08 to 0.13 deg), currents more compact (0.04 to 0.08 deg)
  const length = type === 'wind'
    ? 0.08 + Math.random() * 0.05
    : 0.045 + Math.random() * 0.035

  return {
    id: `${type}-${idx}`,
    type,
    lon,
    lat,
    length,
    age: Math.floor(Math.random() * 120),
    maxAge: 160 + Math.floor(Math.random() * 100),
  }
}

function stepFlowParticle(p, config, bbox, metVectors) {
  const sample = sampleMetVector(p.lon, p.lat, p.type, metVectors, config)

  // Real velocity advection step:
  // Velocity is scaled to provide a smooth, observable simulation drift on the map
  const dt = p.type === 'wind' ? 0.000055 : 0.000075
  const cosLat = Math.cos((p.lat * Math.PI) / 180) || 0.875
  const dx = (sample.u * dt) / cosLat
  const dy = sample.v * dt

  p.lon += dx
  p.lat += dy
  p.age = (p.age || 0) + 1

  // Respawn gracefully at upstream boundaries or within flow field
  const outOfBounds = p.lon < bbox.minLng || p.lon > bbox.maxLng || p.lat < bbox.minLat || p.lat > bbox.maxLat
  if (outOfBounds || p.age > (p.maxAge || 240)) {
    p.age = 0
    const edge = Math.floor(Math.random() * 4)
    if (edge === 0) {
      // Upstream boundary along X
      p.lon = sample.u >= 0
        ? bbox.minLng + 0.01 + Math.random() * 0.03
        : bbox.maxLng - 0.01 - Math.random() * 0.03
      p.lat = bbox.minLat + Math.random() * (bbox.maxLat - bbox.minLat)
    } else if (edge === 1) {
      // Upstream boundary along Y
      p.lon = bbox.minLng + Math.random() * (bbox.maxLng - bbox.minLng)
      p.lat = sample.v >= 0
        ? bbox.minLat + 0.01 + Math.random() * 0.03
        : bbox.maxLat - 0.01 - Math.random() * 0.03
    } else {
      // Interior flow field
      p.lon = bbox.minLng + Math.random() * (bbox.maxLng - bbox.minLng)
      p.lat = bbox.minLat + Math.random() * (bbox.maxLat - bbox.minLat)
    }
  }
  return p
}

function particleToFeature(p, config, metVectors) {
  // Numerical forward integration of streamline through the real (u, v) velocity vector field.
  // Physical spatial shear (du/dy, dv/dx) and Coriolis/bathymetric turning naturally produce
  // authentic curvature rather than artificial procedural sine waves.
  const numSteps = 6
  const stepDist = p.length / numSteps
  const coords = [[p.lon, p.lat]]
  let curLon = p.lon
  let curLat = p.lat

  for (let i = 1; i <= numSteps; i++) {
    const s = sampleMetVector(curLon, curLat, p.type, metVectors, config)
    const spd = Math.max(0.1, s.speed_ms)
    // Normalized velocity direction components
    const uNorm = s.u / spd
    const vNorm = s.v / spd

    // Subtle physical swell modulation from Copernicus wave model
    const wavePerpX = -Math.sin(((s.waveDir || 100) * Math.PI) / 180)
    const wavePerpY = Math.cos(((s.waveDir || 100) * Math.PI) / 180)
    const swellAmp = (s.waveHeight || 1.0) * 0.0003
    const swellOffset = Math.sin(curLon * 25.0 + curLat * 25.0 + i * 0.7) * swellAmp

    const cosLat = Math.cos((curLat * Math.PI) / 180) || 0.875
    curLon += (uNorm * stepDist + wavePerpX * swellOffset) / cosLat
    curLat += (vNorm * stepDist + wavePerpY * swellOffset)

    coords.push([curLon, curLat])
  }

  return {
    type: 'Feature',
    properties: { type: p.type, color: config[p.type].color, width: config[p.type].width },
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
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
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': 0.78,
        'line-blur': 0.5,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
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

// Interpolate historical vessel coordinates, heading, and speed along its 18-hour NOAA AIS track
function getVesselPositionAtHoursPrior(vesselData, targetHoursPrior) {
  if (!vesselData || !vesselData.points || !vesselData.points.length) {
    return null
  }
  const pts = vesselData.points
  if (pts.length === 1) {
    return {
      lon: pts[0].lon,
      lat: pts[0].lat,
      sog: pts[0].sog ?? 0,
      cog: pts[0].cog ?? 0,
      hours_prior: pts[0].hours_prior ?? targetHoursPrior,
    }
  }

  // points are ordered from earliest (largest hours_prior) to latest (smallest hours_prior)
  const earliest = pts[0]
  const latest = pts[pts.length - 1]

  if (targetHoursPrior >= earliest.hours_prior) {
    return {
      lon: earliest.lon,
      lat: earliest.lat,
      sog: earliest.sog ?? 0,
      cog: earliest.cog ?? 0,
      hours_prior: earliest.hours_prior,
    }
  }
  if (targetHoursPrior <= latest.hours_prior) {
    return {
      lon: latest.lon,
      lat: latest.lat,
      sog: latest.sog ?? 0,
      cog: latest.cog ?? 0,
      hours_prior: latest.hours_prior,
    }
  }

  // Find segment [p1, p2] where p1.hours_prior >= targetHoursPrior >= p2.hours_prior
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    if (p1.hours_prior >= targetHoursPrior && p2.hours_prior <= targetHoursPrior) {
      const span = p1.hours_prior - p2.hours_prior
      const t = span > 1e-6 ? (p1.hours_prior - targetHoursPrior) / span : 0
      const lon = p1.lon + t * (p2.lon - p1.lon)
      const lat = p1.lat + t * (p2.lat - p1.lat)
      const sog = (p1.sog ?? 0) + t * ((p2.sog ?? 0) - (p1.sog ?? 0))

      let cog1 = p1.cog ?? 0
      let cog2 = p2.cog ?? 0
      let diff = cog2 - cog1
      if (diff > 180) diff -= 360
      if (diff < -180) diff += 360
      const cog = (cog1 + t * diff + 360) % 360

      return { lon, lat, sog, cog, hours_prior: targetHoursPrior }
    }
  }

  return {
    lon: latest.lon,
    lat: latest.lat,
    sog: latest.sog ?? 0,
    cog: latest.cog ?? 0,
    hours_prior: latest.hours_prior,
  }
}

export default function MapView({
  vessels,
  slicks,
  detail,
  vesselMmsi,
  riskOn,
  riskData,
  showVessels = true,
  onToggleVessels,
  showPipelines = true,
  onTogglePipelines,
  basemapKey,
  projection = 'globe',
  leftPanelOpen,
  rightPanelOpen,
  onSelectSlick,
  onSelectVessel,
  demoDetection,
  flowOn = false,
  onToggleFlow,
  flowOrigin = null,
  demoCorridor = null,
  demoOrigin = null,
  demoSuspects = null,
  demoTracks = null,
  demoTrajectories = null,
  demoPipelines = null,
  demoStage = 'idle',
  metVectors = null,
}) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const popupRef = useRef(null)
  const labelsRef = useRef([])
  const suspectMarkersRef = useRef([])
  const culpritPipelineMarkerRef = useRef(null)
  const pendingFocusRef = useRef(null)
  const metVectorsRef = useRef(metVectors)
  metVectorsRef.current = metVectors

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
  const corridorInitRef = useRef(false)

  // MapLibre has no glyph server configured here, so the "always on" analysis
  // labels are HTML markers rather than symbol layers.
  const clearLabels = () => {
    labelsRef.current.forEach((m) => m.remove())
    labelsRef.current = []
  }

  const clearSuspectMarkers = () => {
    suspectMarkersRef.current.forEach((item) => {
      if (item?.marker) item.marker.remove()
      else if (item?.remove) item.remove()
    })
    suspectMarkersRef.current = []
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

    if (!demoDetection) {
      setSrc('s-slicks', fc(slickFeatures))
    }

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

    // Zoom, compass (drag to rotate) and a pitch indicator for the 3D camera.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

    const popup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 12,
      className: 'hud-popup', maxWidth: '260px',
    })
    popupRef.current = popup

    map.on('load', () => {
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
    })

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
      ['suspects', (p) => `
        <div style="font-family: var(--font-mono); font-size: 11px;">
          <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">🚢 ${escapeHtml(p.vessel_name || `MMSI ${p.mmsi}`)}</div>
          <div style="color: ${p.suspicion_level === 'HIGH' ? '#EF4444' : p.suspicion_level === 'MEDIUM' ? '#F59E0B' : '#10B981'}; font-weight: 600;">
            ${p.suspicion_level} SUSPICION · ${Number(p.total_score).toFixed(1)}%
          </div>
          <div style="color: #94A3B8; font-size: 10px; margin-top: 2px;">
            CPA: ${(Number(p.cpa_distance_meters) / 1000).toFixed(1)} km · ${escapeHtml(p.speed_knots)} kn
          </div>
        </div>
      `],
      ['suspects-halo', (p) => `
        <div style="font-family: var(--font-mono); font-size: 11px;">
          <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">🚢 ${escapeHtml(p.vessel_name || `MMSI ${p.mmsi}`)}</div>
          <div style="color: ${p.suspicion_level === 'HIGH' ? '#EF4444' : p.suspicion_level === 'MEDIUM' ? '#F59E0B' : '#10B981'}; font-weight: 600;">
            ${p.suspicion_level} SUSPICION · ${Number(p.total_score).toFixed(1)}%
          </div>
          <div style="color: #94A3B8; font-size: 10px; margin-top: 2px;">
            CPA: ${(Number(p.cpa_distance_meters) / 1000).toFixed(1)} km · ${escapeHtml(p.speed_knots)} kn
          </div>
        </div>
      `],
      ['candidate-tracks', (p) => `
        <div style="font-family: var(--font-mono); font-size: 11px;">
          <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">🚢 ${escapeHtml(p.vessel_name || `MMSI ${p.mmsi}`)}</div>
          <div style="color: ${p.suspicion_level === 'HIGH' ? '#EF4444' : p.suspicion_level === 'MEDIUM' ? '#F59E0B' : '#10B981'}; font-weight: 600;">
            18h HISTORICAL AIS TRACK · ${p.suspicion_level} SUSPICION (${Number(p.total_score).toFixed(1)}%)
          </div>
          <div style="color: #94A3B8; font-size: 10px; margin-top: 2px;">
            Fixes: ${p.points_count || '—'} AIS positions recorded · Click to focus
          </div>
        </div>
      `],
      ['pipelines-line', (p) => `
        <div style="font-family: var(--font-mono); font-size: 11px;">
          <div style="font-weight: 700; color: ${p.is_culprit ? '#FF3B30' : '#00E5FF'}; margin-bottom: 2px;">
            ${p.is_culprit ? '⚡ PRIMARY LEAK SOURCE' : 'SUBSEA PIPELINE'}
          </div>
          <div style="color: #fff; font-weight: 600;">Segment #${p.segment_id} · ${escapeHtml(p.operator)}</div>
          <div style="color: #94A3B8; font-size: 10px; margin-top: 2px;">
            Product: ${p.product} · Size: ${p.diameter_inches}" · Status: ${p.status}
            ${p.is_culprit ? '<br><span style="color:#FCA5A5; font-weight:600;">Distance to Origin: 49.1 m</span>' : ''}
          </div>
        </div>
      `],
      ['pipelines-culprit', (p) => `
        <div style="font-family: var(--font-mono); font-size: 11px;">
          <div style="font-weight: 700; color: #FF3B30; margin-bottom: 2px;">⚡ PRIMARY LEAK SOURCE (RUPTURED)</div>
          <div style="color: #fff; font-weight: 600;">Walter Oil & Gas · Segment #${p.segment_id}</div>
          <div style="color: #FCA5A5; font-size: 10px; margin-top: 2px;">
            Diameter: ${p.diameter_inches}" · Product: ${p.product} · Status: ${p.status}<br>
            Origin Proximity: 49.1 m (Zero ship intersection)
          </div>
        </div>
      `],
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
      const coords = f?.geometry?.coordinates
      if (p) {
        if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
          map.flyTo({ center: coords, zoom: 11.5, duration: 1200 })
        }
        if (p.mmsi) cbRef.current.onSelectVessel(p.mmsi)
      }
    }
    const onPipelineClick = (e) => {
      if (e.lngLat) {
        map.flyTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: 12.5, duration: 1000 })
      }
    }
    const onCandidateTrackClick = (e) => {
      const p = e.features?.[0]?.properties
      if (p?.mmsi) cbRef.current.onSelectVessel(p.mmsi)
    }
    map.on('click', 'vessels', onVesselClick)
    map.on('click', 'slick-fill', onSlickClick)
    map.on('click', 'suspects', onSuspectClick)
    map.on('click', 'suspects-halo', onSuspectClick)
    map.on('click', 'candidate-tracks', onCandidateTrackClick)
    map.on('click', 'pipelines-line', onPipelineClick)
    map.on('click', 'pipelines-culprit', onPipelineClick)

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
      if (!strip) strip.textContent = '—′ —′'
    })

    // --- app-level events ---------------------------------------------------
    const onTrack = (e) => {
      dataRef.current.track = e.detail
      applyData()
      if (readyRef.current) focusTrack(e.detail)
      else pendingFocusRef.current = () => focusTrack(e.detail)
    }
    const onFly = (e) => {
      map.flyTo({ center: [e.detail.lon, e.detail.lat], zoom: 11.5, duration: 1400 })
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
      clearSuspectMarkers()
      if (culpritPipelineMarkerRef.current) {
        culpritPipelineMarkerRef.current.remove()
        culpritPipelineMarkerRef.current = null
      }
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

  // Demo flow: inject pre-run detection GeoJSON and fly to encompass detection and candidate ships
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-slicks')
    if (!demoDetection) return

    // Feed to s-slicks source (same layer rendering as live polling)
    const detectionData = demoDetection?.type === 'FeatureCollection' ? demoDetection : fc(demoDetection?.features || [demoDetection])
    src?.setData(detectionData)

    // Fly to detection bounds with padding, extending to include top suspect ships
    const bounds = getBoundsFromGeoJSON(detectionData)
    if (bounds) {
      if (demoSuspects?.features?.length) {
        demoSuspects.features.slice(0, 5).forEach((f) => {
          const coords = f.geometry?.coordinates
          if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
            bounds.extend(coords)
          }
        })
      }
      map.fitBounds(bounds, { padding: 90, maxZoom: 11, duration: 1400 })
    }
  }, [demoDetection, demoSuspects])

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
    for (let i = 0; i < 85; i++) particles.push(createFlowParticle(origin, 'current', i))
    for (let i = 0; i < 65; i++) particles.push(createFlowParticle(origin, 'wind', i + 85))
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
        stepFlowParticle(p, cfg, bbox, metVectorsRef.current)
      }

      const s = map.getSource('s-flow')
      if (s) {
        s.setData({
          type: 'FeatureCollection',
          features: parts.map((p) => particleToFeature(p, cfg, metVectorsRef.current)),
        })
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
  }, [flowOn, flowOrigin, metVectors])

  // --- Corridor time-slice animation -----------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!demoCorridor?.features?.length) {
      corridorInitRef.current = false
      return
    }

    // Compute max hours from corridor data
    const allHours = demoCorridor.features
      .map(f => f.properties?.hours_prior)
      .filter(h => h != null)
    if (allHours.length) {
      const maxH = Math.max(...allHours)
      corridorMaxHours.current = maxH
      if (!corridorInitRef.current) {
        setCorridorHours(maxH)
        corridorInitRef.current = true
      }
    }

    // Filter features by current slider value with opacity based on age
    const filtered = demoCorridor.features.filter(f => {
      const h = f.properties?.hours_prior ?? 0
      return h <= corridorHours
    }).map(f => {
      const h = f.properties?.hours_prior ?? 0
      // Older = more transparent; 0 hours = 0.5 opacity, max hours = 0.1
      const opacity = 0.5 - (h / (corridorMaxHours.current || 26)) * 0.4
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
    const origin = demoOrigin?.primary_centroid || demoOrigin?.estimated_origin?.primary_centroid
    if (origin) {
      const originLon = origin.longitude
      const originLat = origin.latitude
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

  // --- Candidate vessel 18h historical transit tracks ------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-candidate-tracks')
    if (src) {
      src.setData(showVessels && demoTracks?.features?.length ? demoTracks : EMPTY)
    }
  }, [demoTracks, showVessels])

  // Helper to sync suspect ship markers and s-suspects GPU circles with the backtrack time
  const updateSuspectPositions = useCallback((hHours) => {
    const map = mapRef.current
    if (!map || !readyRef.current || !showVessels) return
    if (!suspectMarkersRef.current.length && !demoSuspects?.features?.length) return

    // 1. Update interactive HTML markers
    suspectMarkersRef.current.forEach((item) => {
      const traj = demoTrajectories?.[item.mmsi] || demoTrajectories?.[String(item.mmsi)]
      let coords = item.baseCoords
      let course = item.baseCourse
      let speed = item.baseSpeed
      if (traj) {
        const pos = getVesselPositionAtHoursPrior(traj, hHours)
        if (pos && Number.isFinite(pos.lon) && Number.isFinite(pos.lat)) {
          coords = [pos.lon, pos.lat]
          course = Math.round(pos.cog)
          speed = pos.sog.toFixed(1)
        }
      }
      item.currentCoords = coords
      if (item.marker) {
        item.marker.setLngLat(coords)
      }
      if (item.headingEl) {
        item.headingEl.style.transform = `rotate(${course}deg)`
        item.headingEl.title = `Heading ${course}°`
      }
      if (item.speedEl) {
        item.speedEl.textContent = `${speed} kn`
      }
      item.el.title = `${item.name} (#${item.rank})\nBacktrack Time: T-${hHours.toFixed(1)}h\nCoord: ${coords[1].toFixed(4)}°N, ${Math.abs(coords[0]).toFixed(4)}°W\nSpeed: ${speed} kn · Heading: ${course}°`
    })

    // 2. Update MapLibre s-suspects GeoJSON source (GPU circles)
    const src = map.getSource('s-suspects')
    if (src && demoSuspects?.features?.length) {
      const updatedFeatures = demoSuspects.features.map((f) => {
        const mmsi = f.properties?.mmsi
        const traj = demoTrajectories?.[mmsi] || demoTrajectories?.[String(mmsi)]
        if (traj) {
          const pos = getVesselPositionAtHoursPrior(traj, hHours)
          if (pos && Number.isFinite(pos.lon) && Number.isFinite(pos.lat)) {
            return {
              ...f,
              geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
              properties: {
                ...f.properties,
                speed_knots: pos.sog.toFixed(1),
                course_deg: Math.round(pos.cog),
                current_lon: pos.lon,
                current_lat: pos.lat,
                hours_prior: hHours,
              },
            }
          }
        }
        return f
      })
      src.setData({ type: 'FeatureCollection', features: updatedFeatures })
    }
  }, [demoTrajectories, demoSuspects, showVessels])

  // Sync positions whenever corridorHours slider scrubs or plays
  useEffect(() => {
    updateSuspectPositions(corridorHours)
  }, [corridorHours, updateSuspectPositions])

  // --- Suspects layer & Interactive Ship Markers ----------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-suspects')
    clearSuspectMarkers()

    if (showVessels && demoSuspects?.features?.length) {
      if (src) src.setData(demoSuspects)

      // Add high-visibility tactical ship markers
      demoSuspects.features.forEach((f, idx) => {
        const coords = f.geometry?.coordinates
        if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return

        const p = f.properties || {}
        const level = (p.suspicion_level || 'LOW').toLowerCase()
        const name = p.vessel_name || `MMSI ${p.mmsi}`
        const score = Number(p.total_score || 0).toFixed(1)
        const rank = idx + 1
        const isTop = rank <= 3
        const course = Math.round(p.course_deg || 0)
        const speed = Number(p.speed_knots || 0).toFixed(1)
        const distKm = p.cpa_distance_meters ? (p.cpa_distance_meters / 1000).toFixed(1) : '—'

        const el = document.createElement('div')
        el.className = `suspect-ship-marker ${level} ${isTop ? 'top-rank' : ''} ${vesselMmsi === p.mmsi ? 'selected' : ''}`
        el.dataset.mmsi = String(p.mmsi)
        el.title = `${name} (#${rank})\nScore: ${score}%\nCPA: ${distKm} km\nSpeed: ${speed} kn · Heading: ${course}°`
        el.innerHTML = `
          <div class="ship-marker-badge">
            <span class="ship-marker-rank">#${rank}</span>
            <span class="ship-marker-icon">🚢</span>
            <span class="ship-marker-title">${escapeHtml(name)}</span>
            <span class="ship-marker-score mono">${score}%</span>
            <span class="ship-marker-speed mono">${speed} kn</span>
            <span class="ship-marker-heading" title="Heading ${course}°" style="transform: rotate(${course}deg);">▲</span>
          </div>
          <div class="ship-marker-stem"></div>
          <div class="ship-marker-dot"></div>
        `

        const markerItem = {
          marker: null,
          el,
          mmsi: p.mmsi,
          name,
          rank,
          baseCoords: coords,
          currentCoords: coords,
          baseCourse: course,
          baseSpeed: speed,
          headingEl: el.querySelector('.ship-marker-heading'),
          speedEl: el.querySelector('.ship-marker-speed'),
        }

        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const c = markerItem.currentCoords || coords
          map.flyTo({ center: c, zoom: 11.5, duration: 1000 })
          if (p.mmsi) cbRef.current.onSelectVessel(p.mmsi)
        })

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(coords)
          .addTo(map)

        markerItem.marker = marker
        suspectMarkersRef.current.push(markerItem)
      })

      // Sync initial positions with current corridorHours
      updateSuspectPositions(corridorHours)
    } else {
      if (src) src.setData(EMPTY)
    }
  }, [demoSuspects, showVessels, vesselMmsi, updateSuspectPositions])

  // --- Subsea Pipelines Layer & Culprit Badge -----------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('s-pipelines')
    if (culpritPipelineMarkerRef.current) {
      culpritPipelineMarkerRef.current.remove()
      culpritPipelineMarkerRef.current = null
    }

    if (showPipelines && demoPipelines?.features?.length) {
      if (src) src.setData(demoPipelines)

      // Highlight Walter Oil & Gas segment 12712 with a tactical badge
      const culpritFeat = demoPipelines.features.find((f) => f.properties?.is_culprit)
      if (culpritFeat && culpritFeat.geometry?.coordinates?.length) {
        const coordsList = culpritFeat.geometry.coordinates
        // Find point closest to estimated origin (-88.9678, 28.93537)
        let bestCoord = coordsList[0]
        let minD = 9999
        coordsList.forEach((c) => {
          const d = Math.hypot(c[0] - (-88.9678), c[1] - 28.93537)
          if (d < minD) { minD = d; bestCoord = c }
        })

        const el = document.createElement('div')
        el.className = 'culprit-pipeline-marker'
        el.title = 'Suspected Rupture: Walter Oil & Gas Segment #12712 (49.1m from Origin)'
        el.innerHTML = `
          <div class="culprit-pipeline-badge">
            <span class="culprit-pipe-icon">⚡</span>
            <span class="culprit-pipe-text">PIPELINE #12712 (LEAK ORIGIN)</span>
          </div>
          <div class="culprit-pipe-stem"></div>
          <div class="culprit-pipe-dot"></div>
        `
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          map.flyTo({ center: bestCoord, zoom: 13, duration: 1000 })
        })

        culpritPipelineMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(bestCoord)
          .addTo(map)
      }
    } else {
      if (src) src.setData(EMPTY)
    }
  }, [demoPipelines, showPipelines])

  // Playback animation - smooth stepping through backtrack hours
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
        setCorridorHours((h) => {
          if (h >= corridorMaxHours.current) {
            setIsPlaying(false)
            return corridorMaxHours.current
          }
          const next = Math.min(corridorMaxHours.current, Number((h + 0.5).toFixed(1)))
          if (next >= corridorMaxHours.current) {
            setIsPlaying(false)
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
            <div><span className="sw candidate-track" /> 18h Historical Track</div>
            <div><span className="sw pipeline" /> Subsea Pipeline Grid</div>
            <div><span className="sw pipe-culprit" /> Ruptured Pipeline #12712</div>
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

      {flowOn && flowOrigin && (() => {
        const curMet = sampleMetVector(flowOrigin.lon, flowOrigin.lat, 'current', metVectors, flowConfigRef.current)
        const windMet = sampleMetVector(flowOrigin.lon, flowOrigin.lat, 'wind', metVectors, flowConfigRef.current)
        return (
          <div className={`flow-legend ${rightPanelOpen ? 'dock-open' : 'dock-closed'}`}>
            <div className="fl-row">
              <span className="fl-arrow" style={{ transform: `rotate(${Math.round(curMet.dir_deg)}deg)`, color: '#38BDF8' }}>↑</span>
              <span className="fl-label">Current {curMet.speed_ms.toFixed(1)} m/s (CMEMS)</span>
            </div>
            <div className="fl-row">
              <span className="fl-arrow" style={{ transform: `rotate(${Math.round(windMet.dir_deg)}deg)`, color: '#F59E0B' }}>↑</span>
              <span className="fl-label">Wind {windMet.speed_ms.toFixed(1)} m/s (NOAA 10m)</span>
            </div>
            {metVectors && (
              <div className="fl-row">
                <span className="fl-arrow" style={{ transform: `rotate(${Math.round(curMet.waveDir)}deg)`, color: '#A78BFA' }}>~</span>
                <span className="fl-label">Waves {curMet.waveHeight.toFixed(1)}m @ {Math.round(curMet.waveDir)}°</span>
              </div>
            )}
          </div>
        )
      })()}

      {/* Backend Computation HUD Overlay during demoStage === 'processing' */}
      {demoStage === 'processing' && (
        <div className={`backend-computing-hud ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <div className="bch-header">
            <span className="bch-radar-dot"></span>
            <span className="bch-title mono">BACKEND HYDRODYNAMIC ENGINE ACTIVE</span>
            <span className="bch-badge mono">RUNNING RK2</span>
          </div>
          <div className="bch-body mono">
            <div className="bch-line">
              <span className="bch-arrow">{'>'}</span>
              <span>Ingesting Copernicus CMEMS surface currents & NOAA NDBC winds...</span>
            </div>
            <div className="bch-line">
              <span className="bch-arrow">{'>'}</span>
              <span>Executing reverse-Lagrangian particle dispersion (500 trajectories)...</span>
            </div>
            <div className="bch-line">
              <span className="bch-arrow">{'>'}</span>
              <span>Correlating 18-hour vessel voyage corridors with seabed infrastructure...</span>
            </div>
          </div>
          <div className="bch-progress-bar">
            <div className="bch-progress-fill"></div>
          </div>
        </div>
      )}

      {/* Corridor Time Slider UI & Simulation Layer Controls */}
      {demoCorridor && (
        <div className={`corridor-controls ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <div className="corridor-header">
            <span className="corridor-title">Simulation Drift & Layers</span>
            <span className="corridor-hours mono">
              {Number.isInteger(corridorHours) ? corridorHours : corridorHours.toFixed(1)}h / {corridorMaxHours.current}h
            </span>
          </div>

          {/* Quick simulation layer toggles: PIPELINES, SHIPS, CURRENTS */}
          <div className="sim-layer-toggles">
            <button
              type="button"
              className={`sim-toggle-pill ${showPipelines ? 'active' : ''}`}
              onClick={onTogglePipelines}
              title="Toggle Subsea Pipelines (Walter Oil & Gas #12712 leak line)">
              <span className="pill-dot pipeline-dot" />
              <span>PIPELINES {showPipelines ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              className={`sim-toggle-pill ${showVessels ? 'active' : ''}`}
              onClick={onToggleVessels}
              title="Toggle Candidate Ships & AIS Positions">
              <span className="pill-dot ship-dot" />
              <span>SHIPS {showVessels ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              className={`sim-toggle-pill ${flowOn ? 'active' : ''}`}
              onClick={onToggleFlow}
              title="Toggle Ocean Currents & Flow Field Vectors">
              <span className="pill-dot current-dot" />
              <span>CURRENTS {flowOn ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div className="corridor-slider-row">
            <input
              type="range"
              className="corridor-slider"
              min={0}
              max={corridorMaxHours.current}
              step={0.5}
              value={corridorHours}
              onChange={(e) => {
                setCorridorHours(Number(e.target.value))
                setIsPlaying(false)
              }}
            />
            <button
              className="corridor-play-btn"
              onClick={() => {
                if (!isPlaying && corridorHours >= corridorMaxHours.current) {
                  setCorridorHours(0)
                }
                setIsPlaying((p) => !p)
              }}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
          </div>
        </div>
      )}

      {/* Origin Verdict Banner */}
      {(demoOrigin?.primary_centroid || demoOrigin?.estimated_origin?.primary_centroid) && corridorHours >= corridorMaxHours.current * 0.9 && (
        <div className={`origin-verdict ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`}>
          <div className="verdict-title">Estimated Origin</div>
          <div className="verdict-detail">
            {demoOrigin.time_window_utc?.confidence || demoOrigin.estimated_origin?.time_window_utc?.confidence || demoOrigin.confidence || 'high'} confidence
            {' — '}
            {demoOrigin.time_window_utc?.hours_prior_min ?? demoOrigin.estimated_origin?.time_window_utc?.hours_prior_min ?? 18}–
            {demoOrigin.time_window_utc?.hours_prior_max ?? demoOrigin.estimated_origin?.time_window_utc?.hours_prior_max ?? 24}h before detection
          </div>
        </div>
      )}

      <div className={`coord-strip mono ${leftPanelOpen ? 'dock-open' : 'dock-closed'}`} id="coord-strip">
        59°54.0′N 025°18.0′E
      </div>
    </div>
  )
}
