# PonyBunny 差距修复实现计划

> 生成日期: 2026-02-07
> 基于: `implementation-gap-analysis.md`

本文档详细描述了每个差距项的具体实现计划，包括需要修改的文件、新增的类型定义、实现步骤和验收标准。

---

## Phase 1: 核心安全与合规

### 1.1 审计日志系统

**优先级**: P0 - 关键
**预估复杂度**: 中等
**影响范围**: 全局

#### 1.1.1 需求分析

设计文档要求所有命令需要审计日志，用于：
- 追踪所有状态变更
- 记录工具调用和执行结果
- 记录认证和授权事件
- 支持事后审计和问题排查

#### 1.1.2 类型定义

**新建文件**: `src/domain/audit/types.ts`

```typescript
export type AuditAction =
  | 'goal.created'
  | 'goal.status_changed'
  | 'goal.cancelled'
  | 'work_item.created'
  | 'work_item.status_changed'
  | 'run.started'
  | 'run.completed'
  | 'tool.invoked'
  | 'tool.blocked'
  | 'escalation.created'
  | 'escalation.resolved'
  | 'session.created'
  | 'session.ended'
  | 'auth.challenge_issued'
  | 'auth.authenticated'
  | 'auth.failed'
  | 'permission.requested'
  | 'permission.granted'
  | 'permission.denied';

export type AuditEntityType =
  | 'goal'
  | 'work_item'
  | 'run'
  | 'artifact'
  | 'escalation'
  | 'session'
  | 'tool'
  | 'auth';

export interface IAuditLog {
  id: string;
  timestamp: number;
  actor: string; // publicKey, 'system', or 'daemon'
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;
  goal_id?: string; // 关联的 goal，便于按 goal 查询
  old_value?: unknown;
  new_value?: unknown;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  session_id?: string;
}

export interface IAuditLogRepository {
  log(entry: Omit<IAuditLog, 'id' | 'timestamp'>): IAuditLog;
  getByEntityId(entityId: string, limit?: number): IAuditLog[];
  getByGoalId(goalId: string, limit?: number): IAuditLog[];
  getByActor(actor: string, limit?: number): IAuditLog[];
  getByAction(action: AuditAction, limit?: number): IAuditLog[];
  getByTimeRange(from: number, to: number, limit?: number): IAuditLog[];
  prune(olderThanMs: number): number; // 清理旧日志，返回删除数量
}
```

#### 1.1.3 数据库 Schema

**修改文件**: `src/infra/persistence/schema.sql`

```sql
-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  goal_id TEXT,
  old_value TEXT, -- JSON
  new_value TEXT, -- JSON
  metadata TEXT,  -- JSON
  ip_address TEXT,
  session_id TEXT
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_goal ON audit_logs(goal_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
```

#### 1.1.4 实现步骤

1. **创建领域类型** (`src/domain/audit/types.ts`)
   - 定义 `IAuditLog` 接口
   - 定义 `IAuditLogRepository` 接口
   - 导出审计动作枚举

2. **实现 SQLite Repository** (`src/infra/persistence/audit-repository.ts`)
   - 实现 `IAuditLogRepository` 接口
   - 使用 better-sqlite3 同步写入
   - 实现日志清理功能

3. **创建审计服务** (`src/infra/audit/audit-service.ts`)
   - 包装 repository，提供便捷的日志方法
   - 支持批量写入优化
   - 支持异步写入（不阻塞主流程）

4. **集成到现有组件**:

   | 组件 | 文件 | 审计点 |
   |-----|------|-------|
   | WorkOrderRepository | `src/infra/persistence/work-order-repository.ts` | 所有 create/update 操作 |
   | RpcHandler | `src/gateway/rpc/rpc-handler.ts` | 所有 RPC 调用 |
   | AuthManager | `src/gateway/auth/auth-manager.ts` | 认证事件 |
   | ToolEnforcer | `src/infra/tools/tool-enforcer.ts` | 工具调用和拦截 |
   | EscalationHandler | `src/scheduler/escalation-handler/` | 升级事件 |

