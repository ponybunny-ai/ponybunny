# Deployment & Operations Guide (OpenClaw)

## 概述

OpenClaw 支持多种部署方式，从本地开发到生产环境的 Docker 部署。本文档详细说明安装方法、配置管理、网络绑定模式、安全加固、服务管理及监控策略。

**核心组件**:
- `src/config/` - 配置加载与验证 (616 行)
- `src/gateway/server.ts` - Gateway 服务器启动
- `src/gateway/auth.ts` - 认证机制 (291 行)
- `src/infra/bonjour.ts` - mDNS 广播 (200+ 行)
- `src/daemon/systemd*.ts` - systemd 服务管理
- `Dockerfile` - 容器化部署配置 (40 行)

**支持的部署模式**:
- ✅ **本地开发** - npm/pnpm 直接运行
- ✅ **Docker 容器** - 生产环境推荐
- ✅ **系统服务** - systemd (Linux) / launchd (macOS)
- ✅ **LAN 访问** - mDNS 自动发现
- ✅ **Tailscale 集成** - 跨网络安全访问

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)

---

## 1. 安装方法

### 1.1 从源码安装 (开发环境)

**前置要求**:
- Node.js ≥ 22
- pnpm ≥ 9
- Bun (可选，用于构建脚本)

**安装步骤**:
```bash
# 1. 克隆仓库
git clone https://github.com/openclaw/openclaw.git
cd openclaw

# 2. 安装依赖
pnpm install

# 3. 构建后端
pnpm build

# 4. 构建前端 (可选)
pnpm ui:build

# 5. 启动 Gateway
node dist/index.js
```

**首次启动**:
```
[openclaw] Gateway starting...
[openclaw] Config loaded from ~/.openclaw/config.json5
[openclaw] Gateway listening on http://127.0.0.1:18789
[openclaw] Bonjour advertising: openclaw.local
```

**验证安装**:
```bash
# HTTP Health Check
curl http://localhost:18789/health

# WebSocket 连接测试
wscat -c ws://localhost:18789
```

### 1.2 npm 全局安装 (生产环境)

**安装命令**:
```bash
npm install -g openclaw

# 或使用 pnpm
pnpm add -g openclaw
```

**启动命令**:
```bash
# 前台运行
openclaw gateway

# 后台运行 (使用 PM2)
pm2 start openclaw -- gateway
pm2 save
pm2 startup
```

### 1.3 Docker 部署 (推荐生产环境)

**Dockerfile 解析** (基于 `Dockerfile`, 40 行):

```dockerfile
FROM node:22-bookworm

# 1. 安装 Bun (构建工具)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# 2. 启用 corepack (pnpm 支持)
RUN corepack enable

WORKDIR /app

# 3. 可选 APT 包安装
ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/*; \
    fi

# 4. 复制依赖清单并安装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

# 5. 复制源码并构建
COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# 6. 安全加固: 非 root 用户运行
USER node

CMD ["node", "dist/index.js"]
```

**构建镜像**:
```bash
# 基础镜像
docker build -t openclaw:latest .

# 带自定义 APT 包
docker build \
  --build-arg OPENCLAW_DOCKER_APT_PACKAGES="ffmpeg imagemagick" \
  -t openclaw:custom .
```

**运行容器**:
```bash
docker run -d \
  --name openclaw \
  -p 18789:18789 \
  -v openclaw-data:/home/node/.openclaw \
  -e DISCORD_BOT_TOKEN="your-token" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -e OPENAI_API_KEY="sk-..." \
  openclaw:latest
```

**Docker Compose 配置**:
```yaml
version: '3.8'

services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw
    restart: unless-stopped
    ports:
      - "18789:18789"
    volumes:
      - openclaw-data:/home/node/.openclaw
    environment:
      - OPENCLAW_GATEWAY_PORT=18789
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:18789/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  openclaw-data:
```

**启动服务**:
```bash
docker-compose up -d
docker-compose logs -f openclaw
```

---

## 2. 配置管理

### 2.1 配置文件位置

**主配置文件**: `~/.openclaw/config.json5`  
**Agent 数据**: `~/.openclaw/agent/`  
**Session 存储**: `~/.openclaw/sessions/`  
**Memory Index**: `~/.openclaw/memory/`

