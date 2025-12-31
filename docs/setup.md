# 环境配置指南

本文档介绍如何配置 BSC 打狗棒的开发环境。

## 目录

- [系统要求](#系统要求)
- [前置依赖](#前置依赖)
- [环境变量配置](#环境变量配置)
- [依赖安装](#依赖安装)
- [IDE 配置](#ide-配置)
- [常见问题](#常见问题)

## 系统要求

### 操作系统
- macOS 10.15+
- Windows 10+
- Linux (Ubuntu 18.04+, Debian 10+, Fedora 30+)

### 硬件要求
- CPU: 2 核心以上
- 内存: 4GB 以上
- 硬盘: 2GB 可用空间

### 浏览器
- Chrome 114+
- Edge 114+
- Brave 1.50+
- 其他基于 Chromium 的浏览器

## 前置依赖

### 1. Node.js

**推荐版本**: Node.js 18.x 或更高

**安装方式**:

#### macOS
```bash
# 使用 Homebrew
brew install node

# 或使用 nvm (推荐)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

#### Windows
```bash
# 使用 nvm-windows
# 1. 下载 nvm-windows: https://github.com/coreybutler/nvm-windows/releases
# 2. 安装后执行:
nvm install 18
nvm use 18
```

#### Linux
```bash
# 使用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

**验证安装**:
```bash
node --version  # 应显示 v18.x.x
npm --version   # 应显示 9.x.x+
```

### 2. Git

**安装方式**:

#### macOS
```bash
brew install git
```

#### Windows
下载并安装 [Git for Windows](https://git-scm.com/download/win)

#### Linux
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install git

# Fedora
sudo dnf install git
```

**验证安装**:
```bash
git --version  # 应显示 git version 2.x.x
```

### 3. 包管理器

本项目使用 npm，已包含在 Node.js 中。

可选使用 yarn 或 pnpm：

```bash
# Yarn (可选)
npm install -g yarn

# pnpm (可选)
npm install -g pnpm
```

## 项目克隆

```bash
# HTTPS
git clone https://github.com/0xyaofan/bsc-dog-bang-plugin.git

# SSH
git clone git@github.com:0xyaofan/bsc-dog-bang-plugin.git

# 进入项目目录
cd bsc-dog-bang-plugin
```

## 依赖安装

### 安装 npm 依赖

```bash
npm install
```

### 依赖说明

#### 生产依赖

```json
{
  "react": "^19.2.0",           // React 框架
  "react-dom": "^19.2.0"        // React DOM 操作
}
```

#### 开发依赖

```json
{
  "@types/chrome": "^0.1.31",              // Chrome API 类型定义
  "@types/react": "^19.2.7",               // React 类型定义
  "@types/react-dom": "^19.2.3",           // React DOM 类型定义
  "@vitejs/plugin-react-swc": "^4.2.2",    // Vite React SWC 插件
  "typescript": "^5.9.3",                  // TypeScript 编译器
  "viem": "^2.43.1",                       // 以太坊交互库
  "vite": "^7.2.4"                         // 构建工具
}
```

## 环境变量配置

### 创建 .env 文件

```bash
cp .env.example .env
```

### 配置说明

编辑 `.env` 文件：

```bash
# 私钥（仅用于开发测试，不要提交到 git！）
PRIVATE_KEY=your_private_key_here
```

**重要提示**:
- ⚠️ **切勿在生产环境使用 .env 文件中的私钥**
- ⚠️ **确保 .env 文件已添加到 .gitignore**
- ⚠️ **使用测试钱包，不要使用包含真实资产的钱包**

### .gitignore 配置

确保 `.gitignore` 包含以下内容：

```gitignore
# 环境变量
.env
.env.local
.env.*.local

# 依赖
node_modules/

# 构建输出
extension/dist/
dist/

# 日志
*.log
npm-debug.log*

# 编辑器
.vscode/
.idea/
*.swp
*.swo

# 操作系统
.DS_Store
Thumbs.db
```

## IDE 配置

### Visual Studio Code (推荐)

#### 安装推荐插件

创建 `.vscode/extensions.json`:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense"
  ]
}
```

#### 工作区设置

创建 `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "files.exclude": {
    "**/node_modules": true,
    "**/extension/dist": true
  }
}
```

### WebStorm / IntelliJ IDEA

1. 打开项目目录
2. IDE 会自动识别 TypeScript 配置
3. 启用 TypeScript 服务
4. 配置 Prettier 为默认格式化工具

## TypeScript 配置

项目已包含 `tsconfig.json`，主要配置：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

## 开发服务器配置

### Vite 配置

`vite.config.ts` 已配置为 Chrome 扩展构建模式：

```typescript
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'extension/dist',
    rollupOptions: {
      input: {
        popup: './extension/popup.html',
        background: './src/background/index.ts',
        content: './src/content/index.ts',
        offscreen: './src/offscreen/index.ts',
        sidepanel: './extension/sidepanel.html'
      }
    }
  }
})
```

## Chrome 扩展开发者模式

### 启用开发者模式

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"

### 加载扩展

1. 点击"加载已解压的扩展程序"
2. 选择项目的 `extension` 目录
3. 扩展将出现在列表中

### 调试工具

- **Popup 调试**: 右键点击扩展图标 → 检查弹出内容
- **Background 调试**: 扩展详情页 → Service Worker → 检查视图
- **Content Script 调试**: 在网页上右键 → 检查 → Console 选择对应的 Context

## 网络配置

### BSC RPC 节点

默认使用公共 RPC 节点：

```typescript
NETWORK_CONFIG = {
  BSC_RPC: "https://bsc-dataseed.binance.org/"
}
```

### 可选的 RPC 节点

如果默认节点不稳定，可以配置备用节点：

```typescript
// 在 src/shared/trading-config.ts 中修改
const RPC_ENDPOINTS = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.binance.org/",
  "https://bsc-dataseed2.binance.org/",
  "https://bsc-dataseed3.binance.org/"
]
```

### 测试网配置（可选）

开发时可以使用 BSC 测试网：

```typescript
NETWORK_CONFIG = {
  BSC_RPC: "https://data-seed-prebsc-1-s1.binance.org:8545/",
  CHAIN_ID: 97,  // 测试网
  BLOCK_EXPLORER: "https://testnet.bscscan.com"
}
```

## 验证环境

运行以下命令验证环境配置：

```bash
# 检查 Node.js
node --version

# 检查 npm
npm --version

# 检查 TypeScript
npx tsc --version

# 安装依赖
npm install

# 构建项目
npm run build

# 开发模式
npm run dev
```

如果所有命令都成功执行，环境配置完成！

## 常见问题

### Q1: npm install 失败

**可能原因**:
- 网络问题
- Node.js 版本不兼容
- npm 缓存损坏

**解决方案**:
```bash
# 清除 npm 缓存
npm cache clean --force

# 删除 node_modules 和 lock 文件
rm -rf node_modules package-lock.json

# 重新安装
npm install

# 或使用国内镜像
npm install --registry=https://registry.npmmirror.com
```

### Q2: TypeScript 编译错误

**检查**:
- TypeScript 版本是否为 5.x+
- tsconfig.json 是否正确

**解决方案**:
```bash
# 重新安装 TypeScript
npm install -D typescript@latest

# 清除 TypeScript 缓存
rm -rf node_modules/.cache
```

### Q3: Chrome 扩展加载失败

**检查**:
- manifest.json 是否正确
- 构建是否成功
- 路径是否正确

**解决方案**:
```bash
# 重新构建
npm run build

# 检查 extension/dist 目录是否存在
ls -la extension/dist

# 确保 manifest.json 在 extension 目录
ls -la extension/manifest.json
```

### Q4: viem 相关错误

**可能原因**:
- Node.js 版本过低
- polyfill 缺失

**解决方案**:
```bash
# 确保使用 Node.js 18+
node --version

# 如果版本低于 18，升级 Node.js
nvm install 18
nvm use 18
```

### Q5: 开发模式热重载不工作

**解决方案**:
- Chrome 扩展不支持完整的热重载
- 修改代码后需要手动刷新扩展
- 在 `chrome://extensions/` 点击扩展的刷新按钮

## 下一步

环境配置完成后，请阅读：
- [开发手册](development.md) - 了解项目架构和开发流程
- [部署手册](deployment.md) - 学习如何构建和部署
