# Repository Instructions

- Use TypeScript everywhere possible.
- Prefer simple implementations over abstractions.
- Do not introduce dependencies without a concrete need.
- Keep the frontend mobile-first.
- Treat the database as the source of truth for ticket check-in state.
- Enforce duplicate check-in protection in the database/backend.
- Run tests and type checking before declaring a phase complete.
- Never continue to a later implementation phase when the current phase has failing tests.
- Keep offline behavior explicit and easy to reason about.
- Do not add features outside `PROJECT_SPEC.md`.
