# Party QR Check-in

Mobile-first party ticketing and QR check-in for event teams. The app combines ticket creation, downloadable QR tickets, online scanning, guest search, manual fallback, event readiness checks, and a deliberately constrained emergency offline mode in one Cloudflare Workers application.

> This repository contains an event-operations application. It is not a public ticket marketplace or registration platform.

## Highlights

- Admin ticket creation with reusable referee names and cryptographically random `pt_...` QR tokens.
- Browser-side General and VIP/Special Guest artwork with guest, referee, Jalali purchase date, QR code, and PNG download.
- Mobile QR scanning with the rear-facing camera via `@zxing/browser`.
- Database-enforced duplicate check-in protection with Cloudflare D1.
- Online check-in for Admin, Primary Scanner, and Secondary Scanner roles.
- Guest search, referee/type filters, authoritative check-in status, totals, and Admin manual check-in.
- Admin ticket cancellation and restoration without changing the original QR token.
- Safe Admin corrections for guest/referee details and pre-check-in ticket type, with no hard deletion or QR replacement.
- Primary-only emergency offline scanning backed by IndexedDB and a Service Worker shell.
- Short-lived, asymmetric-signed offline scanner grants; normal authentication remains server-authoritative.
- Event Readiness screen for cache, camera, Service Worker, synchronization, and offline authorization checks.
- Structured server logging that avoids access codes and ticket tokens.
- Worker, D1, frontend, offline, concurrency, and authorization tests.

## Product flow

1. An Admin signs in and creates a ticket for a guest.
2. The app generates a private QR token and renders it into the ticket artwork.
3. Door staff scan the QR code online. D1 decides whether the ticket is valid, already used, cancelled, or invalid.
4. Admin staff can search the guest list and use the same backend check-in operation as the scanner.
5. Before an event, the Primary Scanner prepares an offline snapshot and a short-lived offline grant.
6. If connectivity fails, only the explicitly confirmed Primary Scanner may enter emergency offline mode.
7. Pending offline check-ins are synchronized after reconnection and conflicts remain visible for Admin review.

## Roles

| Role | Admin | Scanner | Guest list | Event Readiness | Offline scanning | Cancel/restore |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Admin | Yes | Online | Yes | Yes | No Primary privilege | Yes |
| Primary Scanner | No | Online/offline | Yes | Yes | Yes | No |
| Secondary Scanner | No | Online | Yes | No | No | No |

The frontend uses the server session endpoint as its online authentication source. Access codes and signing private keys are never shipped to browser code.

## Application routes

| Route | Purpose |
| --- | --- |
| `/login` | Staff access-code login |
| `/admin` | Admin ticket creation and ticket preview |
| `/scan` | Online QR scanning and Primary emergency offline scanning |
| `/guests` | Search, authoritative status, totals, and Admin manual check-in |
| `/readiness` | Primary device and event readiness verification |

## Architecture

```text
React + Vite + TypeScript frontend
        │
        │ HTTPS / same-origin API
        ▼
Cloudflare Worker
        │
        ├── signed session authentication and role authorization
        ├── ticket, check-in, guest, readiness, and offline APIs
        └── static asset serving with SPA fallback
        │
        ▼
Cloudflare D1
        ├── tickets
        ├── checkins (UNIQUE ticket_id)
        └── offline_conflicts

Primary device only:
Service Worker shell cache + IndexedDB ticket snapshot and pending queue
```

The database is the authority for online ticket and check-in state. The `checkins.ticket_id` unique constraint and conditional backend writes prevent two phones from both winning the first check-in.

## Technology

- React 19, React Router, Vite, and TypeScript.
- Plain CSS with a mobile-first dark interface.
- Cloudflare Workers static assets and API routes.
- Cloudflare D1 / SQLite migrations.
- `@zxing/browser` for camera scanning.
- Web Crypto for ticket tokens and signed offline grants.
- IndexedDB for explicit emergency offline state.

## Repository layout

```text
.
├── apps/
│   ├── web/                 # React/Vite frontend, tests, CSS, Service Worker
│   └── worker/              # Cloudflare Worker API and tests
├── migrations/              # Ordered D1 migrations
├── README.md                # Project overview and contributor guide
├── *.md                     # Deployment, event-day, acceptance, and project docs
├── package.json             # Workspace scripts
└── wrangler.jsonc           # Worker, D1, static asset, and secret configuration
```

