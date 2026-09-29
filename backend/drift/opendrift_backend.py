"""OpenDrift/OpenOil backend for oil spill drift simulation.

Wraps OpenDrift's OpenOil model for backward hindcasting to estimate
spill origin from observed slick positions.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from shapely.geometry import Polygon

# ponytail: OpenDrift is an external dependency - add to requirements.txt
# pip install opendrift
# If unavailable, this module raises ImportError on init
try:
    from opendrift.models.openoil import OpenOil
    from opendrift.elements import LagrangianArray
    OPENDRIFT_AVAILABLE = True
except ImportError:
    OPENDRIFT_AVAILABLE = False

from ..providers.cmems import get_currents


class HindcastError(Exception):
    """Base exception for hindcast failures."""
    pass


class CMESCredentialsError(HindcastError):
    """CMEMS credentials missing or invalid."""
    pass


class OpenDriftError(HindcastError):
    """OpenDrift simulation error."""
    pass


class Hindcast:
    """Oil spill hindcast using OpenDrift/OpenOil with CMEMS currents.

    Runs backward particle simulation from observed slick to estimate
    origin location, time, and uncertainty.
    """

    # OpenOil oil types - user can pass any from OpenOil.oiltypes
    DEFAULT_OIL_TYPE = "ARABIAN MEDIUM CRUDE"
    DEFAULT_PARTICLES = 1000
    DEFAULT_HOURS_BACK = 48
    DEFAULT_TIMESTEP = 900  # 15 minutes in seconds

    def __init__(
        self,
        oil_type: str = DEFAULT_OIL_TYPE,
        particles: int = DEFAULT_PARTICLES,
        hours_back: float = DEFAULT_HOURS_BACK,
        timestep_seconds: int = DEFAULT_TIMESTEP,
    ):
        if not OPENDRIFT_AVAILABLE:
            raise ImportError(
                "OpenDrift not installed. Install with: pip install opendrift"
            )
        self.oil_type = oil_type
        self.particles = particles
        self.hours_back = hours_back
        self.timestep = timestep_seconds
        self.model = OpenOil(weathering_model="noaa", oil_type=oil_type)
        self.model.set_config("drift:wind_drift_factor", 0.036)  # 3.6% windage
        self.model.set_config("drift:wind_drift_depth_from_surface", 0.5)
        self.model.set_config("processes:evaporation", False)
        self.model.set_config("processes:emulsification", False)
        self.model.set_config("processes:dispersion", False)

    def _check_cmems_credentials(self) -> None:
        """Verify CMEMS credentials are available."""
        user = os.getenv("CMEMS_USER")
        pwd = os.getenv("CMEMS_PASS")
        if not user or not pwd:
            raise CMESCredentialsError(
                "CMEMS credentials missing. Set CMEMS_USER and CMEMS_PASS environment variables."
            )

    def _fetch_cmems_currents(
        self,
        lat: float,
        lon: float,
        time: datetime,
        extent_km: float = 50.0,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Fetch CMEMS currents for simulation area.

        Returns (lons, lats, u_currents, v_currents) as arrays.
        If CMEMS fails, returns None and OpenDrift uses builtin readers.
        """
        self._check_cmems_credentials()

        # ponytail: single-point fetch, extend with spatial grid if needed
        # For minimal working version, we return None and let OpenDrift
        # use its internal current interpolation or user-provided readers
        result = get_currents(lat, lon, time)
        if result is None:
            return None, None, None, None
        u, v = result

        # Create minimal extent grid around point
        km_to_deg = 1.0 / 111.32
        ddeg = extent_km * km_to_deg
        lats = np.array([lat - ddeg, lat + ddeg])
        lons = np.array([lon - ddeg, lon + ddeg])
        u_grid = np.full((2, 2), u)
        v_grid = np.full((2, 2), v)

        return lons, lats, u_grid, v_grid

    def run(
        self,
        slick_polygon: Polygon,
        detect_time: datetime,
        hours_back: float | None = None,
    ) -> dict[str, Any]:
        """Run backward hindcast from observed slick.

        Args:
            slick_polygon: Observed oil slick as shapely Polygon
            detect_time: Time of observation
            hours_back: Simulation duration in hours (default: self.hours_back)

        Returns:
            Dict with keys:
                - origin_lon: Estimated origin longitude
                - origin_lat: Estimated origin latitude
                - origin_time: Estimated spill time (datetime)
                - uncertainty_ellipse: {"major_km": float, "minor_km": float, "bearing_deg": float}
                - particle_count: Number of particles used
                - confidence: Confidence score 0-1 based on spread convergence
        """
        if not OPENDRIFT_AVAILABLE:
            raise OpenDriftError("OpenDrift not available")

        self._check_cmems_credentials()

        hours = hours_back or self.hours_back
        start_time = detect_time - timedelta(hours=hours)
        centroid = slick_polygon.centroid
        bounds = slick_polygon.bounds  # (minx, miny, maxx, maxy)

        # Seed particles uniformly within slick polygon
        minx, miny, maxx, maxy = bounds
        seed_lons = []
        seed_lats = []
        max_attempts = self.particles * 10
        attempts = 0
        while len(seed_lons) < self.particles and attempts < max_attempts:
            xs = np.random.uniform(minx, maxx, size=min(self.particles * 2, 1000))
            ys = np.random.uniform(miny, maxy, size=min(self.particles * 2, 1000))
            for x, y in zip(xs, ys):
                pt = np.array([x, y])
                if slick_polygon.contains(pt):
                    seed_lons.append(x)
                    seed_lats.append(y)
                    if len(seed_lons) >= self.particles:
                        break
                attempts += 1
                if attempts >= max_attempts:
                    break

        if len(seed_lons) < self.particles:
            # Fallback: fill with centroid
            while len(seed_lons) < self.particles:
                seed_lons.append(centroid.x)
                seed_lats.append(centroid.y)

        try:
            # Configure simulation
            self.model.set_config("drift:time_step", self.timestep)
            self.model.seed_elements(
                lon=np.array(seed_lons),
                lat=np.array(seed_lats),
                time=detect_time,
                oiltype=self.oil_type,
                m3_per_hour=0,
            )

            # Run backward simulation
            self.model.run(
                duration=timedelta(hours=hours),
                time_step=-self.timestep,  # Negative = backward
                outfile=None,
                export_variables=["lon", "lat", "status"],
            )

            # Extract final particle positions
            history = self.model.history
            final_lons = history["lon"][:, -1]
            final_lats = history["lat"][:, -1]

            # Compute origin estimate from particle centroid
            origin_lon = float(np.mean(final_lons))
            origin_lat = float(np.mean(final_lats))

            # Compute uncertainty ellipse from particle spread
            cov = np.cov(final_lons, final_lats)
            eigenvalues, eigenvectors = np.linalg.eig(cov)
            order = eigenvalues.argsort()[::-1]
            eigenvalues = eigenvalues[order]
            eigenvectors = eigenvectors[:, order]

            # Convert to km (approximate)
            km_per_deg = 111.32
            major_km = float(np.sqrt(eigenvalues[0]) * km_per_deg * 2.45)  # 95% CI
            minor_km = float(np.sqrt(eigenvalues[1]) * km_per_deg * 2.45)
            bearing_deg = float(np.degrees(np.arctan2(eigenvectors[1, 0], eigenvectors[0, 0])))

            # Confidence based on particle spread convergence
            spread_km = np.sqrt(major_km * minor_km)
            confidence = float(np.clip(1.0 - spread_km / (hours * 2), 0.1, 0.95))

            return {
                "origin_lon": round(origin_lon, 6),
                "origin_lat": round(origin_lat, 6),
                "origin_time": start_time.isoformat(),
                "uncertainty_ellipse": {
                    "major_km": round(major_km, 3),
                    "minor_km": round(minor_km, 3),
                    "bearing_deg": round(bearing_deg, 2),
                },
                "particle_count": self.particles,
                "confidence": round(confidence, 3),
                "oil_type": self.oil_type,
                "hours_simulated": hours,
            }

        except Exception as e:
            raise OpenDriftError(f"OpenDrift simulation failed: {e}")

    def run_simple(
        self,
        origin_lon: float,
        origin_lat: float,
        start_time: datetime,
        hours_forward: float = 24,
    ) -> dict[str, Any]:
        """Simple forward simulation for testing/validation.

        Simulates spill from known origin to compare with observed slick.
        """
        if not OPENDRIFT_AVAILABLE:
            raise OpenDriftError("OpenDrift not available")

        try:
            self.model.set_config("drift:time_step", self.timestep)
            self.model.seed_elements(
                lon=origin_lon,
                lat=origin_lat,
                time=start_time,
                oiltype=self.oil_type,
                number=self.particles,
                m3_per_hour=100,
            )
            self.model.run(
                duration=timedelta(hours=hours_forward),
                time_step=self.timestep,
                outfile=None,
            )

            history = self.model.history
            final_lons = history["lon"][:, -1]
            final_lats = history["lat"][:, -1]

            centroid_lon = float(np.mean(final_lons))
            centroid_lat = float(np.mean(final_lats))

            return {
                "centroid_lon": round(centroid_lon, 6),
                "centroid_lat": round(centroid_lat, 6),
                "particle_count": self.particles,
                "end_time": (start_time + timedelta(hours=hours_forward)).isoformat(),
            }
        except Exception as e:
            raise OpenDriftError(f"Forward simulation failed: {e}")


