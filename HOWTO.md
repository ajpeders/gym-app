# HOWTO

Step-by-step guides for common tasks. See `README.md` for the overview and
`ARCHITECTURE.md` for how the pieces fit together.

## Provision the `companion` deploy key

The API depends on the private `companion` package, fetched over **SSH**
(`git+ssh://git@git.thelunadog.com/alex/companion.git`). Local dev uses your own
SSH agent key; **CI and the Docker build need a dedicated read-only deploy key.**

One-time setup:

1. Generate a keypair (no passphrase, so it's usable non-interactively):

   ```sh
   ssh-keygen -t ed25519 -f companion_deploy_key -N "" -C "gym-app companion deploy"
   ```

2. Register the **public** half on the companion repo:
   `git.thelunadog.com/alex/companion` → Settings → Deploy Keys → add
   `companion_deploy_key.pub` (leave "Enable Write Access" **off**).

3. Install the **private** half (`companion_deploy_key`, the file *without* `.pub`)
   in both places that build the API:

   - **CI** — gym-app repo → Settings → Actions → Secrets → new secret
     **`COMPANION_DEPLOY_KEY`**, value = the full private-key file contents.
   - **Deploy** — set **`COMPANION_DEPLOY_KEY`** in `services/gym-app/.env` to the
     same contents. `docker-compose.yml` feeds it to the build as a BuildKit
     secret; it never lands in an image layer.

4. Delete the local key files once both halves are placed.

Until this exists, the CI `api` job and `docker compose build gym-api` fail to
fetch companion. Nothing else (frontend, local API dev) is affected.

## Run the API locally

From `api/`:

```sh
uvicorn app.main:app --reload
```

Serves on `http://localhost:8000`. SQLite state lands in `./data/gym.db`. Set a
real `GYM_JWT_SECRET` to silence the insecure-default warning.

## Run the app (Expo) locally

From `frontend/`, pointing it at the local API:

```sh
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start
```

Metro serves on `http://localhost:8081`; press `w` for web, or scan the QR with
Expo Go. First run needs `npm ci`.

## Run the backend tests

Tests import the app, which imports `companion` — so the test env needs it too.
With your own SSH key registered on the companion repo (or the deploy key above):

```sh
cd api
uv venv .venv
uv pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

`uv` resolves the wheels reliably; plain `pip` can struggle to build
`pydantic-core` without a toolchain. Expect one harmless `passlib`/`crypt`
deprecation warning.

## Add a database column

There's no Alembic. `init_db()` (in `api/app/db.py`) calls `create_all()` for new
*tables*, and `_ensure_columns()` ALTERs new *columns* onto existing tables. To
add a column: add it to the model in `models.py`, then append a
`(table, column, sqltype)` row to `_ADDED_COLUMNS`. It's idempotent — safe to run
against an existing DB.

## Deploy

See `README.md` → Deploy. In short: fill `services/gym-app/.env` (incl.
`COMPANION_DEPLOY_KEY` above), then from `services/`:

```sh
docker compose up -d --build gym-api gym-web
```

## Build the app for a phone (EAS)

Expo Go is fine for development, but a real build is needed for distribution —
and later for Siri / App Intents and on-device AI, neither of which exist in
Expo Go.

`frontend/eas.json` defines three profiles and `app.json` carries the bundle id
(`com.forgo.gymapp`) for both platforms. **One step still needs you**, because
it requires an interactive Expo login:

```sh
cd frontend
npx eas-cli login          # interactive — must be run by a human
npx eas-cli init           # writes extra.eas.projectId into app.json, once
```

Then build:

```sh
npx eas-cli build --profile development --platform ios   # dev client, simulator
npx eas-cli build --profile preview --platform android   # installable APK
npx eas-cli build --profile production --platform all
```

**Set the API URL before building.** A device build cannot reach
`localhost:8000` — that's the laptop, not the phone. Each profile pins
`EXPO_PUBLIC_API_URL` in `eas.json`; `preview` and `production` point at the
homelab host, so change them there if the hostname differs. The value is baked
in at build time, not read at runtime.
