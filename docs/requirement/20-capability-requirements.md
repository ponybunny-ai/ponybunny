# 能力需求规范 (Capability Requirements)

**文档状态**: Tier 3 - 规范文档  
**目标受众**: 开发工程师、QA工程师、产品经理  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档按**能力域（Capability Area）**组织所有功能需求和质量属性，替代传统的FR/NFR分割。每个能力包含：功能需求、质量属性、验收标准。

阅读本文档后，你应该理解：每个能力需要实现哪些功能？需要满足哪些质量标准（性能、可靠性、安全性）？

**前置阅读**:
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 执行模型
- [11-work-order-system.md](./11-work-order-system.md) — Work Order系统

---

## 能力域划分

PonyBunny的8个核心能力域：

1. **工作接收与契约形成** — 从用户输入到Goal创建
2. **规划与分解** — 将Goal分解为可执行Work Items
3. **执行与工具使用** — 运行任务、调用工具
4. **长期运行持久性** — 跨天/跨周保持状态
5. **可观测性与证据** — 实时状态流、审计日志
6. **自我评估与质量门** — 质量验证、自我检查
7. **升级与人类协作** — 何时请求人类、如何交互
8. **输出打包与交付** — Artifacts生成、PR创建

---

## 能力域1: 工作接收与契约形成

### 1.1 功能需求

#### FR-1.1.1: 多通道输入归一化

**描述**: 系统必须支持多种输入源（WebSocket、Telegram、WhatsApp、Slack、GitHub Webhook等），并归一化为统一的`ChatEvent`格式。

**业务价值**:
- 用户可从任何平台发起工作
- 开发新Channel不需要修改核心逻辑

**技术规格**:
```typescript
interface ChatEvent {
  sessionKey: string;        // "agent:{agentId}:{chatId}"
  message: string;           // 用户输入内容
  channel: string;           // "telegram" | "whatsapp" | "slack"
  userId: string;            // 平台特定用户ID
  attachments?: Attachment[];  // 文件、图片
}
```

**验收标准**:
- [ ] 新增Channel只需实现`ChannelAdapter`接口（≤200行代码）
- [ ] 同一Session在不同Channel间迁移不丢失上下文
- [ ] 支持文本、图片、PDF、代码文件附件
- [ ] Markdown格式在各平台正确渲染或优雅降级

**优先级**: P0

---

#### FR-1.1.2: Goal验证与规范化

**描述**: 接收用户输入后，系统必须验证Goal完整性并补充默认值。

**验证规则**:
| 字段 | 必填 | 默认值 | 验证规则 |
|:-----|:-----|:------|:--------|
| `title` | ✅ | N/A | 非空，≤200字符 |
| `description` | ❌ | 空字符串 | ≤10000字符 |
| `budget.max_tokens` | ❌ | 100000 | \u003e0, ≤1000000 |
| `budget.max_hours` | ❌ | 24 | \u003e0, ≤168 |
| `priority` | ❌ | 50 | 0-100整数 |

**错误处理**:
- 验证失败 → 返回`clarification`请求，说明缺失字段
- 格式错误 → 尝试自动修正（如"2天" → 48小时）

**验收标准**:
- [ ] 缺少title的Goal被拒绝并返回明确错误
- [ ] 未指定budget时，自动使用默认值并通知用户
- [ ] 非法priority值（如150）被规范化为100

**优先级**: P0

---

#### FR-1.1.3: Success Criteria解析

**描述**: 系统必须将用户的成功标准转换为可验证的Quality Gate。

**解析规则**:
```
用户输入: "测试覆盖率>80%，代码通过lint检查"
↓
解析为:
[
  {
    "description": "测试覆盖率>80%",
    "type": "deterministic",
    "verification_method": "npm test -- --coverage",
    "pass_condition": "coverage > 80"
  },
  {
    "description": "代码通过lint检查",
    "type": "deterministic",
    "verification_method": "npm run lint",
    "pass_condition": "exit_code == 0"
  }
]
```

**验收标准**:
- [ ] 常见success criteria模式自动识别（测试、lint、build）
- [ ] 无法解析的criteria记录为`type: manual`
- [ ] 解析后的criteria用户可见并可修改

