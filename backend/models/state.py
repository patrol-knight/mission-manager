from typing import Any

from pydantic import BaseModel


class WebSocketEvent(BaseModel):
    type: str
    data: Any = None
