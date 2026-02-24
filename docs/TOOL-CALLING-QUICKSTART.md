# Native Tool Calling - Quick Start

## 🚀 快速开始

PonyBunny 现已支持原生 tool calling！LLM 可以直接调用工具，无需 JSON 解析。

## 安装和配置

### 1. 确保已构建项目

```bash
npm run build
```

### 2. 配置 API Keys

编辑 `~/.ponybunny/credentials.json`：

```json
{
  "providers": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx"
    }
  }
}
```

### 3. 运行快速测试

```bash
npm run test:tool-calling
```

## 测试命令

```bash
# 快速测试（推荐）
npm run test:tool-calling

# 完整 E2E demo
npm run test:tool-calling-demo

# 单元测试
npm run test:tool-calling-unit
```

## 预期输出

```
🧪 Quick Tool Calling Test

📦 Available tools: web_search, find_skills

=== Testing Tool Calling ===

📤 Sending request to LLM...

✅ Response received!

📊 Response Details:
  Model: claude-3-5-sonnet-20241022
  Tokens used: 120
  Finish reason: tool_calls

🔧 Tool Calls Detected:
  ✓ web_search
    ID: toolu_01ABC123
    Arguments: {"query":"weather in Shanghai today"}
    Parsed: {
      "query": "weather in Shanghai today"
    }

🔄 Simulating tool execution...
  ✓ Executed web_search

📤 Sending tool results back to LLM...

✅ Final response received!

📊 Final Response:
  Tokens used: 85
  Finish reason: stop

💬 Final Content:
   Based on the search results, the weather in Shanghai today is 25°C and sunny with light clouds. The air quality is good.

✅ Test completed successfully!
```

## 支持的功能

- ✅ 原生 tool calling（Anthropic, OpenAI, Gemini）
- ✅ Thinking mode（推理过程可见）
- ✅ Streaming（实时输出）
- ✅ 多轮工具调用
- ✅ 工具参数验证

## 可用工具

### Core Tools
- `read` - 读取文件
- `write` - 写入文件
- `edit` - 编辑文件
- `exec` - 执行命令
- `list_dir` - 列出目录
- `search` - 搜索文件

### Domain Tools
- `web_search` - 网络搜索
- `find_skills` - 查找技能

## 故障排除

### 问题：测试失败，提示 API key 错误

**解决方案：**
1. 检查 `~/.ponybunny/credentials.json` 是否存在
2. 确认 API key 正确
3. 确认 endpoint 已启用（`"enabled": true`）

### 问题：LLM 不调用工具

**可能原因：**
- 模型不支持工具调用
- 提示词不够明确

**解决方案：**
- 使用支持工具调用的模型（Claude 3.5, GPT-4）
- 使用更明确的提示词（如 "Search for..."）

### 问题：Thinking 内容为空

**解决方案：**
- 使用支持 thinking 的模型（Claude 3.5 with extended thinking, OpenAI o1）
- 在 `llm-config.json` 中设置 `"thinking": true`

## 更多信息

- 📖 [完整测试指南](docs/testing/TOOL-CALLING-TESTING.md)
- 📋 [实现总结](docs/TOOL-CALLING-SUMMARY.md)
- 📝 [实现计划](.claude/plan.md)

## 下一步

1. ✅ 运行测试验证功能
2. 🔧 实现真实的工具执行
3. 🎨 在 UI 中显示工具调用过程
4. 📊 添加工具调用监控

---

**Status**: ✅ Ready to Use
**Version**: 1.0.0
**Last Updated**: 2026-02-09
