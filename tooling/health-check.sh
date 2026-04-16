#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

step() {
  echo
  echo "==> $1"
}

step "Docker daemon"
docker info >/dev/null

echo "OK: docker daemon reachable"

step "Build/update contracts toolchain image"
bash "${REPO_ROOT}/tooling/contracts-docker.sh" build-image

echo "OK: image built"

step "Pinned toolchain check"
bash "${REPO_ROOT}/tooling/contracts-docker.sh" check-toolchain

echo "OK: toolchain verified"

step "Contracts build"
bash "${REPO_ROOT}/tooling/contracts-docker.sh" build

echo "OK: build flow finished (factory warning may appear if known symbol collision persists)"

step "Contracts tests"
bash "${REPO_ROOT}/tooling/contracts-docker.sh" test

echo
echo "HEALTH CHECK PASSED"
