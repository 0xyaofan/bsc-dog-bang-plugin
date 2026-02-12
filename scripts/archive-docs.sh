#!/bin/bash

# 开发文档自动归档脚本
# 用法: ./scripts/archive-docs.sh [YYYY-MM]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取归档月份（默认为当前月份）
ARCHIVE_MONTH=${1:-$(date +%Y-%m)}
ARCHIVE_DIR="docs/archive/${ARCHIVE_MONTH}"

echo -e "${GREEN}📦 开发文档归档工具${NC}"
echo -e "${YELLOW}归档月份: ${ARCHIVE_MONTH}${NC}"
echo ""

# 创建归档目录
if [ ! -d "$ARCHIVE_DIR" ]; then
  echo -e "${YELLOW}创建归档目录: ${ARCHIVE_DIR}${NC}"
  mkdir -p "$ARCHIVE_DIR"
fi

# 定义需要归档的文档模式
# 这些是临时开发文档，完成后应该归档
ARCHIVE_PATTERNS=(
  "*_PLAN.md"
  "*_COMPLETE.md"
  "*_ANALYSIS.md"
  "*_SUMMARY.md"
  "*_REPORT.md"
  "*_PROGRESS.md"
  "*_IMPLEMENTATION.md"
  "*_INTEGRATION.md"
  "*_REGISTRATION.md"
  "*_FIX*.md"
  "*_MIGRATION*.md"
  "*_REFACTORING*.md"
  "*_IMPACT*.md"
  "*_STAGE*.md"
)

# 定义不应该归档的文档（保留在根目录）
EXCLUDE_PATTERNS=(
  "README.md"
  "CHANGELOG.md"
  "CONTRIBUTING.md"
  "LICENSE.md"
  "CODE_OF_CONDUCT.md"
  "SECURITY.md"
)

# 查找需要归档的文档
echo -e "${YELLOW}🔍 查找需要归档的文档...${NC}"
DOCS_TO_ARCHIVE=()

for pattern in "${ARCHIVE_PATTERNS[@]}"; do
  while IFS= read -r -d '' file; do
    # 检查文件是否在排除列表中
    filename=$(basename "$file")
    should_exclude=false

    for exclude in "${EXCLUDE_PATTERNS[@]}"; do
      if [ "$filename" = "$exclude" ]; then
        should_exclude=true
        break
      fi
    done

    # 检查文件是否已经在归档目录中
    if [[ "$file" == docs/archive/* ]]; then
      should_exclude=true
    fi

    if [ "$should_exclude" = false ]; then
      DOCS_TO_ARCHIVE+=("$file")
    fi
  done < <(find . -maxdepth 1 -name "$pattern" -type f -print0 2>/dev/null)
done

# 去重
DOCS_TO_ARCHIVE=($(printf '%s\n' "${DOCS_TO_ARCHIVE[@]}" | sort -u))

# 显示找到的文档
if [ ${#DOCS_TO_ARCHIVE[@]} -eq 0 ]; then
  echo -e "${GREEN}✅ 没有找到需要归档的文档${NC}"
  exit 0
fi

echo -e "${YELLOW}找到 ${#DOCS_TO_ARCHIVE[@]} 个文档需要归档:${NC}"
for doc in "${DOCS_TO_ARCHIVE[@]}"; do
  echo "  - $doc"
done
echo ""

# 询问用户确认
read -p "是否继续归档这些文档? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}❌ 已取消归档${NC}"
  exit 1
fi

# 移动文档到归档目录
echo -e "${YELLOW}📦 归档文档...${NC}"
ARCHIVED_COUNT=0

for doc in "${DOCS_TO_ARCHIVE[@]}"; do
  filename=$(basename "$doc")
  target="${ARCHIVE_DIR}/${filename}"

  if [ -f "$target" ]; then
    echo -e "${YELLOW}⚠️  跳过 ${filename} (已存在)${NC}"
  else
    mv "$doc" "$target"
    echo -e "${GREEN}✓ ${filename}${NC}"
    ((ARCHIVED_COUNT++))
  fi
done

echo ""
echo -e "${GREEN}✅ 归档完成！${NC}"
echo -e "${YELLOW}归档了 ${ARCHIVED_COUNT} 个文档到 ${ARCHIVE_DIR}${NC}"

# 检查是否需要创建归档索引
INDEX_FILE="${ARCHIVE_DIR}/README.md"
if [ ! -f "$INDEX_FILE" ]; then
  echo ""
  echo -e "${YELLOW}📝 创建归档索引...${NC}"

  cat > "$INDEX_FILE" << EOF
# 开发文档归档 - ${ARCHIVE_MONTH}

本目录包含 ${ARCHIVE_MONTH} 的开发文档归档。

## 📅 归档日期

$(date +%Y-%m-%d)

## 📚 文档列表

EOF

  # 列出所有归档的文档
  for doc in "${ARCHIVE_DIR}"/*.md; do
    if [ "$doc" != "$INDEX_FILE" ]; then
      filename=$(basename "$doc")
      echo "- **${filename}**" >> "$INDEX_FILE"
    fi
  done

  cat >> "$INDEX_FILE" << EOF

## 📊 统计信息

- 总文档数: ${ARCHIVED_COUNT}
- 归档日期: $(date +%Y-%m-%d)

## 📝 归档规则

开发文档在以下情况下会被归档：

1. 任务完成后的总结文档
2. 计划文档（已执行完成）
3. 分析文档（已应用到代码）
4. 临时性的开发记录

保留在根目录的文档：

- README.md
- CHANGELOG.md
- CONTRIBUTING.md
- LICENSE

## 🔄 自动归档

使用 \`npm run archive-docs\` 命令可以自动归档开发文档。
EOF

  echo -e "${GREEN}✓ 归档索引已创建${NC}"
fi

echo ""
echo -e "${GREEN}🎉 全部完成！${NC}"
