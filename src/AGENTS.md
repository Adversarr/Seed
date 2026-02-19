# AGENTS.md (src)

## Scope

This file applies to `src/` and subdirectories.

It supplements the repository root guide at `../AGENTS.md`.
If guidance conflicts, this file wins for `src/` work.

## Backend Map

`src/` is the backend runtime and orchestration system. Work by layer:

1. `core/`
- Purpose: business contracts and invariants.
- Change here when rules/events/contracts should change globally.

2. `application/`
- Purpose: use-case orchestration over domain contracts.
- Change here when task/event/interaction behavior changes.

3. `agents/`
- Purpose: agent runtime loop, planning, execution behavior.
- Change here when agent decision/execution flow changes.

4. `infrastructure/`
- Purpose: adapters to filesystem, server, tools, LLM integrations.
- Change here when external boundaries or implementations change.

5. `interfaces/`
- Purpose: app composition, CLI, and TUI entry points.
- Change here when startup flow, wiring, or UX entry behavior changes.

## Build and Test Commands

Run from repository root:
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run check:domain-clean`
- `npm run check:layer-boundaries`

Focused checks:
- `npm test -- tests/<file>.test.ts`
- `npm test -- tests/<folder>/<file>.test.ts`

## Code Style Guidelines

- Keep edits small and directly tied to requested behavior.
- Follow existing TypeScript style in touched files.
- Use explicit types at boundaries (ports, service inputs/outputs, tool contracts).
- Prefer straightforward control flow over indirection.
- Add concise comments for invariants, sequencing rules, and non-obvious policy behavior.

Layering constraints (enforced by `check:layer-boundaries`):
- `core/`, `application/`, and `agents/` must not import `infrastructure/`.
- `infrastructure/` may depend on upper-layer contracts, not the reverse.
- Keep composition wiring in `interfaces/app/` and avoid leaking wiring concerns into domain logic.

Core export hygiene (enforced by `check:core-export-usage` through `check:domain-clean`):
- Do not leave dead exports in `src/core`.
- When adding core exports, ensure non-core runtime code consumes them or remove them.

Implementation direction:
- Put policy/rule decisions in `core`/`application`, not in adapter code.
- Keep `agents` focused on orchestration behavior, not filesystem/network mechanics.
- Keep `infrastructure` focused on integration concerns, not domain policy.

## Testing Instructions

- Add/update tests for every behavior change in `src/`.
- Prefer test-first for bug fixes (reproduce failure, then fix).
- Keep test scope targeted while iterating, then run broader suites before finalizing.
- For architectural changes, run both:
  - `npm run check:domain-clean`
  - `npm run check:layer-boundaries`

Minimum final verification for non-trivial backend changes:
1. Relevant targeted test files pass.
2. `npm run check:domain-clean` passes.
3. `npm run check:layer-boundaries` passes.
4. `npm test` passes (or document why not run).

## Security Considerations

- Preserve workspace/file boundary checks.
- Keep risky-tool confirmation and approval binding behavior intact.
- Do not weaken auth or process ownership behavior without explicit request.
- Avoid logging tokens/secrets in diagnostics or error paths.
- For command/tool changes, keep timeout/output limits and audit logging behavior consistent.

## Extra Instructions

- Touch `docs/` only when runtime behavior or operator-facing contracts actually change.
- Treat `docs/legacy/` as historical context, not implementation truth.
- If a change affects both TUI and Web behavior, verify shared backend contracts instead of patching only one surface.
