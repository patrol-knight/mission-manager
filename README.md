# Mission Manager
A containerized React frontend for controlling and monitoring the robot stack via ROS Bridge. The application is served using Nginx, and supports runtime configuration of the ROS bridge address through environment variables.

## Quick Start

Pull the latest image from Dockerhub

```shell
docker pull kokolates/patrolknight-ui:latest
```

Run the application server inside docker container

```shell
docker run --rm -p 3000:80 kokolates/patrolknight-ui:latest
```

Then open your browser with `http://localhost:3000`. Remeber to launch your robot stack with `rosbridge server`. If the `rosbridge_server` is successfully connected, you can see your map and robot information.

## Robot Configuration

The current bridge IP is set as `ws://localhost:9090` which is mainly for dummy testing on developing computer. To connect the user interface to your robot, you have to connect your computer to the robot, and then check the IP of robot. 

```shell
docker run --rm \
    -p 3000:80 \
    -e ROSBRIDGE_URL=ws://<ROBOT_IP_ADDRESS>:9090 \
    kokolates/patrolknight-ui:latest
```

## Dummy Nodes
There are dummy nodes for robot position, map server, and simple planner. 

```shell
cd workspace
docker compose up --build
```

You only have to build image when you run it first time, then you can just simple `docker compose up` to launch the container. And after testing, just run

```shell
docker compose down
```
