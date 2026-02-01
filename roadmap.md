# CoAuthor（V0）架构与交互设计文档（开发指导版）

> 版本：V0 目标实现规范（CLI REPL 为主要交互入口）
> 关键词：**Task 驱动 / Actor 一等公民 / Event Log 审计 / RxJS 流式调度 / LLM Workflow 可附着（attach）/ LaTeX-first / Outline.md 契约 / 可扩展到 Overleaf 插件**
> 读者：负责 V0 开发与后续扩展（V1 TODO 池、Overleaf/Chrome 插件、更多 Agents）的工程人员

---

## 0. 背景与定位

CoAuthor 是一个面向 STEM 学术写作的“合著者型系统”：

- **User = Reviewer/PI**：提出需求、提供事实与资产（实验、图、代码、数据）、做最终裁决（接受/拒绝/调整）。
- **LLM Agents = Co-author/Postdoc**：主动规划、起草、逐段落修改，产出可审阅的计划与可回滚的 patch，并持续维护一致性。

**核心差异**：写作不可像 coding 那样用 test case 验证“正确性”。因此 CoAuthor 的工程策略是：
- 将“正确性”替换为 **可审计、可追踪、可回滚、可编译（LaTeX）**；
- 将“生成质量”替换为 **计划先行（plan-first）、小步修改（patch-first）、人类确认（review-first）**；
- 将“上下文理解”工程化为 **Outline 契约 + 稳定 Brief/Style + 局部段落范围 + 资产引用**。

---

## 1. V0 目标 / 非目标 / 约束

### 1.1 V0 目标（必须达成）
1. **端到端跑通 Claude Code 风格的主流程**（最重要代表性 workflow）
   - 用户通过 REPL 输入请求（chat 指令或 slash 命令）
   - 系统将请求统一封装为 Task，进入共享的任务池（Billboard）
   - Agent 领取 Task，构建上下文，先输出 **修改计划（plan）**，再输出 **patch（diff）**
   - 用户审阅并确认应用 patch
   - 文件变更被监控，Agent 对用户手动修改具备“感知与重放/重基线（rebase）”能力
2. **LaTeX-first 工程**
   - 主产物为 `.tex` 文件（可分章节 include）
   - 能对 patch 应用后进行最小编译检查（可选：latexmk）
3. **OUTLINE.md 契约与灵活性**
   - 大纲是独立 Markdown 文档 `OUTLINE.md`，用户可随时修改
   - 系统能读取并注入 outline 作为全局上下文之一（V0 不强制“锁定”，但必须感知变化）
4. **架构可扩展**
   - CLI 仅为一种 Adapter；未来可接 Overleaf/Chrome 插件
   - V1 的 TODO comment 异步池，只需新增 Adapter + 调度策略，不应重写核心

### 1.2 V0 非目标（明确不做或弱化）
- 不做 GUI / Web 产品（仅 CLI REPL；可选 Ink TUI）
- 不做复杂多 Agent 群体协作（V0 至少 1 个 Default Agent 足够；多 Agent 预留架构）
- 不做强 RAG/Related Work 完整流水线（可留接口；V0 只需资产系统最小骨架）
- 不强制自动把 TODO 真的写进 tex 注释（TODO 的“呈现”为 UX 层问题；源数据应在 Billboard 里）

### 1.3 关键约束（必须遵守）
- **系统不得“猜测”实验图/结果图的含义**：结果解释必须来自用户提供的资产元信息（V0 可先不实现 VLM，但资产元信息管线必须预留）
- **所有写作修改必须走 patch → review → apply**：禁止静默覆盖文件
- **Task 不做细分类**：任务“是什么”由 **路由到的 Agent + 该 Agent 的 workflow** 决定（Task schema 通用化）

---

## 2. 核心理念与术语

### 2.1 Actor 一等公民
- **Actor** = 能参与任务协作的主体：Human User 或 LLM Agent
- User 只是带特殊权限/标记的 Actor（例如能最终 apply patch 或能否自动 apply）

