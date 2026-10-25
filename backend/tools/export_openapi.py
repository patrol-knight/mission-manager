"""Prints the OpenAPI schema (see scripts/gen-api-types.sh)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from config import Settings  # noqa: E402

app = create_app(Settings(_env_file=None, zenoh_enabled=False, database_url=None))
json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
sys.stdout.write("\n")