**容器内路径**: `/home/node/.openclaw/`

### 2.2 配置加载机制

**实现位置**: `src/config/io.ts` (616 行)

**加载优先级** (从高到低):
1. **环境变量** - `OPENCLAW_*` 前缀
2. **配置文件** - `~/.openclaw/config.json5`
3. **默认值** - 代码中的硬编码默认值

**加载流程** (`loadConfig()` 伪代码):
```typescript
function loadConfig(): OpenClawConfig {
  // 1. 查找配置文件路径
  const configPath = resolveConfigPath();  // ~/.openclaw/config.json5
  
  // 2. 读取文件内容 (JSON5 格式)
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    fileConfig = parseConfigJson5(raw);  // 支持注释、尾随逗号
  }
  
  // 3. 应用环境变量覆盖
  const envOverrides = extractEnvOverrides();  // OPENCLAW_GATEWAY_PORT=8080 → gateway.port = 8080
  
  // 4. 合并配置
  const merged = mergeConfig(defaultConfig, fileConfig, envOverrides);
  
  // 5. 验证配置 Schema
  const validated = validateConfigObject(merged);
  
  return validated;
}
```

### 2.3 配置文件结构

**完整示例** (`~/.openclaw/config.json5`):
```json5
{
  // Gateway 配置
  gateway: {
    port: 18789,              // 监听端口
    host: "0.0.0.0",          // 绑定地址 ("127.0.0.1", "0.0.0.0", "::")
    bind: "loopback",         // 预设 ("loopback", "lan", "tailnet")
    
    // 认证配置
    auth: {
      mode: "token",          // "none", "token", "device-pairing"
      token: "secret-token",  // Shared secret (mode="token" 时)
    },
    
    // TLS 配置 (可选)
    tls: {
      enabled: false,
      cert: "/path/to/cert.pem",
      key: "/path/to/key.pem",
    },
    
    // Canvas Host 配置 (Browser mode)
    canvasHost: {
      enabled: true,
      port: 18789,  // 通常与 gateway.port 相同
    },
  },
  
  // Agent 配置
  agents: {
    defaults: {
      // 模型配置
      model: {
        primary: "anthropic/claude-sonnet-4-5",
        fallbacks: [
          "google/gemini-2.0-flash-exp",
          "openai/gpt-4o-mini"
        ],
      },
      
      // 模型别名
      models: {
        "anthropic/claude-opus-4-5": { alias: "opus" },
        "anthropic/claude-sonnet-4-5": { alias: "sonnet" },
      },
      
      // 推理级别
      thinkLevel: "medium",  // "off", "low", "medium", "high", "xhigh"
      
      // 并发控制
      maxConcurrent: 4,  // Main Lane 并发数
      
      // Subagent 配置
      subagent: {
        model: "google/gemini-2.0-flash-exp",
        maxConcurrent: 2,
      },
      
      // Sandbox 配置
      sandbox: {
        mode: "non-main",  // "off", "non-main", "always"
        allowlist: {
          paths: ["/tmp", "/home/user/workspace"],
          domains: ["api.github.com", "npm.org"],
        },
      },
      
      // 工具配置
      tools: {
        enabled: ["read", "write", "bash", "grep"],
        disabled: ["rm"],
      },
    },
  },
  
  // Channel 配置 (Slack, Discord, etc.)
  channels: {
    slack: {
      enabled: true,
      botToken: "${SLACK_BOT_TOKEN}",  // 支持环境变量引用
    },
    discord: {
      enabled: true,
      botToken: "${DISCORD_BOT_TOKEN}",
    },
  },
  
  // Cron 配置
  cron: {
    maxConcurrentRuns: 1,
    jobs: [
      {
        schedule: "0 */6 * * *",  // 每 6 小时
        command: "backup-sessions",
      },
    ],
  },
  
  // Memory 配置
  memory: {
    indexEnabled: true,
    chunkSize: 512,  // tokens
    embeddingModel: "text-embedding-3-small",
  },
}
```

### 2.4 环境变量映射

**核心环境变量**:

