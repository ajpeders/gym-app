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
EXPO_PUBLIC_API_URL=http://localhost:8000/api npx expo start
```

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
