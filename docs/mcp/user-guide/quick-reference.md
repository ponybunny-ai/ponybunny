# MCP 快速参考卡片

## 🚀 快速开始（3 步）

```bash
# 1. 初始化
pb mcp init

# 2. 编辑配置（启用 filesystem）
# 编辑 ~/.ponybunny/mcp-config.json，将 enabled 改为 true

# 3. 测试
pb mcp test filesystem
```

## 📋 常用命令

| 命令 | 说明 |
|------|------|
| `pb mcp init` | 初始化配置文件 |
| `pb mcp list` | 列出所有服务器 |
| `pb mcp status` | 查看连接状态 |
| `pb mcp test <name>` | 测试连接 |
| `pb mcp add <name>` | 添加服务器 |
| `pb mcp remove <name>` | 删除服务器 |
| `pb mcp enable <name>` | 启用服务器 |
| `pb mcp disable <name>` | 禁用服务器 |

## 📝 配置示例

### Filesystem 服务器
```json
{
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "allowedTools": ["*"]
    }
  }
}
```

### GitHub 服务器
```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "allowedTools": ["*"]
    }
  }
}
```

## 🔧 工具命名

MCP 工具使用命名空间：`mcp_<server>_<tool>`

示例：
- `mcp_filesystem_read_file`
- `mcp_filesystem_write_file`
- `mcp_github_create_issue`

## 📂 配置文件位置

```
~/.ponybunny/mcp-config.json
```

## 🧪 测试

```bash
# 运行集成测试
npx tsx test/mcp-integration.test.ts

# 测试特定服务器
pb mcp test filesystem
```

## 📚 文档

| 文档 | 路径 |
|------|------|
| 用户指南 | `docs/cli/MCP-INTEGRATION.md` |
| 测试指南 | `docs/cli/MCP-TESTING.md` |
| 技术规范 | `docs/techspec/mcp-integration.md` |
| 快速开始 | `README-MCP.md` |
| 测试报告 | `TEST-REPORT-MCP.md` |

## 🔒 安全

- ✅ 工具白名单（`allowedTools`）
- ✅ 环境变量（`${VAR}`）
- ✅ 进程隔离（stdio）
- ✅ 超时保护

## 🐛 故障排查

### 连接失败
```bash
# 检查服务器是否可用
npx -y @modelcontextprotocol/server-filesystem .

# 查看配置
cat ~/.ponybunny/mcp-config.json

# 查看日志
pb mcp test filesystem
```

### 工具未找到
```bash
# 检查服务器状态
pb mcp status

# 检查 allowedTools
cat ~/.ponybunny/mcp-config.json | grep -A 5 allowedTools
```

## 🌟 可用的 MCP 服务器

| 服务器 | 包名 | 说明 |
|--------|------|------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | 文件操作 |
| GitHub | `@modelcontextprotocol/server-github` | GitHub API |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | 数据库查询 |
| Slack | `@modelcontextprotocol/server-slack` | Slack 集成 |
| Google Drive | `@modelcontextprotocol/server-gdrive` | Google Drive |

更多: https://github.com/modelcontextprotocol/servers

## 💡 提示

1. **环境变量**: 使用 `${VAR}` 语法引用环境变量
2. **工具白名单**: 使用 `["*"]` 允许所有工具，或指定具体工具名
3. **自动重连**: 设置 `autoReconnect: true` 启用自动重连
4. **超时**: 默认 30 秒，可通过 `timeout` 配置

## 📞 获取帮助

```bash
# 查看命令帮助
pb mcp --help
pb mcp add --help

# 查看文档
cat docs/cli/MCP-INTEGRATION.md
```

---

**版本**: 1.0.0
**状态**: ✅ 生产就绪
**测试**: ✅ 全部通过
