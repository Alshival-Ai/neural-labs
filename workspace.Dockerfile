FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    iproute2 \
    less \
    locales \
    openssh-client \
    procps \
    sudo \
    tini \
    util-linux \
  && curl -fsSL https://code-server.dev/install.sh | sh \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/neural-labs \
  && chmod 0775 /home/neural-labs

WORKDIR /home/neural-labs
ENV HOME=/home/neural-labs

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["tail", "-f", "/dev/null"]
