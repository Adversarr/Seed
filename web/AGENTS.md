# AGENTS.md (web)

## Scope

This file applies to `web/` and subdirectories.

It supplements the repository root guide at `../AGENTS.md`.
If guidance conflicts, this file wins for `web/` work.

## Frontend Map

`web/` is the React interface layer for Seed.

Use this map to place changes:

1. Route-level behavior
- Area: `src/pages/`, `src/layouts/`.
- Use for navigation flow, page composition, and page-level UX.

2. Reusable UI building blocks
- Area: `src/components/` and `src/components/ui/`.
- Use for visual components shared across routes.

3. Client state and app behavior
- Area: `src/stores/`, `src/hooks/`, `src/lib/`.
- Use for state management, derived behavior, and interaction logic.

4. Backend communication
- Area: `src/services/api.ts`, `src/services/ws.ts`.
- Use for HTTP/WS contract handling, reconnect behavior, and request/stream boundaries.

## Build and Test Commands

Run from `web/`:
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run test`
- `npm run test:watch`

Run from repository root:
- `npm --prefix web run dev`
- `npm --prefix web run build`
- `npm --prefix web run test`

## Code Style Guidelines

- Keep component changes surgical and consistent with nearby files.
- Prefer functional components + hooks with clear data flow.
- Keep store responsibilities focused; avoid implicit cross-store coupling.
- Use existing path alias conventions (`@/` for `web/src` imports).
- Preserve established UI primitives under `src/components/ui/` and shared display components.
- Add comments only when behavior is not obvious from code (state sync, event ordering, reconnection edge cases).

State and integration conventions:
- Keep API access in `src/services/api.ts` patterns.
- Keep realtime concerns in `src/services/ws.ts` and event bus subscriptions.
- Avoid embedding backend contract assumptions directly into presentational components.

Implementation direction:
- Keep pages focused on composition, not low-level data wiring.
- Keep business-ish UI logic in stores/hooks.
- Keep backend protocol handling centralized in services.

## Testing Instructions

- Add or update tests in `web/src/test/` for behavior changes.
- Prefer user-observable assertions (rendered state, interaction outcomes, error handling).
- For bug fixes, add a failing test first when practical.
- Run targeted test files during iteration, then run full web tests before handoff.

Minimum final verification for non-trivial web changes:
1. Relevant files in `web/src/test/` pass.
2. `npm run test` passes in `web/`.
3. `npm run build` passes in `web/` for routing/type/build regressions.

## Security Considerations

- Do not expose or log auth tokens (`seed-token`) in UI output or debug logs.
- Preserve WS auth expectations (`/ws?token=...`) and reconnection/gap-fill behavior.
- Keep API/WS communication scoped to expected backend endpoints.
- Do not introduce unsafe HTML rendering paths for model/tool output.
- Maintain localhost-first assumptions unless explicitly implementing remote hardening.

## Extra Instructions

- Keep UI behavior aligned with backend contracts used by both TUI and Web UI.
- If you change route-level behavior, verify navigation and error boundaries still work.
- If you change store/event wiring, test reconnect, refresh, and task switching flows.
