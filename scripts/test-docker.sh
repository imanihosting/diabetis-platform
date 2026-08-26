#!/usr/bin/env bash
# Runs every test suite inside the isolated Docker stack.
#
# Both suites run to completion and their results are reported together, so one
# failure does not hide the other's outcome. Exits non-zero if either failed.
set -uo pipefail

COMPOSE=(docker compose -f infra/docker/docker-compose.test.yml)
KEEP_UP="${KEEP_UP:-0}"

cleanup() {
  if [ "$KEEP_UP" = "1" ]; then
    echo ""
    echo "Stack left running (KEEP_UP=1). Tear down with: npm run test:docker:down"
  else
    echo ""
    echo "Tearing down the test stack..."
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
  fi
}
trap cleanup EXIT

# `docker compose run` does not rebuild, so the test images must be built
# explicitly or a code change would be silently tested against a stale image.
echo "==> Building images"
if ! "${COMPOSE[@]}" build migrate backend-tests engine-tests; then
  echo "Image build failed." >&2
  exit 1
fi

echo "==> Starting dependencies"
if ! "${COMPOSE[@]}" up -d --wait postgres minio; then
  echo "Failed to start the test dependencies." >&2
  exit 1
fi

echo "==> Creating the object storage bucket"
"${COMPOSE[@]}" run --rm --quiet-pull minio-init || exit 1

echo "==> Applying migrations"
"${COMPOSE[@]}" run --rm --quiet-pull migrate || exit 1

echo ""
echo "==> Backend suite (unit + integration)"
"${COMPOSE[@]}" run --rm --quiet-pull backend-tests
backend_status=$?

echo ""
echo "==> Metabolic engine suite"
"${COMPOSE[@]}" run --rm --quiet-pull engine-tests
engine_status=$?

echo ""
echo "──────────────────────────────────────────"
[ $backend_status -eq 0 ] && echo "  backend           PASS" || echo "  backend           FAIL (exit $backend_status)"
[ $engine_status  -eq 0 ] && echo "  metabolic-engine  PASS" || echo "  metabolic-engine  FAIL (exit $engine_status)"
echo "──────────────────────────────────────────"

[ $backend_status -eq 0 ] && [ $engine_status -eq 0 ] || exit 1