| 环境变量 | 配置路径 | 示例值 | 说明 |
|:---|:---|:---|:---|
| `OPENCLAW_GATEWAY_PORT` | `gateway.port` | `18789` | Gateway 端口 |
| `OPENCLAW_GATEWAY_HOST` | `gateway.host` | `0.0.0.0` | 绑定地址 |
| `DISCORD_BOT_TOKEN` | `channels.discord.botToken` | `MTE2...` | Discord Bot Token |
| `SLACK_BOT_TOKEN` | `channels.slack.botToken` | `xoxb-...` | Slack Bot Token |
| `ANTHROPIC_API_KEY` | (auth profile) | `sk-ant-...` | Anthropic API Key |
| `OPENAI_API_KEY` | (auth profile) | `sk-...` | OpenAI API Key |
| `GOOGLE_API_KEY` | (auth profile) | `AIza...` | Google API Key |
| `OPENCLAW_DISABLE_BONJOUR` | - | `1` | 禁用 mDNS 广播 |
| `OPENCLAW_MDNS_HOSTNAME` | - | `my-gateway` | mDNS 主机名 |

**环境变量解析逻辑** (`config/runtime-overrides.ts`):
```typescript
function extractEnvOverrides(): Partial<OpenClawConfig> {
  const overrides: any = {};
  
  // Gateway Port
  if (process.env.OPENCLAW_GATEWAY_PORT) {
    overrides.gateway = overrides.gateway || {};
    overrides.gateway.port = parseInt(process.env.OPENCLAW_GATEWAY_PORT);
  }
  
  // Gateway Host
  if (process.env.OPENCLAW_GATEWAY_HOST) {
    overrides.gateway = overrides.gateway || {};
    overrides.gateway.host = process.env.OPENCLAW_GATEWAY_HOST;
  }
  
  // Discord Token
  if (process.env.DISCORD_BOT_TOKEN) {
    overrides.channels = overrides.channels || {};
    overrides.channels.discord = overrides.channels.discord || {};
    overrides.channels.discord.botToken = process.env.DISCORD_BOT_TOKEN;
  }
  
  return overrides;
}
```

### 2.5 配置验证与 Schema

**Zod Schema** (`config/zod-schema.ts`):
```typescript
import { z } from "zod";

export const OpenClawSchema = z.object({
  gateway: z.object({
    port: z.number().min(1).max(65535).default(18789),
    host: z.string().default("127.0.0.1"),
    bind: z.enum(["loopback", "lan", "tailnet"]).optional(),
    auth: z.object({
      mode: z.enum(["none", "token", "device-pairing"]).default("none"),
      token: z.string().optional(),
    }).optional(),
  }).optional(),
  
  agents: z.object({
    defaults: z.object({
      model: z.union([
        z.string(),
        z.object({
          primary: z.string(),
          fallbacks: z.array(z.string()).optional(),
        }),
      ]).optional(),
      thinkLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
      maxConcurrent: z.number().min(1).default(1),
    }).optional(),
  }).optional(),
  
  // ... 更多字段
});
```

**验证触发时机**:
- Gateway 启动时
- `config.apply` RPC 方法调用时
- 热重载配置时

**验证失败处理**:
```typescript
try {
  const validated = OpenClawSchema.parse(config);
} catch (err) {
  console.error("Config validation failed:");
  console.error(err.errors.map(e => `  ${e.path.join(".")}: ${e.message}`).join("\n"));
  process.exit(1);
}
```

### 2.6 配置热重载

**触发方式**:
1. **文件监听** - 监控 `config.json5` 变化
2. **RPC 方法** - `config.apply` / `config.set`
3. **SIGHUP 信号** - `kill -HUP <pid>`

