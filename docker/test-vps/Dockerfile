FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    openssh-server \
    tmux \
    git \
    sudo \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /run/sshd

COPY sshd_config /etc/ssh/sshd_config
COPY setup-test-user.sh /setup-test-user.sh
RUN chmod +x /setup-test-user.sh && /setup-test-user.sh

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
