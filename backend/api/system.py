from fastapi import APIRouter, Depends

from api.deps import get_services
from bootstrap import Services

router = APIRouter()


@router.get("/status")
def get_system_status(services: Services = Depends(get_services)) -> dict:
    """Curl-able status, so a degraded/unreachable Postgres is discoverable
    rather than only visible in backend logs (see core/anomaly_repository.py)."""
    repository = services.anomaly_repository
    return {
        "database": {
            "configured": repository is not None,
            "connected": repository.is_connected() if repository is not None else False,
        }
    }
