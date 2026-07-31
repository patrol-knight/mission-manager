import uuid

from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter()


def _new_session_id() -> str:
    return f"req-{uuid.uuid4().hex[:12]}"


@router.post("/{device_id}/{camera_id}/stream", status_code=202)
def start_camera_stream(device_id: str, camera_id: str, request: Request) -> dict:
    """Kicks off WebRTC negotiation for one camera -- imperative REST intent
    only, matching every other command in this repo (see
    ../transport/zenoh_gateway.py::publish_command). The offer/answer/ICE
    exchange itself rides the existing WebSocket as camera.signal messages
    (see api/websocket.py), never this endpoint -- see
    ../../zenoh_bridge/docs/video_streaming_pipeline.md."""
    device = request.app.state.device_registry.get(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device not found: {device_id}")

    # zenoh_bridge doesn't actually populate DeviceState.capabilities today
    # (no field on the ROS gateway_msgs/msg/DeviceState.msg, nothing derives
    # "camera" from a configured camera before relaying to Zenoh -- see
    # ros_state_relay.cpp), so capabilities alone would reject every real
    # device. CameraRegistry (fed by the separate camera-state relay, which
    # *does* work today) is the reliable signal -- fall back to it whenever
    # capabilities hasn't caught up. Same rationale as the frontend's
    # DeviceInspectorOverlay.tsx hasCameraCapability fallback.
    known_camera = request.app.state.camera_registry.get(device_id)
    has_camera = "camera" in device.capabilities or (
        known_camera is not None and known_camera.camera_id == camera_id
    )
    if not has_camera:
        raise HTTPException(
            status_code=400, detail=f"Device has no camera capability: {device_id}"
        )
    if not device.connected:
        raise HTTPException(status_code=409, detail=f"Device not connected: {device_id}")

    session_id = _new_session_id()
    published = request.app.state.zenoh_gateway.publish_command(
        device_id, "start_camera_stream", session_id, {"camera_id": camera_id}
    )
    if not published:
        raise HTTPException(status_code=503, detail=f"Unable to reach device: {device_id}")

    return {"session_id": session_id}


@router.post("/{device_id}/{camera_id}/stream/{session_id}/stop", status_code=204)
def stop_camera_stream(device_id: str, camera_id: str, session_id: str, request: Request) -> Response:
    """Idempotent by design (matches zenoh_bridge's handle_stop): stopping an
    already-idle camera still succeeds. session_id isn't required to
    identify the stream server-side -- there's one active stream per
    camera_id -- but it's kept in the path to mirror the session the
    start-stream call handed back."""
    request.app.state.zenoh_gateway.publish_command(
        device_id, "stop_camera_stream", _new_session_id(), {"camera_id": camera_id}
    )
    return Response(status_code=204)