**优先级**: P1

---

### 1.2 质量属性

#### NFR-1.2.1: 响应时间

| 操作 | 目标延迟 | P95 | P99 |
|:-----|:--------|:----|:----|
| WebSocket连接建立 | \u003c 500ms | \u003c 800ms | \u003c 1s |
| Goal创建确认 | \u003c 1s | \u003c 1.5s | \u003c 2s |
| Clarification请求 | \u003c 2s | \u003c 3s | \u003c 5s |

**验证方法**: 
- 负载测试（k6脚本）模拟10并发用户
- Prometheus指标监控

---

#### NFR-1.2.2: 输入容错

**要求**: 系统必须优雅处理非标准输入

**容错示例**:
- 拼写错误: "添加用戶登录" → 自动纠正为"用户"
- 格式混乱: "budget: 2k tokens" → 解析为2000
- 多语言混合: "实现login功能" → 正确理解

**验收标准**:
- [ ] 90%的自然语言Goal描述无需clarification
- [ ] 格式错误自动修正率 \u003e 80%

---

## 能力域2: 规划与分解

### 2.1 功能需求

#### FR-2.1.1: 自动分解算法

**描述**: Agent必须将Goal分解为可执行的Work Items，形成DAG依赖图。

**分解规则**:
1. **原子性**: 每个Work Item是单一职责任务
2. **可验证性**: 每个Work Item有明确的Done定义
3. **并行性**: 无依赖的Work Items可并行执行
4. **估算**: 每个Work Item标注估算effort（S/M/L）

**示例**:
```
Goal: "实现用户登录功能"
↓ 分解为:
[
  {
    id: "wi-1",
    title: "创建User表migration",
    dependencies: [],
    estimated_effort: "S"
  },
  {
    id: "wi-2",
    title: "实现JWT服务模块",
    dependencies: ["wi-1"],
    estimated_effort: "M"
  },
  {
    id: "wi-3",
    title: "编写登录API endpoint",
    dependencies: ["wi-2"],
    estimated_effort: "M"
  },
  {
    id: "wi-4",
    title: "添加单元测试",
    dependencies: ["wi-3"],
    estimated_effort: "L"
  }
]
```

**验收标准**:
- [ ] 分解后的Work Items数量合理（1-10个/Goal）
- [ ] DAG无循环依赖
- [ ] 关键路径识别正确（用于优先级排序）

**优先级**: P0

---

#### FR-2.1.2: 依赖解析

**描述**: 系统必须自动解析Work Item间的依赖关系。

**依赖类型**:
- **必需依赖**: wi-2必须在wi-1完成后才能开始
- **可选依赖**: wi-4可独立于wi-3，但建议顺序执行
- **反依赖**: 集成测试（wi-5）依赖所有功能Work Items

**SQL查询（验证无循环）**:
```sql
WITH RECURSIVE dep_chain AS (
  SELECT item_id, depends_on, 1 AS depth
  FROM work_item_dependencies
  UNION ALL
  SELECT d.item_id, wid.depends_on, dc.depth + 1
  FROM dep_chain dc
  JOIN work_item_dependencies wid ON wid.item_id = dc.depends_on
  WHERE dc.depth < 10
)
SELECT * FROM dep_chain WHERE item_id = depends_on;
-- 如果返回行 → 检测到循环依赖
```

**验收标准**:
- [ ] 循环依赖被拒绝并返回错误
- [ ] Work Item选择算法正确识别"ready"状态（所有依赖已完成）

**优先级**: P0

---

### 2.2 质量属性

#### NFR-2.2.1: 分解准确性

**指标**: 分解质量通过以下维度评估

| 维度 | 目标 |
|:-----|:-----|
| 返工率 | \u003c 20%（需要重新分解的Goal比例） |
| Work Item粒度合理性 | 平均effort估算误差 \u003c 50% |
| 依赖准确性 | \u003c 5% Work Items因依赖错误被阻塞 |

---

#### NFR-2.2.2: 规划性能

