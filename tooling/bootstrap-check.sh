#!/usr/bin/env bash
set -euo pipefail

echo "== Toolchain checks =="
rustc --version
cargo --version
stellar --version

if rustup target list --installed | grep -q "wasm32v1-none"; then
  echo "OK: wasm32v1-none installed"
else
  echo "ERROR: wasm32v1-none missing"
  exit 1
fi

echo "== Build contracts =="
cd contracts
stellar contract build --package event_contract
stellar contract build --package factory_contract
cargo test --workspace

echo "All checks passed"