**热重载流程**:
```typescript
// 监听配置文件变化
fs.watch(configPath, async (eventType) => {
  if (eventType === "change") {
    try {
      const newConfig = await loadConfig();
      await applyConfigChanges(currentConfig, newConfig);
      currentConfig = newConfig;
      console.log("Config reloaded successfully");
    } catch (err) {
      console.error("Config reload failed:", err);
    }
  }
});

// 应用配置变化
function applyConfigChanges(old, new) {
  // 1. 更新 Lane 并发数
  if (old.agents?.defaults?.maxConcurrent !== new.agents?.defaults?.maxConcurrent) {
    setCommandLaneConcurrency("main", new.agents.defaults.maxConcurrent);
  }
  
  // 2. 更新模型配置 (无需重启)
  if (old.agents?.defaults?.model !== new.agents?.defaults?.model) {
    updateDefaultModel(new.agents.defaults.model);
  }
  
  // 3. 警告: 某些变化需要重启
  if (old.gateway?.port !== new.gateway?.port) {
    console.warn("Gateway port change requires restart");
  }
}
```

---

## 3. 网络绑定模式

### 3.1 绑定地址配置

**预设模式** (`gateway.bind`):

| 模式 | 绑定地址 | 访问范围 | 使用场景 |
|:---|:---|:---|:---|
| **loopback** | `127.0.0.1` | 本机 | 开发环境、单用户 |
| **lan** | `0.0.0.0` | 局域网 | 团队共享、LAN 访问 |
| **tailnet** | `100.*.*.*` | Tailscale 网络 | 远程访问、跨网络 |

**自定义绑定**:
```json5
{
  gateway: {
    host: "192.168.1.100",  // 绑定特定 IP
    port: 8080,
  }
}
```

### 3.2 mDNS 自动发现 (Bonjour)

**实现位置**: `src/infra/bonjour.ts` (200+ 行)

**工作原理**:
1. Gateway 启动时广播 `_openclaw-gw._tcp.local` 服务
2. 客户端通过 mDNS 查询发现 Gateway
3. TXT 记录包含 Gateway 元数据（端口、TLS 指纹等）

**TXT 记录结构**:
```typescript
type BonjourTxt = {
  role: "gateway";
  gatewayPort: string;              // "18789"
  lanHost: string;                  // "openclaw.local"
  displayName: string;              // "My OpenClaw Gateway"
  gatewayTls?: "1";                 // TLS 启用标志
  gatewayTlsSha256?: string;        // TLS 证书指纹
  canvasPort?: string;              // Canvas Host 端口
  tailnetDns?: string;              // Tailscale DNS 名称
  cliPath?: string;                 // CLI 可执行文件路径 (minimal=false 时)
  sshPort?: string;                 // SSH 端口 (minimal=false 时)
};
```

**广播示例** (`bonjour.ts`, line 84-200):
```typescript
const gateway = responder.createService({
  name: "openclaw",              // 实例名称
  type: "openclaw-gw",           // 服务类型
  protocol: Protocol.TCP,
  port: 18789,
  domain: "local",
  hostname: "openclaw",          // 主机名 (解析为 openclaw.local)
  txt: {
    role: "gateway",
    gatewayPort: "18789",
    lanHost: "openclaw.local",
    displayName: "OpenClaw Gateway",
  },
});

await gateway.advertise();
```

**客户端发现**:
```typescript
// 使用 @homebridge/ciao 查询
const browser = getResponder().createBrowser("openclaw-gw");
browser.on("service-up", (service) => {
  console.log("Found OpenClaw Gateway:");
  console.log(`  Host: ${service.hostname}.local`);
  console.log(`  Port: ${service.port}`);
  console.log(`  URL: ws://${service.hostname}.local:${service.port}`);
});
browser.start();
```

**禁用 mDNS**:
```bash
export OPENCLAW_DISABLE_BONJOUR=1
node dist/index.js
```

### 3.3 IPv6 支持

**绑定 IPv6**:
```json5
{
  gateway: {
    host: "::",  // 绑定所有 IPv6 地址
    port: 18789,
  }
}
```

**双栈绑定** (IPv4 + IPv6):
```typescript
// 启动两个服务器
const server4 = createServer({ host: "0.0.0.0", port: 18789 });
const server6 = createServer({ host: "::", port: 18789 });
```

---

## 4. 认证与授权

### 4.1 认证模式

**实现位置**: `src/gateway/auth.ts` (291 行)

**支持的认证方式**:

| 模式 | `gateway.auth.mode` | Token 格式 | 适用场景 |
|:---|:---|:---|:---|
| **No Auth** (本地环回) | `"none"` | - | `127.0.0.1` 连接 |
| **Shared Secret** | `"token"` | `secret:<token>` | 简单部署 |
| **Device Pairing** | `"device-pairing"` | `device:<id>:<token>` | 移动设备 |

**认证流程**:
```
1. Client connects to WebSocket
2. Server sends connect.challenge event
   → { nonce: "uuid", ts: 1704067200000 }
