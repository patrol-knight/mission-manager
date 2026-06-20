# Mission Manager
###### tags: `f1tenth`, `react-vite`, `roslib.js`, `nginx`

A containerized React frontend designed for controlling and monitoring the `f1tenth` robot stack via ROS Bridge. The application is served via Nginx and lightweight user interface supports dynamic runtime configuration of the ROS Bridge WebSocket address using environment variables.

## Quick Start
Fetch the latest production-ready image from Dockerhub

```shell
docker pull kokolates/patrolknight-ui:latest
```

Launch the application server locally

```shell
docker run --rm -p 3000:80 kokolates/patrolknight-ui:latest
```

Then open your browser with [`http://localhost:3000`](http://localhost:3000). Ensure your robot stack or simulation is running and the `rosbridge server` node is active. Once connected successfully, the map and robot telemetry will automatically render.

## Robot Configuration

By default, the application attempts to connect to `ws://localhost:9090` (ideal for local dummy testing). To connect the interface to a physical robot or a remote simulation, inject the robot's IP address using the `ROSBRIDGE_URL` environment variable.

```shell
docker run --rm \
    -p 3000:80 \
    -e ROSBRIDGE_URL=ws://<ROBOT_IP_ADDRESS>:9090 \
    kokolates/patrolknight-ui:latest
```

## Local Testing (Dummy Nodes)
If you don't have a physical robot ready, the repository includes mocked ROS nodes (Robot Position, Map Server, and a Simple Planner) for local validation. Navigate to the workspace directory and launch the container orchestration:

```shell
cd workspace
docker compose up --build
```

(Note: The `--build` flag is only necessary for the initial setup or when modifying dummy node source files. For subsequent runs, a simple `docker compose up` is sufficient.) To clean up and stop all running dummy nodes, execute:

```shell
docker compose down
```