### 2.2 Task 驱动协作
- 所有交互（用户 chat、slash 命令、未来 TODO comment、未来 Overleaf 选区操作）都被统一抽象为 **Task**。
- 所有产出（plan、patch、反馈、状态变化、artifact 变更）都作为 **TaskEvent** 写入事件流，形成可审计链路。

### 2.3 Billboard（共享任务池）
你提出的 billboard 在工程上应落地为：
- **Event Store（追加写、可回放）**
- **Projection（派生读模型）**
- **RxJS Streams（实时订阅、调度、UI 更新、Agent 触发）**

---

## 3. 用户体验与交互逻辑（V0）

### 3.1 REPL 交互模式总览
V0 提供一个长期运行的 REPL：

- 用户既可以“像聊天一样”直接输入自然语言（默认变成一个 foreground Task）
- 也可以用 `/` 命令显式触发（更可控、可脚本化）
- REPL UI 支持“附着到某个任务线程”（attach），呈现 Agent 的工作流进度、plan、patch、候选版本等——**这就是 Claude Code 的核心体验**：用户看到 Agent 在做什么、改哪里、为什么。

### 3.2 用户可用命令（建议最小集合）
> 命令只是 Adapter 层，不应侵入核心领域逻辑。命令最终要么创建 Task，要么在 Task thread 上追加事件（accept/reject/feedback）。

**Task 创建类**
- `/ask <text>`：创建 foreground Task（默认分配给 default agent）
- `/edit <file:range> <text>`：创建 foreground Task，并附带 artifactRefs（范围明确）
- `/draft <outlineAnchorOrHint> <text>`：创建 foreground Task；上下文构建器会强注入 OUTLINE.md
- `/tweak <file:range> <goal> --n 3`：创建 foreground Task（期望返回多个候选）
- （预留）`/todo add <file:range> <comment>`：创建 background Task（V1）

**Review / Control 类**
- `/tasks`：列出 open / awaiting_review 等任务
- `/open <taskId>`：附着到 task thread（进入该任务的“会话视图”）
- `/accept <proposalId>`：接受某个 patch proposal，触发 apply
- `/reject <proposalId> [reason]`：拒绝 patch，并追加反馈事件
- `/followup <taskId> <text>`：在该 task thread 里继续提要求（追加 UserFeedback）
- `/cancel <taskId>`：取消任务（若 agent 正在执行要支持取消信号）
- `/agent <name>`：切换 default agent（可选）

### 3.3 “计划先行”的输出规范（强制）
对于任何会修改文本的任务，Agent 必须按固定模板输出两段结构化产物：

1) **Plan（修改计划/意图/要点）**：面向人审阅
- 修改目标（Goal）
- 识别到的问题（Issues）
- 计划采取的策略（Strategy）
- 改动范围（Scope：哪些段落/句子/section）
- 风险提示（Risk：可能引入重复、需要用户补充信息、需要引用/图表 meta 等）
- 若缺少关键事实/资产 meta：明确提出问题（Blocking questions）

2) **Patch Proposal（差异补丁）**：面向机器应用 + 人审阅
- 以 unified diff 或等价结构化 patch 表达
- 必须能定位到 artifact + range（或基于 anchor）
- 必须声明其 baseRevision（用于 drift 检测）

用户看到 plan 后再看 patch，最终用 `/accept` 应用。

---

## 4. 系统架构总览（Clean + Extensible）

采用 **Hexagonal Architecture（端口-适配器）**：

- **Domain（领域层）**：Actor、Task、Artifact、事件、策略（纯 TS，无外部依赖）
- **Application（应用层）**：UseCases（创建任务、路由、运行 agent workflow、apply patch、rebase）、ContextBuilder
- **Infrastructure（基础设施层）**：SQLite EventStore、文件系统监控、LLM Provider、diff 引擎、LaTeX 编译器适配
- **Interfaces（接口层）**：CLI REPL / 未来 Overleaf Adapter / TODO Adapter

核心“管道”如下：

**User/Agent（Actor） → Task → Billboard（事件流） → Router/Scheduler → Agent Runtime（workflow） → Plan/Patch events → User review → ApplyPatch → ArtifactChanged events → Loop**

