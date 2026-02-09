#!/bin/bash

echo "🧹 PonyBunny 清理脚本 - 移除旧的 -enhanced 文件"
echo ""

# 删除 -enhanced 文件
echo "1️⃣ 删除 -enhanced 文件..."
rm -f src/app/lifecycle/planning/planning-service-enhanced.ts
rm -f src/app/lifecycle/execution/execution-service-enhanced.ts
rm -f src/app/conversation/session-manager-enhanced.ts
rm -f src/main-enhanced.ts
rm -f start-enhanced.sh

echo "   ✅ 已删除 -enhanced 文件"

# 用增强版替换 react-integration.ts
echo ""
echo "2️⃣ 替换 react-integration.ts..."
if [ -f src/autonomy/react-integration-enhanced.ts ]; then
    cp src/autonomy/react-integration-enhanced.ts src/autonomy/react-integration.ts
    rm -f src/autonomy/react-integration-enhanced.ts
    echo "   ✅ 已替换 react-integration.ts"
else
    echo "   ⚠️  react-integration-enhanced.ts 不存在"
fi

# 删除临时文档
echo ""
echo "3️⃣ 清理临时文档..."
rm -f docs/QUICK-START-ENHANCED.md
rm -f DELIVERY.md

echo "   ✅ 已清理临时文档"

echo ""
echo "✅ 清理完成！"
echo ""
echo "📝 下一步："
echo "   1. 运行: npm run build"
echo "   2. 运行: npm start"
echo "   3. 测试系统"
echo ""