5. **添加 RPC 查询接口** (`src/gateway/rpc/handlers/audit-handlers.ts`)
   - `audit.list` - 查询审计日志
   - `audit.getByGoal` - 按 goal 查询
   - `audit.getByEntity` - 按实体查询

#### 1.1.5 验收标准

- [ ] 所有状态变更都有审计记录
- [ ] 所有工具调用都有审计记录
- [ ] 所有认证事件都有审计记录
- [ ] 可以通过 RPC 查询审计日志
- [ ] 日志清理功能正常工作
- [ ] 审计写入不影响主流程性能

---

### 1.2 三层责任模型完善

**优先级**: P0 - 关键
**预估复杂度**: 中等
**影响范围**: 工具系统、执行引擎

#### 1.2.1 需求分析

设计文档定义了三层责任模型：
- **Layer 1 (Autonomous)**: 可自主执行，无需审批
- **Layer 2 (Approval Required)**: 需要用户审批才能执行
- **Layer 3 (Forbidden)**: 完全禁止，即使审批也不执行

当前实现仅有 `requiresApproval` 布尔值，需要扩展为完整的三层模型。

#### 1.2.2 类型定义

**修改文件**: `src/infra/tools/tool-registry.ts`

```typescript
export type ResponsibilityLayer = 'autonomous' | 'approval_required' | 'forbidden';

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  riskLevel: 'safe' | 'moderate' | 'dangerous';
  layer: ResponsibilityLayer; // 替代原有的 requiresApproval
  description: string;

  // 新增：详细的权限要求
  permissions?: {
    os_services?: ('keychain' | 'browser' | 'docker' | 'network' | 'filesystem')[];
    requires_sudo?: boolean;
    network_access?: boolean;
    sensitive_data?: boolean;
  };

  // 新增：参数验证 schema
  argsSchema?: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required?: boolean;
    pattern?: string; // 正则验证
    enum?: unknown[];
    description?: string;
  }>;

  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
```

**新建文件**: `src/domain/permission/types.ts`

```typescript
export interface IPermissionRequest {
  id: string;
  tool_name: string;
  layer: 'approval_required';
  reason: string;
  args_summary: string; // 不包含敏感信息的参数摘要
  goal_id: string;
  work_item_id: string;
  requested_at: number;
  expires_at: number; // 请求过期时间
  status: 'pending' | 'approved' | 'denied' | 'expired';
  resolved_by?: string;
  resolved_at?: number;
}

export interface IPermissionCache {
  tool_name: string;
  goal_id: string;
  granted_at: number;
  expires_at: number;
  granted_by: string;
}
```

#### 1.2.3 实现步骤

1. **更新工具定义** (`src/infra/tools/tool-registry.ts`)
   - 将 `requiresApproval` 迁移为 `layer` 字段
   - 添加默认层级映射规则

2. **创建禁止操作列表** (`src/infra/tools/forbidden-operations.ts`)
   ```typescript
   export const FORBIDDEN_OPERATIONS = [
     { pattern: /rm\s+-rf\s+\//, description: 'Delete root filesystem' },
     { pattern: /DROP\s+DATABASE/i, description: 'Drop database' },
     { pattern: /format\s+[cC]:/, description: 'Format system drive' },
     // ... 更多禁止模式
   ];
   ```

3. **增强 ToolEnforcer** (`src/infra/tools/tool-enforcer.ts`)
   ```typescript
   interface EnforcementResult {
     allowed: boolean;
     layer: ResponsibilityLayer;
     reason?: string;
     requires_approval?: boolean;
     permission_request_id?: string;
   }

   class ToolEnforcer {
     checkExecution(
       toolName: string,
       args: Record<string, unknown>,
       context: ExecutionContext
     ): EnforcementResult;

     checkArgumentPatterns(args: Record<string, unknown>): ForbiddenMatch | null;
   }
   ```

