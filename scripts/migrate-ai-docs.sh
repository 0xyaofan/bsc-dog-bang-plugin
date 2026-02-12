#!/bin/bash

# ai-docs 迁移到归档脚本
# 将 ai-docs 中的文档按照归档规范整理到 docs/archive/

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}📦 ai-docs 迁移工具${NC}"
echo ""

# 检查 ai-docs 目录是否存在
if [ ! -d "ai-docs" ]; then
  echo -e "${YELLOW}⚠️  ai-docs 目录不存在，跳过${NC}"
  exit 0
fi

# 创建归档目录
ARCHIVE_BASE="docs/archive"
mkdir -p "$ARCHIVE_BASE"

# 按月份组织文档
# 根据文件修改时间确定归档月份
echo -e "${BLUE}🔍 分析 ai-docs 文档...${NC}"

# 统计信息
TOTAL_FILES=0
ARCHIVED_FILES=0

# 处理 ai-docs 根目录的文档
if [ -d "ai-docs" ]; then
  # 查找所有 .md 文件（排除 README.md）
  while IFS= read -r -d '' file; do
    ((TOTAL_FILES++))

    # 获取文件修改时间（月份）
    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS
      FILE_MONTH=$(stat -f "%Sm" -t "%Y-%m" "$file")
    else
      # Linux
      FILE_MONTH=$(stat -c "%y" "$file" | cut -d'-' -f1,2)
    fi

    # 创建对应月份的归档目录
    MONTH_DIR="$ARCHIVE_BASE/$FILE_MONTH"
    mkdir -p "$MONTH_DIR"

    # 获取文件名
    FILENAME=$(basename "$file")

    # 跳过 README.md
    if [ "$FILENAME" = "README.md" ]; then
      continue
    fi

    # 移动文件
    TARGET="$MONTH_DIR/$FILENAME"
    if [ -f "$TARGET" ]; then
      echo -e "${YELLOW}⚠️  跳过 $FILENAME (已存在于 $FILE_MONTH)${NC}"
    else
      mv "$file" "$TARGET"
      echo -e "${GREEN}✓ $FILENAME → $FILE_MONTH/${NC}"
      ((ARCHIVED_FILES++))
    fi
  done < <(find ai-docs -maxdepth 1 -name "*.md" -type f -print0)

  # 处理子目录
  for subdir in ai-docs/*/; do
    if [ -d "$subdir" ]; then
      SUBDIR_NAME=$(basename "$subdir")
      echo -e "${BLUE}📁 处理子目录: $SUBDIR_NAME${NC}"

      while IFS= read -r -d '' file; do
        ((TOTAL_FILES++))

        # 获取文件修改时间
        if [[ "$OSTYPE" == "darwin"* ]]; then
          FILE_MONTH=$(stat -f "%Sm" -t "%Y-%m" "$file")
        else
          FILE_MONTH=$(stat -c "%y" "$file" | cut -d'-' -f1,2)
        fi

        MONTH_DIR="$ARCHIVE_BASE/$FILE_MONTH"
        mkdir -p "$MONTH_DIR"

        FILENAME=$(basename "$file")

        # 跳过 README.md
        if [ "$FILENAME" = "README.md" ]; then
          continue
        fi

        # 添加子目录前缀避免冲突
        PREFIX="${SUBDIR_NAME}_"
        TARGET="$MONTH_DIR/${PREFIX}${FILENAME}"

        if [ -f "$TARGET" ]; then
          echo -e "${YELLOW}⚠️  跳过 $SUBDIR_NAME/$FILENAME (已存在)${NC}"
        else
          mv "$file" "$TARGET"
          echo -e "${GREEN}✓ $SUBDIR_NAME/$FILENAME → $FILE_MONTH/${NC}"
          ((ARCHIVED_FILES++))
        fi
      done < <(find "$subdir" -name "*.md" -type f -print0)
    fi
  done
fi

echo ""
echo -e "${GREEN}✅ 迁移完成${NC}"
echo -e "${YELLOW}总文件数: $TOTAL_FILES${NC}"
echo -e "${YELLOW}已归档: $ARCHIVED_FILES${NC}"
echo ""

# 删除空的 ai-docs 目录
if [ -d "ai-docs" ]; then
  # 检查是否还有文件
  REMAINING=$(find ai-docs -type f | wc -l)
  if [ "$REMAINING" -eq 0 ]; then
    echo -e "${BLUE}🗑️  删除空的 ai-docs 目录${NC}"
    rm -rf ai-docs
    echo -e "${GREEN}✓ ai-docs 已删除${NC}"
  else
    echo -e "${YELLOW}⚠️  ai-docs 中还有 $REMAINING 个文件，保留目录${NC}"
  fi
fi

echo ""
echo -e "${GREEN}🎉 完成！${NC}"
echo -e "${BLUE}归档位置: $ARCHIVE_BASE/${NC}"
