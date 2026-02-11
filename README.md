# CoAuthor

**AI-powered co-authoring for STEM academic writing.**

CoAuthor is a task-driven, event-sourced system that pairs you with LLM agents to write LaTeX documents. It tracks every decision, supports human-in-the-loop interactions, and never blindly overwrites your work.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the interactive TUI
npm run dev
```

### Create and Run Your First Task

```bash
# Start the interactive TUI for the current directory workspace
npm run dev

# Or: start the Web UI server only (headless)
npm run dev -- serve
```

---

## Core Concepts

### Tasks
Everything starts with a **Task**. A task represents a unit of work (e.g., "improve the introduction" or "fix grammar in section 3"). Tasks have a lifecycle: created → started → [paused/resumed] → completed/failed/canceled.

### User Interaction Protocol (UIP)
When the agent needs your input—like confirming a risky file edit or choosing between options—it creates a **UIP request**. The system pauses and waits for your response. No blind overwrites, ever.

### Event Sourcing
All collaboration decisions are stored as **Domain Events** in an append-only log (`.coauthor/events.jsonl`). You can replay the entire history of any task. File edits and command executions are recorded separately in an **Audit Log**.

### Tools
Agents use tools to interact with your workspace:
- `readFile` / `editFile` — File operations with diff previews
- `listFiles` / `glob` / `grep` — File discovery and search
- `runCommand` — Execute shell commands (requires confirmation)
- `createSubtask` — Decompose work into subtasks

---

## CLI Reference

```bash
# Workspace selection (where .coauthor/ lives). Defaults to current directory.
coauthor --workspace <path> status
coauthor -w <path> status

# Start UI (TUI) for the selected workspace (default command)
coauthor --workspace <path>
coauthor --workspace <path> ui

# Start Web UI server (headless, no TUI)
coauthor --workspace <path> serve [--host 127.0.0.1] [--port 3000]

# Show server status
coauthor --workspace <path> status

# Stop the server for the workspace (best-effort)
coauthor --workspace <path> stop
```

Task management and agent execution are intentionally not exposed via CLI; use the TUI or Web UI for explicit and controllable workflows.

---

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build

# Run built version
npm start
```

### Project Structure

```
src/
├── domain/        # Domain layer: events, types, ports
├── application/   # Application services (use cases)
├── agents/        # Agent runtime and orchestration
├── infra/         # Infrastructure adapters
├── cli/           # Command-line interface
├── tui/           # Terminal UI (Ink + React)
└── app/           # Application composition root
```

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design and principles
- [Domain Model](docs/DOMAIN.md) — Domain events and types
- [Milestones](docs/MILESTONES.md) — Development roadmap

---

## License

[MIT](LICENSE) © Zherui Yang ([@Adversarr](https://github.com/Adversarr))
