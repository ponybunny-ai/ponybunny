# Session-First 主线任务执行台账（截至 2026-03-03）

> 统计范围：从“根据 `docs/plans/2026-03-02-session-first-lifecycle-implementation-plan.md` 执行开发任务”开始，到当前会话为止的**显式拆解执行任务**。  
> 说明：本台账统计的是本轮主线开发中已拆分并执行的任务项，用于核对交付进度与变更范围。

---

## 1) 总体统计

- 任务总数：**58**
- 已完成：**58**
- 待完成：**0**（按本台账统计范围）

---

## 2) 已完成任务清单（可核对）

## 批次 A（6）
- [x] 审查现有 TUI `/new` 与自然输入链路、会话 RPC 客户端能力
- [x] 实现 `/new -> conversation.new` 并设置 active session 状态
- [x] 实现非命令输入走 `conversation.message`（移除 `goal.submit` 直连）
- [x] 补齐状态与 UI 反馈（sessionId/标题/事件）并保持编译通过
- [x] 实现配置变更联动基础（schema/example/pb init 一致性入口）
- [x] 运行诊断与测试构建验证

## 批次 B（4）
- [x] 修复 activeSessionTitle 状态更新语义（支持显式清空）
- [x] 补齐首轮输入生成 session title 逻辑（已有 session 且无标题时）
- [x] 在主界面展示当前 session 信息
- [x] 运行 LSP + build + test 验证

## 批次 C（5）
- [x] 实现会话命令：`/sessions` 列表、`/use <sessionId>` 切换
- [x] 在 TUI 状态中维护 session 列表与生命周期信息
- [x] Goals 视图按 active session 过滤展示（可回退全量）
- [x] 补充事件处理：`conversation.new/response` 时刷新会话状态
- [x] 运行 LSP + build + test 验证

## 批次 D（4）
- [x] 扩展会话摘要模型（lastMessage/title）并打通 gateway->TUI 映射
- [x] 增强 SessionsView：显示标题/最近消息预览并支持一键跳 Goals 过滤
- [x] 切换会话时同步 activeSessionTitle（来源于会话摘要）
- [x] 运行 LSP + build + test 验证

## 批次 E（5）
- [x] 扩展会话管理能力：增加 archive/resume RPC 客户端方法
- [x] 新增会话命令：`/archive-session` 与 `/resume-session`
- [x] 为 SessionsView 增加 active/archived 过滤切换与刷新联动
- [x] 会话归档/恢复后自动刷新列表与状态同步
- [x] 运行 LSP + build + test 验证

## 批次 F（4）
- [x] 扩展 SessionSummary：增加 `archivedAt/archiveSummary`
- [x] 在所有 session 映射路径透传 archived 字段
- [x] SessionsView 展示归档信息并优化恢复后自动切换/定位
- [x] 更新帮助提示并运行全量验证

## 批次 G（3）
- [x] 优化 SessionsView 恢复流程：恢复后自动定位到被恢复会话
- [x] 补充归档/恢复后选中索引稳定性处理
- [x] 运行 LSP + build + test 验证

## 批次 H（5）
- [x] SessionsView 搜索命中高亮显示
- [x] Sessions 视图状态持久化（filter/query）到全局 store
- [x] `/sessions` 支持 query 参数并同步到视图状态
- [x] 新增 `/session-history` 命令与会话历史查询链路
- [x] 更新帮助与仪表盘会话状态展示，完成全量验证

## 批次 I（6）
- [x] SessionsView 增加 history role 快切键（1/2/3/4）
- [x] 扩展 history preview 元数据（generatedAt/source/role）并展示
- [x] 增强 `/sessions` 支持 limit 参数并更新状态同步
- [x] 增强 `/use` 支持 title 关键字匹配
- [x] 事件流补充 session-history 结构化字段并在 EventsView 可读化
- [x] 运行 LSP + build + test 验证

## 批次 J（6）
- [x] Sessions 排序模式持久化到全局 store
- [x] EventsView 过滤/搜索状态持久化到全局 store
- [x] 新增 `/sessions-reset` 命令重置 Sessions 视图状态
- [x] SessionsView 增加清除当前会话 history preview 快捷键（z）
- [x] Dashboard/Help 同步展示与文档更新
- [x] 运行 LSP + build + test 全验证

## 批次 K（10）
- [x] 新增 `/sessions-export` 命令导出会话摘要为 JSON 消息
- [x] 新增 `/events-export` 命令导出当前事件（支持 filter/search/limit）
- [x] 新增 `/events-reset` 命令重置 Events 视图状态
- [x] EventsView 使用全局状态的 filter/search 初始化并支持命令同步
- [x] EventItem 支持按搜索词高亮命中片段
- [x] SessionsView 增加 history preview 折叠/展开快捷键（m）
- [x] `/session-history` 增加 previewLines 参数（控制展示行数）
- [x] 新增清空全部 history preview 的命令 `/session-history-clear`
- [x] Dashboard 增加 Events 过滤/搜索摘要展示
- [x] 更新 help/registry/alias 文档并执行 LSP + build + test 验证

