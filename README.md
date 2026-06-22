# Mission Manager

###### tags: `k7-autoware`, `react-vite`, `fastapi`, `cmu-svd`
A web-based user interface for monitoring and controlling autonomous robots. It consists of a FastAPI backend and a React-TypeScript frontend, containerized and orchestrated using Docker Compose. This project is developed for the `k7-autoware` robot simulation system as part of the Spring Validation Demo, providing a centralized interface for mission management, robot monitoring, and system interaction.

```
docker compose up --build
```
 The `--build` flag is only necessary for the initial setup or when modifying dummy node source files. For subsequent runs, a simple `docker compose up` is sufficient. Then open your browser with [`http://localhost:5050`](http://localhost:5050). 