**要求**: 复杂Goal（10+ Work Items）的规划时间 \u003c 30秒

**优化策略**:
- 并行分析独立模块
- 缓存类似Goal的分解模板

---

## 能力域3: 执行与工具使用

### 3.1 功能需求

#### FR-3.1.1: 多模型支持与Failover

**描述**: 系统必须支持多LLM Provider，主模型失败时自动降级。

**Failover链**:
```
Primary: anthropic/claude-3-5-sonnet-20241022
    ↓ (429/5xx错误)
Fallback 1: openai/gpt-4o
    ↓ (失败)
Fallback 2: openai/gpt-3.5-turbo (Context Compaction后)
    ↓ (失败)
Escalation: 通知用户
```

**验收标准**:
- [ ] 主模型429错误后 \u003c 5秒切换到备用模型
- [ ] Fallback链最多尝试3次
- [ ] 模型切换事件记录到audit log

**优先级**: P0

---

#### FR-3.1.2: 工具沙箱隔离

**描述**: 所有工具调用必须在Docker沙箱内执行。

**Docker安全配置**:
```typescript
{
  readOnlyRoot: true,               // 只读根文件系统
  capDrop: ['ALL'],                 // 禁用所有Linux Capabilities
  securityOpt: [
    'no-new-privileges',
    'seccomp=default',
    'apparmor=docker-default'
  ],
  resources: {
    memory: '256m',
    cpus: '0.5',
    pidsLimit: 100
  },
  networkMode: 'none'               // 禁止联网（可选）
}
```

**验收标准**:
- [ ] 容器内无法写入`/etc/passwd`
- [ ] 无法执行`sudo`或`setuid`
- [ ] 进程数超过100后新进程创建失败
- [ ] 内存超限时容器被OOM kill，不影响宿主

**优先级**: P0

---

#### FR-3.1.3: 幂等性保证

**描述**: 相同`idempotencyKey`的工具调用只执行一次。

**实现**:
```typescript
async function invokeTool(params: {
  tool: string;
  args: any;
  idempotencyKey: string;
}) {
  const cached = await db.query(
    'SELECT result FROM tool_invocations WHERE idempotency_key = ?',
    [params.idempotencyKey]
  );
  
  if (cached) {
    return cached.result;  // 返回缓存结果
  }
  
  const result = await actuallyInvoke(params);
  await db.insert('tool_invocations', {
    idempotency_key: params.idempotencyKey,
    result
  });
  return result;
}
```

**验收标准**:
- [ ] 同一`idempotencyKey`的请求返回相同结果
- [ ] 重复请求不产生副作用（如不重复创建文件）

**优先级**: P0

---

### 3.2 质量属性

#### NFR-3.2.1: 工具调用性能

| 工具类型 | 目标延迟 | P99 |
|:--------|:--------|:----|
| 文件读取 | \u003c 200ms | \u003c 500ms |
| Shell命令 | \u003c 1s | \u003c 3s |
| Node RPC（拍照） | \u003c 3s | \u003c 10s |

---

#### NFR-3.2.2: 沙箱资源限制

**要求**: 单个沙箱容器资源消耗

| 资源 | 限制 | 超限行为 |
|:-----|:-----|:--------|
| 内存 | 256MB | OOM Kill |
| CPU | 0.5核（50%） | 限流 |
| 磁盘I/O | 10MB/s | 限流 |
| 进程数 | 100 | 创建失败 |
| 运行时间 | 30s（默认） | SIGTERM → SIGKILL |

---

## 能力域4: 长期运行持久性

### 4.1 功能需求

#### FR-4.1.1: Context Pack生成

**描述**: Agent必须在长期目标执行中定期生成Context Pack（状态快照）。

**生成触发条件**:
- 每完成1个Work Item
- 每8小时（长期Goal）
- 用户手动触发

**Context Pack内容**:
```json
{
  "goal_id": "goal-123",
  "timestamp": "2026-01-31T12:00:00Z",
  "checkpoint_number": 3,
  "completed_work_items": ["wi-1", "wi-2", "wi-3"],
  "in_progress_work_item": "wi-4",
  "decisions_summary": [
    {
      "decision_id": "dec-001",
      "summary": "选择jose库而非jsonwebtoken（更好的TS支持）"
    }
  ],
  "next_steps": ["完成wi-4单元测试", "开始wi-5集成测试"],
  "budget_remaining": {
    "tokens": 35000,
    "hours": 18
  }
}
```