4. **实现权限请求流程** (`src/scheduler/permission-handler/`)
   - 创建 `PermissionHandler` 类
   - 集成到执行引擎，遇到 Layer 2 操作时暂停执行
   - 创建 RPC handlers 处理审批

5. **实现权限缓存** (`src/infra/permission/permission-cache.ts`)
   - 同一 goal 下相同工具的审批可复用
   - 缓存有过期时间

6. **更新执行引擎** (`src/autonomy/react-integration.ts`)
   - 工具调用前检查层级
   - Layer 2 触发暂停等待审批
   - Layer 3 直接拒绝并记录

#### 1.2.4 工具层级分类

| Layer | 工具示例 | 说明 |
|-------|---------|------|
| autonomous | read_file, search_code, web_search | 只读操作，无副作用 |
| approval_required | write_file, shell (部分), git push | 有副作用但可控 |
| forbidden | rm -rf /, DROP DATABASE, 格式化磁盘 | 不可逆的破坏性操作 |

#### 1.2.5 验收标准

- [ ] 所有工具都有明确的层级分类
- [ ] Layer 3 操作被完全阻止
- [ ] Layer 2 操作触发审批流程
- [ ] 审批结果正确传递到执行引擎
- [ ] 权限缓存正常工作
- [ ] 审批超时自动过期

---

### 1.3 Session 持久化

**优先级**: P0 - 关键
**预估复杂度**: 低
**影响范围**: 对话系统

#### 1.3.1 需求分析

当前会话仅存储在内存中，服务重启会丢失所有会话状态。需要：
- SQLite 持久化存储
- 服务重启后恢复会话
- 会话过期自动清理

#### 1.3.2 数据库 Schema

**修改文件**: `src/infra/persistence/schema.sql`

```sql
-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  state TEXT NOT NULL,
  active_goal_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  metadata TEXT -- JSON
);

-- 会话轮次表
CREATE TABLE IF NOT EXISTS session_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  attachments TEXT, -- JSON
  metadata TEXT,    -- JSON
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_turns ON session_turns(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_expires ON sessions(expires_at);
```

#### 1.3.3 实现步骤

1. **创建 SQLite Session Repository** (`src/infra/persistence/session-repository.ts`)
   ```typescript
   export class SqliteSessionRepository implements ISessionRepository {
     constructor(private db: Database) {}

     createSession(personaId: string): IConversationSession;
     getSession(id: string): IConversationSession | null;
     updateSession(session: IConversationSession): void;
     addTurn(sessionId: string, turn: IConversationTurn): void;
     deleteSession(id: string): boolean;
     listSessions(limit?: number): IConversationSession[];

     // 新增方法
     getExpiredSessions(): IConversationSession[];
     cleanupExpiredSessions(): number;
     getSessionsByGoal(goalId: string): IConversationSession[];
   }
   ```

2. **修改 SessionManager** (`src/app/conversation/session-manager.ts`)
   - 构造函数接受 `ISessionRepository` 依赖注入
   - 添加会话恢复逻辑

3. **添加清理任务** (`src/autonomy/daemon.ts`)
   ```typescript
   // 在 daemon 循环中添加
   private async cleanupExpiredSessions(): Promise<void> {
     const cleaned = await this.sessionRepository.cleanupExpiredSessions();
     if (cleaned > 0) {
       debug.custom('sessions.cleanup', 'daemon', { count: cleaned });
     }
   }
   ```

4. **更新依赖注入** (`src/gateway/gateway-server.ts`)
   - 使用 SQLite repository 替代内存 repository

#### 1.3.4 验收标准

- [ ] 会话数据持久化到 SQLite
- [ ] 服务重启后会话可恢复
- [ ] 过期会话自动清理
- [ ] 会话轮次正确存储和读取
- [ ] 性能无明显下降

---

## Phase 2: 功能完整性

### 2.1 OS Service 权限管理

