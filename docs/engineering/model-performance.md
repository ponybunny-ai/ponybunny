# 模型能力与性能权衡 (Model Capability & Performance Trade-offs)

## 概述

OpenClaw支持多种LLM模型，从顶级的推理模型（GPT-4o, Claude Opus）到经济型模型（GPT-3.5, Haiku, Flash）。本文档分析不同模型能力对系统整体性能的影响，以及使用弱模型时的补偿策略。

## 1. 模型能力矩阵

**实现位置**: `src/agents/model-catalog.ts`

### 关键能力维度

| 能力维度 | 强模型示例 | 弱模型示例 | 系统影响 |
| :--- | :--- | :--- | :--- |
| **推理 (Reasoning)** | GPT-4o, Claude Opus 4.5 | GPT-3.5, Flash | 高级推理功能（`thinkingLevel: high/xhigh`）是否可用 |
| **上下文窗口** | 128K - 200K tokens | 8K - 32K tokens | Compaction触发频率、长文档分析能力 |
| **工具调用** | 高成功率，支持并行调用 | 低成功率，易出现参数错误 | 复杂任务的自动化能力 |
| **多模态 (Vision)** | 原生支持 | 部分支持或不支持 | 截图分析、UI理解能力 |

### 模型分类

**XHigh 级别**（最高智商）:
- GPT-5.2 系列
- Claude Opus 4.5
- Gemini Pro 2.0

**High 级别**（高性能）:
- GPT-4o
- Claude Sonnet 3.5
- Gemini Flash 2.0

**Medium/Low 级别**（经济型）:
- GPT-3.5-turbo
- Claude Haiku
- Qwen 7B-8B 系列

## 2. 功能-模型依赖分析

### 核心功能（所有模型）

- ✅ **文件操作** (`read`, `write`, `edit`)
- ✅ **命令执行** (`exec`)
- ✅ **基础对话**

**弱模型风险**:
- ❌ 路径理解偏差（相对路径 vs 绝对路径混淆）
- ❌ 多步骤任务中途丢失目标
- ❌ JSON Schema理解不精确

### 高级推理（仅强模型）

- **Thinking Mode** (`thinkingLevel: high/xhigh`):
  ```
  启用条件: model.reasoning === true
  Prompt注入: <think>...</think> 标签
  ```
- **任务自动拆解**: 强模型能自主识别何时需要创建 `subagent`
- **上下文长期规划**: 跨多轮对话维护一致的目标

### 工具调用稳定性

**强模型**:
- 并行工具调用成功率: ~95%
- 多层嵌套工具调用: 支持
- Schema复杂度容忍: 高

**弱模型**:
- 并行工具调用成功率: ~60%
- 常见错误类型:
  - 参数缺失
  - 类型不匹配
  - JSON格式错误

## 3. 模型特定的兼容性适配

**实现位置**: `src/agents/pi-tools.ts`

### Gemini 特殊处理

**问题**: Gemini要求严格的 User-Assistant-Tool 交替顺序

**解决方案**: `validateGeminiTurns()`
```typescript
// 自动插入缺失的 User/Assistant 消息以修复顺序
if (lastRole === 'tool' && nextRole !== 'assistant') {
  // 插入虚拟 Assistant 消息
}
```

### Claude 参数规范化

**问题**: Claude对工具参数的Schema有更严格的要求

**解决方案**: `patchToolSchemaForClaudeCompatibility()`
- 扁平化嵌套的 `anyOf`/`oneOf`
- 移除不支持的 `format` 字段

### OpenAI Schema限制

**问题**: OpenAI不支持根级别的 Union 类型

**解决方案**: `cleanToolSchemaForGemini()`
- 将Union类型展开为多个独立工具定义

## 4. 弱模型降级策略

**实现位置**: `src/agents/pi-embedded-runner/run.ts`

### Thinking Level 自动降级

```
用户请求: thinkingLevel = "high"
   ↓
模型拒绝 (400 Unsupported)
   ↓
自动降级: high → medium → low → off
   ↓
重试请求
```

**触发器**: `pickFallbackThinkingLevel()`

### 上下文溢出处理

```
检测到: context_length_exceeded
   ↓
触发 auto-compaction
   ↓
压缩历史 (保留决策/TODO/约束)
   ↓
重试请求
```

