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

## Run the frontend tests

Two suites, and they answer different questions.

```sh
cd frontend
npm test        # vitest: the pure logic in src/lib (the offline queue)
npm run e2e     # playwright: the whole stack in a browser
```

`npm run e2e` builds the web bundle first and then starts everything it needs:
an API on :8011 against a throwaway copy of `api/data/gym.db`, and a static
server for the build on :8012. Nothing is mocked and nothing touches your real
data — each test registers its own account.

While iterating on the tests themselves, `npm run e2e:fast` skips the rebuild.
**Rebuild whenever you change app code**, or you'll be testing the previous
bundle — the same trap as running the API without `--reload`. Useful flags:

```sh
npx playwright test 03-offline          # one spec
npx playwright test --headed            # watch it happen
npx playwright show-trace test-results/<dir>/trace.zip   # after a failure
```

If `api/data/gym.db` doesn't exist the API starts with an empty catalog and the
suite creates the exercises it needs, which is how it runs in CI. Locally the
copied database gives it the real 828-row catalog to search.

## Make yourself an admin

The operator view (accounts, crash reports, AI health, catalog state) needs
`role = "admin"`. On an install that has none yet, set the bootstrap address:

```sh
# in the API's environment
GYM_ADMIN_EMAIL=you@example.com
```

That account is treated as an admin from its next request, and can promote
others by setting `role` directly. It exists so granting the *first* admin
doesn't mean editing SQLite inside the container — which is the problem the
admin view is there to remove.

## Import a history from Hevy or Strong

Export the CSV from that app, then paste it into **Import → "Coming from Hevy
or Strong?"**. The format is detected from the header row; sessions keep the
dates they happened on and warmups stay warmups. Movements the catalog can't
place are listed back to you rather than dropped.

`GET /api/sessions/export.csv` writes the same shape back out, so the export
can be re-imported — into this app, or as a way out of it.

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
