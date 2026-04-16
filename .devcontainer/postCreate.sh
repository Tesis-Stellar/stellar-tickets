#!/usr/bin/env bash
set -euo pipefail

RUST_VERSION="1.86.0"
STELLAR_CLI_VERSION="23.0.0"

if ! command -v rustup >/dev/null 2>&1; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION}"
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

rustup toolchain install "${RUST_VERSION}" --profile minimal
rustup default "${RUST_VERSION}"
rustup target add wasm32-unknown-unknown wasm32v1-none

if ! command -v cargo-binstall >/dev/null 2>&1; then
  cargo install cargo-binstall --locked
fi

cargo binstall --no-confirm "stellar-cli@${STELLAR_CLI_VERSION}"

echo "Rust version: $(rustc --version)"
echo "Cargo version: $(cargo --version)"
echo "Stellar CLI version: $(stellar --version)"
echo "Installed targets:"
rustup target list --installed