---

## 5. 领域模型（Domain Model）— V0 必须实现的最小实体

### 5.1 Actor
字段建议：
- `id`
- `kind: 'human' | 'agent'`
- `displayName`
- `capabilities`（权限/能力声明，决定是否允许 apply patch、是否允许运行 latexmk 等）
- `defaultAgentId`（仅 human 需要）

### 5.2 Artifact（论文与资产统一抽象）
字段建议：
- `id`
- `type: 'tex' | 'outline_md' | 'bib' | 'figure' | 'data' | 'code' | 'other'`
- `path`
- `revision`（hash 或 mtime+size；建议 hash，利于 drift）
- `metadata`（V0 可空；但必须可扩展用于图/代码 meta）

**V0 必需 Artifact 类型**：
- `OUTLINE.md`
- `main.tex` 与 `chapters/*.tex`（或用户自定义结构）
- 可选：`STYLE.md` / `BRIEF.md`（若存在则注入上下文）

### 5.3 Task（通用任务载体）
建议字段：
- `taskId`
- `createdBy: ActorId`
- `assignedTo?: ActorId`（可空）
- `priority: 'foreground' | 'normal' | 'background'`
- `status: 'open' | 'claimed' | 'in_progress' | 'awaiting_review' | 'done' | 'blocked' | 'canceled'`
- `intent`（string + 可选 structured）
- `artifactRefs?: Array<{ path; range?: {lineStart; lineEnd} }>`
- `baseRevisions?: Record<path, revision>`（创建或 claim 时快照）
- `threadId`（任务评论串）
- `timestamps`

### 5.4 TaskEvent（事件是审计主干）
最小事件集（V0）：
- `TaskCreated`
- `TaskRouted`
- `TaskClaimed`
- `TaskStarted`
- `AgentPlanPosted`
- `PatchProposed`
- `UserFeedbackPosted`
- `PatchAccepted`
- `PatchRejected`
- `PatchApplied`
- `TaskCompleted`
- `TaskFailed`
- `ArtifactChanged`（来自 FileWatcher）
- `TaskRebased` / `TaskNeedsRebase`（drift 处理）

事件必须带：
- `eventId`
- `taskId`
- `authorActorId`
- `timestamp`
- `payload`（zod 校验）

---

## 6. Billboard（共享任务池）设计（V0 核心）

Billboard 是 V0 的“协作中枢”，它必须同时做到：

1) **统一入口**：所有 Adapter 只需 `appendEvent(TaskCreated)`
2) **统一出口**：UI 与 Agents 通过订阅 streams 得到最新任务状态与产物
3) **审计与可回放**：任何异常都可通过事件回放复盘
4) **高扩展性**：未来多 Agent、多 UI、多入口不会改变核心

### 6.1 组件拆分
- **EventStore（持久化）**：SQLite（推荐）或 JSONL（原型可用）
- **Projector / Projection（派生读模型）**：将事件流折叠成 `TaskView`、`ThreadView`、`ArtifactIndex`
- **Billboard API（应用层端口）**：
  - `appendEvent(event)`
  - `getTask(taskId)`
  - `queryTasks(filter)`
  - `getThread(taskId)`
  - `events$`（RxJS Observable）
  - `taskViews$`（可选：投影输出流）

### 6.2 RxJS 流式调度（Router + Scheduler）
- **RouterPolicy**：把“未分配任务”分配给某个 actorId
  - V0 规则：`assignedTo = (user指定) ? specifiedAgent : user.defaultAgent`
- **SchedulerPolicy**：决定 agent 何时执行
  - foreground：优先执行
  - background：空闲执行（V0 可不实现 background，但 pipeline 要支持）

> 重要：Router/Scheduler 是“纯策略层”，不依赖 CLI，不依赖具体 LLM。

---

## 7. Agent Runtime（V0 的“像 Claude Code 一样工作”）

### 7.1 AgentHost 与并发模型
V0 推荐一个 AgentHost 进程，管理多个 agent（至少一个 Default CoAuthor Agent）。

