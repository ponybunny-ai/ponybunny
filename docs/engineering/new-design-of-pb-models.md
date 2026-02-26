# New Design of `pb models`

本文定义 `pb models` 命令组的新设计与实现边界，目标是让模型可见性、可用性探测、以及单模型交互测试形成一致的用户体验，并与当前 `LLM Provider Manager` 的能力保持对齐。

## 1. 背景与目标

当前 `pb models` 已有：

- `pb models list`：列出 providers 和 models
- `pb models probe`：探测 provider/model 可用性并回写 health

现有痛点：

1. `list` 输出是线性文本，不便于快速理解 provider → model 层级关系。
2. `list`/`probe` 对“默认只看 enabled provider”的规则需要显式化并统一。
3. 缺少一个“我就想对某个 provider.model 现场发问验证”的交互入口。

本设计新增并明确：

1. `pb models list` 以 tree view 展示，默认只展示 enabled providers；`--all` 展示 `llm-config` 全量 providers 及下属 models。
2. `pb models probe` 只探测 enabled providers 下的 models。
3. 新增 `pb models test <provider.model>` 交互式命令，基于系统内部 LLM 栈进行流式一问一答，并在每轮输出后展示 metadata。

---

## 2. 范围与非目标

### 2.1 In Scope

- CLI 命令层实现：`src/cli/commands/models.ts`
- 复用已有 provider-manager 完成实际请求与 streaming
- 交互式会话（TUI 风格）
- 每轮 metadata 汇总输出：
  - 请求时间
  - 首 token 延迟（TTFB）
  - 输入/输出 token
  - 估算成本（模型价格可用时）

### 2.2 Out of Scope

- 不改写 provider-manager 核心路由策略
- 不引入多会话持久化（本命令仅本地进程内会话）
- 不改动 `llm-config` schema 结构
- 不在本设计中引入富文本界面（先以轻量交互终端为目标）

---

## 3. 命令设计

## 3.1 `pb models list`

### 行为

- 默认：仅显示 `enabled === true` 的 provider 节点。
- `--all`：显示 `llm-config.providers` 的全部 provider 节点（含 disabled）。
- 输出采用 tree view：

```text
providers
├─ openai (enabled, available)
│  ├─ openai.gpt-5.2
│  └─ openai.gpt-5.2-no-endpoints
├─ anthropic (enabled, unknown)
│  └─ anthropic.claude-sonnet-4-5-20250929
└─ azure-openai (disabled, unknown)
   └─ azure-openai.gpt-4o
```

### 参数

- `--all`：显示全部 provider（默认 false）

### 数据来源与筛选规则

1. provider 来源：`loadLLMConfig().providers`
2. model 来源：`loadLLMConfig().models`
3. provider-model 关联优先级：
   - 优先 `model.providers`
   - 兜底从 `modelId` 前缀推断（`provider.model`）
4. 默认筛选：`provider.enabled === true`

---

## 3.2 `pb models probe`

### 行为

- 仅对 enabled providers 下关联 models 执行可用性探测。
- 回写 provider/model health 到 `llm-config.json`（沿用现有行为）。

### 参数（沿用）

- `--timeout <ms>`（默认 `10000`）
- `--max-models <n>`（默认 `20`）

### 关键一致性要求

- 即使存在 disabled provider 的 model，也不应被 probe。
- summary 中 endpoint 计数应与 enabled provider 数量一致。

---

## 3.3 `pb models test <provider.model>`（新增）

### 使用方式

```bash
pb models test openai.gpt-5.2
pb models test custom-openai-endpoint.gpt-5.2-custom
```

### 交互行为

- 启动后进入交互循环：
  - 用户输入一行问题
  - 触发一次流式请求
  - AI 增量输出
  - 输出 metadata 摘要
- 退出条件：
  - 输入 `/exit`
  - `Ctrl-C`

### 请求路径

- 调用 `getLLMProviderManager().completeWithModel(modelId, messages, options)`
- `options.stream = true`
- `options.onChunk` 用于增量输出并记录首 token 时间

### metadata 定义（每轮）

