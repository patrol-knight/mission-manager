FROM ros:humble
ARG USERNAME=USERNAME
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN if id -u $USER_UID ; then userdel `id -un $USER_UID` ; fi

RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && apt-get update \
    && apt-get install -y sudo \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME
    
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-scipy \
    python3-matplotlib \
    ros-humble-rosbridge-server  \
    ros-humble-nav2-map-server \
    ros-humble-nav2-lifecycle-manager \
    ros-humble-rqt-graph \
    && rm -rf /var/lib/apt/lists/*

USER $USERNAME
RUN echo "source /opt/ros/humble/setup.bash" >> /home/$USERNAME/.bashrc

ENV SHELL /bin/bash
CMD ["/bin/bash"]
