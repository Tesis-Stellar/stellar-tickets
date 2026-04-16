FROM rust:1.86.0-bookworm

ARG STELLAR_CLI_VERSION=23.0.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    pkg-config \
    libssl-dev \
    libdbus-1-3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown wasm32v1-none

RUN curl -L --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash && \
    (cargo binstall --no-confirm stellar-cli@${STELLAR_CLI_VERSION} || cargo install --locked stellar-cli --version ${STELLAR_CLI_VERSION})

WORKDIR /workspace/contracts
