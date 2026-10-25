from fastapi import Request, WebSocket

from bootstrap import Services


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_ws_services(websocket: WebSocket) -> Services:
    return websocket.app.state.services
