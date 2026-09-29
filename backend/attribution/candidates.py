"""Candidate vessel selection around an estimated spill origin via aisdb."""
from __future__ import annotations

import math
import os
import sqlite3

EARTH_R = 6371.0

# Sample vessels for fallback when aisdb unavailable
_SAMPLE_VESSELS: list[dict] = [
    {"mmsi": 123456789, "ts": 1704067200.0, "lon": 24.5, "lat": 60.1, "sog": 12.5, "cog": 90.0},
    {"mmsi": 987654321, "ts": 1704067500.0, "lon": 24.6, "lat": 60.15, "sog": 15.0, "cog": 180.0},
]


def _get_aisdb_conn() -> sqlite3.Connection | None:
    """Return aisdb connection if configured, else None."""
    db_path = os.environ.get("AISDB_PATH")
    if not db_path or not os.path.exists(db_path):
        return None
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _query_aisdb(
    conn: sqlite3.Connection,
    time_start: float,
    time_end: float,
    lat_center: float,
    lon_center: float,
    radius_km: float,
) -> list[dict]:
    """Query vessels in space-time window from aisdb.

    Assumes aisdb has ais_positions(mmsi,ts,lon,lat,sog,cog) table.
    """
    # ponytail: simple bbox query, haversine filter in Python for exact radius
    dlat = radius_km / 110.574
    dlon = radius_km / (111.320 * math.cos(math.radians(lat_center)))
    rows = conn.execute(
        "SELECT mmsi, ts, lon, lat, sog, cog FROM ais_positions "
        "WHERE ts BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?",
        (time_start, time_end, lon_center - dlon, lon_center + dlon,
         lat_center - dlat, lat_center + dlat)
    ).fetchall()
    return [dict(r) for r in rows if haversine_km(lon_center, lat_center, r["lon"], r["lat"]) <= radius_km]


def haversine_km(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def haversine_km_vec(lon1, lat1, lon2, lat2):
    """Vectorized haversine for numpy arrays of positions."""
    import numpy as np
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = (np.sin(dp / 2) ** 2
         + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2)
    return 2 * EARTH_R * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def bearing_deg(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(x, y)) % 360.0


def query_vessels_spacetime(
    time_start: float,
    time_end: float,
    lat_center: float,
    lon_center: float,
    radius_km: float,
) -> list[dict]:
    """Query vessels in space-time window [time_start, time_end, lat_center, lon_center, radius_km].

    Uses aisdb if configured (AISDB_PATH env var), else returns sample data.
    Returns list of dicts: [{mmsi, ts, lon, lat, sog, cog}, ...]
    """
    conn = _get_aisdb_conn()
    if conn:
        try:
            return _query_aisdb(conn, time_start, time_end, lat_center, lon_center, radius_km)
        finally:
            conn.close()
    # ponytail: sample fallback when aisdb not configured
    return [
        v for v in _SAMPLE_VESSELS
        if time_start <= v["ts"] <= time_end and haversine_km(lon_center, lat_center, v["lon"], v["lat"]) <= radius_km
    ]


def candidate_vessels(store, origin_lon: float, origin_lat: float,
                      release_ts: float, sigma_km: float,
                      window_before_h: float = 14.0,
                      window_after_h: float = 4.0):
    """Vessels with fixes near the origin within the release window via aisdb.

    Returns {mmsi: {'fixes': [(ts, lon, lat, sog, cog)], 'min_d_km': ...}}
    """
    radius_km = max(4.0 * sigma_km + 25.0, 100.0)
    t0 = release_ts - window_before_h * 3600
    t1 = release_ts + window_after_h * 3600

    rows = query_vessels_spacetime(t0, t1, origin_lat, origin_lon, radius_km)

    # Spatial expansion fallback if empty
    if not rows:
        radius_km *= 1.8
        rows = query_vessels_spacetime(t0, t1, origin_lat, origin_lon, radius_km)

    out: dict[int, dict] = {}
    for r in rows:
        d = haversine_km(origin_lon, origin_lat, r["lon"], r["lat"])
        v = out.setdefault(int(r["mmsi"]), {"fixes": [], "min_d_km": 1e9})
        v["fixes"].append((r["ts"], r["lon"], r["lat"], r.get("sog"), r.get("cog")))
        v["min_d_km"] = min(v["min_d_km"], d)
    for v in out.values():
        v["fixes"].sort(key=lambda q: q[0])
    return out, radius_km


def vessel_meta(store, mmsi: int) -> dict:
    # ponytail: try aisdb first, then store, then minimal fallback
    conn = _get_aisdb_conn()
    if conn:
        try:
            row = conn.execute(
                "SELECT mmsi, name, ship_type, destination as dest, draught, imo, '' as length, '' as width "
                "FROM vessels WHERE mmsi=?", (mmsi,)
            ).fetchone()
            if row:
                return dict(row)
        except Exception:
            pass
        finally:
            conn.close()
    row = store.one(
        "SELECT mmsi,name,ship_type,dest,draught,imo,length,width "
        "FROM vessels WHERE mmsi=?", (mmsi,))
    return row or {"mmsi": mmsi, "name": None, "ship_type": None}
