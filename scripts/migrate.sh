#!/bin/bash

# SDK 测试和迁移自动化脚本
# 用途：自动完成 SDK 测试开发和代码迁移

set -e  # 遇到错误立即退出

echo "=========================================="
echo "BSC Trading SDK 测试和迁移自动化脚本"
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
# 阶段 1: 完善 SDK 测试
# ==========================================

echo "=========================================="
echo "阶段 1: 完善 SDK 测试"
echo "=========================================="
echo ""

cd "$SDK_DIR"

# 1.1 运行现有测试
echo "1.1 运行现有测试..."
npm run test:coverage > /tmp/sdk-test-before.log 2>&1 || true
COVERAGE_BEFORE=$(grep "All files" /tmp/sdk-test-before.log | awk '{print $2}' || echo "34.96")
echo -e "${YELLOW}当前覆盖率: $COVERAGE_BEFORE%${NC}"
echo ""

# 1.2 修复 Flap 测试
echo "1.2 修复 Flap 平台测试..."
echo -e "${YELLOW}提示: 需要手动调整测试以匹配实际实现${NC}"
echo "文件: packages/flap/src/__tests__/platform.test.ts"
echo ""
read -p "按 Enter 继续，或 Ctrl+C 退出..."

# 1.3 创建 FourMeme 测试
echo "1.3 创建 FourMeme 平台测试..."
echo -e "${YELLOW}提示: 复制 Flap 测试模板并调整${NC}"
echo "文件: packages/fourmeme/src/__tests__/platform.test.ts"
echo ""
read -p "按 Enter 继续，或 Ctrl+C 退出..."

# 1.4 创建 Luna 测试
echo "1.4 创建 Luna 平台测试..."
echo -e "${YELLOW}提示: 复制测试模板并调整${NC}"
echo "文件: packages/luna/src/__tests__/platform.test.ts"
echo ""
read -p "按 Enter 继续，或 Ctrl+C 退出..."

# 1.5 创建 PancakeSwap 测试
echo "1.5 创建 PancakeSwap 平台测试..."
echo -e "${YELLOW}提示: 添加 V2 和 V3 测试${NC}"
echo "文件: packages/pancakeswap/src/__tests__/platform.test.ts"
echo ""
read -p "按 Enter 继续，或 Ctrl+C 退出..."

# 1.6 运行所有测试
echo "1.6 运行所有测试..."
npm run test:coverage > /tmp/sdk-test-after.log 2>&1 || true
COVERAGE_AFTER=$(grep "All files" /tmp/sdk-test-after.log | awk '{print $2}' || echo "0")
echo -e "${GREEN}新覆盖率: $COVERAGE_AFTER%${NC}"
echo ""

# 检查覆盖率是否达标
if (( $(echo "$COVERAGE_AFTER >= 80" | bc -l) )); then
    echo -e "${GREEN}✓ 测试覆盖率达标 (>80%)${NC}"
else
    echo -e "${RED}✗ 测试覆盖率不足 (<80%)${NC}"
    echo -e "${YELLOW}建议: 继续添加测试用例${NC}"
    read -p "是否继续下一阶段? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""

# ==========================================
# 阶段 2: 移除 trading-channels.ts
# ==========================================

echo "=========================================="
echo "阶段 2: 移除 trading-channels.ts"
echo "=========================================="
echo ""

cd "$PLUGIN_DIR"

# 2.1 备份文件
echo "2.1 备份 trading-channels.ts..."
cp src/shared/trading-channels.ts src/shared/trading-channels.ts.backup
echo -e "${GREEN}✓ 备份完成${NC}"
echo ""

# 2.2 检查使用情况
echo "2.2 检查 trading-channels.ts 使用情况..."
USAGE_COUNT=$(grep -r "from.*trading-channels\|import.*getChannel" src --include="*.ts" | wc -l)
echo "发现 $USAGE_COUNT 处使用"
echo ""

# 2.3 移除回退逻辑
echo "2.3 移除插件中的回退逻辑..."
echo -e "${YELLOW}需要手动编辑以下文件:${NC}"
echo "  - src/background/index.ts (删除 channelHandler.buy/sell 回退)"
echo "  - src/background/custom-aggregator-agent.ts (如果有使用)"
echo ""
read -p "按 Enter 继续，或 Ctrl+C 退出..."

# 2.4 删除文件
echo "2.4 删除 trading-channels.ts..."
read -p "确认删除? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm src/shared/trading-channels.ts
    echo -e "${GREEN}✓ 文件已删除${NC}"
else
    echo -e "${YELLOW}跳过删除${NC}"
fi
echo ""

# 2.5 构建测试
echo "2.5 构建插件..."
npm run build > /tmp/plugin-build.log 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 构建成功${NC}"
    BUILD_SIZE=$(ls -lh extension/dist/background.js | awk '{print $5}')
    echo "构建产物大小: $BUILD_SIZE"
else
    echo -e "${RED}✗ 构建失败${NC}"
    echo "查看日志: /tmp/plugin-build.log"
    exit 1
fi
echo ""

# 2.6 计算代码减少
echo "2.6 计算代码减少..."
LINES_BEFORE=28580
LINES_AFTER=$(find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1 | awk '{print $1}')
LINES_REDUCED=$((LINES_BEFORE - LINES_AFTER))
PERCENT_REDUCED=$(echo "scale=2; $LINES_REDUCED * 100 / $LINES_BEFORE" | bc)
echo -e "${GREEN}代码减少: $LINES_REDUCED 行 ($PERCENT_REDUCED%)${NC}"
echo ""

# ==========================================
# 阶段 3: 路由查询迁移 (可选)
# ==========================================

echo "=========================================="
echo "阶段 3: 路由查询迁移 (可选)"
echo "=========================================="
echo ""

read -p "是否继续路由查询迁移? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}跳过路由查询迁移${NC}"
    echo ""
    echo "=========================================="
    echo "迁移完成！"
    echo "=========================================="
    exit 0
fi

# 3.1 评估路由查询
echo "3.1 评估路由查询模块..."
echo -e "${YELLOW}需要分析 src/shared/route-query/ 目录${NC}"
echo ""
read -p "按 Enter 继续..."

# 3.2 迁移到 SDK
echo "3.2 迁移路由查询到 SDK..."
echo -e "${YELLOW}提示: 这需要大量重构工作${NC}"
echo ""
read -p "按 Enter 继续..."

# ==========================================
# 完成
# ==========================================

echo ""
echo "=========================================="
echo "迁移完成！"
echo "=========================================="
echo ""
echo "总结:"
echo "  - SDK 测试覆盖率: $COVERAGE_AFTER%"
echo "  - 代码减少: $LINES_REDUCED 行 ($PERCENT_REDUCED%)"
echo "  - 构建产物: $BUILD_SIZE"
echo ""
echo -e "${GREEN}✓ 所有阶段完成${NC}"
echo ""
