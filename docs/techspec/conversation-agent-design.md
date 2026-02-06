# Conversation Agent Design

## 概述

Conversation Agent 是 PonyBunny 系统中负责**人机交互**的独立 Agent。它作为人类世界与机器世界的桥梁，让用户可以用自然语言（文字、语音、图片等）与系统沟通，而无需了解内部的 Goal、WorkItem 等概念。

## 架构定位

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External World                               │
│  Web UI  │  Mobile App  │  Voice Assistant  │  CLI                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ 对人类暴露的简单接口
                              │ conversation.message (文字/图片)
                              │ conversation.voice (语音) [未来]
                              │ conversation.history
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                          Gateway (统一调度层)                        │
│  ═══════════════════════════════════════════════════════════════════│
│                                                                      │
│  ┌────────────────────┐    ┌────────────────────┐                   │
│  │  Conversation      │    │     Scheduler      │                   │
│  │     Agent          │    │                    │                   │
│  │                    │    │                    │                   │
│  │ - 理解人类意图     │───▶│ - 8-Phase          │                   │
│  │ - 人格化回复       │    │   Lifecycle        │                   │
│  │ - 对话状态管理     │◀───│ - 任务编排         │                   │
│  │ - 进度叙述         │    │ - 执行监控         │                   │
│  └────────────────────┘    └────────────────────┘                   │
│           │                         │                                │
│           │                         │                                │
│           ▼                         ▼                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Internal Methods                           │   │
│  │  goal.submit, goal.status, workitem.list, escalation.*       │   │
│  │  (Agents 之间互相调用，不直接暴露给外部 UI)                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 核心原则

1. **外部 UI 只需要简单的沟通接口** - 像和人说话一样
2. **Conversation Agent 是独立的 Agent** - 与 Scheduler 同级
3. **内部方法由 Agents 互相调用** - goal.*, workitem.* 等不直接暴露给用户
4. **Gateway 统一调度所有 Agents** - 包括 Conversation Agent 和 Scheduler

## 对外暴露的方法 (给 UI 使用)

| Method | 描述 | 参数 |
|:-------|:-----|:-----|
| `conversation.message` | 发送消息 | `{ sessionId?, personaId?, message, attachments? }` |
| `conversation.history` | 获取历史 | `{ sessionId, limit? }` |
| `conversation.end` | 结束会话 | `{ sessionId }` |
| `persona.list` | 列出人格 | - |
| `persona.get` | 获取人格详情 | `{ id }` |

## 内部组件

### 1. Persona Engine (人格引擎)

管理 AI 的人格特性，生成人格化的 System Prompt。

```typescript
interface IPersona {
  id: string;
  name: string;                    // "Pony"
  nickname?: string;               // "小马"

  personality: {
    warmth: number;                // 0-1 冷淡→温暖
    formality: number;             // 0-1 随意→正式
    humor: number;                 // 0-1 严肃→幽默
    empathy: number;               // 0-1 理性→共情
  };

  communicationStyle: {
    verbosity: 'concise' | 'balanced' | 'detailed';
    technicalDepth: 'simplified' | 'adaptive' | 'expert';
  };

  expertise: {
    primaryDomains: string[];      // ["software-engineering", "devops"]
  };

  locale: string;                  // "zh-CN"
}
```

### 2. Input Analyzer (输入分析器)

使用 LLM 分析用户输入，提取意图、情绪和目的。

```typescript
interface IInputAnalysis {
  intent: {
    primary: IntentCategory;       // greeting | task_request | question | ...
    confidence: number;
  };

  emotion: {
    primary: EmotionalState;       // neutral | frustrated | excited | ...
    urgency: 'low' | 'medium' | 'high' | 'critical';
  };

  purpose: {
    isActionable: boolean;         // 是否需要执行任务
    extractedGoal?: string;        // 提取的目标
    missingInfo: string[];         // 需要澄清的信息
  };
}
```

### 3. Conversation State Machine (对话状态机)

```
States:
  idle → chatting → clarifying → executing → monitoring → reporting
                         ↑                                    │
                         └────────────────────────────────────┘
                                      (retry)
```

| 状态 | 触发条件 | 行为 |
|:-----|:---------|:-----|
| `idle` | 无活动 | 等待用户输入 |
| `chatting` | greeting/small_talk | 闲聊回复 |
| `clarifying` | task_request + missingInfo | 追问细节 |
| `executing` | 确认后 | 调用 Scheduler 创建 Goal |
| `monitoring` | 长时间任务 | 监控进度，生成叙述 |
| `reporting` | 任务完成 | 结果总结 |

