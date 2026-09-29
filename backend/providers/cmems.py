"""CMEMS ocean current provider via copernicusmarine package.

Uses the NRT (Near Real Time) analysis product for surface currents.
Credentials: CMEMS_USER and CMEMS_PASS environment variables.
"""
from __future__ import annotations

import os
from datetime import datetime

import copernicusmarine
import numpy as np


def get_currents(lat: float, lon: float, time: datetime) -> tuple[float, float] | None:
    """Fetch ocean current (u, v) in m/s from CMEMS at given position and time.

    Returns (None, None) if credentials missing or data unavailable.
    """
    user = os.getenv("CMEMS_USER")
    pwd = os.getenv("CMEMS_PASS")
    if not user or not pwd:
        return None

    dataset_id = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m"

    try:
        subset = copernicusmarine.open_dataset(
            dataset_id=dataset_id,
            username=user,
            password=pwd,
            variables=["uo", "vo"],
            minimum_longitude=lon - 0.01,
            maximum_longitude=lon + 0.01,
            minimum_latitude=lat - 0.01,
            maximum_latitude=lat + 0.01,
            start_datetime=time,
            end_datetime=time,
        )
    except Exception:
        return None

    if subset is None:
        return None

    uo = subset.get("uo")
    vo = subset.get("vo")
    if uo is None or vo is None:
        return None

    u = float(np.nanmean(uo.values))
    v = float(np.nanmean(vo.values))

    if np.isnan(u) or np.isnan(v):
        return None

    return u, v


if __name__ == "__main__":
    result = get_currents(60.0, 20.0, datetime.utcnow())
    print(f"u={result[0]}, v={result[1]}" if result else "No data")
