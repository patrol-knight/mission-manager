"""Prints the OpenAPI schema (see tools/check.sh gen-api)."""

import json
import sys
from pathlib import Path

from pydantic.json_schema import models_json_schema

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app import create_app  # noqa: E402
from config import Settings  # noqa: E402
from models.anomaly import Anomaly  # noqa: E402
from models.device import DeviceView  # noqa: E402

# Only sent over the WebSocket, so no route puts them in the schema.
WEBSOCKET_MODELS = [Anomaly, DeviceView]

app = create_app(Settings(_env_file=None, zenoh_enabled=False))
schema = app.openapi()
_, extra = models_json_schema(
    [(m, "serialization") for m in WEBSOCKET_MODELS], ref_template="#/components/schemas/{model}"
)
for name, definition in extra.get("$defs", {}).items():
    schema["components"]["schemas"].setdefault(name, definition)
json.dump(schema, sys.stdout, indent=2, sort_keys=True)
sys.stdout.write("\n")
