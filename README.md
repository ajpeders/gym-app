# gym-app

An AI-assisted gym tracker. An Expo (React Native) frontend backed by a FastAPI
API, deployed on the homelab behind Traefik.

## Repo layout

- `api/` — FastAPI backend (SQLite state, JWT auth).
- `frontend/` — Expo app (also builds a static web bundle served via nginx).
- `ROADMAP.md` — the build plan / phases.

## Local development

Run the API (from `api/`):

```sh
uvicorn app.main:app --reload
```

Run the app (from `frontend/`), pointing it at the API:

```sh
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start
```

## Tests

Three suites, all run in CI (`.forgejo/workflows/ci.yml`):

```sh
cd api      && .venv/bin/python -m pytest -q   # 454 API tests
cd frontend && npm test                        # unit: offline queue, parsers, plate maths
cd frontend && npm run e2e                     # 71 journeys, real stack in a browser
```

`npm run e2e` builds the web bundle, starts an API against a throwaway copy of
the database, and drives the app in Chromium — nothing mocked. It rebuilds the
bundle each time; use `npm run e2e:fast` only when the app code hasn't changed.
Details in HOWTO → "Run the frontend tests".

## Self-host it anywhere

The compose file above is written for this homelab (Traefik, an external
network, a state path that only exists here). `docker-compose.selfhost.yml` is
the same app standing alone — two containers, published ports, a named volume,
nothing external:

```sh
GYM_JWT_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker-compose.selfhost.yml up -d
# then open http://localhost:8080
```

First boot seeds the exercise catalog from wger (a couple of minutes, once).
There's no default AI provider by design, and nothing needs one: logging,
voice and text sets, imports and catch-up all read notation by rules. To turn
on the Spotter, point `GYM_OLLAMA_URL` at your own Ollama or add a
Claude/OpenAI key on the Spotter screen. Set `GYM_ADMIN_EMAIL` to make your
account the operator, and `GYM_SMTP_HOST` (see HOWTO) if you want password
resets by email.

No TLS here — put it behind a proxy that terminates TLS before it leaves your
network.

## Deploy

This app plugs into the homelab `services/` stack via an `include:` in
`services/gym-app/docker-compose.yml`.

1. Copy `services/gym-app/.env.example` to `services/gym-app/.env` and fill in
   `GYM_DOMAIN`, `GYM_JWT_SECRET`, etc.
2. Bring it up:

   ```sh
   cd services && docker compose up -d gym-api gym-web
   ```

Traefik routes `https://${GYM_DOMAIN}` to the web frontend and
`https://${GYM_DOMAIN}/api` to the API (the `/api` router has higher priority
so it wins over the web catch-all). Access is restricted to LAN/VPN via the
`local-only@file` middleware.

## State & backups

SQLite state lives in `state/gym-app/` (mounted into `gym-api` at `/data`) and
is covered by the nightly homelab backup.
