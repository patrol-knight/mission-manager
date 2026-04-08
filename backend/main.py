import asyncio
import threading
from contextlib import asynccontextmanager

import rclpy
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from core.map_server import MapServer
from core.state_manager import StateManager
from core.bridge_node import BridgeNode
from api import map as map_api

map_server    = MapServer()
state_manager = StateManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    map_server.load(
        # "maps/prc_powow_lot/lanelet2_map.osm",
        # "maps/prc_powow_lot/map_projector_info.yaml",
        "../maps/lanelet2_map.osm",
        "../maps/map_projector_info.yaml",
    )
    print("[FastAPI] Map loaded")

    if not rclpy.ok():
        rclpy.init()

    bridge = BridgeNode(state_manager, map_server=map_server)
    ros_thread = threading.Thread(target=rclpy.spin, args=(bridge,), daemon=True)
    ros_thread.start()
    print("[FastAPI] ROS2 bridge started")

    map_api.init(map_server, bridge)

    yield

    bridge.destroy_node()
    rclpy.shutdown()
    print("[FastAPI] Shutdown")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(map_api.router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            state = state_manager.get()
            if state is not None:
                await websocket.send_json(state)
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        pass
