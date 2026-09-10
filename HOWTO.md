# HOWTO

Step-by-step guides for common tasks. See `README.md` for the overview and
`ARCHITECTURE.md` for how the pieces fit together.

## The `companion` dependency

The API depends on the `companion` package (the provider seam and the
tool-calling coach), pinned in `api/requirements.txt`. It has been a **public**
repo since 2026-07-26 and is fetched anonymously over https, so there is
nothing to provision: local dev, CI and `docker build` all just work.

*Removed 2026-08-16:* the deploy-key setup this section used to describe. The
key had been unnecessary since the repo went public, and the BuildKit secret
that carried it was the only reason the API image couldn't be built on a host
without buildx — which is exactly the host a self-hoster has.

CI still rewrites the URL to the internal Forgejo hostname (see `ci.yml`),
because the runner can't resolve the public one.

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

Export the CSV from that app, then paste it into **History → "Coming from Hevy
or Strong?"** (it creates sessions, so it lives with them). The format is detected from the header row; sessions keep the
dates they happened on and warmups stay warmups. Movements the catalog can't
place are listed back to you rather than dropped.

`GET /api/sessions/export.csv` writes the same shape back out, so the export
can be re-imported — into this app, or as a way out of it.

## Log a set with Siri (or the Android equivalent)

There's no native App Intent, and there doesn't need to be one: the app answers
deep links, and Shortcuts can open a URL.

1. Shortcuts → new shortcut → **Dictate Text**.
2. Add **URL**, set it to `gymapp://log-chat?text=` and append the dictated text
   (Shortcuts' "Text" action with the variable inserted works).
3. Add **Open URLs**.
4. Name it "Log a set". "Hey Siri, log a set" now dictates, opens the app and
   parses the phrase — no tap.

The same URL works from anywhere: a home-screen shortcut, an NFC tag on your
gym bag, Tasker on Android. On the web build it's `/log-chat?text=…`.

The phrase goes through the same parser as typing it, so "bench three by eight
at sixty" becomes three sets — read by rules on the server, no AI provider
needed. A shortcut that fires twice logs once — the screen sends a deep-linked
phrase exactly once per arrival. In the app itself, **Say a set** on the
session screen does the same without a shortcut.

## Let people reset a forgotten password

The login screen has **Forgot password?**. It mails a six-digit code, good for
thirty minutes, if the API can send mail:

```sh
# in the API's environment
GYM_SMTP_HOST=smtp.example.com
GYM_SMTP_PORT=587            # default
GYM_SMTP_USER=gym@example.com
GYM_SMTP_PASSWORD=...
GYM_SMTP_FROM=gym@example.com   # defaults to the user, then gym@<host>
GYM_SMTP_STARTTLS=true       # default
```

With no `GYM_SMTP_HOST` the screen says the server can't send email and
points at whoever runs it: an admin can reset any password from **Admin**. The
reply never says whether an address has an account.

## Turn on "Continue with Google" (or GitHub)

Nothing social is configured by default, and an install with no client ids
shows no buttons at all. To enable one:

1. Create an OAuth client with the provider. The redirect URI is
   `https://<your-host>/api/auth/oauth/<provider>/callback`.
2. Set the credentials in the API's environment:

```sh
GYM_GOOGLE_CLIENT_ID=...      # and GYM_GOOGLE_CLIENT_SECRET
GYM_GITHUB_CLIENT_ID=...      # and GYM_GITHUB_CLIENT_SECRET
```

The button appears on the login screen as soon as the server advertises the
provider. The secret never reaches the app: the browser starts at
`/auth/oauth/<provider>/start`, the code is exchanged server-side, and only our
own session token comes back to the app's deep link.

Apple is deliberately refused for now — validating its id_token means verifying
against Apple's JWKS, and a sign-in that "probably" checked out is worse than
one that isn't offered.

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

## Check the app will build (no account needed)

Before touching EAS, two commands catch the things that fail a first build:

```sh
cd frontend
npx expo-doctor        # dependency + config compatibility
npm run prebuild:check # generates ios/ and android/, then cleans up
```

`expo prebuild` is the first thing an EAS build does, so a config that breaks
there breaks here first — cheaply, and without an Apple or Expo account. Both
run in CI.

## Build the app for a phone (EAS)

Expo Go is fine for development, but a real build is needed for distribution —
and later for a native App Intent, which doesn't exist in Expo Go. (Hands-free
logging already works today through the deep link above, no build needed.)

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
