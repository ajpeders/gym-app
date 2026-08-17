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
# A copy of the dev database gives the tests the real 828-row catalog without a
# network fetch. Where there isn't one (CI), start empty: the suite creates the
# exercises it needs, so a missing catalog changes what is tested with, never
# whether the tests run.
if [ -f "$api/data/gym.db" ]; then
  cp "$api/data/gym.db" "$data/gym.db"
  ln -sfn "$api/data/exercise-media" "$data/exercise-media"
fi

cd "$api"
# The venv locally, whatever python has the deps in CI.
python="$api/.venv/bin/python"
[ -x "$python" ] || python="$(command -v python3)"

# ...except that a catalog of *nothing* does decide whether some tests can run:
# presets resolve their movements against it, the CSV import matches against it,
# and the exercise screen needs a row to open. Seed a small fixed catalog when
# the copy above didn't supply one. No-ops when it did, so local runs keep using
# the real 828-row dev catalog.
# PYTHONPATH, because running a script by path puts *its* directory on sys.path
# (e2e/), not the working directory — so `app` would not import.
GYM_DATA_DIR="$data" PYTHONPATH="$api" "$python" "$here/seed_catalog.py"

# The admin-bootstrap address: an install with no admin yet grants it to this
# email, which is how the operator tests sign in as one without a back door.
GYM_DATA_DIR="$data" GYM_SEED_ON_START=false GYM_ADMIN_EMAIL=e2e-admin@example.com \
  exec "$python" -m uvicorn app.main:app --host 127.0.0.1 --port "${E2E_API_PORT:-8011}"
