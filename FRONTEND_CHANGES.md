# Frontend Changes Specification

## New "Forensic Backtrack" View/Panel

### Overview
Display processed forensic backtracking results from the `/api/forensics/{case_id}` endpoint. This renders pre-generated pipeline artifacts (trajectory corridors, suspect vessels, origin estimates) on the existing MapLibre GL JS map.

### Data Source
**Endpoint**: `GET /api/forensics/{case_id}`

**Response Contract**:
```json
{
  "case_id": "string",
  "origin": {
    "status": "success",
    "detection_metadata": {
      "timestamp": "2023-11-17T23:54:16+00:00",
      "centroid": {"latitude": 28.9347, "longitude": -88.9655},
      "has_polygon": true
    },
    "morphology_analysis": {...},
    "estimated_origin": {
      "time_window_utc": {"start": "...", "end": "..."},
      "primary_centroid": {"latitude": 28.9354, "longitude": -88.9678},
      "confidence": "high"
    },
    "simulation_summary": {...}
  },
  "corridor": {
    "type": "FeatureCollection",
    "metadata": {...},
    "features": [{
      "type": "Feature",
      "geometry": {"type": "Polygon", "coordinates": [...]},
      "properties": {"layer": "envelope", "timestamp": "...", "hours_prior": 6.0, "incident_name": "..."}
    }]
  },
  "suspects": {
    "type": "FeatureCollection",
    "name": "culprit_visual",
    "crs": {...},
    "features": [{
      "type": "Feature",
      "geometry": {"type": "Point", "coordinates": [lon, lat]},
      "properties": {
        "mmsi": 366953000,
        "vessel_name": "CG WALNUT",
        "vessel_type": 90,
        "callsign": "NZNE",
        "is_dark_ship": false,
        "cpa_timestamp_utc": "2023-11-17T23:18:55+00:00",
        "cpa_distance_meters": 8451.0,
        "speed_knots": 13.3,
        "course_deg": 252.6,
        "total_score": 52.5,
        "suspicion_level": "MEDIUM"
      }
    }]
  },
  "verdict": {
    "primary_verdict": "SUSPECTED_ANCHOR_STRIKE_ON_PIPELINE",
    "confidence_level": "HIGH",
    "executive_summary": "Vessel CG WALNUT was observed loitering...",
    "nearest_infrastructure": {...},
    "anchor_strike_suspect": {"mmsi": 366953000, ...}
  },
  "ranked": [{
    "mmsi": 366953000,
    "vessel_name": "CG WALNUT",
    "total_score": 52.5,
    "suspicion_level": "MEDIUM",
    "cpa_distance_meters": 8451.0
  }],
  "report_html_url": "/api/forensics/taylor_energy/report.html",
  "report_pdf_url": "/api/forensics/taylor_energy/report.pdf"
}
```

### Map Rendering (MapLibre GL JS)

#### Layer 1: Trajectory Corridor (Polygon)
- **Source**: `corridor` FeatureCollection
- **Type**: `fill` layer
- **Fill color**: Graded by `properties.hours_prior`
  - Recent (0h) → light blue with higher opacity
  - Old (6h+) → dark blue/teal with lower opacity
- **Stroke**: 1px white outline
- **Popup**: Show `hours_prior`, `timestamp`, `incident_name`

#### Layer 2: Suspect Vessels (Point)
- **Source**: `suspects` FeatureCollection
- **Type**: `circle` layer
- **Circle color**: By `properties.suspicion_level`
  - `HIGH` → `#ef4444` (red)
  - `MEDIUM` → `#f97316` (orange)
  - `LOW` → `#eab308` (yellow)
- **Circle radius**: Scale by `total_score` (e.g., 8px base + score/10)
- **Stroke**: White outline, 2px
- **Popup**: `vessel_name`, `mmsi`, `total_score`, `is_dark_ship`, `cpa_distance_meters`

#### Layer 3: Estimated Origin (Marker)
- **Source**: `origin.estimated_origin.primary_centroid`
- **Type**: Marker with label "Estimated Origin"
- **Icon**: Location pin or crosshair
- **Color**: `#22c55e` (green) to distinguish from suspects
- **Popup**: Confidence level, release window timestamps

### UI Panel Components

#### Verdict Banner (Top)
```
🚨 SUSPECTED_ANCHOR_STRIKE_ON_PIPELINE
Confidence: HIGH | Time Window: 2023-11-17 23:16 - 23:31 UTC
Executive Summary: [verdict.executive_summary truncated]
```

#### Suspects Table (Side Panel)
Columns from `ranked` array:
| Rank | Vessel Name | MMSI | Score | Suspicion | CPA Distance |
|------|-------------|------|-------|-----------|--------------|
| 1 | CG WALNUT | 366953000 | 52.5% | MEDIUM | 8451m |

- Sorted by `total_score` desc
- Click row to fly to vessel on map
- Highlight selected row

#### Report Links (Bottom)
- Button: "View HTML Report" → opens `report_html_url`
- Button: "Download PDF Report" → opens `report_pdf_url`

### Map Initialization
```javascript
// On case select / view load
const response = await fetch('/api/forensics/taylor_energy');
const data = await response.json();

// Add sources
map.addSource('corridor', { type: 'geojson', data: data.corridor });
map.addSource('suspects', { type: 'geojson', data: data.suspects });

// Fit bounds to corridor
map.fitBounds(bbox(data.corridor), { padding: 50 });

// Add layers per spec above
```

### Route/Navigation
```
/forensics/:caseId  → ForensicBacktrack component
```

### Static File Serving
HTML/PDF reports served directly from backend at:
- `/api/forensics/{case_id}/report.html`
- `/api/forensics/{case_id}/report.pdf`

Use `<a href="..." target="_blank">` for report links.

---
*Spec version: 1.0 | Map library: MapLibre GL JS | Endpoint version: v1*
