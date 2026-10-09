import asyncio
import logging
from typing import Coroutine

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def send_json(self, websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_json(message)
        except Exception:
            logger.warning("Failed to send WebSocket message; dropping connection")
            await self.disconnect(websocket)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            connections = list(self._connections)
        for websocket in connections:
            await self.send_json(websocket, message)

    def broadcast_threadsafe(self, message: dict) -> None:
        if self._loop is None:
            logger.warning("WebSocketManager loop not bound; dropping broadcast: %s", message)
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    def run_coroutine_threadsafe(self, coro: Coroutine) -> None:
        """Schedules an arbitrary coroutine on the bound event loop from any
        thread -- same escape hatch as broadcast_threadsafe, used for
        MissionDriveCoordinator's navigation-timeout task."""
        if self._loop is None:
            logger.warning("WebSocketManager loop not bound; dropping scheduled coroutine")
            coro.close()  # avoid "coroutine was never awaited" warning
            return
        asyncio.run_coroutine_threadsafe(coro, self._loop)