**优先级**: P1 - 重要
**预估复杂度**: 高
**影响范围**: 工具系统、执行引擎

#### 2.1.1 需求分析

设计文档要求管理以下 OS 服务的权限：
- **Keychain**: 密钥和凭证存取
- **Browser**: 浏览器自动化
- **Docker**: 容器操作
- **Network**: 网络请求（特定域名）
- **Filesystem**: 敏感目录访问

#### 2.1.2 类型定义

**新建文件**: `src/domain/permission/os-service.ts`

```typescript
export type OSService =
  | 'keychain'
  | 'browser'
  | 'docker'
  | 'network'
  | 'filesystem'
  | 'clipboard'
  | 'notifications';

export interface IOSServicePermission {
  service: OSService;
  scope: string; // 如: 'read', 'write', 'execute', 或特定资源路径
  goal_id: string;
  granted: boolean;
  granted_at?: number;
  granted_by?: string;
  expires_at?: number;
}

export interface IOSServiceChecker {
  checkPermission(service: OSService, scope: string, goalId: string): Promise<{
    granted: boolean;
    cached: boolean;
    expiresAt?: number;
  }>;

  requestPermission(params: {
    service: OSService;
    scope: string;
    goalId: string;
    reason: string;
  }): Promise<string>; // 返回 permission_request_id

  grantPermission(requestId: string, grantedBy: string): Promise<void>;
  denyPermission(requestId: string, deniedBy: string): Promise<void>;

  revokePermission(service: OSService, goalId: string): Promise<void>;
  listActivePermissions(goalId: string): Promise<IOSServicePermission[]>;
}
```

#### 2.1.3 实现步骤

1. **创建 OS Service 检查器** (`src/infra/permission/os-service-checker.ts`)
   - 实现各服务的权限检查逻辑
   - 集成权限缓存

2. **创建服务特定的检查器**:
   - `KeychainChecker`: 检查 Keychain 访问
   - `DockerChecker`: 检查 Docker daemon 可用性
   - `NetworkChecker`: 检查域名白名单
   - `FilesystemChecker`: 检查路径权限

3. **集成到工具执行** (`src/infra/tools/tool-enforcer.ts`)
   - 工具执行前检查所需的 OS 服务权限
   - 缺失权限时触发请求流程

4. **创建 RPC handlers** (`src/gateway/rpc/handlers/permission-handlers.ts`)
   - `permission.list` - 列出当前权限
   - `permission.grant` - 授予权限
   - `permission.deny` - 拒绝权限
   - `permission.revoke` - 撤销权限

5. **持久化权限** (`src/infra/persistence/schema.sql`)
   ```sql
   CREATE TABLE IF NOT EXISTS os_permissions (
     id TEXT PRIMARY KEY,
     service TEXT NOT NULL,
     scope TEXT NOT NULL,
     goal_id TEXT NOT NULL,
     granted BOOLEAN NOT NULL,
     granted_at INTEGER,
     granted_by TEXT,
     expires_at INTEGER,
     UNIQUE(service, scope, goal_id)
   );
   ```

#### 2.1.4 验收标准

- [ ] 各 OS 服务权限可独立管理
- [ ] 权限缓存正常工作
- [ ] 权限过期后自动失效
- [ ] RPC 接口可查询和管理权限
- [ ] 权限变更有审计记录

---

### 2.2 独立的 Clarify 阶段

**优先级**: P1 - 重要
**预估复杂度**: 中等
**影响范围**: 生命周期服务

#### 2.2.1 需求分析

设计文档要求独立的 Clarify（澄清）阶段，用于：
- 与用户确认不明确的需求
- 收集缺失的关键信息
- 在进入 Planning 之前确保需求清晰

当前实现将此逻辑分散在 Intake 和 Elaboration 中。

#### 2.2.2 实现步骤

