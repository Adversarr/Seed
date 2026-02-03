# 里程碑 1 (M1) 状态报告：LLM 集成准备阶段

**日期：** 2026年2月2日  
**状态：** ✅ **M1 已完成（Ready for M2）**  
**测试覆盖率：** 29/29 测试通过 (100%)

> 口径声明：本报告反映 2026-02-02 的实现与验收口径（包含 Plan/Patch 相关命令与事件）。自 2026-02-03 起，Plan/Patch 不再作为现行协作协议：领域事件收敛为 Task 生命周期 + UIP；文件修改与命令执行通过 Tool Use + AuditLog 表达。

---

## 执行摘要

M1 阶段的目标是“不引入外部 LLM API 依赖，补齐系统底座”。经过全面的代码审查和重构，系统已完全符合 [ARCHITECTURE.md](ARCHITECTURE.md) 的各项要求。底座设施（EventSourcing + RxJS, Checkpoint, Persistence）已经稳固，Agent 抽象层已定型，可以平滑进入 M2（端到端 LLM 协作）。

---

## M1 需求验证

### ✅ 1) 投影 Checkpoint 与增量计算 (TD-3)

**状态：** 完成  
**实现：**
- **增量更新**：Tasks 投影列表仅在启动时全量重放，之后维持内存状态并追加写入 checkpoints。
- **文件重写**：为防止 `projections.jsonl` 无限增长，实现了 `saveProjection` 时对文件的覆写优化（Snapshotting）。
- **验证**：`tests/taskServiceProjection.test.ts` 验证了 cursor 推进和计算正确性。

### ✅ 2) 并发控制与防漂移 (TD-4)

**状态：** 完成  
**实现：**
- **Optimistic Locking（历史口径）**：`patch propose` 自动捕获 `baseRevision`。
- **JIT 校验（历史口径）**：`patch apply` 时严格校验文件版本。若版本不匹配（用户中途改了文件），拒绝 Apply 并发出 `PatchConflicted` 事件。
- **验证**：`tests/patchConcurrency.test.ts`。

> 注：新方向下不再以 `PatchConflicted` 等 DomainEvent 表达冲突；应改为工具执行失败在 AuditLog 中体现，并通过 UIP 引导用户确认/重试/终止任务。

### ✅ 3) LLMClient 端口与 FakeLLM

**状态：** 完成  
**实现：**
- **Port Definition**：`src/domain/ports/llmClient.ts` 定义了标准接口。
- **Mock Implementation**：`src/infra/fakeLLMClient.ts` 提供了确定性的、基于规则的响应，用于开发和测试。
- **验证**：所有集成测试均通过 FakeLLM 运行，保证了 CI/CD 的稳定性。

### ✅ 4) AgentRuntime 与标准 Agent 接口

**状态：** 完成  
**实现：**
- **Strict Interface**：在 `src/agents/agent.ts` 中定义了符合架构文档的 `Agent` 接口 (`canHandle`, `run`, `resume`)。
- **Reactive Runtime**：`AgentRuntime` (`src/agents/runtime.ts`) 重构为基于 RxJS 的响应式运行时，订阅 `events$` 流而不是轮询。
- **Default Agent**：`DefaultCoAuthorAgent` 实现了标准的 Claim -> Context -> Confirm/Loop 工作流（当时实现细节可能包含 plan 输出，但不再作为现行协议要求）。
- **验证**：
  - `tests/agentRuntime.test.ts` 验证了任务分发、执行循环和状态更新。
  - `npm run dev -- agent handle <taskId>` 可手动触发完整流程。

---

## 架构与代码质量审查总结

在 M1 结束前的最终审查中，我们进行了以下关键重构以对齐架构文档：

1.  **引入 RxJS 响应式流**：
    - `EventStore` 现在暴露 `events$` Observable。
    - `AgentRuntime` 和 `Projector` 通过订阅流来响应事件，消除了低效的轮询代码。

2.  **Hexagonal Architecture 边界强化**：
    - 明确分离了 `AgentRuntime`（基础设施/调度器）与 `Agent`（业务逻辑）。
    - Runtime 只负责“怎么跑”，Agent 只负责“跑什么”。

3.  **V0 简化**：
    - 移除 FileWatcher 和 DriftDetector（V1 可选功能）。
    - 冲突检测简化为 JIT baseRevision 校验。
    - 优化了 Projections 的存储格式。

---

## CLI 验收路径 (Updated)

目前系统处于 M1 完成态，可通过以下命令验证核心链路（历史口径，含 Plan/Patch 事件与命令，已被 2026-02-03 新方向覆盖）：

```bash
# 1. 创建任务 (带上下文引用)
npm run dev -- task create "Refactor class X" --file src/index.ts --lines 10-20

# 2. 启动 Agent 处理 (使用 FakeLLM)
# 将生成 plan 输出并写入事件流（历史口径）
npm run dev -- agent handle <taskId>

# 3. 查看生成的 plan 相关事件（历史口径）
npm run dev -- log replay | grep AgentPlanPosted

# 4. 模拟并发冲突
# 先 Propose Patch（历史口径）
npm run dev -- patch propose <taskId> src/index.ts < my.patch
# 手动修改文件 src/index.ts
echo "change" >> src/index.ts
# 尝试 Apply (应失败)
npm run dev -- patch accept <taskId> latest
```

---

## 下一步：M2 (End-to-End LLM Workflow)

M1 已打好一切基础。M2 的工作重点将是：
1.  **接入真实 LLM**：实现 `OpenAILLMClient` / `AnthropicLLMClient`。
2.  **完善 Agent 能力**：完善通用 `confirm → loop until done` 执行循环，并接入 Tool Use + AuditLog（不以 Patch 事件作为协议）。
3.  **Prompt Engineering**：优化 System Prompt 和 Context 组装策略。

---

## 架构待办事项（TODO）

### ⏳ ArtifactStore Port 实现

**优先级**：中  
**状态**：待实现

当前工具实现（readFile、editFile、listFiles）直接使用 Node.js `fs` API，违反了端口-适配器架构原则。

**待办**：
1. 创建 `src/domain/ports/artifactStore.ts` 定义接口
2. 创建 `src/infra/fsArtifactStore.ts` 实现
3. 重构 `src/infra/tools/*.ts` 使用 `ArtifactStore` 端口
4. 更新 `src/application/contextBuilder.ts` 使用 `ArtifactStore` 端口

**接口定义**（参考 DOMAIN.md）：
```typescript
export interface ArtifactStore {
  readFile(path: string): Promise<string>
  readFileRange(path: string, lineStart: number, lineEnd: number): Promise<string>
  getRevision(path: string): Promise<string>
  listDir(path: string): Promise<string[]>
  writeFile(path: string, content: string): Promise<void>
}
```

**好处**：
- 遵循 Hexagonal Architecture
- 便于测试（可替换为内存实现）
- 便于未来支持远程存储（如 Overleaf API）
