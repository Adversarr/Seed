# Skill Pipeline (V1)

## Scope

Skill support in V1 is workspace-local only:
- discovery root: `<workDir>/skills`
- no built-in/user/extension tiers yet
- activation is explicit via `activateSkill` tool

## Skill Format

Each skill is a directory containing `SKILL.md`.

Required frontmatter fields:
- `name`
- `description`

Body content (Markdown below frontmatter) is treated as activation-time instructions.

Optional co-located resources:
- `references/`
- `scripts/`
- `assets/`
- any additional files under the skill directory

## Discovery and Parsing

Loader: `src/infrastructure/skills/skillLoader.ts`

Discovery patterns under `<workDir>/skills`:
- `SKILL.md`
- `*/SKILL.md`

Ignored paths:
- `.git`
- `node_modules`

Parsing behavior:
1. strict frontmatter parse
2. fallback extraction for `name` and `description` if strict parse fails

Validation behavior:
- missing `name` or `description` -> warning + skip
- sanitized name empty -> warning + skip
- duplicate names -> last discovered wins + warning

Skill names are normalized to stable IDs via `sanitizeSkillName`.

## Registry and Visibility

Domain port: `src/core/ports/skill.ts`

Implementations:
- mutable registry: `DefaultSkillRegistry`
- read-only filtered view: `FilteredSkillRegistry`

Per-agent visibility is controlled by `Agent.skillAllowlist`:
- `undefined` -> all discovered skills
- `[]` -> none
- `['*']` -> explicit all
- `['name-a', 'name-b']` -> listed skills only

Runtime constructs a filtered skill view for each task execution and injects it into `AgentContext.skills`.

## Prompt Injection (Metadata Only)

`BaseToolAgent` appends an `Available Skills` section to the system prompt using:
- skill name
- description
- location

The initial prompt never includes skill body content.
Agents must call `activateSkill` to load full instructions/resources.

## Activation Flow

Tool: `activateSkill` (`group: meta`)

Arguments:
- `{ name: string }`

Risk and consent semantics:
- first activation of a visible skill in a task session -> `risky` (requires UIP confirmation)
- repeated activation of the same skill in the same task session -> `safe`

Execution behavior:
1. validate skill exists and is visible to current task/agent
2. load `SKILL.md` body lazily (progressive disclosure)
3. mark skill consented + activated for that task session
4. build folder-structure summary
5. materialize skill directory into task-private mount:
   - disk path: `private/<taskId>/.skills/<skillName>/...`
   - logical path returned to model: `private:/.skills/<skillName>`
6. return structured activation payload (`instructions`, `folderStructure`, `mountPath`, metadata)

Error behavior:
- unknown/invisible skill -> error + visible skill list

## Session Lifetime

Skill consent/activation state is task-scoped and in-memory:
- set during runtime execution
- cleared when runtime/task reaches terminal lifecycle cleanup
- isolated across tasks

## Demo Assets

Demo workspace includes sample skills under `demo/skills`:
- `repo-survey`
- `safe-edit`
- `test-first-fix`

See `demo/README.md` for activation walkthrough.

