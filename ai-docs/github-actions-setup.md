# GitHub Actions 和测试徽章设置指南

## CI/CD 已配置 ✅

GitHub Actions 已经配置完成，会在以下情况自动运行测试：
- 每次推送到 `main` 分支
- 每次创建 Pull Request

## 测试配置

### 测试矩阵
- Node.js 18.x
- Node.js 20.x

### 测试步骤
1. Checkout 代码
2. 设置 Node.js 环境
3. 安装依赖
4. 运行测试
5. 生成覆盖率报告
6. 上传覆盖率到 Codecov（可选）

## 添加测试状态徽章到 README

在你的 `README.md` 文件顶部添加以下徽章：

```markdown
# BSC Dog Bang Plugin

[![Tests](https://github.com/YOUR_USERNAME/bsc-dog-bang-plugin/actions/workflows/test.yml/badge.svg)](https://github.com/YOUR_USERNAME/bsc-dog-bang-plugin/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/YOUR_USERNAME/bsc-dog-bang-plugin/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_USERNAME/bsc-dog-bang-plugin)

Binance Smart Chain 代币交易插件，直接与Four/Flap/PancakeSwap等合约交互。
```

**注意**：将 `YOUR_USERNAME` 替换为你的 GitHub 用户名。

## 查看测试结果

1. 推送代码到 GitHub
2. 访问仓库的 "Actions" 标签页
3. 查看测试运行状态和结果

## 本地测试命令

```bash
# 运行所有测试
npm test

# 运行测试（非 watch 模式）
npm run test:run

# 运行测试并查看 UI
npm run test:ui

# 生成覆盖率报告
npm run coverage
```

## 覆盖率报告

覆盖率报告会生成在 `coverage/` 目录：
- `coverage/index.html` - HTML 格式的覆盖率报告
- `coverage/coverage-final.json` - JSON 格式的覆盖率数据

打开 HTML 报告：
```bash
open coverage/index.html
```

## Codecov 设置（可选）

如果你想使用 Codecov 追踪覆盖率：

1. 访问 https://codecov.io/
2. 使用 GitHub 账号登录
3. 添加你的仓库
4. 获取 CODECOV_TOKEN
5. 在 GitHub 仓库设置中添加 Secret：
   - 名称：`CODECOV_TOKEN`
   - 值：从 Codecov 获取的 token

## 测试覆盖率目标

- **当前**：24 个测试用例
- **短期目标**：覆盖率 > 70%
- **中期目标**：覆盖率 > 85%
- **长期目标**：覆盖率 > 90%

## 故障排查

### 测试失败
如果 CI 测试失败：
1. 查看 Actions 日志
2. 在本地运行 `npm test` 复现问题
3. 修复问题后重新提交

### 覆盖率上传失败
如果覆盖率上传失败（这是正常的，因为是可选的）：
- 检查 CODECOV_TOKEN 是否正确设置
- 或者移除 Codecov 步骤（在 `.github/workflows/test.yml` 中）

---

**创建日期**：2026-02-08
**状态**：✅ 已配置
