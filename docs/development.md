# 开发手册

本文档提供 BSC 打狗棒插件的开发指南，包括架构设计、代码规范和最佳实践。

## 目录

- [项目架构](#项目架构)
- [目录结构](#目录结构)
- [核心模块](#核心模块)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [调试技巧](#调试技巧)
- [测试指南](#测试指南)

## 项目架构

### 技术栈

```
┌─────────────────────────────────────────┐
│           Chrome Extension              │
│         (Manifest V3)                   │
├─────────────────────────────────────────┤
│  Frontend: React 19 + TypeScript        │
│  Build: Vite 7 + SWC                    │
│  Blockchain: viem 2.x                   │
│  State: Chrome Storage API              │
└─────────────────────────────────────────┘
```

### 架构图

```
┌──────────────┐
│   Popup UI   │ ←─────┐
└──────────────┘       │
                       │
┌──────────────┐       │
│ Sidepanel UI │ ←─────┤ Chrome Runtime
└──────────────┘       │ Messaging
                       │
┌──────────────┐       │
│Content Script│ ←─────┤
└──────────────┘       │
        ↓              │
┌──────────────┐       │
│ Background   │ ←─────┘
│Service Worker│
└──────────────┘
        ↓
┌──────────────┐
│  Offscreen   │
│  Document    │
└──────────────┘
        ↓
┌──────────────┐
│  BSC Network │
└──────────────┘
```

### 消息流

```
User Action (Popup/Sidepanel/Content)
    ↓
Chrome Runtime Message
    ↓
Background Service Worker
    ↓
Offscreen Document (Crypto Operations)
    ↓
viem (Blockchain Interaction)
    ↓
BSC Network
```

## 目录结构

```
bsc-dog-bang-plugin/
├── src/
│   ├── background/              # 后台服务
│   │   ├── index.ts            # 主入口
│   │   ├── four-quote-agent.ts # Four.meme 报价代理
│   │   ├── flap-quote-agent.ts # Flap 报价代理
│   │   └── custom-aggregator-agent.ts # 自定义聚合器
│   │
│   ├── content/                # 内容脚本
│   │   └── index.ts           # 页面注入逻辑
│   │
│   ├── popup/                  # 弹窗界面
│   │   ├── App.tsx            # 主组件
│   │   ├── main.tsx           # 入口文件
│   │   └── index.css          # 样式
│   │
│   ├── sidepanel/             # 侧边栏
│   │   ├── main.tsx
│   │   └── index.css
│   │
│   ├── offscreen/             # 离屏文档
│   │   └── index.ts           # 加密操作
│   │
│   └── shared/                # 共享模块
│       ├── logger.ts          # 日志系统
│       ├── performance.ts     # 性能监控
│       ├── trading-config.ts  # 交易配置
│       ├── trading-channels.ts # 交易通道
│       ├── tx-watcher.ts      # 交易监听
│       ├── viem-helper.ts     # viem 辅助
│       ├── user-settings.ts   # 用户设置
│       ├── token-route.ts     # 代币路由
│       ├── promise-dedupe.ts  # Promise 去重
│       └── channel-config.ts  # 通道配置
│
├── extension/                 # 扩展静态文件
│   ├── manifest.json         # 清单文件
│   ├── popup.html            # 弹窗HTML
│   ├── sidepanel.html        # 侧边栏HTML
│   ├── offscreen.html        # 离屏HTML
│   ├── content-wrapper.js    # 内容脚本包装
│   ├── styles.css            # 注入样式
│   ├── icons/                # 图标资源
│   └── dist/                 # 构建输出
│
├── abis/                     # 合约ABI
│   ├── ERC20.json
│   ├── PancakeRouter.json
│   ├── FourTokenManager.json
│   └── FlapPortal.json
│
├── docs/                     # 文档
├── scripts/                  # 构建脚本
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TypeScript 配置
└── package.json             # 项目配置
```

## 核心模块

### 1. Background Service Worker

**文件**: `src/background/index.ts`

**职责**:
- 钱包管理（导入、解锁、锁定）
- 交易执行（买入、卖出、授权）
- 消息处理（popup、content、offscreen 通信）
- 状态管理

**核心功能**:

```typescript
// 钱包导入
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'import_wallet') {
    // 加密私钥
    // 保存到 chrome.storage
    // 返回钱包地址
  }
});

// 交易执行
async function executeBuy(params) {
  // 1. 验证参数
  // 2. 估算 Gas
  // 3. 构建交易
  // 4. 签名
  // 5. 发送
  // 6. 监听确认
}
```

### 2. Content Script

**文件**: `src/content/index.ts`

**职责**:
- 检测当前页面类型
- 注入交易 UI
- 提取代币信息
- 与 Background 通信

**注入逻辑**:

```typescript
// 检测页面
const detectPlatform = () => {
  const url = window.location.href;
  if (url.includes('four.meme')) return 'four';
  if (url.includes('flap.sh')) return 'flap';
  if (url.includes('gmgn.ai')) return 'gmgn';
  return null;
};

// 注入 UI
const injectUI = (platform) => {
  const container = document.createElement('div');
  container.id = 'bsc-dog-bang-widget';
  // 渲染交易界面
  document.body.appendChild(container);
};
```

### 3. Shared Modules

#### logger.ts - 日志系统

```typescript
import { logger, DEBUG_CONFIG } from '../shared/logger';

// 启用调试模式
DEBUG_CONFIG.ENABLED = true;

// 使用日志
logger.debug('调试信息');
logger.info('普通信息');
logger.warn('警告信息');
logger.error('错误信息');

// 分组日志
logger.group('交易流程');
logger.debug('步骤 1');
logger.debug('步骤 2');
logger.groupEnd();
```

#### performance.ts - 性能监控

```typescript
import { PerformanceTimer } from '../shared/performance';

const timer = new PerformanceTimer('buy');
timer.step('参数验证');
// ... 操作 ...
timer.step('发送交易');
// ... 操作 ...
const report = timer.finish();

console.log(`总耗时: ${report.totalTime}ms`);
```

#### trading-config.ts - 配置管理

```typescript
import {
  CONTRACTS,
  TX_CONFIG,
  NETWORK_CONFIG,
  ROUTER_ABI,
  ERC20_ABI
} from '../shared/trading-config';

// 使用配置
const routerAddress = CONTRACTS.PANCAKE_ROUTER;
const gasPrice = TX_CONFIG.DEFAULT_GAS_PRICE;
const rpcUrl = NETWORK_CONFIG.BSC_RPC;
```

#### trading-channels.ts - 交易通道

```typescript
import { tradingChannels } from '../shared/trading-channels';

// 执行买入
const result = await tradingChannels.pancakeswap.buy({
  tokenAddress,
  amountIn,
  slippage,
  walletClient
});
```

### 4. Offscreen Document

**文件**: `src/offscreen/index.ts`

**职责**:
- 私钥加密/解密
- 交易签名
- 敏感计算

**为何需要 Offscreen**:
- Service Worker 不支持某些 Web Crypto API
- 隔离敏感操作
- 更好的安全性

## 开发流程

### 1. 启动开发环境

```bash
# 安装依赖
npm install

# 开发模式（启动 Vite dev server）
npm run dev

# 构建（生成 extension/dist）
npm run build
```

### 2. 加载扩展

1. 构建项目: `npm run build`
2. 打开 Chrome: `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `extension` 目录

### 3. 修改代码

```bash
# 修改代码后重新构建
npm run build

# 在 chrome://extensions/ 刷新扩展
```

### 4. 调试

**Popup 调试**:
```
右键点击扩展图标 → 检查弹出内容
```

**Background 调试**:
```
chrome://extensions/ → 扩展详情 → Service Worker → 检查视图
```

**Content Script 调试**:
```
在注入的页面 → F12 → Console → 选择 Content Script context
```

### 5. 代码提交

```bash
# 添加文件
git add .

# 提交
git commit -m "feat: 添加新功能"

# 推送
git push origin your-branch
```

## 代码规范

### TypeScript 规范

```typescript
// ✅ 好的示例
interface BuyParams {
  tokenAddress: `0x${string}`;
  amountIn: bigint;
  slippage: number;
}

async function executeBuy(params: BuyParams): Promise<TransactionResult> {
  // 实现
}

// ❌ 不好的示例
function executeBuy(tokenAddress, amountIn, slippage) {
  // 缺少类型
}
```

### 命名规范

```typescript
// 文件名: kebab-case
// four-quote-agent.ts

// 变量/函数: camelCase
const tokenAddress = '0x...';
function getBalance() {}

// 类/接口: PascalCase
class WalletManager {}
interface TradeParams {}

// 常量: UPPER_SNAKE_CASE
const DEFAULT_GAS_LIMIT = 300000;

// 私有属性: _camelCase
class Foo {
  private _privateValue: string;
}
```

### 导入顺序

```typescript
// 1. Node 模块
import { resolve } from 'path';

// 2. 第三方库
import { createPublicClient, http } from 'viem';

// 3. 项目内模块
import { logger } from '../shared/logger';
import { CONTRACTS } from '../shared/trading-config';

// 4. 类型导入
import type { WalletClient } from 'viem';
```

### 注释规范

```typescript
/**
 * 执行代币买入交易
 *
 * @param params - 交易参数
 * @param params.tokenAddress - 代币合约地址
 * @param params.amountIn - 买入BNB数量（wei）
 * @param params.slippage - 滑点容差（百分比）
 * @returns 交易哈希
 *
 * @throws {Error} 余额不足
 * @throws {Error} Gas估算失败
 *
 * @example
 * ```typescript
 * const hash = await executeBuy({
 *   tokenAddress: '0x...',
 *   amountIn: parseEther('0.1'),
 *   slippage: 10
 * });
 * ```
 */
async function executeBuy(params: BuyParams): Promise<`0x${string}`> {
  // 实现
}
```

### 错误处理

```typescript
// ✅ 好的示例
try {
  const result = await somethingRisky();
  logger.info('成功', result);
} catch (error) {
  logger.error('失败', error);
  throw new Error(`操作失败: ${(error as Error).message}`);
}

// ❌ 不好的示例
try {
  somethingRisky();
} catch (e) {
  console.log(e); // 不要使用 console.log
}
```

## 调试技巧

### 1. 启用 Debug 模式

```typescript
// 方法 1: 通过 Chrome Storage
chrome.storage.local.set({ DEBUG_ENABLED: true });

// 方法 2: 修改代码
// src/shared/logger.ts
DEBUG_CONFIG.ENABLED = true;
```

### 2. 查看详细日志

```typescript
// 在 Background Console
logger.debug('交易参数', params);
logger.debug('交易结果', result);

// 性能分析
const timer = new PerformanceTimer('operation');
timer.step('步骤1');
// ...
timer.step('步骤2');
// ...
timer.finish(); // 自动打印报告
```

### 3. 网络请求调试

```typescript
// 查看 RPC 请求
import { logger } from '../shared/logger';

const response = await fetch(RPC_URL, {
  method: 'POST',
  body: JSON.stringify(request)
});
logger.debug('RPC Request', request);
logger.debug('RPC Response', await response.json());
```

### 4. Chrome DevTools

**查看 Storage**:
```
Application → Storage → Local Storage / Chrome Storage
```

**查看 Network**:
```
Network → Filter: BSC RPC
```

**查看 Console**:
```
Console → Filter: [BG] / [Content] / [Popup]
```

## 测试指南

### 单元测试（TODO）

```typescript
// tests/trading-channels.test.ts
import { describe, it, expect } from 'vitest';
import { tradingChannels } from '../src/shared/trading-channels';

describe('PancakeSwap Channel', () => {
  it('should calculate amounts correctly', () => {
    // 测试逻辑
  });
});
```

### 手动测试清单

**钱包功能**:
- [ ] 导入私钥
- [ ] 设置密码
- [ ] 锁定钱包
- [ ] 解锁钱包
- [ ] 显示余额

**交易功能**:
- [ ] Four.meme 买入
- [ ] Four.meme 卖出
- [ ] Flap 买入
- [ ] Flap 卖出
- [ ] PancakeSwap 交换
- [ ] Gas 估算
- [ ] 滑点保护
- [ ] 交易监听

**UI 测试**:
- [ ] Popup 显示正常
- [ ] Sidepanel 显示正常
- [ ] Content Script 注入正常
- [ ] 错误提示友好

## 性能优化

### 1. Promise 去重

```typescript
import { promiseDedupe } from '../shared/promise-dedupe';

// 避免重复请求
const getPrice = promiseDedupe(async (token) => {
  return await fetchPrice(token);
});

// 多次调用只会发送一次请求
getPrice('0x...'); // 发送请求
getPrice('0x...'); // 复用结果
```

### 2. 缓存策略

```typescript
// 缓存代币信息
const tokenCache = new Map();

async function getTokenInfo(address) {
  if (tokenCache.has(address)) {
    return tokenCache.get(address);
  }

  const info = await fetchTokenInfo(address);
  tokenCache.set(address, info);
  return info;
}
```

### 3. 减少 Storage 读写

```typescript
// ❌ 不好的示例
for (let i = 0; i < 100; i++) {
  await chrome.storage.local.set({ [`key${i}`]: value });
}

// ✅ 好的示例
const batch = {};
for (let i = 0; i < 100; i++) {
  batch[`key${i}`] = value;
}
await chrome.storage.local.set(batch);
```

## 贡献代码

1. Fork 项目
2. 创建功能分支: `git checkout -b feature/amazing-feature`
3. 提交更改: `git commit -m 'feat: Add amazing feature'`
4. 推送分支: `git push origin feature/amazing-feature`
5. 提交 Pull Request

详见 [贡献指南](../CONTRIBUTING.md)

## 下一步

- [部署手册](deployment.md) - 学习如何构建和发布
- [API 文档](../doc/Four-MEME-API-Documents.30-10-2025.md) - 了解 API 接口