**验收标准**:
- [ ] Context Pack大小 \u003c 100KB
- [ ] 从Context Pack恢复后，Agent能继续执行
- [ ] 恢复后不重复已完成的Work Items

**优先级**: P0

---

#### FR-4.1.2: Session Compaction

**描述**: 当Session历史超过上下文窗口80%时，自动压缩。

**压缩算法**:
1. 识别关键信息（Decisions、Escalations、TODO）
2. 分段总结非关键内容
3. 保留最近N轮完整对话（N可配置，默认10）

**压缩效果**:
- 原始Token: 50000
- 压缩后Token: 7500-20000 (15%-40%)
- 关键信息保留率: \u003e 95%

**验收标准**:
- [ ] 压缩后Token减少至15%-40%
- [ ] 所有Decisions和Escalations保留
- [ ] 压缩过程用户感知延迟 \u003c 10秒

**优先级**: P0

---

### 4.2 质量属性

#### NFR-4.2.1: 数据持久化可靠性

**要求**: Session数据写入后不可丢失

**保证措施**:
- SQLite WAL模式 + `synchronous=NORMAL`
- 每条消息写入后立即fsync（可配置）
- 自动备份：每日增量备份

**灾难恢复**:
- RTO（恢复时间目标）: \u003c 1小时
- RPO（恢复点目标）: \u003c 15分钟

---

#### NFR-4.2.2: 多天执行稳定性

**指标**: 
- 连续运行时间: ≥7天不重启
- 多天Goal成功率: \u003e 60%

**测试场景**: 
创建预计5天的Goal，验证：
- [ ] Context Pack每天正确生成
- [ ] 第5天Agent仍能访问第1天的Decisions
- [ ] Budget消耗符合预期（无泄漏）

---

## 能力域5: 可观测性与证据

### 5.1 功能需求

#### FR-5.1.1: 实时状态流

**描述**: 用户/管理员必须能实时查看Agent执行过程。

**WebSocket事件类型**:
```typescript
type AgentEvent =
  | { type: 'agent.thinking'; content: string }
  | { type: 'agent.tool_call'; tool: string; args: any }
  | { type: 'agent.tool_result'; result: any; duration: number }
  | { type: 'agent.delta'; text: string }
  | { type: 'agent.completed'; goalId: string };
```

**验收标准**:
- [ ] 用户在UI中看到Agent思考过程（Thinking Mode开启时）
- [ ] 所有工具调用显示输入参数和返回结果
- [ ] 流式输出每个token延迟 \u003c 100ms
- [ ] 客户端能检测sequence gap（消息丢失）

**优先级**: P1

---

#### FR-5.1.2: 审计日志

**描述**: 所有关键操作必须记录到不可篡改日志。

**日志格式（JSON Lines）**:
```json
{"timestamp":"2026-01-31T12:00:00Z","level":"INFO","userId":"user-123","action":"tool.invoke","resource":"bash","args":{"cmd":"ls"},"result":"success","duration":120}
{"timestamp":"2026-01-31T12:01:00Z","level":"WARN","userId":"user-123","action":"auth.failed","reason":"invalid_token","ip":"192.168.1.100"}
```

**记录范围**:
- 所有工具调用（输入、输出、耗时）
- 认证/授权事件
- 模型切换
- Budget变化
- Escalation创建

**验收标准**:
- [ ] 日志支持外部工具解析（Splunk、ELK）
- [ ] 日志保留期可配置（默认90天）
- [ ] 日志文件自动轮转（每日或100MB）

**优先级**: P1

---

### 5.2 质量属性

#### NFR-5.2.1: 日志性能开销

**要求**: 日志记录不影响主流程性能

| 指标 | 目标 |
|:-----|:-----|
| 日志写入延迟 | \u003c 5ms (P99) |
| 磁盘I/O开销 | \u003c 10 IOPS |
| CPU开销 | \u003c 2% |

