# 文档归档指南

本指南说明如何管理和归档项目开发文档。

## 📚 文档分类

### 永久保留文档（根目录）

这些文档应该始终保留在项目根目录：

- `README.md` - 项目介绍
- `CHANGELOG.md` - 变更日志
- `CONTRIBUTING.md` - 贡献指南
- `LICENSE` - 许可证
- `CODE_OF_CONDUCT.md` - 行为准则
- `SECURITY.md` - 安全政策

### 用户文档（docs/ 目录）

面向用户的文档应该保留在 `docs/` 目录：

- `docs/guides/` - 使用指南
- `docs/api/` - API 文档
- `docs/QUICK_START.md` - 快速开始
- `docs/MIGRATION_GUIDE.md` - 迁移指南

### 开发文档（需要归档）

临时性的开发文档应该在完成后归档：

- `*_PLAN.md` - 计划文档
- `*_COMPLETE.md` - 完成报告
- `*_ANALYSIS.md` - 分析文档
- `*_SUMMARY.md` - 总结文档
- `*_REPORT.md` - 报告文档
- `*_PROGRESS.md` - 进度文档
- `*_IMPLEMENTATION.md` - 实现文档
- `*_INTEGRATION.md` - 集成文档
- `*_REGISTRATION.md` - 注册文档
- `*_FIX*.md` - 修复文档
- `*_MIGRATION*.md` - 迁移文档
- `*_REFACTORING*.md` - 重构文档
- `*_IMPACT*.md` - 影响分析文档
- `*_STAGE*.md` - 阶段文档

## 📦 归档流程

### 自动归档（推荐）

使用自动归档脚本：

```bash
# 插件项目
npm run archive-docs

# SDK 项目
pnpm run archive-docs
```

脚本会：
1. 自动查找需要归档的文档
2. 显示文档列表供确认
3. 移动文档到 `docs/archive/YYYY-MM/` 目录
4. 自动创建归档索引

### 手动归档

如果需要手动归档：

```bash
# 1. 创建归档目录
mkdir -p docs/archive/$(date +%Y-%m)

# 2. 移动文档
mv YOUR_DOC.md docs/archive/$(date +%Y-%m)/

# 3. 更新归档索引
# 编辑 docs/archive/YYYY-MM/README.md
```

## 📅 归档时机

### 何时归档

- ✅ 任务完成后的总结文档
- ✅ 已执行完成的计划文档
- ✅ 已应用到代码的分析文档
- ✅ 临时性的开发记录
- ✅ 已过时的设计文档

### 何时不归档

- ❌ 正在进行的任务文档
- ❌ 未来计划文档
- ❌ 用户文档（使用指南、API 文档等）
- ❌ 项目核心文档（README、CHANGELOG 等）

## 🗂️ 归档结构

```
docs/
├── archive/
│   ├── 2026-02/
│   │   ├── README.md              # 归档索引
│   │   ├── TASK_COMPLETE.md       # 归档的文档
│   │   └── ...
│   ├── 2026-03/
│   │   ├── README.md
│   │   └── ...
│   └── ...
├── guides/                         # 用户指南（不归档）
├── api/                           # API 文档（不归档）
└── ...
```

## 🔍 查找归档文档

### 按月份查找

```bash
# 查看 2026 年 2 月的归档
ls docs/archive/2026-02/

# 查看归档索引
cat docs/archive/2026-02/README.md
```

### 按关键词查找

```bash
# 在所有归档中搜索关键词
grep -r "关键词" docs/archive/

# 查找特定类型的文档
find docs/archive/ -name "*_PLAN.md"
```

### 查看归档统计

```bash
# 统计归档文档数量
find docs/archive/ -name "*.md" -not -name "README.md" | wc -l

# 按月份统计
for dir in docs/archive/*/; do
  count=$(find "$dir" -name "*.md" -not -name "README.md" | wc -l)
  echo "$(basename $dir): $count 个文档"
done
```

## 🔄 自动归档脚本

### 脚本功能

`scripts/archive-docs.sh` 提供以下功能：

1. **自动识别**: 根据文件名模式自动识别需要归档的文档
2. **排除保护**: 自动排除重要文档（README、CHANGELOG 等）
3. **交互确认**: 显示文档列表，等待用户确认
4. **创建索引**: 自动创建归档索引文件
5. **防止覆盖**: 如果目标文件已存在，跳过并提示

### 脚本用法

```bash
# 归档到当前月份
npm run archive-docs

# 归档到指定月份
bash scripts/archive-docs.sh 2026-03
```

### 自定义归档规则

编辑 `scripts/archive-docs.sh`，修改 `ARCHIVE_PATTERNS` 数组：

```bash
ARCHIVE_PATTERNS=(
  "*_PLAN.md"
  "*_COMPLETE.md"
  # 添加你的模式
  "*_YOUR_PATTERN.md"
)
```

## 📝 归档索引

每个归档目录都应该有一个 `README.md` 索引文件，包含：

- 归档日期
- 文档列表
- 文档分类
- 统计信息
- 相关链接

示例：

```markdown
# 开发文档归档 - 2026年2月

## 📅 归档日期
2026-02-12

## 📚 文档列表

### SDK 集成相关
1. **SDK_INTEGRATION_COMPLETE.md** - SDK 集成完成报告

### 配置重构相关
2. **CONFIG_REFACTORING_PLAN.md** - 配置重构计划

## 📊 统计信息
- 总文档数: 10
- SDK 集成: 4 篇
- 配置重构: 5 篇
```

## 🎯 最佳实践

### 1. 及时归档

任务完成后立即归档相关文档，避免根目录文档堆积。

### 2. 保持索引更新

归档时确保更新归档索引，方便后续查找。

### 3. 使用描述性文件名

文档命名应该清晰描述内容和目的：

- ✅ `CONFIG_REFACTORING_PLAN.md`
- ✅ `SDK_INTEGRATION_COMPLETE.md`
- ❌ `PLAN.md`
- ❌ `DOC1.md`

### 4. 定期清理

每月检查一次根目录，归档已完成的开发文档。

### 5. 保留重要信息

归档前确保重要信息已经：
- 更新到 CHANGELOG.md
- 记录到用户文档
- 应用到代码中

## 🔗 相关资源

- [项目 README](../README.md)
- [贡献指南](../CONTRIBUTING.md)
- [变更日志](../CHANGELOG.md)

## ❓ 常见问题

### Q: 归档的文档还能访问吗？

A: 可以。归档的文档仍然在 Git 仓库中，可以通过 `docs/archive/` 目录访问。

### Q: 如果误归档了重要文档怎么办？

A: 可以从归档目录移回根目录：

```bash
mv docs/archive/YYYY-MM/IMPORTANT_DOC.md ./
```

### Q: 归档脚本会删除文档吗？

A: 不会。脚本只是移动文档到归档目录，不会删除任何内容。

### Q: 可以归档到自定义目录吗？

A: 可以。手动移动文档到任何目录，但建议使用标准的 `docs/archive/YYYY-MM/` 结构。

### Q: 归档的文档会影响搜索吗？

A: 不会。归档的文档仍然可以通过 `grep`、`find` 等工具搜索。

---

**最后更新**: 2026-02-12
