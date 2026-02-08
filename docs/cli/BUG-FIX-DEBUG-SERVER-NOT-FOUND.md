# Debug Server "Not Found" Bug Fix

## 问题

访问 `http://localhost:3001` 时显示 "Not found"，即使 Debug Server 正在运行。

## 根本原因

1. **错误的静态目录配置**：`pb debug web` 命令配置使用 `standalone` 目录，但 Next.js 没有生成这个目录
2. **index.html 位置错误**：API Server 在 `staticDir/index.html` 查找文件，但 Next.js 将其放在 `staticDir/app/index.html`

## 修复内容

### 1. 修复 CLI 命令的静态目录配置

**文件：** `src/cli/commands/debug.ts`

**修改前：**
```typescript
if (existsSync(webuiPath)) {
  staticDir = join(serverPath, '../webui/.next/standalone');
  console.log(chalk.green('✓ Using Next.js WebUI'));
}
```

**修改后：**
```typescript
const webuiServerPath = join(serverPath, '../webui/.next/server');

if (existsSync(webuiServerPath)) {
  // Use Next.js server output directory
  staticDir = webuiServerPath;
  console.log(chalk.green('✓ Using Next.js WebUI'));
} else if (existsSync(webuiPath)) {
  // Fallback to .next directory
  staticDir = webuiPath;
  console.log(chalk.yellow('⚠ Using Next.js build output (not optimized)'));
}
```

### 2. 修复 API Server 的 index.html 查找逻辑

**文件：** `debug-server/server/src/api-server.ts`

**修改前：**
```typescript
if (!existsSync(filePath)) {
  // For SPA, serve index.html for non-API routes
  const indexPath = resolve(staticDir, 'index.html');
  if (existsSync(indexPath)) {
    const content = readFileSync(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
  return;
}
```

**修改后：**
```typescript
if (!existsSync(filePath)) {
  // For SPA, serve index.html for non-API routes
  // Try multiple locations for index.html (Next.js puts it in app/ subdirectory)
  const indexPaths = [
    resolve(staticDir, 'index.html'),
    resolve(staticDir, 'app/index.html'),
    resolve(staticDir, '../static/index.html'),
  ];

  for (const indexPath of indexPaths) {
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
  return;
}
```

## Next.js 目录结构

```
debug-server/webui/.next/
├── server/
│   ├── app/
│   │   ├── index.html          ← 实际位置
│   │   ├── goals.html
│   │   ├── events.html
│   │   └── ...
│   ├── pages/
│   └── chunks/
├── static/
└── ...
```

## 测试结果

### 修复前
```bash
$ curl http://localhost:3001/
Not found
```

### 修复后
```bash
$ curl http://localhost:3001/
<!DOCTYPE html>
<html lang="en">
<head>
  <title>PonyBunny Debug Dashboard</title>
  ...
</head>
<body>
  <div class="flex h-screen">
    ...
  </div>
</body>
</html>
```

## 验证步骤

1. 停止旧的 Debug Server
   ```bash
   pkill -f "debug-server"
   ```

2. 重新构建
   ```bash
   npm run build:cli
   cd debug-server/server && npm run build
   ```

3. 启动 Debug Server
   ```bash
   pb debug web
   ```

4. 在浏览器访问
   ```
   http://localhost:3001
   ```

5. 应该看到 PonyBunny Debug Dashboard 界面

## 相关文件

- `src/cli/commands/debug.ts` - CLI 命令配置
- `debug-server/server/src/api-server.ts` - API Server 静态文件处理
- `debug-server/webui/.next/server/app/index.html` - Next.js 生成的 HTML

## 注意事项

1. Next.js 默认不生成 `standalone` 输出，需要在 `next.config.ts` 中配置 `output: 'standalone'`
2. 当前解决方案使用 Next.js 的 `server` 目录，这是标准构建输出
3. API Server 现在会尝试多个位置查找 `index.html`，提高兼容性

## 状态

✅ 已修复并验证
✅ Debug Server Web UI 正常工作
✅ 可以在浏览器访问 http://localhost:3001