### 4. Task Bridge (任务桥接)

连接 Conversation Agent 与 Scheduler：

```typescript
interface ITaskBridge {
  // 自然语言 → Goal (调用 goal.submit)
  createGoalFromConversation(
    requirements: IExtractedRequirements,
    session: IConversationSession
  ): Promise<{ goalId: string }>;

  // 订阅进度 (监听 goal.* 和 workitem.* 事件)
  subscribeToProgress(goalId: string, callback: (progress) => void): Unsubscribe;
}
```

### 5. Response Generator (响应生成器)

根据 Persona 和上下文生成自然语言回复：

- **闲聊回复** - 匹配人格风格
- **进度叙述** - 将任务进度转换为自然语言
- **结果总结** - 将执行结果转换为用户友好的描述
- **情绪适配** - 根据用户情绪调整语气

### 6. Retry Handler (重试处理器)

当任务失败时，分析原因并选择重试策略：

```
重试策略序列:
1. same_approach      - 简单重试（瞬时错误）
2. parameter_adjust   - 调整参数
3. alternative_tool   - 换工具/方法
4. model_upgrade      - 升级模型
5. decompose_further  - 进一步分解
6. human_guidance     - 请求用户协助
```

## 对话流程示例

```
用户: "帮我写一个登录功能"

Conversation Agent:
  1. Input Analyzer: intent=task_request, isActionable=true, missingInfo=["认证方式", "用户存储"]
  2. State: idle → clarifying
  3. Response: "好的！在开始之前，我想确认几个问题：1) 使用什么认证方式？2) 用户数据存在哪里？"

用户: "用 JWT，数据存 PostgreSQL"

Conversation Agent:
  1. Input Analyzer: intent=clarification, missingInfo=[]
  2. State: clarifying → executing
  3. Task Bridge: 调用 goal.submit 创建 Goal
  4. Response: "明白了，我来实现 JWT 认证 + PostgreSQL 用户存储的登录功能。"

[Scheduler 执行中...]

Conversation Agent (收到 workitem.progress 事件):
  State: executing → monitoring
  Response: "正在编写用户模型... 已完成 2/5 个步骤。"

[Scheduler 完成]

Conversation Agent (收到 goal.completed 事件):
  State: monitoring → reporting
  Response: "登录功能已完成！我创建了以下文件：
    - src/auth/user.model.ts
    - src/auth/login.controller.ts
    - src/auth/jwt.middleware.ts
    还需要我帮你写测试吗？"
```

## 文件结构

```
src/
├── domain/conversation/
│   ├── persona.ts              # Persona 类型定义
│   ├── session.ts              # 会话类型定义
│   ├── analysis.ts             # 分析结果类型
│   ├── retry.ts                # 重试策略类型
│   └── state-machine-rules.ts  # 状态转换规则
│
├── app/conversation/
│   ├── persona-engine.ts
│   ├── input-analysis-service.ts
│   ├── conversation-state-machine.ts
│   ├── response-generator.ts
│   ├── task-bridge.ts
│   ├── retry-handler.ts
│   └── session-manager.ts
│
├── infra/conversation/
│   ├── persona-repository.ts   # Persona 存储
│   ├── session-repository.ts   # 会话持久化
│   └── prompts/                # LLM Prompt 模板
│
└── gateway/rpc/handlers/
    ├── conversation-handlers.ts  # conversation.* 方法
    └── persona-handlers.ts       # persona.* 方法
```

## 与现有系统的关系

| 组件 | 职责 | 关系 |
|:-----|:-----|:-----|
| **Gateway** | 统一调度层 | 调度 Conversation Agent 和 Scheduler |
| **Conversation Agent** | 人机交互 | 理解人类意图，调用 Scheduler 执行任务 |
| **Scheduler** | 任务执行 | 8-Phase Lifecycle，执行具体工作 |
| **LLM Service** | 模型调用 | 被 Conversation Agent 和 Scheduler 共同使用 |

## 未来扩展

1. **语音支持** - `conversation.voice` 方法
2. **图片理解** - 多模态输入分析
3. **多人格切换** - 不同场景使用不同人格
4. **对话记忆** - 长期记忆和上下文压缩
5. **主动通知** - Agent 主动向用户汇报进度
