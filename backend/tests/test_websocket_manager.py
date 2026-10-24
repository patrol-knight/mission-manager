"""Camera signals reach only the connection that started the stream."""

import asyncio

from core.websocket_manager import WebSocketManager


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def accept(self) -> None:
        pass

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


def test_camera_signals_go_to_the_session_owner_only():
    async def scenario():
        manager = WebSocketManager()
        manager.bind_loop(asyncio.get_running_loop())
        owner, other = FakeSocket(), FakeSocket()
        owner_id = await manager.connect(owner)
        await manager.connect(other)

        manager.bind_session("s-1", owner_id)
        manager.send_to_session_threadsafe("s-1", {"type": "camera.signal"})
        manager.send_to_session_threadsafe("s-unknown", {"type": "camera.signal", "to": "all"})
        await asyncio.sleep(0.05)
        return owner.sent, other.sent

    owner_sent, other_sent = asyncio.run(scenario())
    assert len(owner_sent) == 2
    assert other_sent == [{"type": "camera.signal", "to": "all"}]