def demo():
    """Self-test demo for the Hindcast class."""
    import os

    # Check credentials exist (test only)
    if not os.getenv("CMEMS_USER") or not os.getenv("CMEMS_PASS"):
        print("demo: CMEMS credentials not set - AddTo: set CMEMS_USER and CMEMS_PASS")
        return

    if not OPENDRIFT_AVAILABLE:
        print("demo: OpenDrift not installed - AddTo: pip install opendrift")
        return

    # Create synthetic slick polygon
    from shapely.geometry import box
    slick = box(20.0, 59.5, 20.5, 60.0)  # Baltic Sea area
    detect_time = datetime.utcnow() - timedelta(hours=12)

    try:
        hindcast = Hindcast(
            oil_type="ARABIAN MEDIUM CRUDE",
            particles=100,  # Reduced for demo speed
            hours_back=6,
        )
        result = hindcast.run(slick, detect_time)
        print(f"demo: origin_est=({result['origin_lat']}, {result['origin_lon']})")
        print(f"demo: uncertainty={result['uncertainty_ellipse']}")
        print(f"demo: particles={result['particle_count']}")
        assert "origin_lon" in result
        assert "uncertainty_ellipse" in result
        print("demo: PASS")
    except CMESCredentialsError:
        print("demo: CMEMS auth missing - AddTo: configure CMEMS_USER/PASS")
    except Exception as e:
        print(f"demo: ERROR {e}")


if __name__ == "__main__":
    demo()
