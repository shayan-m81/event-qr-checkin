# Party Ticket and QR Check-in — Project Specification

## Product goal

Build a small, production-ready application for creating party tickets and checking guests in from a mobile device. Each ticket has a unique QR code and a shareable ticket image. Authorized event staff can scan the QR code or find a guest manually, with the backend and database preventing duplicate check-ins.

## Users and core workflows

- An authorized organizer or staff member signs in.
- An organizer creates a ticket for a guest and generates a shareable ticket image containing its QR code.
- Staff scan a ticket QR code on a mobile device and receive a clear accepted, already-used, invalid, or error result.
- Staff can search or browse the guest list and perform a manual check-in when scanning is impractical.
- Staff can deliberately enter an emergency offline mode when connectivity is unavailable and later reconcile queued check-ins with the server.

## Functional requirements

### Authentication and access

- Ticket management, guest data, scanning, and check-in actions require authentication.
- The API must enforce authorization; the frontend must not be treated as a security boundary.
- Authentication mechanism and role granularity are implementation decisions to be settled in Phase 2.

### Tickets

- Store each ticket in D1 with a stable internal identifier and a unique, non-guessable QR credential.
- Store the guest information needed for the guest list and ticket image.
- Store a referee name with each ticket so Admin can reuse previously entered names and staff can filter the guest list by referee or ticket type.
- Generate a downloadable or shareable ticket image containing the QR code and human-readable guest/event information.
- Render the guest name, referee name, and the server-created purchase date in Jalali `YYYY/MM/DD` format on the ticket artwork, using dedicated General and VIP/Special Guest templates.
- A QR payload must identify or authenticate a ticket without exposing unnecessary guest data.
- Allow an administrator to cancel a ticket without deleting or replacing it, and to restore it only if it has never checked in.
- Keep cancelled tickets visible and reject them consistently in online, manual, and refreshed offline validation.

### Online check-in

- Support camera-based QR scanning on a mobile-first interface.
- Validate every online scan against the backend.
- Perform check-in atomically in the backend/database so simultaneous requests cannot both produce a first successful check-in.
- Return distinct outcomes for accepted, already checked in, unknown/invalid ticket, unauthorized request, and operational failure.
- Record enough check-in metadata for event operations and troubleshooting.

### Guest list and manual check-in

- Provide a mobile-friendly guest list with simple search.
- Show the authoritative check-in state returned by the backend.
- Allow an authorized staff member to check in a guest manually through the same backend-enforced atomic operation used by QR scans.

### Emergency offline mode

- Offline mode must be explicitly entered and visibly indicated; it must not silently masquerade as online validation.
- Store pending offline check-in attempts locally with stable operation identifiers and timestamps.
- Clearly communicate that offline acceptance is provisional because another device may have checked in the same ticket.
- Reconcile queued operations when connectivity returns, using idempotent backend requests and reporting conflicts instead of hiding them.
- Keep the offline state model and synchronization rules small, documented, and testable.

## Quality and operational requirements

- Use TypeScript wherever possible across frontend, Worker, shared contracts, and tests.
- Design the frontend mobile-first, including clear feedback, large touch targets, and resilient scanner recovery.
- Treat D1 as the source of truth for ticket and check-in state.
- Do not rely on client-side checks for duplicate protection.
- Validate untrusted inputs and avoid logging secrets or unnecessary guest data.
- Provide automated tests for core ticket, authentication, atomic check-in, duplicate, manual, and offline-reconciliation behavior.
- Type checking and tests must pass before each implementation phase is considered complete.
- Include a deployment and event-day verification procedure before production use.

## Scope boundaries

The planned scope is limited to authentication, ticket creation, ticket image generation, online QR scanning, atomic check-in, guest-list/manual check-in, explicit emergency offline operation, testing/hardening, deployment, and event-day verification. Features such as payments, ticket sales, public registration, messaging, seating, analytics, and multi-event administration are not included unless this specification is deliberately updated.

## Proposed architecture

- **Frontend:** a mobile-first TypeScript web application for ticket administration and check-in operations.
- **Backend:** a TypeScript Cloudflare Worker exposing authenticated HTTP endpoints and serving as the sole writer of authoritative ticket/check-in state.
- **Database:** Cloudflare D1 with schema constraints and transactional/conditional writes that enforce one successful first check-in per ticket.
- **Shared contracts:** a small set of framework-independent TypeScript request, response, and domain types shared between frontend and Worker.
- **Ticket rendering:** deterministic QR and image generation behind a focused application module; the exact browser/server rendering boundary will be chosen in Phase 3 based on output and runtime requirements.
- **Offline storage:** a small client-side queue used only in explicitly enabled emergency mode, reconciled through idempotent Worker endpoints.

## Expected directory structure

This is a target structure, not scaffolding to create before implementation requires it:

```text
.
├── AGENTS.md
├── PROJECT_SPEC.md
├── IMPLEMENTATION_STATUS.md
├── package.json
├── tsconfig.json
├── apps/
│   ├── web/                  # Mobile-first frontend
│   │   ├── src/
│   │   └── tests/
│   └── worker/               # Cloudflare Worker API
│       ├── src/
│       └── tests/
├── packages/
│   └── shared/               # Minimal shared TypeScript contracts
├── migrations/               # Ordered D1 schema migrations
└── docs/                     # Deployment and event-day runbooks when needed
```

Directories and configuration files should be added only in the phase that needs them. A monorepo tool should not be introduced unless plain package workspaces become insufficient.

## Phase completion rule

Implementation follows the phases in `IMPLEMENTATION_STATUS.md` in order. A phase is complete only when its scoped behavior is implemented, its relevant tests pass, and type checking passes. Work must not continue to a later phase while the current phase has failures.