3. Client sends connect request
   → { method: "connect", params: { auth: "secret:my-token" } }
4. Server validates auth
   → 检查 auth token 是否匹配 gateway.auth.token
5a. Success: Server responds with HelloOk
   → { ok: true, result: { hello: "ok", version: "..." } }
5b. Failure: Server responds with error
   → { ok: false, error: { code: "ERR_AUTH_FAILED", ... } }
```

### 4.2 Shared Secret 配置

**配置文件**:
```json5
{
  gateway: {
    auth: {
      mode: "token",
      token: "my-secret-token-12345",
    },
  }
}
```

**客户端连接** (WebSocket):
```javascript
const ws = new WebSocket("ws://localhost:18789");

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "req",
    id: "1",
    method: "connect",
    params: {
      auth: "secret:my-secret-token-12345",
      client: "my-app",
    },
  }));
});
```

**Token 验证逻辑** (`auth.ts`):
```typescript
function validateAuth(params: {
  auth?: string;
  remoteAddr?: string;
  resolvedAuth: ResolvedGatewayAuth;
}): boolean {
  // 1. 本地环回免认证
  if (isLoopbackAddress(params.remoteAddr)) {
    return true;
  }
  
  // 2. Shared Secret 验证
  if (params.resolvedAuth.mode === "token") {
    const expected = `secret:${params.resolvedAuth.token}`;
    return params.auth === expected;
  }
  
  return false;
}
```

### 4.3 Device Pairing 机制

**配对流程**:
```
1. Device generates pairing code
   → QR Code 或 6-digit PIN
2. User scans QR code in OpenClaw UI
3. Gateway approves device
   → 生成 device token 并存储到 device registry
4. Device connects with device token
   → auth: "device:<device-id>:<token>"
```

**Device Registry** (`~/.openclaw/devices.json`):
```json5
{
  devices: [
    {
      id: "device-iphone-123",
      name: "Alice's iPhone",
      token: "generated-secure-token",
      approvedAt: 1704067200000,
      lastSeen: 1704070800000,
    },
  ],
}
```

### 4.4 Tailscale 集成

**配置**:
```json5
{
  gateway: {
    bind: "tailnet",  // 自动绑定到 Tailscale IP
    auth: {
      mode: "tailscale",  // 使用 Tailscale 身份认证
    },
  }
}
```

**Tailscale 认证流程**:
1. Gateway 启动时检测 Tailscale IP (`100.*.*.*`)
2. 绑定到 Tailscale 接口
3. WebSocket 连接时验证 `X-Tailscale-User` header
4. 自动授权来自同一 Tailnet 的连接

---

## 5. 服务管理

### 5.1 systemd (Linux)

**Unit 文件生成** (`daemon/systemd-unit.ts`, 138 行):

**示例 Unit 文件** (`~/.config/systemd/user/openclaw.service`):
```ini
[Unit]
Description=OpenClaw Gateway
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/node /home/user/openclaw/dist/index.js
Restart=always
RestartSec=5
KillMode=process
WorkingDirectory=/home/user/openclaw
Environment="NODE_ENV=production"
Environment="OPENCLAW_GATEWAY_PORT=18789"

[Install]
WantedBy=default.target
```

**安装与启动**:
```bash
# 1. 创建 Unit 文件
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/openclaw.service << 'EOF'
[Unit]
Description=OpenClaw Gateway
After=network-online.target

[Service]
ExecStart=/usr/bin/node /home/user/openclaw/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

# 2. 重载 systemd 配置
systemctl --user daemon-reload

# 3. 启用开机自启
systemctl --user enable openclaw

# 4. 启动服务
systemctl --user start openclaw

# 5. 查看状态
systemctl --user status openclaw