**实现**: `src/agents/compaction.ts`

### 认证配置文件轮换

```
遇到: 429 Rate Limit / 402 Billing Error
   ↓
切换到下一个 Auth Profile
   ↓
如果所有Profile耗尽
   ↓
触发 Model Failover (降级到备用模型)
```

**配置**: `agents.defaults.model.fallbacks`

## 5. 补偿策略详解

### Prompt 工程优化

**动态Prompt构建** (`src/agents/system-prompt.ts`):

**强模型 Prompt**:
```
你是一个高级AI助手，具备复杂推理能力。
使用 <think>...</think> 标签进行深度思考。
```

**弱模型 Prompt**:
```
你是一个AI助手。请严格遵循以下步骤：
1. 仔细阅读用户请求
2. 确定需要调用的工具
3. 按顺序执行
```

**关键差异**:
- 弱模型：更明确的步骤指导
- 强模型：更抽象的目标导向

### Few-Shot 示例注入

**建议**: 对于8B级别的模型，在 `system-prompt.ts` 中添加显式示例：

```typescript
if (modelTier === 'low') {
  systemPrompt += `
Example Tool Call:
User: "Read the file server.ts"
Assistant: {
  "tool": "read",
  "params": { "filePath": "./server.ts" }
}
  `;
}
```

### 混合模型策略

| 任务类型 | 推荐模型 | 理由 |
| :--- | :--- | :--- |
| **核心架构设计** | GPT-4o / Opus | 需要高级推理 |
| **代码实现** | Sonnet / GPT-4 Turbo | 平衡性能与成本 |
| **子任务 (Subagent)** | Haiku / Flash | 简单任务，成本敏感 |
| **心跳检查 (Heartbeat)** | Flash / Haiku | 极简任务 |

**配置示例**:
```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-3-5",
      "subagent": {
        "model": "anthropic/claude-haiku-3-5"
      },
      "model": {
        "fallbacks": ["anthropic/claude-haiku-3-5", "openai/gpt-3.5-turbo"]
      }
    }
  }
}
```

## 6. 性能瓶颈与缓解

### 关键瓶颈

**多步工具调用连贯性**（弱模型的最大挑战）:
- 症状: 第3-4步后丢失上下文目标
- 影响: 任务失败率从 5% 上升到 40%

**缓解措施**:
1.  **Runtime Info注入**: 每次调用都在Prompt中包含当前工作目录、目标、已完成步骤
2.  **Workspace Notes**: 使用 `MEMORY.md` 文件记录关键决策，让弱模型可以"查阅笔记"
3.  **强制Sandbox**: 弱模型必须在沙箱中运行，防止逻辑混乱导致的破坏性操作

**效果**: 成功率提升 20%-30%

### 成本优化建议

**生产环境**:
- ✅ 必须开启 `agents.defaults.model.fallbacks`
- ✅ 弱模型环境强制 `sandbox.mode: "non-main"`
- ✅ 监控工具调用失败率，动态调整模型选择

**测试环境**:
- 可以使用单一弱模型以节约成本
- 接受较高的失败率，依赖人工干预

## 7. 模型能力检测

**自动检测** (建议实现):

```typescript
function detectThinkingCapability(modelId: string): ThinkLevel {
  const lowTierModels = ['gpt-3.5', 'haiku', 'flash', 'qwen-7b'];
  if (lowTierModels.some(m => modelId.includes(m))) {
    return 'low';
  }
  return 'high'; // 默认假设支持
}
```

**目的**: 避免首次尝试失败（浪费API调用）

## 8. 总结与建议

### 模型选择决策树

```
任务复杂度?
  ├─ 高（架构设计、复杂推理）
  │    └─> 使用 XHigh/High 模型
  ├─ 中（代码实现、文档编写）
  │    └─> 使用 High/Medium 模型
  └─ 低（文件读取、简单查询）
       └─> 使用 Medium/Low 模型
```

### 最佳实践

1.  **永远配置 Failover**: 主模型失败时自动降级
2.  **弱模型 + Sandbox**: 强制组合，保证安全
3.  **监控关键指标**: 工具调用成功率、平均Token消耗
4.  **成本优化**: Subagent使用便宜模型，主Agent使用强模型
