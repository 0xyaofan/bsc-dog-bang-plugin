# 部署手册

本文档介绍如何构建、打包和发布 BSC 打狗棒 Chrome 扩展。

## 目录

- [构建流程](#构建流程)
- [打包发布](#打包发布)
- [版本管理](#版本管理)
- [发布到 GitHub Releases](#发布到-github-releases)
- [Chrome Web Store 发布](#chrome-web-store-发布)
- [CI/CD 配置](#cicd-配置)

## 构建流程

### 开发环境构建

**用于开发和测试**:

```bash
# 安装依赖
npm install

# 开发模式（启动 Vite dev server）
npm run dev

# 构建开发版本
npm run build
```

构建产物位于 `extension/dist/` 目录。

### 生产环境构建

**用于发布**:

```bash
# 清理旧构建
rm -rf extension/dist

# 生产构建
npm run build

# 验证构建
ls -la extension/dist
```

**构建产物清单**:
```
extension/
├── dist/
│   ├── background.js        # 后台脚本
│   ├── content.js           # 内容脚本
│   ├── offscreen.js         # 离屏文档
│   ├── popup.html           # 弹窗页面
│   ├── sidepanel.html       # 侧边栏页面
│   └── assets/              # 资源文件
│       ├── *.css
│       └── *.js
├── manifest.json
├── content-wrapper.js
├── styles.css
├── offscreen.html
├── popup.html
├── sidepanel.html
└── icons/
    ├── 16x16.png
    ├── 48x48.png
    └── 128x128.png
```

### 构建优化

#### 生产环境配置

在 `vite.config.ts` 中：

```typescript
export default defineConfig({
  build: {
    minify: 'terser',              // 代码压缩
    sourcemap: false,              // 生产环境不生成 sourcemap
    rollupOptions: {
      output: {
        manualChunks: {
          // 代码分割策略
          vendor: ['react', 'react-dom'],
          viem: ['viem']
        }
      }
    }
  }
});
```

#### 资源优化

```bash
# 压缩图标
# 使用 ImageOptim, TinyPNG 等工具压缩 icons/ 目录下的图片

# 检查构建大小
du -sh extension/dist
```

## 打包发布

### 创建发布包

#### 方法 1: 手动打包

```bash
# 1. 构建项目
npm run build

# 2. 创建 release 目录和 zip 包
mkdir -p release
cd extension
zip -r ../release/bsc-dog-bang-plugin-v1.0.0.zip . -x "*.DS_Store" -x "__MACOSX*"
cd ..

# 3. 验证 zip 包
unzip -l release/bsc-dog-bang-plugin-v1.0.0.zip
```

#### 方法 2: 使用构建脚本

创建 `scripts/build-release.sh`:

```bash
#!/bin/bash
# ... (脚本内容见 scripts/build-release.sh)
```

使用脚本：

```bash
chmod +x scripts/build-release.sh
./scripts/build-release.sh
```

构建完成后，所有 release 文件将生成在 `release/` 目录中：
- `release/bsc-dog-bang-plugin-v{version}.zip`
- `release/checksums.txt`

### 发布检查清单

在发布前，请确保：

- [ ] 代码已提交到 Git
- [ ] 版本号已更新（package.json, manifest.json）
- [ ] CHANGELOG.md 已更新
- [ ] 所有功能已测试
- [ ] 没有调试代码（console.log, debugger）
- [ ] .env 文件已排除
- [ ] 图标文件完整
- [ ] manifest.json 配置正确
- [ ] 构建成功无错误
- [ ] 扩展在 Chrome 中可正常加载

## 版本管理

### 版本号规范

遵循 [Semantic Versioning](https://semver.org/) (语义化版本):

```
MAJOR.MINOR.PATCH

1.0.0 → 1.0.1 (补丁版本 - Bug 修复)
1.0.1 → 1.1.0 (次版本 - 新功能)
1.1.0 → 2.0.0 (主版本 - 破坏性更改)
```

### 更新版本号

#### 同时更新两个文件

**package.json**:
```json
{
  "version": "1.0.1"
}
```

**extension/manifest.json**:
```json
{
  "version": "1.0.1"
}
```

#### 使用 npm version

```bash
# 补丁版本 (1.0.0 → 1.0.1)
npm version patch

# 次版本 (1.0.0 → 1.1.0)
npm version minor

# 主版本 (1.0.0 → 2.0.0)
npm version major
```

**注意**: npm version 只会更新 package.json，需要手动更新 manifest.json。

### Git 标签

```bash
# 创建标签
git tag -a v1.0.0 -m "Release version 1.0.0"

# 推送标签
git push origin v1.0.0

# 推送所有标签
git push --tags
```

## 发布到 GitHub Releases

### 方法 1: 通过 GitHub Web 界面

1. 访问项目的 GitHub 页面
2. 点击右侧 "Releases"
3. 点击 "Draft a new release"
4. 填写信息：
   - **Tag version**: v1.0.0
   - **Release title**: BSC 打狗棒 v1.0.0
   - **Description**: 从 CHANGELOG.md 复制更新内容
5. 上传 `bsc-dog-bang-plugin-v1.0.0.zip`
6. 勾选 "Set as the latest release"
7. 点击 "Publish release"

### 方法 2: 使用 GitHub CLI

安装 GitHub CLI:

```bash
# macOS
brew install gh

# Windows
scoop install gh

# Linux
# 参考: https://github.com/cli/cli#installation
```

发布流程:

```bash
# 登录
gh auth login

# 创建 Release
gh release create v1.0.0 \
  --title "BSC 打狗棒 v1.0.0" \
  --notes "$(cat CHANGELOG.md | sed -n '/## \[1.0.0\]/,/## \[/p' | sed '$d')" \
  release/bsc-dog-bang-plugin-v1.0.0.zip \
  release/checksums.txt
```

### Release 内容模板

```markdown
## BSC 打狗棒 v1.0.0

### 新功能
- ✨ 支持 Four.meme 交易
- ✨ 支持 Flap.sh 交易
- ✨ 支持 PancakeSwap 交换
- ✨ 钱包导入和管理

### 改进
- 🚀 优化交易速度
- 🔐 增强安全性

### Bug 修复
- 🐛 修复 Gas 估算问题
- 🐛 修复余额显示错误

### 安装方法

1. 下载 `bsc-dog-bang-plugin-v1.0.0.zip`
2. 解压到本地目录
3. 打开 Chrome 浏览器，访问 `chrome://extensions/`
4. 开启"开发者模式"
5. 点击"加载已解压的扩展程序"
6. 选择解压后的 `extension` 目录
7. 完成安装！

### 升级方法

1. 下载新版本 zip 文件
2. 删除旧版本扩展
3. 按照安装方法加载新版本

### 注意事项

- ⚠️ 请务必备份私钥
- ⚠️ 使用强密码保护钱包
- ⚠️ 代币交易存在风险，请谨慎操作

---

完整更新日志: [CHANGELOG.md](https://github.com/0xyaofan/bsc-dog-bang-plugin/blob/main/CHANGELOG.md)
```

## Chrome Web Store 发布

### 前置准备

1. **注册开发者账号**
   - 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - 支付一次性注册费（$5）

2. **准备素材**
   - 图标: 128x128 PNG
   - 截图: 至少 1 张，推荐 1280x800 或 640x400
   - 宣传图（可选）: 440x280, 920x680, 1400x560

### 上传流程

1. **登录 Developer Dashboard**
2. **点击 "New Item"**
3. **上传 zip 包**: `bsc-dog-bang-plugin-v1.0.0.zip`
4. **填写商店信息**:

```yaml
Product details:
  Name: BSC 打狗棒
  Summary: Binance Smart Chain Meme 代币交易插件
  Category: 生产力工具
  Language: 简体中文

Detailed description:
  （参考 README.md 的介绍部分）

Privacy practices:
  Single purpose: 提供 BSC 代币交易功能
  Permission justification: 说明每个权限的用途
  Data usage: 声明不收集用户数据

Store listing:
  Icon: 上传 128x128 图标
  Screenshots: 上传功能截图
  Promotional images: 上传宣传图

Distribution:
  Visibility: Public / Unlisted / Private
  Regions: 选择发布地区
```

5. **提交审核**

### 审核时间

- 通常需要 1-3 个工作日
- 首次提交可能需要更长时间
- 可能会收到审核反馈，需要修改后重新提交

### 更新现有扩展

```bash
# 1. 更新版本号
# 2. 构建新版本
npm run build

# 3. 创建新的 zip 包
./scripts/build-release.sh

# 4. 在 Developer Dashboard 上传新版本
# 5. 填写更新说明
# 6. 提交审核
```

## CI/CD 配置

### GitHub Actions 自动构建

创建 `.github/workflows/build.yml`:

```yaml
name: Build Extension

on:
  push:
    branches: [ master, develop ]
  pull_request:
    branches: [ master ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Build
      run: npm run build

    - name: Upload artifacts
      uses: actions/upload-artifact@v3
      with:
        name: extension-build
        path: extension/dist/
```

### 自动发布到 Releases

创建 `.github/workflows/release.yml`:

```yaml
name: Release Extension

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'

    - name: Install dependencies
      run: npm ci

    - name: Build
      run: npm run build

    - name: Get version
      id: version
      run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

    - name: Create zip
      run: |
        cd extension
        zip -r ../bsc-dog-bang-plugin-v${{ steps.version.outputs.VERSION }}.zip . \
          -x "*.DS_Store" -x "__MACOSX*"

    - name: Create Release
      uses: softprops/action-gh-release@v1
      with:
        files: bsc-dog-bang-plugin-v${{ steps.version.outputs.VERSION }}.zip
        body_path: CHANGELOG.md
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 使用自动化发布

```bash
# 1. 更新版本号
npm version patch  # or minor, major

# 2. 手动更新 manifest.json 版本号

# 3. 提交并推送
git add .
git commit -m "chore: bump version to v1.0.1"
git push

# 4. 创建并推送标签
git tag v1.0.1
git push origin v1.0.1

# GitHub Actions 将自动构建并发布
```

## 发布后检查

- [ ] GitHub Release 页面显示正常
- [ ] Zip 包可以下载
- [ ] 安装说明准确
- [ ] CHANGELOG 链接有效
- [ ] 下载并测试发布的 zip 包
- [ ] 扩展可正常加载和运行

## 回滚流程

如果发现严重问题需要回滚：

```bash
# 1. 删除有问题的 Release
gh release delete v1.0.1 --yes

# 2. 删除标签
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1

# 3. 恢复到之前的版本
git checkout v1.0.0

# 4. 修复问题后重新发布
```

## 最佳实践

1. **每次发布前充分测试**
2. **使用语义化版本号**
3. **维护详细的 CHANGELOG**
4. **自动化构建流程**
5. **保留历史版本的 zip 包**
6. **发布后监控问题反馈**
7. **定期安全审计**

## 下一步

- [使用手册](user-guide.md) - 了解如何使用插件
- [CHANGELOG](../CHANGELOG.md) - 查看版本更新历史