## Requirements

- Node.js 20+ (use a current LTS release) and npm.
- Wrangler access for Worker/D1 development or deployment.
- A secure browser context for camera and Service Worker behavior; production must use HTTPS.

## Local development

Install the exact locked dependency tree:

```sh
npm ci
```

Create local-only secrets:

```sh
cp .dev.vars.example .dev.vars
```

Replace every example value in `.dev.vars`. Do not commit that file. For local offline-grant verification, configure the matching public key as `OFFLINE_GRANT_PUBLIC_KEY_SPKI` in the frontend build environment; the private key belongs only in Worker secrets.

Apply the local D1 migrations and start the Worker with its static frontend:

```sh
npm run db:migrate:local
npm run dev
```

Wrangler prints the local URL, normally `http://localhost:8787`. `npm run dev:web` starts only Vite and does not provide the Worker APIs.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the lockfile exactly |
| `npm run dev` | Build the frontend and run Wrangler locally |
| `npm run dev:web` | Run frontend-only Vite development |
| `npm run db:migrate:local` | Apply D1 migrations to local storage |
| `npm run typecheck` | Type-check both workspaces |
| `npm run test` | Run frontend, Worker unit, and Worker integration tests |
| `npm run build` | Build frontend and Worker dry-run output |
| `npm run verify` | Run typecheck, tests, and production build |
| `npm run deploy` | Build and deploy to Cloudflare |

## Configuration and secrets

Worker secrets are configured through Wrangler and must never be committed:

- `ADMIN_ACCESS_CODE`
- `PRIMARY_SCANNER_ACCESS_CODE`
- `SECONDARY_SCANNER_ACCESS_CODE`
- `SESSION_SECRET`
- `OFFLINE_GRANT_PRIVATE_KEY`

The public P-256 verification key may be embedded into the frontend build as `OFFLINE_GRANT_PUBLIC_KEY_SPKI`. It is not secret, but it must match the Worker private key. See [DEPLOYMENT.md](DEPLOYMENT.md) for key generation, D1 production migration, deployment, logs, rollback, and smoke-test procedures.

## Security model

- Online authentication is based only on the signed `__Host-party_session` cookie and `GET /api/auth/session`.
- Cookies are HttpOnly, Secure in production, SameSite, and finite-lived.
- Access codes are compared server-side and never exposed to the frontend.
- Ticket QR payloads contain an opaque token, not guest personal information.
- Duplicate protection is enforced by D1 and the shared Worker check-in service.
- The Primary offline grant is a narrow, twelve-hour capability for local scanning only; it cannot access Admin APIs or replace online authentication.
- Service Worker caching excludes every `/api/*` response.
- Never commit `.dev.vars`, private signing keys, backups, `.wrangler`, `node_modules`, or build output.

## Testing and release gate

Before merging or deploying, run:

```sh
npm run verify
```

The release gate covers TypeScript compilation, frontend tests, Worker unit tests, D1 integration tests, concurrency behavior, authentication and authorization, offline persistence, service-worker API exclusion, ticket cancellation, and production build output.

Operational verification is documented in:

- [EVENT_DAY_CHECKLIST.md](EVENT_DAY_CHECKLIST.md)
- [AUTH_ACCEPTANCE_CHECKLIST.md](AUTH_ACCEPTANCE_CHECKLIST.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)

## Current scope and limitations

- No public registration, payments, seating, messaging, analytics, or multi-event administration.
- Camera permissions, browser storage quotas, and offline behavior still require real-phone event-day verification.
- Offline acceptance is provisional until the server acknowledges synchronization; conflicting check-ins are not silently discarded.
- Offline grants expire absolutely and cannot be remotely revoked while a device is disconnected.

The included frontend currently carries the `DiveLine` deployment brand, but the application architecture and repository are intended to be reusable for other events and organizations.

## Contributing

Keep changes small and operationally obvious. Use TypeScript, avoid unnecessary dependencies, preserve the mobile-first UI, and run `npm run verify` before opening a pull request. Do not add features outside [PROJECT_SPEC.md](PROJECT_SPEC.md).

## License

This project is licensed under the [MIT License](LICENSE).