- 每个 agent 订阅 `Billboard.taskViews$`
- 过滤出“分配给自己且可执行”的任务：
  - `status=open` 或 `status=claimed但未开始`
- 使用 RxJS `mergeMap` 控制并发：
  - V0 建议 **写作类任务单并发 = 1**（避免两个任务同时改同一个文件造成冲突）
  - 读取类任务可并发更高（V1 再细化）

### 7.2 Agent 的端口依赖（必须解耦）
Agent 不应直接调用 SQLite、FS、LLM SDK；只依赖抽象端口：

- `BillboardClient`
- `ArtifactStore`（readFile、getRevision、listFiles）
- `PatchEngine`（生成/应用/校验 patch）
- `LLMClient`（支持多 profile）
- `Diagnostics`（可选：latex build / lint）

这样未来换 UI、换模型、换存储不影响 workflow。

### 7.3 Default CoAuthor Agent：V0 代表性 workflow
V0 只需要一个主 agent，但它必须把“plan → patch → review → apply”的体验做扎实。

**Workflow（写作/改稿类任务的统一骨架）**

1) **Claim**
- 读取 TaskView
- 写入 `TaskClaimed`（author=agent）
- 生成 `baseRevisions` 快照（对 task 涉及的 artifacts：tex 文件、OUTLINE.md 等）

2) **Build Context**
- 读取 `OUTLINE.md`（始终注入）
- 读取 `BRIEF.md`、`STYLE.md`（若存在）
- 若 task 指定了 `artifactRefs`：读取对应 file range 的文本
- 若未指定范围：使用启发式选择焦点（例如最近修改的章节、或 main.tex include 的当前章；V0 可简单：让用户显式指定或提示补充）
- 形成一个结构化 Context Package（而不是拼长字符串），便于后续替换/压缩

3) **Drift Check（用户手改感知）**
- 对比当前 artifact revision 与 task.baseRevisions：
  - 若关键文件变化：记录 `TaskNeedsRebase` 或在 plan 中显式提示“我将基于最新版本重新生成 patch”
  - V0 推荐：自动读取最新内容并继续（即“自动 rebase”），但要记录事件说明发生了 drift

4) **Plan（使用 reasoning/thinking 或 writer 的 plan 模式）**
- 输出 **计划要点**（AgentPlanPosted）
- 若缺关键信息（比如“图表想表达什么”）：
  - 将 task 状态置为 `blocked`
  - 在 plan 里提出明确问题（并可自动创建一个“需要用户回答”的子 task，V1 再做；V0 可直接在 thread 里提问）

5) **Patch Proposal（使用 writer profile）**
- 生成 unified diff（或结构化 patch）并附带：
  - 修改文件列表
  - baseRevision
  - patchId
- 写入 `PatchProposed`
- 将 task 状态置为 `awaiting_review`

6) **Wait Review（人类循环）**
- 用户 `/accept` → 触发 apply
- 用户 `/reject` 或 `/followup` → 写入反馈事件，agent 再次进入 Plan/Patch

7) **Apply Patch（建议由“ApplyUseCase”处理）**
- Apply 本身是应用层 use case（可由 human 触发，也可由具备权限的 agent 触发）
- Apply 前做最小校验：
  - baseRevision 是否匹配当前文件（否则要求 rebase）
  - patch 是否可 clean apply
- Apply 后写入 `PatchApplied` + `ArtifactChanged`（或由 FileWatcher 产出 ArtifactChanged）
- 任务置为 `done`

---

## 8. Context Engine（上下文构建）— V0 最小但必须正确

Context Engine 的目标是：**稳定全局 + 聚焦局部 + 可解释**，避免 LLM 重复、跑题、瞎改。

### 8.1 全局上下文（Always-on）
- `OUTLINE.md`（始终存在）
- `BRIEF.md`（如果存在）：论文在做什么、贡献是什么、读者是谁
- `STYLE.md`（如果存在）：语气、术语表、禁用词、时态、人称策略

> V0：以上文件不存在也要优雅降级；提示用户生成 BRIEF/STYLE 是 V1 可增强点。

