"""Live AIS provider - aisstream.io (global coverage via WebSocket).
Free tier requires API key (get at https://aisstream.io/).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import websockets

log = logging.getLogger("ais")

WS_URL = "wss://stream.aisstream.io/v0/stream"
INDIA_COAST_BBOX = (68.0, 8.0, 92.0, 24.0)


class AisProvider:
    def __init__(self, store, settings, api_key: str | None = None):
        self.store = store
        self.settings = settings
        self.api_key = api_key or getattr(settings, "aisstream_api_key", None)
        self.bbox = getattr(settings, "aoi_bbox", INDIA_COAST_BBOX)
        self.latest: dict[int, dict] = {}
        self.last_update = 0.0
        self.last_poll: float | None = None
        self.error: str | None = None
        self.running = False
        self._task = None
        log.info("AIS provider (aisstream) initialized for bbox %s", self.bbox)

    async def close(self) -> None:
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def _in_aoi(self, lon: float, lat: float) -> bool:
        x0, y0, x1, y1 = self.bbox
        return x0 <= lon <= x1 and y0 <= lat <= y1

    async def _connect_and_stream(self, broadcast=None):
        reconnect_delay = 1.0
        while self.running:
            try:
                log.info("Connecting to aisstream...")
                async with websockets.connect(WS_URL) as ws:
                    reconnect_delay = 1.0
                    self.error = None
                    subscribe_msg = {
                        "APIKey": self.api_key,
                        "BoundingBoxes": [[[self.bbox[1], self.bbox[0]], [self.bbox[3], self.bbox[2]]]],
                        "FilterMessageTypes": ["PositionReport", "ShipStaticData", "StandardClassBPositionReport"]
                    }
                    await ws.send(json.dumps(subscribe_msg))
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=10)
                        data = json.loads(msg)
                        if data.get("MessageType") == "SubscriptionConfirmation":
                            log.info("AIS subscription confirmed")
                    except asyncio.TimeoutError:
                        log.warning("AIS subscription timeout")
                        continue
                    async for msg in ws:
                        if not self.running:
                            break
                        try:
                            await self._handle_message(json.loads(msg))
                        except Exception:
                            pass
            except websockets.ConnectionClosed:
                log.warning("AIS connection closed, reconnecting in %ss...", reconnect_delay)
            except Exception as exc:
                self.error = str(exc)
                log.error("AIS error: %s", exc)
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60.0)

    async def _handle_message(self, data: dict) -> None:
        msg_type = data.get("MessageType", "")
        meta = data.get("Metadata", {})
        mmsi = meta.get("MMSI")
        if not mmsi:
            return
        if msg_type == "PositionReport":
            pos = data.get("PositionReport", {})
            lat, lon = pos.get("Latitude"), pos.get("Longitude")
            if lat is None or lon is None or not self._in_aoi(lon, lat):
                return
            ts_str = meta.get("Timestamp")
            ts = time.time()
            if ts_str:
                try:
                    from datetime import datetime
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
                except Exception:
                    pass
            vessel = {"mmsi": int(mmsi), "ts": ts, "lon": lon, "lat": lat,
                      "sog": pos.get("Sog"), "cog": pos.get("Cog"), "navStat": pos.get("NavigationalStatus")}
            self.latest[vessel["mmsi"]] = vessel
            self.store.upsert_positions([(vessel["mmsi"], vessel["ts"], vessel["lon"], vessel["lat"], vessel["sog"], vessel["cog"], vessel["navStat"])])
            self.last_update = time.time()
            self.last_poll = self.last_update
        elif msg_type == "ShipStaticData":
            static = data.get("ShipStaticData", {})
            dim = static.get("Dimension", {})
            vessel_info = {"mmsi": int(mmsi), "name": static.get("Name"), "imo": static.get("ImoNumber"),
                           "callSign": static.get("CallSign"), "shipType": static.get("Type"),
                           "length": dim.get("A", 0) + dim.get("B", 0), "width": dim.get("C", 0) + dim.get("D", 0),
                           "destination": static.get("Destination"), "draught": static.get("Draught")}
            self.store.upsert_vessels([vessel_info])
        elif msg_type == "StandardClassBPositionReport":
            pos = data.get("StandardClassBPositionReport", {})
            lat, lon = pos.get("Latitude"), pos.get("Longitude")
            if lat and lon and self._in_aoi(lon, lat):
                self.store.upsert_positions([(int(mmsi), time.time(), lon, lat, pos.get("Sog"), pos.get("Cog"), None)])

    async def poll_once(self) -> int:
        return len(self.latest)

    async def refresh_metadata(self, force: bool = False) -> None:
        pass

    async def run(self, broadcast=None) -> None:
        if not self.api_key:
            raise RuntimeError("aisstream_api_key required")
        self.running = True
        self._task = asyncio.create_task(self._connect_and_stream(broadcast))
        while self.running:
            await asyncio.sleep(1)