---

## 3) 交付核对备注

- 上述 58 项均已在本会话中完成并通过持续验证（LSP、build、test）。
- 若后续要做“主线计划剩余里程碑（如 Result DTO 深化、灰度/回滚 runbook、发布门禁等）”，建议在此台账基础上追加“批次 L/M/...” 继续累积，不改历史记录。

---

## 4) 计划内剩余任务拆解（追加）

> 口径：对齐 `docs/plans/2026-03-02-session-first-lifecycle-implementation-plan.md` 中 P0~P6 与 I-01~I-07。  
> 目标：把“仍在计划中的事项”拆解为可直接执行的任务项（不含工时）。

### R-01（P0 / I-01）迁移开关与契约冻结

- [x] R-01.1 在运行时配置中落地并校验 `tui.sessionFirst.enabled` 与 `tui.goalSubmitFastPath.enabled`（默认值、读取路径、覆盖优先级）
- [x] R-01.2 将 TUI 输入主路径显式受上述开关控制（含日志标记当前生效模式）
- [x] R-01.3 在 gateway 会话接口返回结构中补齐“是否创建 goal / 追问 / 仅回复”决策字段约定
- [x] R-01.4 补充契约文档（字段定义、兼容策略、错误码语义）并在 docs/engineering 形成定稿记录

### R-02（P0 / I-01A）配置联动门禁收口

- [x] R-02.1 增加自动化检查：配置结构变更时必须同步 schema/example/pb init（CI 或测试门禁）
- [x] R-02.2 为 `pb init --dry-run` 增加一致性断言（schema 文件、模板文件、输出结构）
- [x] R-02.3 在贡献流程文档补充“配置变更三联动”强制规则

### R-03（P3 / I-04）Session-Goal 关联模型规范化

- [x] R-03.1 冻结最终关联方案（context 字段 vs 显式字段/表）并在代码中统一单一路径
- [x] R-03.2 Gateway 创建 goal 时强制写入 `sessionId + turnId`，缺失时返回明确错误
- [x] R-03.3 查询接口补齐按 session 过滤 goals（必要时扩展到 workItems/runs）
- [x] R-03.4 增加一致性校验：任意新 goal 均可反查到源会话轮次

### R-04（P4 / I-05）视图分层最终收口

- [x] R-04.1 明确并固定各视图职责：Session / Goals / WorkItems / Runs / Results
- [x] R-04.2 将 Tasks 视图从“业务任务视图”彻底去歧义（重命名为 Timeline/Narration 或等价方案）
- [x] R-04.3 打通 drill-down 路径：session -> goal -> work item -> run
- [x] R-04.4 补齐视图间跳转命令与快捷键文档

### R-05（P5 / I-06）Result DTO 标准化（核心剩余）

- [x] R-05.1 定义统一 Result DTO（summary/artifacts/verification/cost-time-token/关联 IDs）
- [x] R-05.2 Gateway 输出统一 DTO，不再依赖临时字符串拼接
- [x] R-05.3 TUI 消费改造：以 DTO 为主、`execution_log` 为兜底
- [x] R-05.4 CLI 消费改造：与 TUI 字段一致
- [x] R-05.5 增加 Result DTO 回归测试（序列化、展示、缺字段降级）

### R-06（P6 / I-07）灰度、观测、回滚上线闭环（核心剩余）

- [x] R-06.1 实现切流状态可见化（dev/canary/default 当前模式可查询）
- [x] R-06.2 补齐核心指标采集：session 创建成功率、conversation.message 成功率、goal-session 关联覆盖率、run 成功率/时延
- [x] R-06.3 定义并实现关键异常阈值触发策略（回滚触发条件）
- [x] R-06.4 落地回滚 runbook（操作步骤、验证步骤、恢复步骤）
- [x] R-06.5 完成 staging 回滚演练并记录演练结果

### R-07（验证门禁）Go/No-Go 最终对齐

- [x] R-07.1 主路径门禁：`/new` 与自然输入均在 Session-First 下可稳定运行
- [x] R-07.2 幂等门禁：重试/重放不重复建 goal/run
- [x] R-07.3 可观测门禁：trace/log/metrics 可串联 session->result
- [x] R-07.4 配置门禁：若涉及配置结构变更，schema/example/pb init 三项一致性检查必须通过
- [x] R-07.5 发布前统一回归：build/typecheck/test + 关键手工场景验收

---

## 5) 剩余任务汇总（便于核对）

- 本次新增待办（R-01 ~ R-07）子项合计：**30 项**
- 当前状态：**已完成 30 项，剩余 0 项**