# 6. 查看日志
journalctl --user -u openclaw -f
```

**KillMode=process 解释**:
- 确保 systemd 只等待主进程退出
- 防止 Podman conmon 进程阻塞关机
- 允许子进程（如 Docker 容器）独立存活

### 5.2 launchd (macOS)

**plist 文件** (`~/Library/LaunchAgents/com.openclaw.gateway.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.gateway</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/nick/openclaw/dist/index.js</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>/Users/nick/openclaw</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>OPENCLAW_GATEWAY_PORT</key>
        <string>18789</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>/tmp/openclaw.log</string>
    
    <key>StandardErrorPath</key>
    <string>/tmp/openclaw.error.log</string>
</dict>
</plist>
```

**安装与启动**:
```bash
# 1. 创建 plist 文件
mkdir -p ~/Library/LaunchAgents
cp com.openclaw.gateway.plist ~/Library/LaunchAgents/

# 2. 加载服务
launchctl load ~/Library/LaunchAgents/com.openclaw.gateway.plist

# 3. 启动服务
launchctl start com.openclaw.gateway

# 4. 查看状态
launchctl list | grep openclaw

# 5. 查看日志
tail -f /tmp/openclaw.log
```

### 5.3 PM2 (跨平台)

**安装 PM2**:
```bash
npm install -g pm2
```

**启动配置** (`ecosystem.config.js`):
```javascript
module.exports = {
  apps: [{
    name: "openclaw",
    script: "dist/index.js",
    cwd: "/home/user/openclaw",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      OPENCLAW_GATEWAY_PORT: 18789,
    },
  }],
};
```

**启动命令**:
```bash
# 使用配置文件启动
pm2 start ecosystem.config.js

# 或直接启动
pm2 start dist/index.js --name openclaw

# 保存配置
pm2 save

# 开机自启 (生成 systemd/launchd unit)
pm2 startup

# 查看状态
pm2 status

# 查看日志
pm2 logs openclaw

# 重启服务
pm2 restart openclaw

# 停止服务
pm2 stop openclaw
```

---

## 6. 安全加固

### 6.1 TLS/SSL 配置

**生成自签名证书**:
```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=openclaw.local"
```

**配置 TLS**:
```json5
{
  gateway: {
    tls: {
      enabled: true,
      cert: "/path/to/cert.pem",
      key: "/path/to/key.pem",
    },
  }
}
```

**Let's Encrypt (生产环境)**:
```bash
# 使用 certbot 获取证书
sudo certbot certonly --standalone -d openclaw.example.com

# 配置文件
{
  gateway: {
    tls: {
      enabled: true,
      cert: "/etc/letsencrypt/live/openclaw.example.com/fullchain.pem",
      key: "/etc/letsencrypt/live/openclaw.example.com/privkey.pem",
    },
  }
}
```

### 6.2 反向代理 (Nginx)

**Nginx 配置** (`/etc/nginx/sites-available/openclaw`):
```nginx
upstream openclaw {
    server 127.0.0.1:18789;
}

