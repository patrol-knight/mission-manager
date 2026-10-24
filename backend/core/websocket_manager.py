import asyncio
import logging
import threading
import uuid
from typing import Coroutine

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        # connection_id <-> WebSocket. A plain lock: is_connected() is also
        # asked from Zenoh's threads.
        self._ids_lock = threading.Lock()
        self._by_id: dict[str, WebSocket] = {}
        self._ids: dict[WebSocket, str] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket) -> str:
        """Accepts the connection and returns its connection_id -- the
        identifier a client quotes to own a camera session's signaling."""
        await websocket.accept()
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        connection_id = uuid.uuid4().hex
        with self._ids_lock:
            self._by_id[connection_id] = websocket
            self._ids[websocket] = connection_id
        async with self._lock:
            self._connections.add(websocket)
        return connection_id

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)
        with self._ids_lock:
            connection_id = self._ids.pop(websocket, None)
            if connection_id is not None:
                self._by_id.pop(connection_id, None)

    def is_connected(self, connection_id: str) -> bool:
        with self._ids_lock:
            return connection_id in self._by_id

    async def send_to(self, connection_id: str, message: dict) -> bool:
        """Sends to one connection only. False if it's gone (or the send
        failed and dropped it)."""
        with self._ids_lock:
            websocket = self._by_id.get(connection_id)
        if websocket is None:
            return False
        try:
            await websocket.send_json(message)
        except Exception:
            logger.warning("Failed to send WebSocket message to %s; dropping connection", connection_id)
            await self.disconnect(websocket)
            return False
        return True

    def send_to_threadsafe(self, connection_id: str, message: dict) -> None:
        if self._loop is None:
            logger.warning("WebSocketManager loop not bound; dropping message to %s", connection_id)
            return
        asyncio.run_coroutine_threadsafe(self.send_to(connection_id, message), self._loop)

    async def send_json(self, websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_json(message)
        except Exception:
            logger.warning("Failed to send WebSocket message; dropping connection")
            await self.disconnect(websocket)
            # So the client notices and reconnects.
            try:
                await websocket.close()
            except Exception:
                pass

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            connections = list(self._connections)
        await asyncio.gather(*(self.send_json(websocket, message) for websocket in connections))

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