**优化策略**:
- 异步写入（buffered I/O）
- 批量flush（每100条或每秒）

---

## 能力域6: 自我评估与质量门

### 6.1 功能需求

#### FR-6.1.1: 确定性质量门

**描述**: Work Item完成前必须通过所有确定性验证。

**验证类型**:
| 类型 | 示例 | 验证方法 |
|:-----|:-----|:--------|
| 测试 | `npm test` | `exit_code == 0` |
| 构建 | `npm run build` | `exit_code == 0` |
| Lint | `npm run lint` | `exit_code == 0` |
| 覆盖率 | `nyc report` | `coverage \u003e 80` |

**执行流程**:
```
Work Item标记为"done candidate"
    ↓
运行所有Deterministic Gates
    ↓
All Pass? → 标记为"done"
    ↓
Any Fail? → 状态回退为"in_progress"，记录失败原因
```

**验收标准**:
- [ ] 所有确定性gate必须pass（无例外）
- [ ] 失败的gate错误信息清晰可读
- [ ] LLM Review无法override失败的deterministic gate

**优先级**: P0

---

#### FR-6.1.2: LLM Review (Second-level Validation)

**描述**: 在deterministic gates通过后，可选运行LLM代码审查。

**审查维度**:
- Code smell（坏味道检测）
- Security（安全漏洞）
- Performance（性能问题）
- Best practices（最佳实践）

**结果处理**:
- **Critical issue**: 阻塞Work Item，创建Escalation
- **Warning**: 记录到Decisions，允许继续
- **Info**: 记录到日志

**验收标准**:
- [ ] LLM Review发现的critical issue阻塞完成
- [ ] Warning不阻塞但在hand-off时提醒用户

**优先级**: P1

---

### 6.2 质量属性

#### NFR-6.2.1: Quality Gate准确性

**指标**:
- False Positive Rate: \u003c 5%（错误拒绝好代码）
- False Negative Rate: \u003c 10%（错误通过坏代码）

**测试方法**: 人工审查100个Work Items的QG结果

---

#### NFR-6.2.2: Quality Gate性能

**要求**: 
- 单个Work Item的QG执行时间 \u003c 5分钟
- 并行执行多个gate

---

## 能力域7: 升级与人类协作

### 7.1 功能需求

#### FR-7.1.1: 自动升级触发

**描述**: 系统必须在预定义条件下自动创建Escalation。

**触发条件**:
| 场景 | 条件 | 紧急程度 |
|:-----|:-----|:--------|
| 重复失败 | 连续3次相同error signature | High |
| Budget耗尽 | Remaining \u003c 5% | Medium |
| 缺失信息 | 需要API Key/凭证 | Medium |
| 风险边界 | 即将删除生产数据 | Critical |
| 目标模糊 | 无法分解Goal | Medium |

