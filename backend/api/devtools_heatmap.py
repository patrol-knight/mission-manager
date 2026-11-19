from fastapi import APIRouter, Depends

from api.deps import get_services
from bootstrap import Services
from models.heatmap import BaselineSpec, HeatmapConfig, HeatmapPreview, HeatmapState, PreviewRequest

router = APIRouter()


@router.get("", response_model=HeatmapState)
def get_state(services: Services = Depends(get_services)) -> HeatmapState:
    return services.heatmap.state()


@router.post("/preview", response_model=HeatmapPreview)
def preview(request: PreviewRequest, services: Services = Depends(get_services)) -> HeatmapPreview:
    return services.heatmap.preview(request)


@router.put("/config", status_code=204)
def save_config(config: HeatmapConfig, services: Services = Depends(get_services)) -> None:
    services.heatmap.save_config(config)


@router.put("/baseline", response_model=HeatmapState)
def save_baseline(spec: BaselineSpec, services: Services = Depends(get_services)) -> HeatmapState:
    return services.heatmap.save_baseline(spec)


@router.delete("/real", response_model=HeatmapState)
def clear_real(services: Services = Depends(get_services)) -> HeatmapState:
    return services.heatmap.clear_real()


@router.post("/real/merge", response_model=HeatmapState)
def merge_real(services: Services = Depends(get_services)) -> HeatmapState:
    return services.heatmap.merge_real()
