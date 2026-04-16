#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="stellar-tickets-contracts:23.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash tooling/contracts-docker.sh build-image
  bash tooling/contracts-docker.sh check-toolchain
  bash tooling/contracts-docker.sh build
  bash tooling/contracts-docker.sh test
  bash tooling/contracts-docker.sh shell

Notes:
  - Runs Soroban contract tasks in Docker, without host Rust/stellar-cli.
  - Must be run from anywhere; script resolves repo root automatically.
EOF
}

run_in_container() {
  docker run --rm -it \
    -v "${REPO_ROOT}:/workspace" \
    -w /workspace/contracts \
    "${IMAGE_NAME}" \
    bash -c "$1"
}

cmd="${1:-}"
case "${cmd}" in
  build-image)
    docker build \
      -f "${REPO_ROOT}/tooling/docker/stellar-contracts.Dockerfile" \
      -t "${IMAGE_NAME}" \
      "${REPO_ROOT}"
    ;;
  check-toolchain)
    run_in_container "rustc --version && cargo --version && stellar --version && rustup target list --installed"
    ;;
  build)
    run_in_container "set -e; stellar contract build --package event_contract; if ! stellar contract build --package factory_contract; then echo 'WARN: factory_contract build failed (known symbol collision in current workspace setup).'; fi"
    ;;
  test)
    run_in_container "cargo test --workspace --verbose"
    ;;
  shell)
    docker run --rm -it \
      -v "${REPO_ROOT}:/workspace" \
      -w /workspace/contracts \
      "${IMAGE_NAME}" \
      bash
    ;;
  *)
    usage
    exit 1
    ;;
esac
