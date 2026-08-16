#!/usr/bin/env bash
# API server for the e2e suite.
#
# Runs against a throwaway copy of the dev database so the tests get a seeded
# exercise catalog (828 rows) without a network fetch, and can write freely
# without touching real data. Each run starts from a fresh copy; each test
# registers its own user, so tests never share state.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api="$here/../../api"
data="${E2E_DATA_DIR:-/tmp/gym-e2e-data}"

rm -rf "$data"
mkdir -p "$data"
cp "$api/data/gym.db" "$data/gym.db"
ln -sfn "$api/data/exercise-media" "$data/exercise-media"

cd "$api"
GYM_DATA_DIR="$data" GYM_SEED_ON_START=false \
  exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "${E2E_API_PORT:-8011}"