**Escalation Packet内容**:
参见 [12-human-interaction-contracts.md#escalation](./12-human-interaction-contracts.md#接触点4-escalation升级)

**验收标准**:
- [ ] 所有触发条件100%创建Escalation
- [ ] Escalation包含完整上下文（attempts、error、options）
- [ ] 紧急程度自动分级（low/medium/high/critical）

**优先级**: P0

---

#### FR-7.1.2: 人类响应集成

**描述**: Agent必须能处理人类的Escalation响应并恢复执行。

**响应类型**:
- **提供信息**: 用户补充缺失的API Key
- **选择方案**: 用户选择Option A/B/C
- **批准操作**: 用户批准风险操作
- **拒绝**: 用户拒绝并终止Goal

**恢复流程**:
```
Agent → 创建Escalation
    ↓
等待人类响应（timeout: 24小时）
    ↓
收到响应 → 解析并更新Work Item状态
    ↓
恢复执行（从Escalation点继续）
```

**验收标准**:
- [ ] 响应后Agent在30秒内恢复执行
- [ ] 响应无效时返回validation error

**优先级**: P0

---

### 7.2 质量属性

#### NFR-7.2.1: Escalation质量

**指标**:
- Escalation必要性: \u003e 90%（无trivial escalations）
- 最小化问题描述: 用户能在2分钟内理解问题

**测试**: 人工review 100个Escalations

---

#### NFR-7.2.2: 响应时间SLA

参见 [12-human-interaction-contracts.md#响应时间SLA](./12-human-interaction-contracts.md#响应时间sla)

---

## 能力域8: 输出打包与交付

### 8.1 功能需求

#### FR-8.1.1: Artifact生成

**描述**: Goal完成时，自动生成所有Artifacts。

**Artifact类型**:
| 类型 | 示例 | 格式 |
|:-----|:-----|:-----|
| Code | 源代码文件 | Git diff |
| Test | 测试文件 | `.test.ts` |
| Documentation | API文档 | Markdown |
| Report | 测试覆盖率报告 | HTML/JSON |
| Configuration | 配置变更 | JSON/YAML |

**存储**:
```typescript
interface Artifact {
  id: string;
  goalId: string;
  workItemId: string;
  type: 'code' | 'test' | 'doc' | 'report' | 'config';
  path: string;               // 文件路径
  content: string;            // 文件内容或URL
  metadata: {
    size: number;
    hash: string;             // SHA256
    createdAt: string;
  };
}
```

**验收标准**:
- [ ] 所有Work Item产生的文件记录为Artifacts
- [ ] Artifacts可通过API下载
- [ ] Artifacts包含完整metadata（size, hash, timestamp）

**优先级**: P0

---

#### FR-8.1.2: PR/MR自动创建

**描述**: 代码类Goal完成后，自动创建Pull Request。

**PR内容**:
- Title: Goal title
- Description: Goal summary + Work Items完成列表
- Changes: Git diff of all artifacts
- Checks: Quality Gates结果

**验收标准**:
- [ ] GitHub/GitLab集成配置后，自动创建PR
- [ ] PR description包含Goal ID可追溯
- [ ] CI checks自动触发

**优先级**: P1

---

### 8.2 质量属性

#### NFR-8.2.1: Artifact完整性

**要求**: 所有Artifacts必须可验证（hash校验）

**防护措施**:
- 写入时计算SHA256
- 读取时验证hash
- Mismatch → 标记为corrupted

---

#### NFR-8.2.2: 交付质量

**指标**:
- First-time PR pass rate: \u003e 80%（无需修改即可merge）
- Artifact完整性: 100%（所有生成文件可追溯）

---

## 跨能力域质量属性

### 性能总览

| 维度 | 目标 |
|:-----|:-----|
| 并发Session | 10+（单机） |
| 消息吞吐 | 20+ msg/s |
| 内存占用 | \u003c 2GB（峰值） |
| 磁盘增长 | \u003c 100MB/天（个人使用） |

---

### 可靠性总览

| 维度 | 目标 |
|:-----|:-----|
| 可用性 | 99%（月停机 \u003c 7.2小时） |
| 数据持久性 | 100%（无丢失） |
| Failover时间 | \u003c 5秒（LLM Provider） |

---

### 安全性总览

| 维度 | 措施 |
|:-----|:-----|
| 认证 | Token/Ed25519签名 |
| 沙箱隔离 | Docker + Seccomp + AppArmor |
| 数据加密 | API Key: AES-256-GCM |
| 审计 | 所有操作记录到audit log |

---

## 文档导航

**前置阅读**:
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 执行模型
- [11-work-order-system.md](./11-work-order-system.md) — Work Order系统
- [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) — 人类交互

**相关Tier 3文档**:
- [21-scenarios-and-user-stories.md](./21-scenarios-and-user-stories.md) — 用户场景
- [22-quality-risk-and-compliance.md](./22-quality-risk-and-compliance.md) — 质量与风险

**实现参考**:
- `/docs/engineering/architecture.md` — 技术架构
- `/src/work-order/` — Work Order实现

---

**版本历史**:
- v2.0 (2026-01-31): 从functional-requirements.md + non-functional-requirements.md重组，按能力域组织
- v1.0 (2026-01-15): 初始版本（FR/NFR分离）
