# Tools

Developer tools, not part of the deployed app.

| Tool | What it does |
|---|---|
| `check.sh` | Runs the same checks as CI, so a PR that passes here passes there |
| `export_openapi.py` | Prints the backend's OpenAPI schema; `check.sh gen-api` turns it into `frontend/src/api/schema.ts` |
| `analyzer/` | Turns a devtools run in `data/runs/<run>` into plots and `summary.md`: `python -m tools.analyzer data/runs/<run>` |

## Checks

```bash
tools/check.sh                   # backend, frontend and contract
tools/check.sh all               # those plus docker
tools/check.sh backend frontend  # only the named checks
tools/check.sh gen-api           # regenerate frontend/src/api/schema.ts
```

| Check | Runs | Needs |
|---|---|---|
| `backend` | ruff, pytest | `pip install --group dev` in `backend/` (pip >= 25.1) |
| `frontend` | eslint, vitest, type-check + build | `npm ci` in `frontend/` |
| `contract` | `frontend/src/api/schema.ts` matches the backend's API | both of the above |
| `docker` | builds the images, starts the stack and checks each service answers | Docker, ports 8000 and 5050 free |

Python comes from `$PYTHON`, else `backend/.venv`, else `python3`.

## Notes

- **backend**: the tests run the real app on a temporary copy of `backend/storage/`, with a fake
  robot, anomaly source and straight-line map, so no Zenoh or devices are needed. The lanelet2 map
  tests are skipped when lanelet2 isn't installed.
- **contract**: the frontend's wire types come from `schema.ts`, generated from the backend's OpenAPI
  schema. After changing a backend model or route, run `gen-api` and commit the result. WebSocket-only
  messages (camera signals, `autonomy.aborted`, `anomaly.expired`) aren't in the schema and are typed
  by hand.
- **docker** runs as its own compose project (`mission-manager-smoke`), so your usual stack's
  containers and volumes are untouched.

## CI

`.github/workflows/ci.yml` runs one job per check on pull requests into `main` (not drafts), on
merges into `main`, and on demand from the Actions tab. Pushes to `feat/*` branches don't trigger it.
