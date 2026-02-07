# CoAuthor Vision and Interaction Design

> Version: V0  
> Last Updated: 2026-02-07  
> Status: Vision Document (Guideline)

This document describes the product vision, user experience design, and interaction logic of CoAuthor.

> **For technical implementation details, please refer to**:
> - [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Architectural Design
> - [DOMAIN.md](docs/DOMAIN.md) - Domain Model
> - [MILESTONES.md](docs/MILESTONES.md) - Milestone Plan

---

## 0. Background and Positioning

CoAuthor is a "co-author type system" for STEM academic writing:

- **User = Reviewer/PI**: Proposes requirements, provides facts and assets (experiments, figures, code, data), and makes final decisions (accept/reject/adjust).
- **LLM Agents = Co-author/Postdoc**: Proactively drafts and iterates paragraph by paragraph, using tool calls with auditable logs and UIP confirmation for risky actions.

**Core Difference**: Writing cannot be verified for "correctness" using test cases like coding. Therefore, CoAuthor's engineering strategy is:
- Replace "correctness" with **auditable, traceable, and compilable (LaTeX)**;
- Replace "generation quality" with **tool-use loops, UIP review for risky actions, and auditability**;
- Engineer "context understanding" into **Outline Contract + Stable Brief/Style + Local Paragraph Range + Asset Citation**.

---

## 1. V0 Goals and Non-Goals

### 1.1 V0 Goals (Must Achieve)

1. **End-to-end Claude Code style main workflow**
   - User inputs requests via REPL (chat instructions or slash commands)
   - The system encapsulates requests into Tasks and enters a shared task pool (Billboard)
   - Agent claims Task, builds context, and executes a **tool-use loop**
   - Risky actions (e.g., `editFile`) require UIP confirmation with a diff preview
   - File changes are monitored, and the Agent can recover from manual user modifications via UIP

2. **LaTeX-first Engineering**
   - Main artifacts are `.tex` files (can be included by chapter)
   - Capability to perform minimal compilation checks after risky edits (optional)

3. **OUTLINE.md Contract and Flexibility**
   - The outline is an independent Markdown document `OUTLINE.md`, which users can modify at any time
   - The system can read and inject the outline as global context

4. **Extensible Architecture**
   - CLI is only one type of Adapter; future support for Overleaf/Chrome plugins
   - V1's TODO comment asynchronous pool only needs a new Adapter + scheduling strategy

### 1.2 V0 Non-Goals (Explicitly Not Done or Weakened)

- No GUI / Web product (CLI REPL only; optional Ink TUI)
- No complex multi-Agent group collaboration (V0 only needs 1 Default Agent)
- No strong RAG/Related Work full pipeline (interfaces can be reserved)
- No forced automatic writing of TODOs into tex comments

### 1.3 Key Constraints (Must Obey)

| Constraint | Description |
|------|------|
| Do not guess figure meanings | Result interpretation must come from user-provided asset metadata |
| Risky Tool → UIP Review → Apply | Silent file overwriting is prohibited |
| No detailed Task classification | Task types are determined by Agent workflow |

---

## 2. Core Concepts

### 2.1 Actor as First-class Citizen

- **Actor** = An entity that can participate in task collaboration: Human User or LLM Agent
- User is just an Actor with special permissions/tags

### 2.2 Task-Driven Collaboration

- All interactions are uniformly abstracted as **Tasks**
- All outputs are written to the event stream as **TaskEvents**

### 2.3 Billboard (Shared Task Pool)

- **Event Store** (append-only, replayable)
- **Projection** (derived read models)
- **RxJS Streams** (real-time subscription, scheduling)

---

## 3. User Interaction Design

### 3.1 REPL Interaction Mode

V0 provides a long-running REPL:

- Users can input natural language directly "like chatting"
- Or explicitly trigger using `/` commands
- REPL UI supports "attaching to a specific task thread" (attach), presenting the Agent's workflow progress

### 3.2 Command Set (Minimal Set)

#### Task Creation

| Command | Description |
|------|------|
| `/ask <text>` | Create foreground Task |
| `/edit <file:range> <text>` | Create Task with artifactRefs |
| `/draft <outlineAnchor> <text>` | Create Task, strongly injecting OUTLINE.md |
| `/tweak <file:range> <goal> --n 3` | Create Task, expecting multiple candidates |
| `/todo add <file:range> <comment>` | Create background Task (V1) |

#### Review / Control

| Command | Description |
|------|------|
| `/tasks` | List open / awaiting_user tasks |
| `/open <taskId>` | Attach to task thread |
| `/pending [taskId]` | List pending UIPs |
| `/respond <taskId> <optionId> [--text ...]` | Respond to a UIP |
| `/followup <text>` | Append instruction to the current thread |
| `/cancel` | Cancel current task |

### 3.3 Tool-Use Output Specification

For any task that modifies text, the Agent uses tool calls and UIP:

1. **Safe tools** (`listFiles`, `readFile`) execute immediately.
2. **Risky tools** (`editFile`) require UIP confirmation with a diff preview.
3. If information or a decision is missing, the Agent issues a UIP (`request_info` / `choose_strategy`) before continuing.

---

## 4. Workflow Scenarios

### 4.1 Typical Scenario: Modifying a Paragraph

```
User: /edit chapters/01_intro.tex:10-20 Make this paragraph more academic

Agent: [TaskStarted, agentId=agent_coauthor_default]

Agent: [ToolCallRequested: editFile]
  --- a/chapters/01_intro.tex
  +++ b/chapters/01_intro.tex
  @@ -10,5 +10,5 @@
  -This thing is really fast.
  +The proposed architecture demonstrates significant latency improvements.

System: [UserInteractionRequested: confirm_risky_action]

User: /respond <approve_option_id>
Applied edit -> chapters/01_intro.tex
```

### 4.2 Typical Scenario: User Manual Modification Mid-task

```
User: /edit chapters/02_method.tex:50-60 Expand this section

Agent: [TaskStarted, agentId=agent_coauthor_default]

# User manually modifies 02_method.tex while Agent is working

Agent: [ToolCallRequested: editFile]
  (Diff based on original file content)

# Apply fails due to file change
System: [ToolCallCompleted: editFile isError=true]

System: [UserInteractionRequested: request_info]
  "File changed while editing. Re-read and retry?"

User: /respond <retry_option_id>
Agent re-reads file and retries edit.
```

### 4.3 Typical Scenario: Multiple Candidates

```
User: /tweak chapters/03_result.tex:100-105 Make this sentence more concise --n 3

Agent: [UserInteractionRequested: choose_strategy]
  Option A (concise)
  Option B (formal)
  Option C (emphatic)

User: /respond <optionB_id>
Agent: [ToolCallRequested: editFile] (apply selected option)
```

---

## 5. Asset Management Principles

### 5.1 Asset Types

| Type | Description | Metadata Requirements |
|------|------|------------|
| `tex` | LaTeX source file | - |
| `outline_md` | Outline file | - |
| `figure` (schematic) | Schematic diagram (e.g., pipeline) | source, purpose |
| `figure` (result) | Result diagram (e.g., bar chart) | source, purpose, **message** |
| `code` | Key implementation code | source, purpose |
| `data` | Experimental data | source, purpose |

### 5.2 Key Constraints

- **Result diagrams must have a message**: Users must tell the system "what this figure is intended to illustrate"
- **Agent must not guess data meanings**: Can only describe visual features (trends, colors), cannot interpret experimental conclusions
- **Code assets used for Method section**: Agent can extract algorithm descriptions from code

---

## 6. Context Strategy

### 6.1 Global Context (Always Injected)

| File | Description |
|------|------|
| `OUTLINE.md` | Thesis outline (must exist) |
| `BRIEF.md` | What the article does, contributions, audience (optional) |
| `STYLE.md` | Tone, glossary, forbidden words (optional) |

### 6.2 Local Context (Injected as Needed)

- Range of artifactRefs specified by Task
- Adjacent paragraphs (to reduce repetition)
- Metadata of related assets

### 6.3 Handling Missing Context

- If OUTLINE.md does not exist, prompt the user to create it
- If BRIEF.md/STYLE.md does not exist, degrade gracefully (but suggest creation)

---

## 7. V1 Reserved Features

The following features are explicitly deferred to V1, but the V0 architecture must reserve extension points:

| Feature | Description |
|------|------|
| TODO Async Pool | `/todo add` creates background task |
| Background Scheduler | Background execution of low-priority tasks |
| Overleaf Plugin | Selection → artifactRefs → Task |
| Multi-Agent | ReviewerAgent, InterviewerAgent |
| Related Work RAG | Literature search, three-layer materials |

---

## 8. Project Structure (Thesis Workspace)

```
my-thesis/
├── OUTLINE.md              # Outline (Required)
├── BRIEF.md                # Project Brief (Recommended)
├── STYLE.md                # Style Guide (Recommended)
├── main.tex                # Main file
├── chapters/
│   ├── 01_introduction.tex
│   ├── 02_background.tex
│   └── ...
├── figures/                # Figures and charts
├── code/                   # Key code
├── bib/
│   └── refs.bib
└── .coauthor/              # CoAuthor working directory
    ├── events.jsonl        # Event Store
    ├── projections.jsonl   # Projection checkpoints
    ├── audit.jsonl         # Tool audit log
    └── conversations.jsonl # Conversation history
```

---

## Appendix: Comparison with Claude Code

| Feature | Claude Code | CoAuthor |
|------|-------------|----------|
| Goal | Code writing | Academic writing |
| Verification | Test case | Compilable + Rollable |
| Minimal Unit | Function/File | Paragraph |
| Context | AST + LSP | OUTLINE + BRIEF + STYLE |
| Main Workflow | Think → Act → Observe | Tool Use → UIP → Review |
| Adapter | CLI | CLI (V0) → Overleaf (V1) |