- `requestedAt`: ISO 时间字符串
- `firstTokenLatencyMs`: 首 token 延迟（若无 chunk 则记为 `null`）
- `inputTokens`: 可得则填，默认 `0`
- `outputTokens`: 可得则填，默认 `0`
- `totalTokens`: 来自响应 `tokensUsed`
- `estimatedCostUsd`: 调用 `providerManager.estimateCost(modelId, inputTokens, outputTokens)` 估算；若价格信息缺失则显示 `N/A`

> 注：当前 streaming 回调不天然返回 input/output tokens 细分，V1 可先用 `totalTokens` 和保守拆分策略（如 output=total,input=0）展示，并在后续协议层增强后升级。

---

## 4. 技术设计

## 4.1 代码组织

- 文件：`src/cli/commands/models.ts`
- 新增子命令：`modelsCommand.command('test <modelId>')`
- 建议抽取私有帮助函数：
  - `buildProviderModelTree(config, { all })`
  - `renderTree(tree)`
  - `runInteractiveModelTest(modelId)`
  - `formatTestMetadata(meta)`

## 4.2 TUI 方案

V1 建议采用“轻量交互终端模式”：

- 用 `readline/promises` 读取用户输入
- 用 stdout 做流式增量渲染
- 捕获 `SIGINT` 实现优雅退出

理由：

1. 依赖最少，和当前命令风格一致。
2. 成本低于引入复杂组件化 TUI。
3. 能满足“交互式 + 流式 + metadata”核心目标。

后续若需更复杂 UI（多窗格/历史滚动/快捷键），可升级到 Ink 组件化界面。

---

## 5. 错误处理与边界情况

## 5.1 输入与模型校验

- `modelId` 不存在：提示并退出（code 1）
- 解析到的 provider 不存在或 disabled：默认拒绝测试并提示
  - 可选参数 `--allow-disabled`（后续可加，不是 V1 必需）

## 5.2 运行时错误

- Provider 无凭据/不可用：打印错误并继续交互，不中断整个 test 会话
- 流式中断：打印失败原因并结束本轮

## 5.3 兼容性

- OpenAI 协议 provider 统一走 `/v1/responses`（遵循当前实现约束）

---

## 6. 验收标准（Definition of Done）

1. `pb models list`
   - 默认只显示 enabled providers
   - `--all` 显示全部 providers
   - 输出为树状层级（provider → models）

2. `pb models probe`
   - 仅探测 enabled providers 下 models
   - summary 与回写逻辑正确

3. `pb models test <provider.model>`
   - 可进入交互模式
   - 支持 `/exit` 和 `Ctrl-C` 退出
   - 流式输出响应
   - 每轮输出 metadata（请求时间、TTFB、token、成本）

4. 文档与帮助
   - `pb models --help`、`pb models test --help` 文案完整
   - CLI 文档补充命令示例

---

## 7. 测试计划

## 7.1 单元测试

- `isEndpointEffectivelyEnabled()`：覆盖 enabled/disabled + credentials 组合
- provider-model 树构建函数：
  - model.providers 场景
  - `provider.model` 前缀推断场景
  - `--all` 筛选场景
- metadata 计算函数：
  - 有/无首 token
  - 成本可计算/不可计算

## 7.2 集成测试

- `models list` 输出包含树状结构关键符号/层级
- `models probe` 在禁用 provider 存在时仍只 probe enabled
- `models test` 使用 mocked provider-manager：
  - 验证 stream 回调路径
  - 验证退出命令处理

---

## 8. 分阶段实施建议

### Phase 1（低风险）

- 改造 `list` 为 tree view + `--all`
- 明确 `probe` 的 enabled-only 行为并补测试

### Phase 2（新增能力）

- 实现 `models test <modelId>` 交互命令
- 输出基础 metadata（请求时间、TTFB、totalTokens、估算成本）

### Phase 3（增强）

- 细化 token 统计（input/output）
- UI 升级（可选 Ink 组件化）

---

## 9. 兼容性与回滚

- 新命令是增量能力，不破坏现有 `models list/probe` 参数兼容性。
- 若 `models test` 线上发现异常，可仅回滚该子命令，不影响 provider-manager 主路径。
