# Production Deployment

This application deploys as one Cloudflare Worker named `party-check-in`. The Worker serves the Vite frontend from `apps/web/dist`, handles `/api/*` before static assets, and binds D1 as `env.DB`.

## Deployment gates

Do not deploy until all of these are true:

- Wrangler is authenticated to the intended Cloudflare account.
- `wrangler.jsonc` contains the real production D1 UUID, not `00000000-0000-0000-0000-000000000000`.
- The five required Worker secrets exist, including the offline-grant P-256 private key.
- `apps/web/offline-grant-public.spki.b64` contains the public key matching the Worker private key.
- `npm run verify` passes.
- The remote database export and Time Travel bookmark have been recorded before migration.

The current repository cannot verify the Cloudflare account, production hostname, D1 UUID, or deployed secrets without Cloudflare authentication. Those are mandatory operator checks below.

## Install dependencies

Use the committed lockfile from the repository root:

```sh
npm ci
```

Confirm the installed Wrangler version:

```sh
npx wrangler --version
```

## Local development

Create a local-only secrets file and replace every example value. All five values must be non-empty, the three access codes must be distinct, and `SESSION_SECRET` must contain at least 32 bytes of unpredictable data. Configure the public build value using the key-generation procedure below before starting or building the application.

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

The full application is then available at the URL printed by Wrangler, normally `http://localhost:8787`. `npm run dev:web` starts only Vite and does not provide the Worker APIs.

Run local verification separately:

```sh
npm run typecheck
npm run test
npm run build
```

There is no configured lint or formatting script.

## Authenticate Wrangler

For an interactive workstation:

```sh
npx wrangler login
npx wrangler whoami
```

For CI, provide a scoped `CLOUDFLARE_API_TOKEN` through the CI secret store. Never commit that token or put production secrets in `.dev.vars`.

## Create and bind production D1

List existing databases first:

```sh
npx wrangler d1 list
```

If `party-check-in` does not exist, create it:

```sh
npx wrangler d1 create party-check-in
```

Copy the returned `database_id` into the `DB` entry in `wrangler.jsonc`, replacing the all-zero placeholder. Verify the selected database:

```sh
npx wrangler d1 info party-check-in
npx wrangler d1 migrations list party-check-in --remote
```

The production binding must remain:

- binding: `DB`
- database name: `party-check-in`
- migrations directory: `migrations`

## Set required Worker secrets

### Generate the offline-grant signing key

Generate one P-256 key pair in a private temporary directory. The PKCS#8 private key is a Worker secret; the SPKI public key is intentionally embedded in the frontend build.

```sh
offline_key_dir="$(mktemp -d)"
chmod 700 "$offline_key_dir"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve -out "$offline_key_dir/offline-grant-private.pem"
openssl pkcs8 -topk8 -nocrypt -in "$offline_key_dir/offline-grant-private.pem" -outform DER | openssl base64 -A > "$offline_key_dir/offline-grant-private.pkcs8.b64"
openssl pkey -in "$offline_key_dir/offline-grant-private.pem" -pubout -outform DER | openssl base64 -A > "$offline_key_dir/offline-grant-public.spki.b64"
chmod 600 "$offline_key_dir"/*
```

Set the private key directly from the generated file so it does not enter shell history:

```sh
npx wrangler secret put OFFLINE_GRANT_PRIVATE_KEY < "$offline_key_dir/offline-grant-private.pkcs8.b64"
```

For local development, copy the one-line private PKCS#8 value into `OFFLINE_GRANT_PRIVATE_KEY` in `.dev.vars`. Never commit that value.

Copy the public key into the tracked frontend build configuration:

```sh
cp "$offline_key_dir/offline-grant-public.spki.b64" apps/web/offline-grant-public.spki.b64
```

The public value is not secret and is committed so local, CI, and production builds all use the same verification key. The build fails if this file is missing or malformed. It must match the Worker private key. Store the private key in an approved secret manager, remove temporary private-key files using the organization's secure-file procedure, and never commit the private PEM or PKCS#8 value. Rotating this pair requires updating the committed public key, setting the new Worker secret, and deploying both together; existing offline grants then stop verifying.

### Configure all Worker secrets

Enter values interactively so they do not appear in shell history:

```sh
npx wrangler secret put ADMIN_ACCESS_CODE
npx wrangler secret put PRIMARY_SCANNER_ACCESS_CODE
npx wrangler secret put SECONDARY_SCANNER_ACCESS_CODE
npx wrangler secret put SESSION_SECRET
```

`OFFLINE_GRANT_PRIVATE_KEY` was set from the generated file in the preceding step.

Requirements:

- All three access codes are strong and mutually distinct.
- Access codes are distributed only to their intended role.
- `SESSION_SECRET` is an unpredictable value of at least 32 bytes and is not reused as an access code.
- `OFFLINE_GRANT_PRIVATE_KEY` is the base64 PKCS#8 P-256 private key generated above and is never exposed to frontend code.

Verify secret names, not their values:

```sh
npx wrangler secret list
```

`wrangler.jsonc` declares these names as required, so production deployment fails if any is absent.

## Back up and migrate production D1

Create the local backup directory, export the database, and record the current Time Travel bookmark. Replace `YYYYMMDD-HHMM` with the actual UTC deployment time.

```sh
mkdir -p backups
npx wrangler d1 export party-check-in --remote --output=./backups/party-check-in-before-YYYYMMDD-HHMM.sql
npx wrangler d1 time-travel info party-check-in
```

