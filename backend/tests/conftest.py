import pytest

from core.mission_server import MissionServer


@pytest.fixture
def mission_server(tmp_path) -> MissionServer:
    server = MissionServer(
        mission_folder=str(tmp_path / "missions"),
        app_state_path=str(tmp_path / "app_state.yaml"),
    )
    server.load()
    return server
