# 里程碑 2 (M2) 状态报告：MVP Task 闭环 + UIP + Tool Audit + 通用 Agent

**日期：** 2026年2月4日  
**状态：** � **100% 完成**  
**测试覆盖率：** 68.4% (核心业务逻辑 > 80%)  
**测试命令：** `npm run test`

> 口径声明：自 2026-02-03 起，Plan/Patch 不再作为现行协议。自 2026-02-04 起，Revision 校验机制已移除（采用单用户极简策略）。

---

## 执行摘要

M2 的核心目标“Task 闭环 + UIP + Tool Audit + 通用 Agent”已经完全达成。
我们完成了以下关键改进：
1.  **架构极简重构**：移除了复杂的 Revision 校验机制，回归单用户“读-改-写”模式。
2.  **风险确认增强**：Agent 现在能生成直观的 Unified Diff 预览，供用户在确认前查看。
3.  **TUI 交互闭环**：TUI 新增了 `InteractionPanel`，支持 Diff 渲染和选项选择，无需离开 TUI 即可完成风险确认。
4.  **审计日志可见性**：CLI 新增 `audit list` 命令，支持查询最近的工具调用记录。

---

## M2 完成标准对照

| 完成标准 | 当前状态 | 证据/实现位置 |
|---|---|---|
| 领域事件收敛（仅 Task 生命周期 + UIP） | ✅ 完成 | `src/domain/events.ts` |
| 工具审计链路（ToolRegistry/Executor + AuditLog） | ✅ 完成 | `src/infra/toolExecutor.ts`, `src/infra/jsonlAuditLog.ts` |
| 高风险动作确认（confirm_risky_action） | ✅ 完成 | `src/agents/defaultAgent.ts` 生成 Diff 预览 |
| 通用 Agent 骨架（start → loop until done，按需 UIP） | ✅ 完成 | `src/agents/defaultAgent.ts`, `src/agents/runtime.ts` |
| 交互渲染与输入（CLI/TUI） | ✅ 完成 | CLI `interact` 命令, TUI `InteractionPanel` 组件 |

---

## 已实现功能列表

1.  **DomainEvent 收敛**
    - 仅保留 Task 生命周期 + UIP 事件。

2.  **UIP 交互服务**
    - 支持 Select/Confirm/Input 类型的交互。
    - TUI 支持 Diff 渲染 (绿加红减)。

3.  **AgentRuntime 端到端闭环**
    - 自动处理 UIP 请求与响应。

4.  **通用 Agent（DefaultCoAuthorAgent）**
    - 自动生成 Diff 预览用于 `confirm_risky_action`。

5.  **Tool Use + AuditLog 审计**
    - 完整的 Request/Complete 记录。
    - CLI `audit list` 命令支持查询。

6.  **极简工具集**
    - `editFile` 不再校验 revision，支持幂等写入。
    - `runCommand` 支持风险确认。

---

## 质量指标

**整体测试覆盖率：** 68.4% (Lines)

关键模块覆盖率：
- **Audit System**: `src/application/auditService.ts` (100%), `src/infra/jsonlAuditLog.ts` (100%)
- **Interaction System**: `src/application/interactionService.ts` (99%)
- **Tools**: `runCommand.ts` (95%), `editFile.ts` (87%)
- **Tool Executor**: `toolExecutor.ts` (78%)

---

## 下一步计划 (M3)

1.  **工具安全与冲突处理 (JIT)**
    - 虽然移除了 Revision 校验，但 M3 将关注更高级的冲突解决策略（如果需要）。
    - 目前策略为“最后写入者胜”。

2.  **OUTLINE / BRIEF / STYLE 上下文注入**
    - 解析 OUTLINE.md。
    - 增强 ContextBuilder。

---

## 验收命令

```bash
# 1. 创建任务
npm run dev -- task create "修改 README" --file README.md

# 2. 启动 Agent (将会触发 editFile，进而触发 UIP)
npm run dev -- agent start

# 3. 在 TUI 中查看并响应
npm run dev -- ui
# (在 TUI 中你应该能看到 Diff 预览，并选择 Approve)

# 4. 查看审计日志
npm run dev -- audit list
```
