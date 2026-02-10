# PonyBunny Web UI - 新架构说明

## 概述

PonyBunny Web前端已重新设计，提供三个核心功能模块：对话（Conversation）、系统状态（System Status）和配置管理（Configuration）。

## 架构特点

### 1. 主布局（Main Layout）
- **文件**: `src/app/layout.tsx`
- **功能**: 
  - 全局Gateway Provider包装，提供实时事件流
  - 左侧Sidebar导航栏
  - 主内容区域

### 2. 侧边栏导航（Sidebar）
- **文件**: `src/components/layout/sidebar.tsx`
- **功能**:
  - 三个主要导航项：对话、系统状态、配置
  - 显示PonyBunny品牌和版本信息
  - 响应式高亮当前活动页面

## 三大核心功能

### 1. 对话页面（/chat）

**位置**: `src/app/chat/page.tsx`

**功能**:
- 简洁的聊天界面
- 完美集成Gateway后端
- **实时流式响应**:
  - 使用现有的Server-Sent Events (SSE)
  - 自动接收`llm.stream.start`、`llm.stream.chunk`、`llm.stream.end`事件
  - Markdown渲染LLM响应
- 复用现有的`ChatContainer`组件

**实时事件处理**:
```typescript
// Gateway Provider自动处理这些事件：
- llm.stream.start   // 流开始
- llm.stream.chunk   // 接收文本块
- llm.stream.end     // 流结束
- llm.stream.error   // 错误处理
```

### 2. 系统状态页面（/status）

**位置**: `src/app/status/page.tsx`

**功能**:
- 实时监控Gateway和Scheduler服务状态
- 服务控制按钮（启动、停止、重启）
- 全局控制（启动/停止/重启所有服务）
- 每5秒自动刷新状态
- 显示服务PID和运行状态

**API接口**:
- `GET /api/system/status` - 获取服务状态
- `POST /api/system/control` - 控制服务

**后端实现**:
- 通过`pb service status`命令获取状态
- 通过`pb service start/stop/restart`控制服务
- 要求`pb` CLI在系统PATH中可用

### 3. 配置页面（/config）

**位置**: `src/app/config/page.tsx`

**功能**:
- 查看和编辑三个配置文件：
  - `credentials.json` - API密钥
  - `llm-config.json` - LLM配置
  - `mcp-config.json` - MCP服务器配置
- JSON编辑器，带语法高亮
- 保存前JSON格式验证
- 实时显示修改状态
- 撤销未保存的更改

**API接口**:
- `GET /api/config?file=<filename>` - 读取配置文件
- `POST /api/config` - 保存配置文件

**安全性**:
- 仅允许访问白名单文件
- 配置文件位于`~/.ponybunny/`
- JSON格式验证防止损坏配置

## 技术栈

- **框架**: Next.js 16 (App Router)
- **React**: 19.2.3
- **TypeScript**: 严格模式
- **样式**: Tailwind CSS 4
- **UI组件**: shadcn/ui (Radix UI)
- **实时通信**: Server-Sent Events (SSE)
- **状态管理**: React Context (Gateway Provider)

## 流式响应实现

### Gateway Provider
**文件**: `src/components/providers/gateway-provider.tsx`

流式响应完全由现有的Gateway Provider处理：

```typescript
// 自动处理SSE事件
case 'llm.stream.start':
  dispatch({ type: 'LLM_STREAM_START', data });
  
case 'llm.stream.chunk':
  dispatch({ type: 'LLM_STREAM_CHUNK', data });
  
case 'llm.stream.end':
  dispatch({ type: 'LLM_STREAM_END', data });
```

### API Client
**文件**: `src/lib/api-client.ts`

SSE连接管理：
```typescript
// 连接到事件流
connectEvents(): void
  
// 订阅事件
on(event: string, handler: (data) => void): () => void
  
// 断开连接
disconnectEvents(): void
```

## 项目结构

```
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # 主布局 + Sidebar
│   │   ├── page.tsx                # 重定向到 /chat
│   │   ├── chat/
│   │   │   └── page.tsx            # 对话页面
│   │   ├── status/
│   │   │   └── page.tsx            # 系统状态页面
│   │   ├── config/
│   │   │   └── page.tsx            # 配置管理页面
│   │   └── api/
│   │       ├── system/
│   │       │   ├── status/         # 获取服务状态
│   │       │   └── control/        # 控制服务
│   │       └── config/             # 配置文件读写
│   ├── components/
│   │   ├── layout/
│   │   │   └── sidebar.tsx         # 侧边栏导航
│   │   ├── providers/
│   │   │   └── gateway-provider.tsx # Gateway状态管理
│   │   └── ui/                     # UI组件库
│   └── lib/
│       ├── api-client.ts           # API客户端 + SSE
│       ├── types.ts                # TypeScript类型
│       └── utils.ts                # 工具函数
```

## 运行说明

### 启动开发服务器

```bash
cd web
npm run dev
```

服务器启动在: http://localhost:3000

### 前置条件

1. **Gateway必须运行**:
   ```bash
   pb gateway start
   ```

2. **pb CLI必须在PATH中** (用于系统状态页面):
   ```bash
   # 构建CLI
   cd ..
   npm run build:cli
   
   # 确保pb可用
   pb --version
   ```

3. **配置文件存在** (用于配置页面):
   ```bash
   # 初始化配置
   pb init
   ```

## 验证清单

✅ **TypeScript编译**: 通过 (`tsc --noEmit`)
✅ **主布局**: 实现 Sidebar + GatewayProvider
✅ **对话页面**: 复用ChatContainer，支持流式响应
✅ **系统状态页面**: 服务监控和控制
✅ **配置页面**: JSON编辑器，三个配置文件
✅ **API路由**: 
  - `/api/system/status` - 获取服务状态
  - `/api/system/control` - 控制服务
  - `/api/config` - 读写配置文件
✅ **流式支持**: Gateway Provider处理SSE事件
✅ **重定向**: 根路径 → /chat

## 注意事项

1. **服务控制依赖pb CLI**:
   - 系统状态页面的启动/停止功能需要`pb`命令在PATH中
   - 如果`pb`不可用，会显示错误消息

2. **配置文件权限**:
   - 确保Next.js进程有权限读写`~/.ponybunny/`目录
   - credentials.json包含敏感信息，仅在本地访问

3. **实时更新**:
   - 对话页面：通过SSE实时接收流式响应
   - 系统状态页面：每5秒自动刷新
   - 配置页面：手动保存

## 未来改进

- [ ] 添加深色/浅色主题切换
- [ ] 系统状态页面添加日志查看功能
- [ ] 配置页面添加JSON Schema验证
- [ ] 添加用户认证和权限管理
- [ ] 服务状态实时WebSocket更新
- [ ] 配置文件版本控制和回滚
