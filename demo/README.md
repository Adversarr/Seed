# Seed Demo - General Workspace Task

This demo shows Seed handling a general maintenance task (not paper-specific):

- discover files (`listFiles`),
- inspect context (`readFile`),
- propose a risky edit (`editFile`),
- wait for UIP confirmation,
- finalize with a task summary.

## Demo Assets

```text
demo/
├── README.md
├── fake-llm-config.ts        # Deterministic response sequence used for scripted demos/tests
├── brief.md                  # Project brief for context
├── outline.md                # Goal and execution outline
├── profiles.json             # Workspace profile catalog (auto-loaded by default)
├── skills/                   # Workspace-local skills discovered at startup
│   ├── repo-survey/
│   │   ├── SKILL.md
│   │   └── references/checklist.md
│   ├── safe-edit/
│   │   ├── SKILL.md
│   │   └── scripts/preflight.sh
│   └── test-first-fix/
│       └── SKILL.md
├── state/                    # Runtime state (events/audit/conversations/lock)
├── private/                  # Task-private workspace roots
├── shared/                   # Task-group shared workspace roots
└── public/
    ├── data/
    │   └── sample.txt        # Primary file edited in this demo
    └── paper/                # Optional writing-domain sample assets
```

## Recommended Walkthrough (TUI)

1. Start Seed:

```bash
npm run dev -- --workspace demo
```

2. In TUI, create and run a task:

```text
/new Improve task clarity in public:/data/sample.txt
/continue Start with repo survey, then propose a single focused improvement, and apply only after confirmation.
```

3. Observe expected behavior:
- Safe reads execute directly.
- Risky edit triggers UIP with diff preview.
- After approval, task transitions to completion.
- System prompt includes skill metadata (`repo-survey`, `safe-edit`, `test-first-fix`) only.
- Model must call `activateSkill` to load full instructions/resources.
- First activation per task requires consent; repeated activation in the same task is safe.
- Activated skill resources are mounted under `private:/.skills/<skill-name>/...`.

4. Verify the file change:

```bash
cat demo/public/data/sample.txt
```

## What This Verifies

- Tool loop execution with deterministic state transitions.
- UIP safety guard for risky operations.
- Skill discovery from `demo/skills` and metadata-only prompt injection.
- Progressive skill activation with task-scoped consent.
- Event + audit separation in `state/`.
- End-to-end behavior for a non-writing workspace task.

## Optional: Scripted Fake Sequence

`demo/fake-llm-config.ts` contains a deterministic sequence for a scripted fake-LLM run. Use it in custom harness/tests where you inject `FakeLLMClient` responses.

## Optional Writing Domain Sample

The `demo/public/paper/` directory is retained as a writing-domain example only. Seed core behavior is domain-agnostic.
