# AGENTS.md

## Scope and Precedence

This file applies to the whole repository.

Nested guides provide subproject-specific instructions:
- `src/AGENTS.md` for backend/domain/runtime code.
- `web/AGENTS.md` for the React Web UI.

When instructions conflict, the nearest `AGENTS.md` in the directory tree wins.

## Broad Project Overview

Seed is a goal-driven local AI assistant system with three main surfaces:
- runtime and orchestration backend (`src/`),
- terminal UI (inside `src/interfaces/tui`),
- web UI (`web/`).

The repository is organized by responsibility:
- `src/`: domain model, application services, agent runtime, adapters, CLI/TUI.
- `web/`: React frontend consuming shared backend contracts.
- `tests/`: backend/runtime/security/integration tests.
- `docs/`: architecture, operations, security, and reference docs.

## Agent System Map

Use this map to decide where to implement changes:

1. Coordination and task execution flow
- Primary area: `src/agents/` and `src/application/`.
- Typical work: planning flow, runtime behavior, interaction lifecycle, task state transitions.

2. Domain rules and contracts
- Primary area: `src/core/`.
- Typical work: entities, events, ports, policy constraints shared across layers.

3. Tooling and external adapters
- Primary area: `src/infrastructure/`.
- Typical work: tool execution, persistence adapters, server-side integrations, runtime wiring adapters.

4. Composition and user entry points
- Primary area: `src/interfaces/` and `src/index.ts`.
- Typical work: CLI/TUI startup, app composition, process lifecycle.

5. Web interaction experience
- Primary area: `web/src/`.
- Typical work: pages, stores, components, realtime UI behavior.

Rule of thumb:
- behavior/rules first -> `core`/`application`,
- orchestration next -> `agents`,
- adapter/integration last -> `infrastructure`,
- UI behavior -> `web`.

## Build and Test Commands

Run from repository root unless noted otherwise.

Setup:
- `npm install`

Development:
- `npm run dev` (TUI + local server)
- `npm run dev -- serve` (headless server)

Build and run:
- `npm run build`
- `npm start`

Validation:
- `npm test`
- `npm run test:watch`
- `npm run coverage`
- `npm run check:domain-clean`
- `npm run check:layer-boundaries`

Web UI (from root without changing directories):
- `npm --prefix web run dev`
- `npm --prefix web run build`
- `npm --prefix web run test`

## Code Style Guidelines

- Prioritize concise, precise, clean, clear, extensible code.
- Keep changes surgical: modify only what is required for the requested behavior.
- Match existing style in touched files (naming, structure, formatting, import style).
- Prefer explicit code over speculative abstractions.
- Write high-signal comments for non-obvious logic and invariants.
- Keep comments factual and maintainable; avoid narrating trivial operations.
- Remove only the unused code created by your own changes.

Architecture constraints:
- Respect strict typing; do not introduce `any` unless unavoidable and justified.
- Preserve layering boundaries (`src/core`, `src/application`, and `src/agents` must not import `src/infrastructure` directly).
- Keep module contracts explicit and local; avoid broad cross-layer coupling.

## Testing Instructions

- Every behavior change must include tests or an explicit reason tests are not feasible.
- Prefer reproducing bugs with a failing test first, then implement the fix.
- Run the smallest relevant test subset during iteration, then run broader suites before handoff.
- Backend/runtime tests live under `tests/`.
- Web UI tests live under `web/src/test/`.

Recommended workflow:
1. Run targeted test files for touched modules.
2. Run `npm run check:domain-clean` and `npm run check:layer-boundaries` for `src/` architecture changes.
3. Run `npm test` for final backend/runtime verification.
4. Run `npm --prefix web run test` for Web UI changes.

## Security Considerations

- Never commit secrets or environment files (`.env`, `.env.local`, `.env.*.local`).
- Keep user confirmation boundaries intact for high-risk tool actions.
- Preserve workspace safety boundaries and path validation.
- Do not weaken auth defaults or token handling without explicit request and tests.
- Keep localhost-first assumptions unless explicitly working on remote deployment hardening.
- Avoid logging sensitive tokens, credentials, or raw secret material.

Reference docs:
- `docs/SECURITY.md`
- `docs/OPERATIONS.md`
- `docs/TOOL_SCHEMA.md`

## Extra Team Instructions

Commit and PR quality:
- Use clear, imperative commit messages scoped to behavior changes.
- Keep each commit focused; avoid mixing unrelated refactors.
- In PR/task summaries, include:
  - what changed,
  - why it changed,
  - how it was verified (commands and outcomes),
  - follow-up risks or TODOs.

Operational cautions:
- Do not commit generated/runtime artifacts (`state/`, `private/`, `shared/`, `coverage/`, `dist/`, `node_modules/`).
- Treat `docs/legacy/` as historical context, not source of truth for current behavior.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it; don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
