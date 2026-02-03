# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview -- in MVP development stage, no backward compatibility need to consider.

CoAuthor is a co-authoring system for STEM academic writing using LLM agents. It provides a task-driven, event-sourced architecture for collaborative writing with LaTeX support.

**Current Milestone:** M1 - Core event sourcing and CLI scaffolding complete.

## Common Commands

### Development
```bash
npm install          # Install dependencies
npm run dev          # Run development server with TUI (tsx src/index.ts)
```

### Build and Run
```bash
npm run build        # Build TypeScript (tsc -p tsconfig.json)
npm start            # Run built executable (node dist/index.js)
```

### Testing
```bash
npm test             # Run all tests (vitest run)
npm run test:watch   # Run tests in watch mode
npm run coverage     # Run tests with coverage (v8 provider)
```

### Running Single Tests
```bash
npx vitest run tests/eventStore.test.ts     # Run specific test file
npx vitest run -t "should create task"       # Run tests matching pattern
```

### Using the CLI

**Development mode (recommended for testing):**
```bash
# Task operations
npm run dev -- task create "Task title"         # Create a task
npm run dev -- task list                        # List all tasks
npm run dev -- task start <taskId>              # Start a task
npm run dev -- task complete <taskId>           # Complete a task

# Patch operations
echo '<patch content>' | npm run dev -- patch propose <taskId> <targetPath>
npm run dev -- patch accept <taskId> [proposalId|latest]
npm run dev -- patch reject <taskId> <proposalId>
npm run dev -- patch apply <taskId> <proposalId>

# Event log
npm run dev -- log replay [streamId]           # Replay events
npm run dev -- log show [streamId]             # Show events

# Terminal UI
npm run dev                                     # Start Ink TUI (default)
```

**Production mode (after build):**
```bash
node dist/index.js task create "Task title"
node dist/index.js task list
# ... same commands as above
```

## Architecture Overview

### Architecture Pattern
**Hexagonal Architecture (Ports and Adapters)** with **Event Sourcing** and **CQRS**.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture design.
See [docs/DOMAIN.md](docs/DOMAIN.md) for domain model specification.
See [docs/MILESTONES.md](docs/MILESTONES.md) for milestone planning.

### Directory Structure
```
src/
├── index.ts              # CLI entry point
├── app/
│   └── createApp.ts      # App initialization with services
├── domain/               # Domain layer (types, schemas)
│   ├── actor.ts          # Actor types (User, Agent, System)
│   ├── task.ts           # Task, ArtifactRef types
│   ├── artifact.ts       # Artifact types (Figure, Table, etc.)
│   ├── events.ts         # Domain events (Zod schemas)
│   ├── index.ts          # Domain exports
│   └── ports/            # Port interfaces
│       ├── eventStore.ts # EventStore interface
│       └── index.ts
├── application/          # Application services (Use Cases)
│   ├── taskService.ts    # Task use cases
│   ├── patchService.ts   # Patch use cases
│   ├── eventService.ts   # Event replay use cases
│   └── index.ts
├── core/                 # Core utilities
│   ├── projector.ts      # Projection runner with checkpoint
│   └── projections.ts    # Projection reducers for read models
├── infra/                # Infrastructure adapters
│   ├── jsonlEventStore.ts # JSONL-based event store
│   └── logger.ts         # Pino logger
├── cli/                  # CLI interface
│   ├── run.ts            # CLI command parser (yargs)
│   └── io.ts             # IO abstraction for testability
├── tui/                  # Terminal UI (Ink + React)
│   ├── main.tsx          # Main TUI component
│   └── run.ts            # TUI renderer
└── patch/                # Patch handling
    └── applyUnifiedPatch.ts  # Unified diff patch application

tests/                    # Test files (vitest)
docs/                     # Documentation
├── ARCHITECTURE.md       # Architecture design
├── DOMAIN.md             # Domain model spec
└── MILESTONES.md         # Milestone planning
.coauthor/                # Database directory
├── events.jsonl          # Event store (append-only)
└── projections.jsonl     # Projection checkpoints
```

### Core Concepts

**Actor Model:**
- All actions are attributed to an Actor (`authorActorId`)
- Actor types: `user`, `agent`, `system`
- Well-known IDs: `system`, `default-user`, `default-agent`
- Every domain event MUST include `authorActorId` field

**Event Sourcing:**
- All state changes are captured as events in an append-only log
- Events are stored in JSONL format (`.coauthor/events.jsonl`)
- Events have `streamId`, `seq`, `type`, `payload`, `createdAt`, `authorActorId`
- Read models are built via projections that fold events into state
- No direct state mutations - only through events

