# Authentication Production Acceptance Checklist

Run these checks against the production HTTPS deployment after this fix is deployed. Do not reuse a private window between tests that require a fresh browser session.

## Test A — Fresh Incognito

1. Open a brand-new Incognito/private browser window.
2. Do not log in.
3. Navigate directly to `/scan`.

Expected: `/login`. No scanner UI and no user/role identity should appear first.

Repeat with:

- `/admin`
- `/guests`

## Test B — Admin navigation

1. Login using the ADMIN access code.
2. Open `/admin`.
3. Click Scanner.

Expected: `/scan` remains open. Scanner identifies the role as `Admin`. It does not redirect back to `/admin`.

## Test C — Logout

1. Login.
2. Click Logout.
3. Confirm redirect to `/login`.
4. Enter `/scan` manually in the address bar.

Expected: redirect to `/login`.

Repeat for Admin, Primary Scanner, and Secondary Scanner.

## Test D — Role isolation

- Primary Scanner: `/admin` must not open.
- Secondary Scanner: `/admin` must not open.
- Admin: `/admin`, `/scan`, and `/guests` must all open.
- Primary Scanner retains Emergency Offline Mode controls.
- Admin and Secondary Scanner have no Emergency Offline Mode override.

## Test E — Fresh second device

1. Login as Admin on Device A.
2. On Device B or a brand-new Incognito session, directly open `/scan`.

Expected: Device B remains unauthenticated. Device A's session has no effect on Device B.
