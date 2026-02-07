# coauthor

M2: Agent runtime with Tool Use + UIP (User Interaction Points).

## Quick Start (Tool Use + UIP)

```bash
# 1) Create task (outputs taskId)
npm run dev -- task create "Improve introduction" --file demo/paper/sections/introduction.tex --lines 1-200

# 2) Run agent on the task
npm run dev -- agent run <taskId>

# 3) If the agent is awaiting user input, inspect and respond
npm run dev -- interact pending <taskId>
npm run dev -- interact respond <taskId> <optionId> --text "optional text input"

# 4) Replay event stream (confirm what happened)
npm run dev -- log replay <taskId>
```

You can also start the TUI (interactive interface):

```bash
npm run dev
```

Type `/help` in the TUI to see commands; `/log replay [taskId]` prints events to the terminal and shows the number of replayed events in the UI.

## Development

```bash
npm i
npm run dev
```

## Build and Test

```bash
npm run build
npm test
```

## LLM Debugging

```bash
npm run dev -- llm test --mode tool_use
npm run dev -- llm test --mode stream_tool_use
```

To output structured telemetry events to stdout:

```bash
COAUTHOR_TELEMETRY_SINK=console npm run dev -- llm test --mode tool_use
```

See `docs/llm-context.md` for context persistence and recovery semantics.

See `docs/tool-schema.md` for tool schema adaptation and rollback toggles.
