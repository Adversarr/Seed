## 你给的 devDependencies 里哪些会用上
下面这些我会直接纳入脚手架与实现（避免重复引入同类库）：
- vitest + @vitest/coverage-v8：单元/集成测试 + 覆盖率
- ink-testing-library：TUI（Ink）组件测试
- mock-fs / memfs：patch apply 与文件写回的隔离测试
- yargs：CLI 子命令解析（task/list/thread/patch/log）
- tsx：开发期直接运行 TS
- eslint / eslint-config-prettier / prettier / typescript-eslint：代码质量与格式（可选但建议一起落地）
- cross-env、npm-run-all：跨平台脚本编排（如果需要）

其它像 msw、@octokit/rest、glob、semver 等在 M0 最小闭环里不强依赖，我会先不引入到运行路径里，避免范围膨胀。

## 运行时依赖（dependencies，我会用到的全部）
- better-sqlite3：EventStore 落地到 SQLite
- zod：事件 payload 校验（保证 event log 可演进、可回放）
- nanoid：生成 taskId / proposalId
- pino：结构化日志（事件回放时也能输出）
- ink + react：可选的主界面式 Billboard（默认入口可先走 CLI，再扩展成 TUI）
- ink-text-input：TUI 底部命令输入
- diff：解析/应用 unified diff（applyPatch/parsePatch），用于 patch accept/apply

## 目录结构（脚手架产物）
- package.json / tsconfig.json / README.md / vitest.config.ts
- src/
  - index.ts（bin 入口：yargs 解析；可选默认启动 Ink UI）
  - core/
    - eventStore.ts（append/read；写入事务；按 stream 顺序号）
    - projector.ts（增量投影：TaskProjection、ThreadProjection；存 cursor）
    - domain.ts（事件类型定义 + zod schema）
  - infra/
    - sqlite.ts（建库/迁移；支持 :memory: 供测试）
    - logger.ts（pino 配置）
  - patch/
    - applyUnifiedPatch.ts（diff.applyPatch 封装：读取目标→apply→写回）
  - cli/
    - run.ts（run(argv, io) 纯函数化，便于 vitest）
    - commands/*（task、thread、patch、log）
  - tui/
    - main.tsx（Ink 主界面；底部输入；视图切换）

## M0 功能闭环（对齐 roadmap 验收）
- EventStore（SQLite）+ Projection：
  - events 表：id、stream_id、seq、type、payload_json、created_at
  - projections 表：name、cursor_event_id、state_json
  - 事件：TaskCreated / ThreadOpened / PatchProposed / PatchApplied（足够验收）
- CLI：
  - task create 标题
  - task list
  - thread open taskId
  - patch propose taskId targetPath（从 stdin 或交互粘贴 patch）
  - patch accept proposalId|latest（真正写回 .tex）
  - log replay [--stream taskId]
- patch apply pipeline：
  - 仅接受 unified diff（含 ---/+++ 与 @@ hunks）
  - apply 成功：写回文件 + 追加 PatchApplied 事件
  - apply 失败：不写回 + 输出可读错误（并保持事件流可诊断）

## 测试计划（你要求“加强 test”）
我会把“可验收闭环”拆成可自动化验证的测试层级，并在脚手架里直接跑通：

### 1) 纯单元测试（vitest）
- EventStore：
  - append 后按顺序 readAll/readStream 正确
  - 事务性：同一批次写入失败不应出现半写入
  - stream seq 自增与并发保护（同 stream）
- Projector：
  - 从空 state 重放到最新 state 的确定性
  - cursor_event_id 正确推进，重复 replay 不重复应用（幂等）
- Patch apply：
  - 典型 patch 能正确修改 .tex 内容
  - 行尾差异（\n/\r\n）处理（diff 的 autoConvertLineEndings 选项）
  - hunk 不匹配时返回失败且不写文件

### 2) 文件系统隔离测试（mock-fs / memfs）
- patch accept：
  - 通过 mock-fs 构造目标 tex 文件与 patch 文本
  - accept 后检查文件内容确实变化 + 事件被追加
  - 失败路径检查：文件内容未变 + 不追加 PatchApplied

### 3) CLI 级集成测试（不 spawn 子进程，直接测 run(argv, io)）
- 用注入式 io（stdin 文本、stdout 收集器、logger stub）验证：
  - task create → task list 输出含新任务
  - thread open → 再 replay log 能看到事件序列
  - propose + accept 能修改 tex，并在回放里看到 proposal/apply

### 4) TUI 最小测试（ink-testing-library）
- 渲染 main.tsx：
  - 初始显示 task list
  - 模拟输入命令（例如 `task create ...`）后界面更新
  - 不做复杂快照，只断言关键文本存在（降低脆弱性）

### 覆盖率门槛（可选但建议）
- vitest coverage：对 core/patch 至少行覆盖 80%（避免后续改坏闭环）

## 完成后我会怎么验收（自动 + 手动）
- 自动：vitest 全绿（含 patch/事件/投影/CLI run）
- 手动 smoke：创建任务→列事件流→粘贴 patch→accept 改 .tex→回放日志看到全过程

确认后我会一次性把以上脚手架与最小闭环落地到当前空目录。