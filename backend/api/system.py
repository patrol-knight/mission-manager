from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/status")
def get_system_status(request: Request) -> dict:
    """Curl-able status surface (matches this project's curl-based
    verification habit -- there's no pytest suite) so a degraded/unreachable
    Postgres is discoverable rather than only visible in backend logs. See
    core/anomaly_repository.py for the fail-soft persistence behavior this
    reports on."""
    repository = getattr(request.app.state, "anomaly_repository", None)
    return {
        "database": {
            "configured": repository is not None,
            "connected": repository.is_connected() if repository is not None else False,
        }
    }