1. **创建 ClarifyService** (`src/app/lifecycle/clarify/clarify-service.ts`)
   ```typescript
   export interface IClarifyService {
     needsClarification(goal: Goal): Promise<ClarificationResult>;
     generateClarificationQuestions(goal: Goal): Promise<ClarificationQuestion[]>;
     processClarificationResponse(
       goalId: string,
       responses: ClarificationResponse[]
     ): Promise<Goal>;
   }

   export interface ClarificationQuestion {
     id: string;
     question: string;
     type: 'text' | 'choice' | 'confirmation';
     options?: string[];
     required: boolean;
     context?: string;
   }

   export interface ClarificationResult {
     needsClarification: boolean;
     questions: ClarificationQuestion[];
     confidence: number; // 0-1, 需求清晰度
   }
   ```

2. **更新 Goal 状态机** (`src/domain/work-order/state-machine.ts`)
   ```typescript
   const GOAL_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
     queued: ['clarifying', 'active', 'cancelled'], // 添加 clarifying
     clarifying: ['active', 'cancelled'],            // 新状态
     active: ['blocked', 'completed', 'cancelled'],
     blocked: ['active', 'cancelled'],
     completed: [],
     cancelled: [],
   };
   ```

3. **更新 Goal 类型** (`src/domain/work-order/types.ts`)
   ```typescript
   export type GoalStatus =
     | 'queued'
     | 'clarifying'  // 新增
     | 'active'
     | 'blocked'
     | 'completed'
     | 'cancelled';

   export interface Goal {
     // ... 现有字段
     clarification_questions?: ClarificationQuestion[];
     clarification_responses?: Record<string, string>;
   }
   ```

4. **集成到生命周期** (`src/app/lifecycle/`)
   - 在 IntakeService 之后调用 ClarifyService
   - 需要澄清时暂停并等待用户响应
   - 响应后更新 Goal 并继续到 Planning

5. **创建 RPC handlers** (`src/gateway/rpc/handlers/clarify-handlers.ts`)
   - `clarify.getQuestions` - 获取澄清问题
   - `clarify.respond` - 提交澄清响应

#### 2.2.3 验收标准

- [ ] 不明确的 Goal 自动进入 clarifying 状态
- [ ] 生成合理的澄清问题
- [ ] 用户响应正确更新 Goal
- [ ] 状态转换符合状态机规则
- [ ] 与现有生命周期无缝集成

---

### 2.3 Stuck State 检测

**优先级**: P1 - 重要
**预估复杂度**: 中等
**影响范围**: 调度器、监控

#### 2.3.1 需求分析

需要检测以下"卡住"场景：
- WorkItem 长时间处于 `in_progress` 状态
- Run 长时间无输出
- 目标整体进度停滞
- 循环依赖导致的死锁

#### 2.3.2 类型定义

**新建文件**: `src/scheduler/watchdog/types.ts`

```typescript
export interface StuckDetectionConfig {
  // 各状态的超时时间（毫秒）
  timeouts: {
    work_item_in_progress: number;  // 默认 10 分钟
    work_item_verify: number;       // 默认 5 分钟
    run_running: number;            // 默认 15 分钟
    goal_no_progress: number;       // 默认 30 分钟
  };

  // 检查间隔
  checkIntervalMs: number; // 默认 60 秒

  // 自动升级配置
  autoEscalate: boolean;
  escalationSeverity: 'low' | 'medium' | 'high';
}

export interface StuckItem {
  type: 'work_item' | 'run' | 'goal';
  id: string;
  goalId: string;
  status: string;
  stuckSinceMs: number;
  timeoutMs: number;
  reason: string;
}

export interface IStuckDetector {
  checkForStuckItems(): Promise<StuckItem[]>;
  isStuck(item: WorkItem | Run | Goal): boolean;
  getStuckDuration(item: WorkItem | Run | Goal): number;
}

export interface IWatchdogService {
  start(): void;
  stop(): void;
  checkNow(): Promise<StuckItem[]>;
  onStuckDetected(callback: (items: StuckItem[]) => void): void;
}
```

