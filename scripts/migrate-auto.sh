#!/bin/bash

# SDK 测试和迁移自动化脚本（非交互式版本）
# 用途：自动完成 SDK 测试验证和代码迁移

set -e  # 遇到错误立即退出

echo "=========================================="
echo "BSC Trading SDK 自动迁移脚本"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目路径
PLUGIN_DIR="$(pwd)"
SDK_DIR="../bsc-trading-sdk"

# 检查目录
if [ ! -d "$SDK_DIR" ]; then
    echo -e "${RED}错误: SDK 目录不存在: $SDK_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 项目目录检查通过${NC}"
echo ""

# ==========================================
# 阶段 1: 验证 SDK 测试
# ==========================================

echo "=========================================="
echo "阶段 1: 验证 SDK 测试"
echo "=========================================="
echo ""

cd "$SDK_DIR"

# 1.1 运行所有平台测试
echo "1.1 运行所有平台测试..."
npm run test:run -- \
  packages/flap/src/__tests__/platform.test.ts \
  packages/fourmeme/src/__tests__/platform.test.ts \
  packages/luna/src/__tests__/platform.test.ts \
  packages/pancakeswap/src/__tests__/v2.test.ts \
  packages/pancakeswap/src/__tests__/v3.test.ts \
  > /tmp/sdk-test-result.log 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 所有测试通过${NC}"
    TEST_COUNT=$(grep "Tests" /tmp/sdk-test-result.log | grep "passed" | awk '{print $2}')
    echo "通过测试数: $TEST_COUNT"
else
    echo -e "${RED}✗ 测试失败${NC}"
    cat /tmp/sdk-test-result.log
    exit 1
fi
echo ""

# 1.2 运行覆盖率测试
echo "1.2 运行覆盖率测试..."
npm run test:coverage > /tmp/sdk-coverage.log 2>&1 || true
COVERAGE=$(grep "All files" /tmp/sdk-coverage.log | awk '{print $2}' || echo "未知")
echo -e "${YELLOW}测试覆盖率: $COVERAGE${NC}"
echo ""

echo -e "${GREEN}✓ SDK 测试验证完成${NC}"
echo ""

# ==========================================
# 阶段 2: 分析 trading-channels.ts 使用情况
# ==========================================

echo "=========================================="
echo "阶段 2: 分析 trading-channels.ts"
echo "=========================================="
echo ""

cd "$PLUGIN_DIR"

# 2.1 检查文件是否存在
if [ ! -f "src/shared/trading-channels.ts" ]; then
    echo -e "${YELLOW}trading-channels.ts 已不存在，跳过此阶段${NC}"
    echo ""
else
    # 2.2 备份文件
    echo "2.1 备份 trading-channels.ts..."
    cp src/shared/trading-channels.ts src/shared/trading-channels.ts.backup
    echo -e "${GREEN}✓ 备份完成: src/shared/trading-channels.ts.backup${NC}"
    echo ""

    # 2.3 检查使用情况
    echo "2.2 检查 trading-channels.ts 使用情况..."
    echo "搜索导入语句..."
    grep -rn "from.*trading-channels\|import.*getChannel" src --include="*.ts" --include="*.tsx" || echo "未找到使用"
    echo ""

    # 2.4 统计使用次数
    USAGE_COUNT=$(grep -r "from.*trading-channels\|import.*getChannel" src --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' ')
    echo "发现 $USAGE_COUNT 处使用"
    echo ""

    if [ "$USAGE_COUNT" -eq "0" ]; then
        echo -e "${GREEN}✓ 没有发现使用，可以安全删除${NC}"
        echo ""

        # 2.5 删除文件
        echo "2.3 删除 trading-channels.ts..."
        rm src/shared/trading-channels.ts
        echo -e "${GREEN}✓ 文件已删除${NC}"
        echo ""
    else
        echo -e "${YELLOW}⚠ 发现 $USAGE_COUNT 处使用，需要手动处理${NC}"
        echo "请检查上述文件并移除对 trading-channels.ts 的依赖"
        echo ""
    fi
fi

# ==========================================
# 阶段 3: 构建验证
# ==========================================

echo "=========================================="
echo "阶段 3: 构建验证"
echo "=========================================="
echo ""

cd "$PLUGIN_DIR"

# 3.1 构建插件
echo "3.1 构建插件..."
npm run build > /tmp/plugin-build.log 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 构建成功${NC}"
    if [ -f "extension/dist/background.js" ]; then
        BUILD_SIZE=$(ls -lh extension/dist/background.js | awk '{print $5}')
        echo "构建产物大小: $BUILD_SIZE"
    fi
else
    echo -e "${RED}✗ 构建失败${NC}"
    echo "查看日志: /tmp/plugin-build.log"
    tail -50 /tmp/plugin-build.log
    exit 1
fi
echo ""

# 3.2 计算代码统计
echo "3.2 计算代码统计..."
LINES_TOTAL=$(find src -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
FILES_TOTAL=$(find src -name "*.ts" -o -name "*.tsx" | wc -l | tr -d ' ')
echo "总代码行数: $LINES_TOTAL"
echo "总文件数: $FILES_TOTAL"
echo ""

# ==========================================
# 完成
# ==========================================

echo ""
echo "=========================================="
echo "迁移完成！"
echo "=========================================="
echo ""
echo "总结:"
echo "  - SDK 测试: $TEST_COUNT 个测试通过"
echo "  - 测试覆盖率: $COVERAGE"
echo "  - 插件代码行数: $LINES_TOTAL"
echo "  - 插件文件数: $FILES_TOTAL"
if [ -f "extension/dist/background.js" ]; then
    echo "  - 构建产物: $BUILD_SIZE"
fi
echo ""
echo -e "${GREEN}✓ 所有阶段完成${NC}"
echo ""
echo "下一步建议:"
echo "  1. 测试插件功能是否正常"
echo "  2. 检查是否有遗漏的 trading-channels.ts 引用"
echo "  3. 提交代码变更"
echo ""