### 8.2 局部上下文（Focus）
- 若 task 带 `artifactRefs(range)`：只读取指定范围（最强约束）
- 否则读取“最相关文件片段”（V0 允许简单策略：用户指定章节文件；或者最近修改文件）
- 读取相邻段落（可选）：用于降低重复（V1 可增强）

### 8.3 资产上下文（V0 预留接口）
图表/代码等资产在 V0 可以先只做：
- 能被注册为 Artifact（type=figure/code）
- 其 metadata 允许为空，但 workflow 在需要解释“结果图含义”时必须阻止瞎编并向用户提问

---

## 9. Patch / Review / Apply 体系（写作版的“可验证性”支柱）

写作不可测试，但 patch 机制提供：
- 可审阅、可回滚、可合并冲突处理、可审计链路

### 9.1 Patch 规范
V0 推荐统一 diff（unified diff）作为交换格式：
- 优点：易展示、易存储、可用成熟库 apply
- 必须包含：
  - 目标文件 path
  - base revision（hash）
  - patchId
  - 可选：受影响行范围

### 9.2 Apply 策略
- 默认：**手动确认 apply**（用户 `/accept`）
- ApplyUseCase 做三件事：
  1) 校验 patch 是否基于当前 revision（否则拒绝并提示 rebase）
  2) clean apply 写回文件
  3) 追加 `PatchApplied` 事件，触发后续流程（可选 build）

### 9.3 最小质量闸门（V0）
- 必需：patch 可 clean apply、不会破坏文件编码
- 可选（强烈建议但可开关）：
  - `latexmk` 编译
  - 基础 lint（例如引用 key 是否存在、明显的 LaTeX 语法错误）

---

## 10. 文件变更感知（用户手改）— 必须具备的“协作真实感”

### 10.1 FileWatcher（基础设施）
- 监控：`*.tex`、`OUTLINE.md`、（可选）`BRIEF.md`、`STYLE.md`
- 每次变更：
  - 更新 Artifact revision
  - 追加 `ArtifactChanged` 事件（包含 path、newRevision）

### 10.2 Drift（漂移）处理原则
- Agent 处理任务时若发现 baseRevision 已过期：
  - 不直接 apply patch（防止覆盖用户新改动）
  - 自动 rebase（重新读取最新片段，重新生成 plan/patch）
  - 在 thread 中明确说明发生 drift 以及可能原因

---

## 11. LLM 模型支持（fast/base/thinking）— V0 需要但要工程化

### 11.1 LLMClient 抽象
必须支持：
- 多 provider（OpenAI/Anthropic/本地等）
- 多 profile（fast/writer/reasoning）
- 流式输出（用于 CLI 呈现“正在写”）
- tracing（记录 request/response 元信息到事件或日志，便于审计与调试）

### 11.2 Profile 用途规范（避免混用）
- **fast**：解析用户指令、轻量改写、多候选生成（/tweak）
- **writer**：生成 LaTeX 文本与 patch
- **reasoning/thinking**：生成 plan、检查一致性、跨文件结构性判断

> thinking 不是“随便开启”，而是 workflow 的明确 step。这样才能控制成本与稳定性。

---

## 12. CLI 只是 Adapter：为何与如何“可扩展到 Overleaf”

### 12.1 Adapter 原则
- Adapter 做的事只有：
  1) 将外部输入转换为 TaskCreated / UserFeedback / PatchAccepted 等事件
  2) 订阅 task thread 并展示
- Adapter 不包含任何“写作逻辑”，写作逻辑在 Agent workflow 中

### 12.2 Overleaf/Chrome 插件（未来）如何接入（无需重构）
- 插件将“选区 + 评论”转成 artifactRefs + intent → TaskCreated
- 插件展示 thread 中的 plan/patch/候选 → 用户点击 accept → PatchAccepted
- 全部复用 Billboard + Agent Runtime

---

## 13. V0 目录与工程组织建议（清晰、可扩展）

建议 monorepo 或单包均可，核心是分层明确：