server {
    listen 443 ssl http2;
    server_name openclaw.example.com;
    
    ssl_certificate /etc/letsencrypt/live/openclaw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/openclaw.example.com/privkey.pem;
    
    # WebSocket 升级
    location / {
        proxy_pass http://openclaw;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 增加超时时间 (长连接)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

**启用配置**:
```bash
sudo ln -s /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6.3 防火墙规则

**iptables (Linux)**:
```bash
# 允许 Gateway 端口
sudo iptables -A INPUT -p tcp --dport 18789 -j ACCEPT

# 限制连接速率 (防 DDoS)
sudo iptables -A INPUT -p tcp --dport 18789 -m connlimit --connlimit-above 50 -j REJECT

# 仅允许特定 IP
sudo iptables -A INPUT -p tcp --dport 18789 -s 192.168.1.0/24 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 18789 -j DROP
```

**UFW (Ubuntu)**:
```bash
sudo ufw allow 18789/tcp
sudo ufw enable
```

### 6.4 API Key 轮换

**定期轮换认证 Token**:
```bash
# 生成新 Token
NEW_TOKEN=$(openssl rand -hex 32)

# 更新配置
cat > ~/.openclaw/config.json5 << EOF
{
  gateway: {
    auth: {
      mode: "token",
      token: "${NEW_TOKEN}",
    },
  }
}
EOF

# 热重载配置
kill -HUP $(cat ~/.openclaw/gateway.pid)

# 或使用 RPC
curl -X POST http://localhost:18789/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "method": "config.set",
    "params": {
      "key": "gateway.auth.token",
      "value": "'"$NEW_TOKEN"'"
    }
  }'
```

---

## 7. 监控与日志

### 7.1 健康检查

**HTTP Endpoint**: `http://localhost:18789/health`

**响应示例**:
```json
{
  "status": "ok",
  "version": "0.5.0",
  "uptime": 86400,
  "memory": {
    "rss": 134217728,
    "heapUsed": 67108864
  },
  "sessions": {
    "active": 5,
    "total": 123
  }
}
```

**Kubernetes Liveness Probe**:
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 18789
  initialDelaySeconds: 30
  periodSeconds: 10
```

### 7.2 日志管理

**日志级别**:
```bash
export OPENCLAW_LOG_LEVEL=debug  # debug, info, warn, error
export DEBUG=openclaw:*           # 启用详细调试日志
```

**日志输出**:
- **stdout** - 正常日志
- **stderr** - 错误日志
- **文件** - `~/.openclaw/logs/gateway.log` (可配置)

**日志轮转** (使用 logrotate):
```bash
# /etc/logrotate.d/openclaw
/home/user/.openclaw/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 user user
}
```

### 7.3 Prometheus Metrics (建议实现)

**Metrics Endpoint**: `http://localhost:18789/metrics`

**示例指标**:
```prometheus
# Queue depth
openclaw_queue_depth{lane="main"} 3
openclaw_queue_depth{lane="subagent"} 1

# Request rate
openclaw_requests_total{method="agent"} 1234
openclaw_requests_total{method="chat.send"} 567

# Response time
openclaw_response_duration_seconds{method="agent",quantile="0.95"} 2.5

# Error rate
openclaw_errors_total{code="ERR_TIMEOUT"} 12
```

---

## 8. 关键文件索引

| 文件路径 | 行数 | 功能职责 |
|:---|:---|:---|
| `Dockerfile` | 40 | Docker 容器化配置 |
| `src/config/io.ts` | 616 | 配置文件读写、JSON5 解析 |
| `src/config/zod-schema.ts` | - | 配置 Schema 验证 |
| `src/gateway/auth.ts` | 291 | 认证机制实现 |
| `src/gateway/server.ts` | - | Gateway 服务器启动逻辑 |
| `src/infra/bonjour.ts` | 200+ | mDNS 广播与发现 |
| `src/daemon/systemd-unit.ts` | 138 | systemd Unit 文件生成 |
| `scripts/systemd/openclaw-auth-monitor.service` | 15 | Auth 过期监控示例 |

---

## 9. 故障排查

### 9.1 常见问题

**Q1: Gateway 无法启动**

**排查步骤**:
1. 检查端口占用: `lsof -i:18789`
2. 检查配置文件语法: `node -e "require('json5').parse(fs.readFileSync('~/.openclaw/config.json5'))"`
3. 查看日志: `journalctl --user -u openclaw -n 100`

---

**Q2: 无法通过 mDNS 发现**

**排查步骤**:
1. 检查 mDNS 是否启用: `echo $OPENCLAW_DISABLE_BONJOUR`
2. 检查防火墙: `sudo ufw status`
3. 测试 mDNS 查询: `avahi-browse -r _openclaw-gw._tcp`

---

**Q3: 认证失败**

**排查步骤**:
1. 检查 Token: `grep "auth.token" ~/.openclaw/config.json5`
2. 检查客户端 Token 格式: 必须是 `secret:<token>`
3. 检查是否是本地环回连接 (免认证)

---

## 10. 适用场景

**PonyBunny 项目中的部署参考指南**:
- Autonomy Daemon 的服务管理配置
- Work Order System 的生产环境部署
- Quality Gate 的监控集成
- Multi-day Context 的高可用配置

---

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**文档更新**: 2026-01-31  
**总行数**: ~950 lines
