# Event-Day Checklist

Use one printed or shared copy. Assign one person to own changes to scanner mode and synchronization decisions.

## Before event

- [ ] Deploy the final verified version.
- [ ] Record the deployed Worker version ID and HTTPS URL.
- [ ] Verify the production `DB` binding points to the intended D1 database.
- [ ] Verify D1 has no unapplied migrations.
- [ ] Create a test ticket through the ADMIN account.
- [ ] If any ticket was cancelled or restored, prepare the Primary device again before relying on offline mode.
- [ ] Scan the test ticket successfully.
- [ ] Scan the same test ticket again and verify `ALREADY USED` with the original time.
- [ ] Test a two-phone simultaneous scan and verify only one device receives the first successful check-in.
- [ ] Verify the Primary phone is signed in as `PRIMARY SCANNER`.
- [ ] Verify the Secondary phone is signed in as `SECONDARY SCANNER`.
- [ ] Open `/readiness` on Primary while online and select `PREPARE DEVICE FOR OFFLINE`.
- [ ] Select `CHECK CAMERA`, then `RUN READINESS CHECK`.
- [ ] Verify the server and cached ticket counts match exactly.
- [ ] Verify the cache is less than 30 minutes old, Pending Offline Check-ins is `0`, Offline Authorization is `PASS`, and the Service Worker and App Shell both pass.
- [ ] Verify Offline Authorization shows `PRIMARY SCANNER GRANT`, an expiration time, and remaining validity.
- [ ] Verify the overall state is `EVENT READY` and record the displayed build identifier.
- [ ] Verify rear-camera permission and QR focus on Secondary.
- [ ] Charge both phones fully and connect backup power packs if available.
- [ ] Test venue Wi-Fi and mobile connectivity at the actual door location.
- [ ] Verify `Pending` is `0` on Primary before admitting guests.
- [ ] Confirm event staff know that only Primary may enter emergency offline mode.

## Offline drill

- [ ] Stop the Secondary scanner and confirm it is no longer scanning.
- [ ] Enable airplane mode on Primary.
- [ ] Confirm Primary displays `CONNECTION LOST`.
- [ ] Check “I confirm the secondary scanner has stopped.”
- [ ] Enter Emergency Offline Mode.
- [ ] Scan designated test tickets and verify they are marked provisional.
- [ ] Reload the page while still offline.
- [ ] Verify `/scan` reopens from the cached shell as `Primary Scanner · Offline authorization`.
- [ ] Verify the previously scanned ticket and pending operation remain present after reload.
- [ ] Verify a repeated offline ticket is rejected locally as already used.
- [ ] Scan a second unused cached ticket successfully.
- [ ] Restore internet and allow the application to check `/api/auth/session`.
- [ ] If the server session expired, authenticate again as Primary Scanner.
- [ ] Verify offline ticket data and all pending operations remain available.
- [ ] Synchronize pending check-ins.
- [ ] Verify the pending count reaches zero.
- [ ] Verify the server guest list shows the synchronized check-in state.
- [ ] Review any synchronization conflict in the ADMIN guest list.
- [ ] Return Primary to online mode before resuming Secondary.
- [ ] Return to `/readiness`, verify Pending Offline Check-ins is `0`, and record `OFFLINE DRILL PASSED`.

## At doors open

- [ ] Primary Scanner: `ONLINE`
- [ ] Secondary Scanner: `ONLINE`
- [ ] Pending Offline: `0`
- [ ] Primary Camera: `READY`
- [ ] Secondary Camera: `READY`
- [ ] Offline Cache: `CURRENT`
- [ ] Offline Authorization: `PASS`
- [ ] Both phones remain on power where practical.

## If internet fails

1. [ ] Stop Secondary scanner.
2. [ ] Primary confirms Secondary stopped.
3. [ ] Primary enters Emergency Offline Mode.
4. [ ] Only Primary scans tickets.
5. [ ] When internet returns, use `SYNC NOW` on Primary.
6. [ ] Confirm pending count is zero and review conflicts with ADMIN.
7. [ ] Return Primary to `ONLINE`, then resume Secondary scanner.

Do not allow both phones to scan while offline. Offline acceptance is provisional until D1 acknowledges synchronization.

## After event

- [ ] Verify Primary pending sync count is zero.
- [ ] Verify Primary has returned to online mode.
- [ ] Review all offline synchronization conflicts in the ADMIN guest list.
- [ ] Check the final guest list and totals. Direct guest-list export is not supported by the current product.
- [ ] Record the current D1 Time Travel bookmark:

  ```sh
  npx wrangler d1 time-travel info party-check-in
  ```

- [ ] Create a full production database export. Replace `YYYYMMDD-HHMM` with the actual UTC time:

  ```sh
  mkdir -p backups
  npx wrangler d1 export party-check-in --remote --output=./backups/party-check-in-after-YYYYMMDD-HHMM.sql
  ```

- [ ] Store the export in an access-controlled backup location outside the repository.
- [ ] Review Worker logs for `checkin_error`, `offline_sync_conflict`, or `unexpected_server_error` events.
- [ ] Retain production access codes only as long as operationally required; rotate them before the next event.