#### 2.3.3 数据库变更

**修改文件**: `src/infra/persistence/schema.sql`

```sql
-- 添加状态变更时间戳字段
ALTER TABLE work_items ADD COLUMN status_changed_at INTEGER;
ALTER TABLE runs ADD COLUMN last_output_at INTEGER;
ALTER TABLE goals ADD COLUMN last_progress_at INTEGER;
```

**修改文件**: `src/infra/persistence/work-order-repository.ts`

```typescript
// 更新状态时同时更新时间戳
updateWorkItemStatus(id: string, status: WorkItemStatus): void {
  const now = Date.now();
  this.db.prepare(`
    UPDATE work_items
    SET status = ?, status_changed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, now, now, id);
}

// 新增查询方法
getItemsStuckInStatus(status: WorkItemStatus, thresholdMs: number): WorkItem[] {
  const cutoff = Date.now() - thresholdMs;
  return this.db.prepare(`
    SELECT * FROM work_items
    WHERE status = ? AND status_changed_at < ?
  `).all(status, cutoff);
}
```

#### 2.3.4 实现步骤

1. **创建 StuckDetector** (`src/scheduler/watchdog/stuck-detector.ts`)
   ```typescript
   export class StuckDetector implements IStuckDetector {
     constructor(
       private repository: IWorkOrderRepository,
       private config: StuckDetectionConfig
     ) {}

     async checkForStuckItems(): Promise<StuckItem[]> {
       const results: StuckItem[] = [];

       // 检查 in_progress 的 work items
       const stuckWorkItems = this.repository.getItemsStuckInStatus(
         'in_progress',
         this.config.timeouts.work_item_in_progress
       );

       // 检查运行中的 runs
       const stuckRuns = this.repository.getRunsWithNoRecentOutput(
         this.config.timeouts.run_running
       );

       // 检查无进度的 goals
       const stuckGoals = this.repository.getGoalsWithNoProgress(
         this.config.timeouts.goal_no_progress
       );

       return results;
     }
   }
   ```

2. **创建 WatchdogService** (`src/scheduler/watchdog/watchdog-service.ts`)
   ```typescript
   export class WatchdogService implements IWatchdogService {
     private intervalId?: NodeJS.Timeout;
     private callbacks: ((items: StuckItem[]) => void)[] = [];

     constructor(
       private detector: IStuckDetector,
       private escalationHandler: IEscalationHandler,
       private config: StuckDetectionConfig
     ) {}

     start(): void {
       this.intervalId = setInterval(
         () => this.check(),
         this.config.checkIntervalMs
       );
     }

     private async check(): Promise<void> {
       const stuckItems = await this.detector.checkForStuckItems();

       if (stuckItems.length > 0) {
         this.callbacks.forEach(cb => cb(stuckItems));

         if (this.config.autoEscalate) {
           await this.escalateStuckItems(stuckItems);
         }
       }
     }

     private async escalateStuckItems(items: StuckItem[]): Promise<void> {
       for (const item of items) {
         await this.escalationHandler.createEscalation({
           type: 'stuck',
           severity: this.config.escalationSeverity,
           goalId: item.goalId,
           workItemId: item.type === 'work_item' ? item.id : undefined,
           message: `${item.type} stuck in ${item.status} for ${item.stuckSinceMs}ms`,
           context: { item }
         });
       }
     }
   }
   ```

3. **集成到 Daemon** (`src/autonomy/daemon.ts`)
   - 创建并启动 WatchdogService
   - 监听 stuck 事件并记录日志

4. **添加监控 RPC** (`src/gateway/rpc/handlers/monitor-handlers.ts`)
   - `monitor.getStuckItems` - 获取当前卡住的项目
   - `monitor.checkNow` - 立即执行检查

#### 2.3.5 验收标准

- [ ] 能检测各类卡住状态
- [ ] 超时配置可调整
- [ ] 自动创建升级请求
- [ ] 不产生重复的升级请求
- [ ] 检查过程不影响正常执行

---

## Phase 3: 优化与增强

### 3.1 Per-Goal 工具白名单

**优先级**: P2 - 优化
**预估复杂度**: 低
**影响范围**: 工具系统

#### 3.1.1 实现步骤

1. **扩展 Goal 类型** (`src/domain/work-order/types.ts`)
   ```typescript
   export interface Goal {
     // ... 现有字段
     allowed_tools?: string[];      // 允许的工具列表
     blocked_tools?: string[];      // 禁止的工具列表
     tool_restrictions?: {
       mode: 'allowlist' | 'blocklist';
       tools: string[];
     };
   }
   ```

2. **更新 ToolEnforcer** (`src/infra/tools/tool-enforcer.ts`)
   - 检查时考虑 Goal 级别的限制
   - 支持 allowlist 和 blocklist 两种模式

3. **添加 RPC 方法**
   - `goal.updateToolRestrictions` - 更新工具限制

#### 3.1.2 验收标准

- [ ] 可为单个 Goal 设置工具限制
- [ ] 限制正确应用到执行过程
- [ ] 可通过 RPC 动态更新

---

### 3.2 升级包完整性验证

**优先级**: P2 - 优化
**预估复杂度**: 低
**影响范围**: 升级系统

#### 3.2.1 实现步骤

1. **定义必需字段** (`src/domain/work-order/invariants.ts`)
   ```typescript
   export function validateEscalationPacket(packet: EscalationPacket): ValidationResult {
     const errors: string[] = [];

     if (!packet.context || packet.context.length < 50) {
       errors.push('Context must be at least 50 characters');
     }
     if (!packet.attempts_summary || packet.attempts_summary.length === 0) {
       errors.push('At least one attempt summary required');
     }
     if (!packet.analysis) {
       errors.push('Analysis is required');
     }
     if (!packet.suggested_options || packet.suggested_options.length === 0) {
       errors.push('At least one suggested option required');
     }

     return { valid: errors.length === 0, errors };
   }
   ```

2. **集成到 EscalationHandler**
   - 创建升级前验证完整性
   - 不完整时拒绝创建

#### 3.2.2 验收标准

- [ ] 不完整的升级包被拒绝
- [ ] 错误信息清晰指出缺失字段
- [ ] 验证规则可配置

---

### 3.3 AbortSignal 完整传播

**优先级**: P2 - 优化
**预估复杂度**: 中等
**影响范围**: 执行引擎

#### 3.3.1 实现步骤

1. **更新 ExecutionService** (`src/app/lifecycle/execution/execution-service.ts`)
   ```typescript
   async executeWorkItem(
     workItem: WorkItem,
     signal?: AbortSignal  // 从调用方传入
   ): Promise<ExecutionResult> {
     // 使用传入的 signal 或创建新的
     const controller = new AbortController();
     const effectiveSignal = signal ?? controller.signal;

     // 传递给 ReAct 引擎
     return this.reactEngine.execute(workItem, { signal: effectiveSignal });
   }
   ```

2. **更新 ReActIntegration** (`src/autonomy/react-integration.ts`)
   - 每个迭代检查 signal.aborted
   - 工具执行时传递 signal

3. **更新工具实现**
   - 长时间运行的工具支持 signal

#### 3.3.2 验收标准

- [ ] 取消信号正确传播到所有层级
- [ ] 取消后资源正确清理
- [ ] 取消状态正确记录

---

### 3.4 权限缓存机制

**优先级**: P2 - 优化
**预估复杂度**: 低
**影响范围**: 权限系统

#### 3.4.1 实现步骤

1. **创建 PermissionCache** (`src/infra/permission/permission-cache.ts`)
   ```typescript
   export class PermissionCache {
     private cache: Map<string, CachedPermission> = new Map();

     private getCacheKey(toolName: string, goalId: string): string {
       return `${goalId}:${toolName}`;
     }

     get(toolName: string, goalId: string): CachedPermission | null {
       const key = this.getCacheKey(toolName, goalId);
       const cached = this.cache.get(key);

       if (!cached) return null;
       if (cached.expiresAt < Date.now()) {
         this.cache.delete(key);
         return null;
       }

       return cached;
     }

     set(toolName: string, goalId: string, permission: CachedPermission): void {
       const key = this.getCacheKey(toolName, goalId);
       this.cache.set(key, permission);
     }

     invalidate(goalId: string): void {
       for (const key of this.cache.keys()) {
         if (key.startsWith(`${goalId}:`)) {
           this.cache.delete(key);
         }
       }
     }
   }
   ```

2. **集成到 ToolEnforcer**
   - 检查权限前先查缓存
   - 授权后写入缓存

#### 3.4.2 验收标准

- [ ] 相同工具相同 Goal 不重复请求权限
- [ ] 缓存过期后重新请求
- [ ] Goal 完成后缓存清理

---

## 实现时间线建议

```
Week 1-2: Phase 1 (核心安全与合规)
├── 1.1 审计日志系统
├── 1.2 三层责任模型
└── 1.3 Session 持久化

