# Gateway 使用指南

## 启动 Gateway

```bash
# 构建项目
npm run build

# 启动 Gateway 服务器（默认后台运行，端口 18789）
pb gateway start

# 指定端口
pb gateway start --port 8080

# 前台运行（阻塞控制台）
pb gateway start --foreground

# 使用守护进程模式（崩溃后自动重启）
pb gateway start --daemon

# 强制启动（如果已有进程运行，先停止它）
pb gateway start --force
```

### 运行模式说明

| 模式 | 命令 | 说明 |
|------|------|------|
| 后台模式（默认） | `pb gateway start` | 进程在后台运行，不阻塞控制台 |
| 前台模式 | `pb gateway start --foreground` | 进程在前台运行，Ctrl+C 停止 |
| 守护进程模式 | `pb gateway start --daemon` | 带守护进程，崩溃后自动重启 |

## 进程管理

```bash
# 查看运行中的 Gateway 进程
pb gateway ps

# 查看指定端口的进程
pb gateway ps --port 8080

# 查看 Gateway 状态（包括连接测试）
pb gateway status

# 停止 Gateway（守护进程模式会同时停止守护进程）
pb gateway stop

# 停止指定端口的 Gateway
pb gateway stop --port 8080

# 强制停止（使用 SIGKILL）
pb gateway stop --force

# 查看日志
pb gateway logs

# 实时查看日志
pb gateway logs -f

# 查看最近 100 行日志
pb gateway logs -n 100
```

### 文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| PID 文件 | `~/.pony/gateway.pid` | 记录进程信息 |
| 日志文件 | `~/.pony/gateway.log` | 运行日志 |
| 守护进程 PID | `~/.pony/gateway-daemon.pid` | 守护进程 PID |

## 配对令牌管理

```bash
# 生成一个具有 read/write 权限的令牌
pb gateway pair

# 指定权限
pb gateway pair --permissions read,write,admin

# 查看现有令牌
pb gateway tokens

# 撤销令牌
pb gateway revoke <token-id>
```

## 客户端连接流程

### 1. 客户端认证流程

使用 WebSocket 连接到 `ws://localhost:18789`，然后：

```javascript
// 1. 发送配对请求
ws.send(JSON.stringify({
  type: 'req',
  id: '1',
  method: 'auth.pair',
  params: { token: '<pairing-token>' }
}));
// 响应: { challenge: '...' }

// 2. 用 Ed25519 私钥签名 challenge
const signature = await ed25519.sign(challenge, privateKey);

// 3. 完成认证
ws.send(JSON.stringify({
  type: 'req',
  id: '2',
  method: 'auth.verify',
  params: {
    signature: signature.toString('hex'),
    publicKey: publicKey.toString('hex')
  }
}));
// 响应: { success: true, sessionId: '...', permissions: [...] }
```

### 2. 调用 RPC 方法

认证后可以调用这些方法：

```javascript
// 提交目标
ws.send(JSON.stringify({
  type: 'req',
  id: '3',
  method: 'goal.submit',
  params: { title: 'My Goal', description: '...' }
}));

// 查询目标状态
ws.send(JSON.stringify({
  type: 'req',
  id: '4',
  method: 'goal.status',
  params: { goalId: '<goal-id>' }
}));

// 订阅目标事件
ws.send(JSON.stringify({
  type: 'req',
  id: '5',
  method: 'goal.subscribe',
  params: { goalId: '<goal-id>' }
}));
```

## 可用方法

| 方法 | 权限 | 说明 |
|------|------|------|
| `system.ping` | 无 | 健康检查 |
| `system.info` | 无 | 服务信息 |
| `goal.submit` | write | 提交目标 |
| `goal.status` | read | 查询状态 |
| `goal.cancel` | write | 取消目标 |
| `goal.list` | read | 列出目标 |
| `goal.subscribe` | read | 订阅事件 |
| `workitem.get/list` | read | 查询工作项 |
| `escalation.respond` | write | 响应升级 |
| `approval.grant/deny` | admin | 审批请求 |

## 快速测试

```bash
# 使用 wscat 测试
npm install -g wscat
wscat -c ws://localhost:18789

# 发送 ping
{"type":"req","id":"1","method":"system.ping"}
```
