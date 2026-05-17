#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${RESULTS_DIR:-$ROOT_DIR/load-tests/results/$(date -u +%Y%m%dT%H%M%SZ)}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

mkdir -p "$RESULTS_DIR"
FAILED_CASES=()

run_case() {
  local name="$1"
  local file="$2"
  echo "==> k6 $name"
  set +e
  k6 run \
    --summary-export "$RESULTS_DIR/$name.summary.json" \
    "$ROOT_DIR/load-tests/$file" \
    2>&1 | tee "$RESULTS_DIR/$name.log"
  local status=${PIPESTATUS[0]}
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "$status" > "$RESULTS_DIR/$name.exitcode"
    FAILED_CASES+=("$name")
  fi
}

cat > "$RESULTS_DIR/environment.txt" <<EOF
BASE_URL=$BASE_URL
DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

export BASE_URL

run_case public-read public-read.k6.js

if [[ -n "${LOAD_TEST_EMAIL:-}" && -n "${LOAD_TEST_PASSWORD:-}" ]]; then
  run_case auth auth.k6.js
else
  echo "SKIP auth: define LOAD_TEST_EMAIL y LOAD_TEST_PASSWORD" | tee "$RESULTS_DIR/auth.skipped.txt"
fi

if [[ -n "${SCANNER_EMAIL:-}" && -n "${SCANNER_PASSWORD:-}" ]]; then
  run_case scanner scanner.k6.js
else
  echo "SKIP scanner: define SCANNER_EMAIL y SCANNER_PASSWORD" | tee "$RESULTS_DIR/scanner.skipped.txt"
fi

if [[ -n "${CHECKOUT_EMAIL:-}" && -n "${CHECKOUT_PASSWORD:-}" ]]; then
  run_case checkout-guard checkout-guard.k6.js
else
  echo "SKIP checkout-guard: define CHECKOUT_EMAIL y CHECKOUT_PASSWORD" | tee "$RESULTS_DIR/checkout-guard.skipped.txt"
fi

if [[ -n "${TRANSACTION_EMAIL:-}" && -n "${TRANSACTION_PASSWORD:-}" ]]; then
  run_case transactions-guard transactions-guard.k6.js
else
  echo "SKIP transactions-guard: define TRANSACTION_EMAIL y TRANSACTION_PASSWORD" | tee "$RESULTS_DIR/transactions-guard.skipped.txt"
fi

if [[ -n "${ADMIN_TOKEN:-}" || ( -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ) ]]; then
  run_case operational-read operational-read.k6.js
else
  echo "SKIP operational-read: define ADMIN_TOKEN o ADMIN_EMAIL y ADMIN_PASSWORD" | tee "$RESULTS_DIR/operational-read.skipped.txt"
fi

if [[ ( -n "${ADMIN_TOKEN:-}" || ( -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ) ) && ( -n "${STAFF_TOKEN:-}" || ( -n "${STAFF_EMAIL:-}" && -n "${STAFF_PASSWORD:-}" ) ) ]]; then
  run_case role-guard role-guard.k6.js
else
  echo "SKIP role-guard: define credenciales/token de ADMIN y STAFF" | tee "$RESULTS_DIR/role-guard.skipped.txt"
fi

if [[ "${#FAILED_CASES[@]}" -gt 0 ]]; then
  printf '%s\n' "${FAILED_CASES[@]}" > "$RESULTS_DIR/failed-cases.txt"
  echo "Escenarios con threshold/error: ${FAILED_CASES[*]}"
  echo "Resultados en: $RESULTS_DIR"
  exit 1
fi

echo "Resultados en: $RESULTS_DIR"
