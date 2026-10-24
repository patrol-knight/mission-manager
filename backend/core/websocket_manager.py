import asyncio
import logging
import uuid
from typing import Coroutine

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}
        # Camera stream session_id -> the connection that started it.
        self._session_owners: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket) -> str:
        """Returns the connection's id, which the client gets in connection.ready."""
        await websocket.accept()
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        connection_id = uuid.uuid4().hex[:12]
        async with self._lock:
            self._connections[connection_id] = websocket
        return connection_id

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            gone = [cid for cid, ws in self._connections.items() if ws is websocket]
            for cid in gone:
                del self._connections[cid]
            self._session_owners = {s: cid for s, cid in self._session_owners.items() if cid not in gone}

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
            connections = list(self._connections.values())
        await asyncio.gather(*(self.send_json(websocket, message) for websocket in connections))

    def broadcast_threadsafe(self, message: dict) -> None:
        if self._loop is None:
            logger.warning("WebSocketManager loop not bound; dropping broadcast: %s", message)
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    def bind_session(self, session_id: str, connection_id: str) -> None:
        self._session_owners[session_id] = connection_id

    def unbind_session(self, session_id: str) -> None:
        self._session_owners.pop(session_id, None)

    def send_to_session_threadsafe(self, session_id: str, message: dict) -> None:
        """Sends to the connection that started this camera session; to everyone
        if that isn't known (e.g. it has reconnected since)."""
        websocket = self._connections.get(self._session_owners.get(session_id, ""))
        if websocket is None or self._loop is None:
            self.broadcast_threadsafe(message)
            return
        asyncio.run_coroutine_threadsafe(self.send_json(websocket, message), self._loop)

    def run_coroutine_threadsafe(self, coro: Coroutine) -> None:
        """Schedules a coroutine on the bound event loop from any thread
        (MissionDriveCoordinator's navigation timeout)."""
        if self._loop is None:
            logger.warning("WebSocketManager loop not bound; dropping scheduled coroutine")
            coro.close()  # avoid "coroutine was never awaited" warning
            return
        asyncio.run_coroutine_threadsafe(coro, self._loop)