- `domain/`：实体、事件、策略（纯逻辑）
- `application/`：用例（PostTask/RouteTask/RunAgent/ApplyPatch）、ContextBuilder
- `infrastructure/`：SQLite store、FS watcher、LLM provider、diff/latex 工具适配
- `interfaces/cli/`：REPL、命令解析、视图渲染（Ink 可选）
- `agents/`：agent runtime 与 workflows

同时强制：
- schema 校验（zod）
- DI（tsyringe/inversify）让端口可替换
- 统一日志与 trace id（关联 taskId）

---

## 14. Milestone 计划（V0 开发路线，按价值优先）

> 原则：尽早把“LLM 端到端跑通 + patch/review/apply”做出来；其它能力在此之上叠加。

### M0：Billboard 基础闭环（无 LLM 也能跑）
- 实现 EventStore（SQLite）+ Projection
- CLI 能创建 task、列出 task、打开 thread
- 手动贴入一个 patch proposal 也能 accept/apply（验证 apply pipeline）

**验收**：你能创建任务、看到事件流、能通过 accept 应用 patch 到 tex 文件，并在日志里回放发生过什么。

### M1：端到端 LLM Workflow（V0 的核心里程碑）
- Default CoAuthor Agent 接入 LLMClient
- workflow：claim → context → plan → patch proposed → awaiting_review
- CLI 展示 plan + diff，支持 `/accept` `/reject` `/followup`
- FileWatcher 产出 ArtifactChanged（至少 OUTLINE.md 与 tex）

**验收**：像 Claude Code 一样：用户一句话改某段 → agent 给计划 → 给 diff → 用户确认 → 文件更新。

### M2：Drift/rebase（用户手改感知）变成稳定能力
- task.baseRevisions 与 artifact revision 对比
- patch apply 时强校验 baseRevision
- agent 自动 rebase 并记录事件

**验收**：用户在 agent 生成 patch 期间手动改文件，系统不会盲目覆盖；会提示并基于新版本重新出 patch。

### M3：多 profile 模型与 thinking step（成本/质量可控）
- 实现 fast/writer/reasoning profiles
- plan 用 reasoning，patch 用 writer，轻量解析用 fast
- 基本 tracing（写入日志或事件摘要）

**验收**：同一任务可清晰看到 plan 的生成与 patch 的生成由不同 profile 驱动，成本可控。

### M4（可选增强，仍属 V0 范围）：OUTLINE/BRIEF/STYLE 结构化注入
- ContextBuilder 稳定注入 OUTLINE
- BRIEF/STYLE 若存在自动注入，并在缺失时提示用户创建

**验收**：改文风、改章节目标等效果显著提升且更少重复。

### V1（明确延后）：TODO comment 异步池 + background scheduler
- `/todo add` → background Task
- Scheduler 空闲执行，agent 完成后自动回报
- TODO 的“呈现”为 LaTeX 注释或 UI overlay（Adapter 负责）

---

## 15. 测试与质量保障（V0 应该怎么测）

写作质量难测，但系统行为必须可测：

1. **Domain 单测**
   - event → projection 的状态机正确性
   - 路由策略（RouterPolicy）
   - scheduler 规则（优先级、并发控制）
2. **集成测试（关键）**
   - 给定一个 tex 文件，模拟 Task → 生成 patch → apply → 文件变化被 watcher 捕获
   - drift 场景：apply 前修改文件导致 baseRevision mismatch
3. **回放测试**
   - 从事件日志回放到某一时刻，TaskView 应一致（审计能力验证）

---

## 16. V0 最终形态总结（你在开发中要“守住”的几条）

1. **所有输入都变成 Task；所有输出都进入事件流**
2. **plan-first + patch-first + review-first** 是 CoAuthor 的默认协议
3. **用户随手改文件不会被覆盖**（revision/drift 是系统内建机制）
4. **CLI 只是一个输入/输出适配器**；未来 Overleaf 插件不需要改核心
5. **Task 不分类**；行为差异来自 agent/workflow 的选择与路由
6. **先把 LLM 跑通整个闭环放在最前**（M1 是 V0 成败关键）