Review pending migrations, then apply them remotely:

```sh
npx wrangler d1 migrations list party-check-in --remote
npm run db:migrate:remote
npx wrangler d1 migrations list party-check-in --remote
```

The final list must show no unapplied migrations. Verify the expected tables without modifying data:

```sh
npx wrangler d1 execute party-check-in --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"
```

Expected application tables are `tickets`, `checkins`, and `offline_conflicts`; D1 also maintains its migration metadata table.

## Deploy

Run the complete automated gate, then deploy:

```sh
npm run verify
npm run deploy
```

Record the HTTPS URL and version ID printed by Wrangler. Workers deployment versions include the Worker code, static frontend assets, bindings, and configuration; D1 data is separate.

## Production smoke test

Set `APP_URL` to the exact HTTPS hostname printed by Wrangler or to the configured custom domain:

```sh
export APP_URL=https://party-check-in.YOUR-SUBDOMAIN.workers.dev
curl --fail --silent --show-error --head "$APP_URL/login"
curl --fail --silent --show-error --head "$APP_URL/admin"
curl --fail --silent --show-error --head "$APP_URL/scan"
curl --fail --silent --show-error --head "$APP_URL/guests"
curl --fail --silent --show-error --head "$APP_URL/readiness"
curl --fail --silent --show-error "$APP_URL/api/auth/session"
curl --fail --silent --show-error --head "$APP_URL/sw.js"
```

Verify:

- Every application route is HTTPS and returns the SPA shell successfully.
- `/api/auth/session` returns JSON, proving `/api/*` is routed to the Worker rather than the SPA fallback.
- `/sw.js` is served as JavaScript.
- An unauthenticated protected API returns `401`.
- Each production access code logs into exactly its intended ADMIN, PRIMARY_SCANNER, or SECONDARY_SCANNER role.
- The session cookie is named `__Host-party_session` and has `HttpOnly`, `Secure`, `SameSite=Strict`, and finite expiration attributes.

Do not put access codes into curl commands, screenshots, browser URLs, or logs. Perform authentication smoke tests through the login UI.

## Static assets, SPA fallback, and service worker

The Wrangler configuration uses:

- `assets.directory`: `./apps/web/dist`
- `assets.not_found_handling`: `single-page-application`
- `assets.run_worker_first`: `/api/*`

In browser developer tools:

1. Open `/login`, `/admin`, `/scan`, and `/guests` directly in new tabs and confirm they load rather than return 404.
2. Confirm the registered service worker URL is `/sw.js`.
3. Load the application online once, switch the browser offline, and reload an application route; the shell should still load.
4. Confirm requests under `/api/` are not present in Cache Storage and fail rather than returning cached API data.
5. Restore connectivity and confirm the network-first shell updates.

The Service Worker never caches `/api/*`, including `/api/offline/grant`. The signed grant is stored separately in IndexedDB only after an authenticated Primary Scanner explicitly prepares the device.

## Offline Scanner Grant security model

- Online authentication remains exclusively based on the signed `__Host-party_session` cookie and `/api/auth/session`.
- `POST /api/offline/grant` requires a real `PRIMARY_SCANNER` session and same-origin request.
- Grants use ECDSA P-256/SHA-256, last 12 hours, and contain only version, capability type, Primary role, application scope, timestamps, and a random grant ID.
- The grant permits only cached local scanning. It cannot authenticate Worker APIs, open Admin or Guests, create or void tickets, or synchronize pending operations.
- Reload fallback is attempted only when `/api/auth/session` cannot be reached. A reachable unauthenticated response never activates the grant.
- Logout clears the local grant and emergency-mode marker while retaining the ticket snapshot and pending check-ins.
- Once issued, a grant cannot be remotely revoked while the device is offline. Its narrow permissions and absolute 12-hour expiration bound this risk.

Camera access and service workers require a secure context in production. Use only the Cloudflare HTTPS hostname or an HTTPS custom domain.

## View production logs

Tail logs from the repository root:

```sh
npx wrangler tail party-check-in --format pretty
```

The configuration explicitly enables Workers observability. In Cloudflare, inspect Workers & Pages → `party-check-in` → Logs. Expected structured events include `login_failed`, `checkin_error`, `offline_sync_conflict`, and `unexpected_server_error`. Logs intentionally omit access codes and ticket tokens.

## Rollback guidance

List deployments and versions:

```sh
npx wrangler deployments list
npx wrangler versions list
```

Roll back Worker code and static assets to a known version:

```sh
npx wrangler rollback VERSION_ID --message "Rollback after production verification failure"
```

A Worker rollback does not roll back D1. The existing migrations are additive, but never assume an older Worker is compatible with a future schema. Prefer fixing forward when data has been written after a migration.

For a confirmed database incident, first retrieve the desired bookmark:

```sh
npx wrangler d1 time-travel info party-check-in --timestamp="YYYY-MM-DDTHH:MM:SSZ"
```

D1 restore overwrites the production database and cancels in-flight queries. Run it only with explicit incident approval and after preserving the current bookmark/export:

```sh
npx wrangler d1 time-travel restore party-check-in --bookmark=BOOKMARK
```

After any rollback, repeat the production smoke test and the relevant sections of `EVENT_DAY_CHECKLIST.md`.

## Cloudflare references

- [Workers static SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
