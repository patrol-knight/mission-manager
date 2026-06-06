FROM ros:humble

RUN apt-get update && apt-get install -y \
    python3-pip \
    ros-humble-rmw-cyclonedds-cpp \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install fastapi "uvicorn[standard]" pyyaml lanelet2 pyproj

WORKDIR /app
COPY . .

CMD ["/bin/bash", "-c", \
    "source /opt/ros/humble/setup.bash && \
     uvicorn main:app --host 0.0.0.0 --port 8000"]