**Domain Events:**
- Task lifecycle: `TaskCreated`, `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskCanceled`
- Plan & Patch: `AgentPlanPosted`, `PatchProposed`, `PatchAccepted`, `PatchRejected`, `PatchApplied`
- Feedback: `UserFeedbackPosted`
- Conflict: `PatchConflicted` (emitted when apply fails due to baseRevision mismatch)
- All events defined with Zod schemas in `src/domain/events.ts`

**Projections:**
- `tasks` projection - Lists all tasks with current state and metadata
- Projections use cursor positions for incremental updates
- Checkpoint stored in `.coauthor/projections.jsonl`
- Projections can be rebuilt by replaying all events

**Hexagonal Architecture Layers:**
1. **Domain** (`src/domain/`): Pure types, event schemas, port interfaces. Zero external dependencies.
2. **Application** (`src/application/`): Use case services implementing business logic.
3. **Infrastructure** (`src/infra/`): EventStore adapter (JSONL), logger, external dependencies.
4. **Interface** (`src/cli/`, `src/tui/`): User-facing CLI and TUI adapters.

### Dependency Flow
```
CLI/TUI → Application Services → Domain Ports ← Infrastructure Adapters
         ↓                      ↓
         Domain Events ← Domain Types
```

## Important Patterns

**Event Store Pattern:**
- `EventStore` is a port (interface) in domain layer
- `JsonlEventStore` is an adapter in infrastructure layer
- All events are appended with monotonically increasing sequence numbers
- Events within a stream are totally ordered

**Service Pattern:**
- Services in `src/application/` encapsulate use cases
- Services depend on `EventStore` port, not concrete implementation
- Services emit events, never mutate state directly
- Services build projections by folding over events

**Testing Pattern:**
- Uses Vitest with Node environment
- `mock-fs` for filesystem mocking (event store testing)
- `ink-testing-library` for TUI component tests
- IO abstraction in CLI allows easy testing without actual stdin/stdout
- Test services by verifying emitted events, not state

**Patch Application:**
- Uses unified diff format (RFC standard)
- Base revision checking to prevent drift
- Applied patches append `PatchApplied` event with new revision
- Conflicts emit `PatchConflicted` event

**Database:**
- JSONL stored in `.coauthor/` directory
  - `events.jsonl` - Event log (append-only)
  - `projections.jsonl` - Projection checkpoints
- Files auto-created via `ensureSchema()` in EventStore
- Event log is immutable, never modified or deleted

## Development Workflow

### Making Changes

1. **Run development mode:** `npm run dev` for quick iteration
2. **Add/update tests:** Place in `tests/` directory, mirror source structure
3. **Run tests:** `npm test` to verify all tests pass
4. **Build:** `npm run build` before committing or using production CLI

### Adding New Domain Events

1. Add event payload schema to `src/domain/events.ts` (Zod schema)
2. Add event type to `EventTypeSchema` enum
3. Add to `DomainEventSchema` discriminated union
4. Add to `DomainEvent` TypeScript union type
5. Update projection reducers in service methods (e.g., `TaskService.#buildTasksProjection`)
6. Add service method in appropriate `src/application/*.ts`
7. Add CLI command in `src/cli/run.ts` if user-facing
8. Add tests for event emission and projection

### Adding New Use Cases

1. **Add method to service** in `src/application/`
2. **Service constructor** takes `EventStore` and `currentActorId`
3. **Emit events** with `authorActorId` field (required!)
4. **Return results** by building projections or querying event store
5. **Add CLI command** in `src/cli/run.ts`
6. **Add tests** verifying event emission and business logic

### Adding New Adapters

1. **Define port interface** in `src/domain/ports/` (if needed)
2. **Implement adapter** in `src/infra/`
3. **Inject via app** in `src/app/createApp.ts`
4. **Mock in tests** using vitest mocking

## Code Principles

- **Event-first thinking:** Every state change is an event
- **Immutability:** Never mutate existing state, only append events
- **Dependency inversion:** Domain depends on ports, infrastructure implements ports
- **Actor attribution:** Every action must have an `authorActorId`
- **Type safety:** Use Zod schemas for runtime validation, TypeScript for compile-time safety
- **Testability:** Design for testing - use interfaces, dependency injection, IO abstraction

## Common Issues & Solutions

**"Cannot find module" errors:**
- Run `npm install` to ensure dependencies are installed
- Check TypeScript paths configuration in `tsconfig.json`

**Event store corruption:**
- `.coauthor/events.jsonl` should contain valid JSON lines
- Delete `.coauthor/` directory to reset (lose all data!)

**Projection out of sync:**
- Delete `.coauthor/projections.jsonl` to rebuild from events
- Projections will automatically rebuild on next read

**Tests failing:**
- Ensure `mock-fs` is properly cleaned up (`mock.restore()`)
- Check that event schemas match expectations
- Verify `authorActorId` is set on all events
