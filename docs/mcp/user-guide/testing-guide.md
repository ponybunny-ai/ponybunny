# MCP 测试指南

## 测试方法

### 方法 1: CLI 命令测试（最简单）

```bash
# 1. 初始化配置
pb mcp init

# 2. 启用 filesystem 服务器
# 编辑 ~/.ponybunny/mcp-config.json，将 enabled 改为 true

# 3. 测试连接
pb mcp test filesystem

# 4. 查看状态
pb mcp status

# 5. 列出所有服务器
pb mcp list
```

### 方法 2: 集成测试脚本（完整测试）

```bash
# 运行完整的集成测试
npx tsx test/mcp-integration.test.ts
```

这个测试会：
1. ✅ 测试 MCP 客户端连接
2. ✅ 测试连接管理器
3. ✅ 测试工具注册表集成
4. ✅ 测试工具执行

### 方法 3: 手动测试真实场景

#### 测试 Filesystem 服务器

```bash
# 1. 配置 filesystem 服务器
cat > ~/.ponybunny/mcp-config.json << 'EOF'
{
  "$schema": "https://ponybunny.dho.ai/schemas/mcp-config.schema.json",
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "allowedTools": ["*"],
      "autoReconnect": true,
      "timeout": 30000
    }
  }
}
EOF

# 2. 测试连接
pb mcp test filesystem

# 预期输出：
# Testing connection to filesystem...
# ✓ Connection successful
#   Server: @modelcontextprotocol/server-filesystem v1.x.x
#   Protocol: 2024-11-05
#   Tools available: 8
```

#### 测试 GitHub 服务器（需要 token）

```bash
# 1. 设置环境变量
export GITHUB_TOKEN="your-github-token"

# 2. 添加 GitHub 服务器
pb mcp add github \
  --transport stdio \
  --command npx \
  --args "-y" "@modelcontextprotocol/server-github"

# 3. 启用服务器
pb mcp enable github

# 4. 测试连接
pb mcp test github
```

### 方法 4: 单元测试（开发者）

创建 Jest 测试文件：

```typescript
// test/infra/mcp/mcp-client.test.ts
import { MCPClient } from '../../../src/infra/mcp/client/mcp-client.js';

describe('MCPClient', () => {
  it('should connect to filesystem server', async () => {
    const client = new MCPClient({
      serverName: 'test',
      config: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      },
    });

    await client.connect();
    expect(client.getState()).toBe('connected');

    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    await client.disconnect();
  });
});
```

运行：
```bash
npx jest test/infra/mcp/mcp-client.test.ts
```

## 测试检查清单

### ✅ 基础功能
- [ ] `pb mcp init` 创建配置文件
- [ ] `pb mcp list` 显示服务器列表
- [ ] `pb mcp add` 添加新服务器
- [ ] `pb mcp remove` 删除服务器
- [ ] `pb mcp enable/disable` 启用/禁用服务器

### ✅ 连接测试
- [ ] `pb mcp test <server>` 成功连接
- [ ] 显示服务器信息（名称、版本、协议）
- [ ] 显示可用工具数量

### ✅ 工具发现
- [ ] 列出所有工具
- [ ] 工具名称正确（mcp_<server>_<tool>）
- [ ] 工具描述正确

### ✅ 工具执行
- [ ] 通过客户端执行工具
- [ ] 通过连接管理器执行工具
- [ ] 通过工具注册表执行工具
- [ ] 返回正确的结果

### ✅ 错误处理
- [ ] 连接失败时显示错误
- [ ] 工具执行失败时显示错误
- [ ] 超时处理
- [ ] 自动重连

## 预期输出示例

### pb mcp test filesystem

```
Testing connection to filesystem...
✓ Connection successful
  Server: @modelcontextprotocol/server-filesystem v1.0.0
  Protocol: 2024-11-05
  Tools available: 8
```

### npx tsx test/mcp-integration.test.ts

```
🚀 MCP Integration Test Suite

============================================================

🧪 Test 1: MCP Client Connection

  ⏳ Connecting to MCP server...
  ✅ Connected successfully
  📋 Server: @modelcontextprotocol/server-filesystem v1.0.0
  📋 Protocol: 2024-11-05

  ⏳ Listing tools...
  ✅ Found 8 tools:
     - read_file: Read the complete contents of a file
     - write_file: Create a new file or overwrite an existing file
     - list_directory: List all files and directories in a path
     ...

  ⏳ Testing tool execution (read package.json)...
  ✅ Tool executed successfully
  📄 Result preview: {
  "name": "pony",
  "version": "1.0.0",
  ...

  ✅ Disconnected

============================================================

🧪 Test 2: Connection Manager

  ⏳ Initializing connection manager...
  ✅ Connection manager initialized
  ✅ Connected servers: test-fs

  ⏳ Listing all tools from all servers...
  📋 test-fs: 8 tools
  ✅ Total tools: 8

  ⏳ Testing tool execution through manager...
  ✅ Tool executed successfully through manager
  ✅ All connections closed

============================================================

🧪 Test 3: Tool Registry Integration

  ⏳ Creating tool registry...
  ⏳ Initializing connection manager...
  ⏳ Registering MCP tools...
  ✅ Registered 2 tools in registry
  ✅ MCP tools: 2
     - mcp_test-fs_read_file
       Category: network, Risk: moderate
     - mcp_test-fs_write_file
       Category: network, Risk: moderate

  ⏳ Testing tool execution through registry...
  ✅ Tool executed successfully through registry
  📄 Result preview: {
  "name": "pony",
  ...

  ✅ Test completed

============================================================

📊 Test Summary

  Test 1 (MCP Client):           ✅ PASS
  Test 2 (Connection Manager):   ✅ PASS
  Test 3 (Registry Integration): ✅ PASS

✅ All tests passed!
```

## 故障排查

### 问题：连接失败

```bash
# 检查 MCP 服务器是否可用
npx -y @modelcontextprotocol/server-filesystem .

# 检查配置文件
cat ~/.ponybunny/mcp-config.json

# 查看详细日志
pb mcp test filesystem
```

### 问题：工具未找到

```bash
# 检查服务器是否启用
pb mcp list

# 检查 allowedTools 配置
cat ~/.ponybunny/mcp-config.json | grep -A 5 allowedTools
```

### 问题：权限错误

```bash
# 检查文件权限
ls -la ~/.ponybunny/

# 重新初始化
pb mcp init
```

## 下一步

测试通过后，你可以：

1. **集成到 Scheduler** - 在 scheduler 启动时初始化 MCP
2. **添加更多服务器** - GitHub, PostgreSQL, Slack 等
3. **编写自定义 MCP 服务器** - 使用 MCP SDK
4. **监控和调试** - 集成到 Debug Server

## 需要帮助？

查看文档：
- 用户指南: `docs/cli/MCP-INTEGRATION.md`
- 技术规范: `docs/techspec/mcp-integration.md`
- 快速开始: `README-MCP.md`
