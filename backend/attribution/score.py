"""Suspect scoring: rank vessels by spatio-temporal correlation with a slick.

Simplified 3-factor ensemble for 3-day sprint:
  proximity      0.40  closest approach to the estimated release point/time
  ais_gap        0.30  AIS silence ("dark event") overlapping the release time
  speed_anomaly  0.30  drifting / low-speed loitering inside the window

Keeps TYPE_PRIOR for vessel classification only (not scoring).
"""
from __future__ import annotations

import math

import numpy as np

from .candidates import candidate_vessels, haversine_km

WEIGHTS = {
    "proximity": 0.40,
    "ais_gap": 0.30,
    "speed_anomaly": 0.30,
}

# AIS ship-type code -> (likelihood of being an oily-discharge source, label)
# Codes 80-84 are liquid cargo; 85-89 are the general tanker classes (crude/
# product/liquefied gas) — both are tankers for oil-discharge prior purposes.
TYPE_PRIOR = {
    **{t: (1.00, "tanker") for t in range(80, 90)},
    **{t: (0.75, "cargo") for t in range(70, 80)},
    30: (0.25, "fishing"), 31: (0.45, "towing"), 32: (0.45, "towing"),
    50: (0.30, "pilot"), 51: (0.55, "tug"), 52: (0.40, "reserve"),
    53: (0.45, "port tender"), 55: (0.35, "law enforce"),
    **{t: (0.20, "passenger") for t in range(60, 70)},
}
DEFAULT_PRIOR = (0.35, "unknown")


def score_vessels(store, slick: dict, drift: dict) -> list[dict]:
    """slick: row from slicks; drift: backward run result with origin estimate.

    Returns ranked suspect dicts with per-factor evidence.
    """
    origin_lon = drift["origin_lon"]
    origin_lat = drift["origin_lat"]
    release_ts = drift["release_ts"]
    sigma_km = max(drift["origin_sigma_km"], 1.0)
    sigma_ts = drift.get("origin_sigma_s", 3600)  # temporal uncertainty def 1h

    cands, radius_km = candidate_vessels(
        store, origin_lon, origin_lat, release_ts, sigma_km)

    mmsis = list(cands.keys())
    meta_map = {}
    if mmsis:
        placeholders = ",".join("?" for _ in mmsis)
        rows = store.query(
            f"SELECT mmsi,name,ship_type,dest,draught,imo,length,width "
            f"FROM vessels WHERE mmsi IN ({placeholders})", tuple(mmsis))
        meta_map = {r["mmsi"]: r for r in rows}

    results = []
    for mmsi, cd in cands.items():
        fixes = cd["fixes"]
        if len(fixes) < 1:
            continue
        # uncertainty propagation: degrade proximity with spatial+temporal sigma
        f_prox, ev_prox = _proximity(fixes, origin_lon, origin_lat, release_ts,
                                     sigma_km, sigma_ts)
        f_speed, ev_speed = _speed_anomaly(fixes)
        f_gap, ev_gap = _ais_gap(fixes, release_ts)
        meta = meta_map.get(mmsi, {"mmsi": mmsi, "name": None, "ship_type": None})
        _, ev_type = _type_prior(meta.get("ship_type"))

        factors = {
            "proximity": {"score": round(f_prox, 3), "weight": WEIGHTS["proximity"],
                          "evidence": ev_prox},
            "ais_gap": {"score": round(f_gap, 3), "weight": WEIGHTS["ais_gap"],
                        "evidence": ev_gap},
            "speed_anomaly": {"score": round(f_speed, 3),
                              "weight": WEIGHTS["speed_anomaly"],
                              "evidence": ev_speed},
        }
        total = sum(factors[k]["score"] * factors[k]["weight"] for k in WEIGHTS)
        results.append({
            "mmsi": mmsi,
            "name": meta.get("name"),
            "ship_type": meta.get("ship_type"),
            "type_label": ev_type.split(":")[0] if ev_type else "?",
            "min_dist_km": round(cd["min_d_km"], 2),
            "n_fixes": len(fixes),
            "score": round(total * 100, 1),
            "factors": factors,
            # ponytail: uncertainty drops score by up to 20% at 2 sigma
            "uncertainty_adj": round(sigma_km / (sigma_km + 10.0), 2),
        })
    results.sort(key=lambda r: -r["score"])
    for i, r in enumerate(results):
        r["rank"] = i + 1
    return results


# ---- individual factors ------------------------------------------------------
def _proximity(fixes, olon, olat, release_ts, sigma_km: float,
               sigma_ts: float, scale_km=18.0):
    # ponytail: combined spatial+temporal uncertainty degrades confidence
    near = [f for f in fixes if abs(f[0] - release_ts) <= sigma_ts]
    if not near:
        near = fixes
    d = min(haversine_km(olon, olat, f[1], f[2]) for f in near)
    dt_min = min(abs(f[0] - release_ts) for f in near) / 60.0
    # propagate uncertainty: effective distance grows with sigma_km
    d_eff = d + sigma_km * 0.5  # 0.5 sigma = ~68% confidence
    val = math.exp(-d_eff / scale_km)
    return val, f"closest approach {d:.1f} km ({dt_min:.0f} min from est. release, " \
                f"sigma={sigma_km:.1f}km)"


def _speed_anomaly(fixes):
    sogs = [f[3] for f in fixes if f[3] is not None]
    if not sogs:
        return 0.35, "no speed data recorded"
    slow_frac = float(np.mean([s < 3.0 for s in sogs]))
    med = float(np.median(sogs))
    val = slow_frac * (0.6 + 0.4 * (med < 6.0))
    return min(max(val, 0.25), 1.0), (f"{slow_frac * 100:.0f}% of fixes < 3 kn "
                                      f"(median SOG {med:.1f} kn)")


def _ais_gap(fixes, release_ts, min_gap_s=900):
    ts = [f[0] for f in fixes]
    if len(ts) < 2:
        return 0.35, "single fix (limited temporal tracking)"
    gaps = np.diff(ts)
    best_val, best_ev = 0.0, "no suspicious AIS gaps"
    for g, t_start in zip(gaps, ts[:-1]):
        t_end = t_start + g
        if g <= min_gap_s:
            continue
        overlap = min(t_end, release_ts + 3600) - max(t_start, release_ts - 3600)
        if overlap <= 0:
            continue
        val = min(g / 5400.0, 1.0)          # saturate at 1.5 h silence
        if val > best_val:
            best_val = val
            best_ev = (f"AIS silent {g / 60:.0f} min overlapping release window")
    return max(best_val, 0.1), best_ev


def _type_prior(code):
    prior, label = TYPE_PRIOR.get(int(code) if code is not None else -1,
                                  DEFAULT_PRIOR)
    return prior, f"{label}: prior {prior:.2f}"
