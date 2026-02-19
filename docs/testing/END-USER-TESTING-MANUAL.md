# PonyBunny 最终用户测试操作手册

本手册用于最终用户在本地验证 PonyBunny 的核心功能是否可用。

## 1. 适用对象

- 首次接触 PonyBunny 的最终用户
- 需要做版本验收或冒烟测试的使用者
- 希望确认本地环境、配置和服务运行是否正常的用户

## 2. 前置条件

请先确认：

- 已安装 Node.js（建议使用项目要求版本）
- 已完成项目安装与构建
- 已通过 `pb init` 初始化配置
- 已在 `~/.ponybunny/credentials.json` 中配置至少一个可用 LLM API Key

常用准备命令：

```bash
npm install
npm run build
npm run build:cli
pb init
pb status
```

## 3. 快速冒烟测试（5-10 分钟）

### 步骤 A：启动核心服务

```bash
pb service start all
pb service status
```

预期结果：

- Gateway 与 Scheduler 均为 Running
- 无阻塞性错误（少量环境 warning 可接受）

### 步骤 B：提交一个最小任务

```bash
pb work "请创建一个 hello world 的 TypeScript 示例，并说明如何运行"
```

预期结果：

- 任务可被接收并进入执行流程
- 最终返回结构化输出（不是进程崩溃或长时间无响应）

### 步骤 C：查看服务日志

```bash
pb service logs gateway -n 50
pb service logs scheduler -n 50
```

预期结果：

- 能看到近期运行日志
- 无持续刷新的致命错误

### 步骤 D：停止服务

```bash
pb service stop all
pb service status
```

预期结果：

- 服务状态变为未运行

## 4. 标准验收测试清单

建议按下表执行并记录结果：

| 测试项 | 操作 | 通过标准 |
|---|---|---|
| 配置有效性 | `pb status` | 配置文件可读、认证状态正常 |
| 服务启动 | `pb service start all` | 两个服务均成功启动 |
| 服务状态 | `pb service status` | 状态信息完整且与实际一致 |
| 基础任务执行 | `pb work "..."` | 能返回有效结果，无崩溃 |
| 日志可观测性 | `pb service logs ...` | 可查看最近日志，定位问题有依据 |
| 服务停止 | `pb service stop all` | 服务可正常停止 |

## 5. 常见问题与处理

### 1) `pb status` 显示未认证或无可用模型

处理：

- 检查 `~/.ponybunny/credentials.json` 是否填写正确
- 再次执行 `pb status` 验证

### 2) 服务启动失败

处理：

- 查看日志：`pb service logs gateway -n 100` / `pb service logs scheduler -n 100`
- 检查端口/Socket 是否被占用
- 尝试先停止再启动：`pb service stop all && pb service start all`

### 3) 任务长时间无结果

处理：

- 先看 Scheduler 日志是否存在持续报错
- 确认 API Key 可用且网络可访问对应模型端点

## 6. 回归建议

每次升级后，建议至少执行一次第 3 节“快速冒烟测试”。

若用于发布前验收，建议执行第 4 节全量清单，并保留以下信息：

- 执行时间
- 执行人
- 命令与结果摘要
- 异常日志片段