Week 3-4: Phase 2 (功能完整性)
├── 2.1 OS Service 权限管理
├── 2.2 独立的 Clarify 阶段
└── 2.3 Stuck State 检测

Week 5: Phase 3 (优化与增强)
├── 3.1 Per-Goal 工具白名单
├── 3.2 升级包完整性验证
├── 3.3 AbortSignal 完整传播
└── 3.4 权限缓存机制

Week 6: 集成测试与文档更新
```

---

## 测试策略

每个功能实现后需要：

1. **单元测试**: 覆盖核心逻辑
2. **集成测试**: 验证组件间交互
3. **E2E 测试**: 验证完整工作流

测试文件命名：`test/[component]/[feature].test.ts`

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|-----|---------|
| 审计日志影响性能 | 中 | 使用异步写入，批量提交 |
| 权限系统过于复杂 | 中 | 提供合理的默认配置 |
| 状态机变更影响现有数据 | 高 | 数据库迁移脚本，向后兼容 |
| Stuck 检测误报 | 低 | 可配置阈值，人工确认 |

---

## 附录：文件变更清单

### 新建文件

```
src/domain/audit/types.ts
src/domain/permission/types.ts
src/domain/permission/os-service.ts
src/infra/persistence/audit-repository.ts
src/infra/persistence/session-repository.ts (SQLite 版本)
src/infra/audit/audit-service.ts
src/infra/permission/permission-cache.ts
src/infra/permission/os-service-checker.ts
src/infra/tools/forbidden-operations.ts
src/app/lifecycle/clarify/clarify-service.ts
src/scheduler/watchdog/types.ts
src/scheduler/watchdog/stuck-detector.ts
src/scheduler/watchdog/watchdog-service.ts
src/scheduler/permission-handler/permission-handler.ts
src/gateway/rpc/handlers/audit-handlers.ts
src/gateway/rpc/handlers/permission-handlers.ts
src/gateway/rpc/handlers/clarify-handlers.ts
```

### 修改文件

```
src/domain/work-order/types.ts
src/domain/work-order/state-machine.ts
src/domain/work-order/invariants.ts
src/infra/persistence/schema.sql
src/infra/persistence/work-order-repository.ts
src/infra/tools/tool-registry.ts
src/infra/tools/tool-enforcer.ts
src/infra/conversation/session-repository.ts
src/app/conversation/session-manager.ts
src/app/lifecycle/intake/intake-service.ts
src/app/lifecycle/execution/execution-service.ts
src/autonomy/react-integration.ts
src/autonomy/daemon.ts
src/gateway/gateway-server.ts
src/gateway/rpc/rpc-handler.ts
src/gateway/auth/auth-manager.ts
src/scheduler/escalation-handler/escalation-handler.ts
```
