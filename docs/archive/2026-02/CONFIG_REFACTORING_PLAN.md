# 插件配置重构方案

## 🎯 目标

集成 SDK 后，重新梳理配置结构：
- **SDK 提供默认配置**：合约地址、交易参数、重试策略等
- **插件只保留自定义配置**：用户偏好、UI 设置、插件特有功能

## 📊 当前配置分析

### 插件配置文件（512 行）

**文件**: `src/shared/trading-config.ts`

**包含内容**:
1. ✅ **应该保留** - 插件特有配置
2. ❌ **应该移除** - SDK 已提供的配置
3. ⚠️ **需要调整** - 部分重叠的配置

---

## 🔍 详细配置分类

### 1. DEBUG_CONFIG（调试配置）
**当前位置**: 插件
**建议**: ✅ **保留在插件**

```typescript
export const DEBUG_CONFIG = {
  ENABLED: false,
  PERF_ENABLED: false,
  LEVELS: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }
};
```

**原因**:
- 这是插件级别的调试开关
- 控制插件日志输出
- SDK 有自己的日志系统

---

### 2. WALLET_CONFIG（钱包配置）
**当前位置**: 插件
**建议**: ✅ **保留在插件**

```typescript
export const WALLET_CONFIG = {
  KEEP_ALIVE_DURATION: 30 * 60 * 1000,
  KEEP_ALIVE_INTERVAL: 25000,
  AUTO_KEEP_ALIVE_ON_UNLOCK: true,
};
```

**原因**:
- Service Worker Keep-Alive 是插件特有功能
- SDK 不涉及钱包管理

---

### 3. NETWORK_CONFIG（网络配置）
**当前位置**: 插件
**建议**: ⚠️ **部分移除，使用 SDK 配置**

**插件当前配置**:
```typescript
export const NETWORK_CONFIG = {
  BSC_RPC: 'https://api.zan.top/node/v1/bsc/mainnet/...',
  BSC_CHAIN_ID: 56,
  BSC_RPC_FALLBACK: [
    'https://bsc-mainnet.nodereal.io/v1/...',
    'https://bsc-dataseed.bnbchain.org/',
  ]
};
```

**SDK 已提供**:
```typescript
// @bsc-trading/core/src/config/transport-config.ts
export const BSC_RPC_NODES: RpcNode[] = [
  { id: 'binance-official-1', url: 'https://bsc-dataseed.binance.org', priority: 1 },
  { id: 'binance-official-2', url: 'https://bsc-dataseed1.binance.org', priority: 2 },
  // ... 更多节点
];
```

**重构方案**:
```typescript
// 插件只保留自定义 RPC（如果用户想覆盖）
export const PLUGIN_NETWORK_CONFIG = {
  // 用户自定义的主 RPC（可选）
  CUSTOM_PRIMARY_RPC: process.env.CUSTOM_RPC_URL || null,

  // 是否使用 SDK 默认节点
  USE_SDK_DEFAULT_NODES: true,
};

// 在初始化时合并配置
import { BSC_RPC_NODES, createTransportConfig } from '@bsc-trading/core';

const transportConfig = PLUGIN_NETWORK_CONFIG.CUSTOM_PRIMARY_RPC
  ? createTransportConfig()
      .addNode({
        id: 'custom-primary',
        url: PLUGIN_NETWORK_CONFIG.CUSTOM_PRIMARY_RPC,
        priority: 0, // 最高优先级
        timeout: 5000,
      })
      .useBscNodes() // 添加 SDK 默认节点作为备用
      .build()
  : createTransportConfig()
      .useBscNodes()
      .build();
```

---

### 4. RPC_CONFIG（RPC 请求配置）
**当前位置**: 插件
**建议**: ❌ **移除，使用 SDK 配置**

**插件当前配置**:
```typescript
export const RPC_CONFIG = {
  REQUEST_TIMEOUT_MS: 10000
};
```

**SDK 已提供**:
```typescript
// @bsc-trading/core 的 transport-config.ts
export const BSC_RPC_NODES: RpcNode[] = [
  { id: '...', url: '...', priority: 1, timeout: 5000 },
];
```

**重构方案**: 直接使用 SDK 的 timeout 配置

---

### 5. TX_CONFIG（交易参数配置）
**当前位置**: 插件
**建议**: ⚠️ **部分移除，保留用户偏好**

**插件当前配置**:
```typescript
export const TX_CONFIG = {
  DEADLINE_SECONDS: 60 * 20,
  GAS_LIMIT: {
    APPROVE: 100000,
    PANCAKE_SWAP: 350000,
    FOUR_SWAP: 1500000,
    FLAP_SWAP: 1500000,
    LUNA_SWAP: 1500000
  },
  DEFAULT_SLIPPAGE: 15,
  DEFAULT_GAS_PRICE: 0.05,
  MIN_GAS_PRICE: 0.05,
  MAX_SLIPPAGE: 100,
  MIN_SLIPPAGE: 1,
  // ...
};
```

**SDK 已提供**:
```typescript
// @bsc-trading/fourmeme/src/constants.ts
export const DEFAULT_CONFIG = {
  DEFAULT_SLIPPAGE: 0.05, // 5%
  MAX_SLIPPAGE: 0.5, // 50%
  GAS_LIMIT_MULTIPLIER: 1.2,
  DEADLINE_SECONDS: 300, // 5 minutes
};
```

**重构方案**:
```typescript
// 插件只保留用户偏好设置
export const USER_TX_PREFERENCES = {
  // 用户默认滑点（可在 UI 中修改）
  DEFAULT_SLIPPAGE: 15, // 15%

  // 用户默认 Gas Price（可在 UI 中修改）
  DEFAULT_GAS_PRICE: 0.05, // Gwei

  // 用户偏好的 deadline（可在 UI 中修改）
  PREFERRED_DEADLINE_SECONDS: 60 * 20, // 20 分钟
};

// SDK 的默认配置作为后备
// 如果用户没有设置，使用 SDK 默认值
```

---

### 6. UI_CONFIG（UI 配置）
**当前位置**: 插件
**建议**: ✅ **保留在插件**

```typescript
export const UI_CONFIG = {
  BALANCE_UPDATE_INTERVAL: 10000,
  STATUS_MESSAGE_TIMEOUT: 1200,
  URL_CHANGE_DELAY: 800
};
```

**原因**:
- 纯 UI 相关配置
- SDK 不涉及 UI

---

### 7. TX_WATCHER_CONFIG（交易监控配置）
**当前位置**: 插件
**建议**: ✅ **保留在插件**

```typescript
export const TX_WATCHER_CONFIG = {
  BSC_WS_URLS: [...],
  POLLING_INTERVAL: 800,
  TIMEOUT_MS: 10000,
  MAX_RECONNECT_ATTEMPTS: 3,
  RECONNECT_DELAY: 2000,
  CONNECTION_TIMEOUT: 10000,
  ENABLED: false
};
```

**原因**:
- WebSocket 监控是插件特有功能
- SDK 不提供交易监控

---

### 8. BACKGROUND_TASK_CONFIG（后台任务配置）
**当前位置**: 插件
**建议**: ✅ **保留在插件**

```typescript
export const BACKGROUND_TASK_CONFIG = {
  APPROVE_LOCK_DURATION_MS: 60 * 1000,
  FOUR_QUOTE_BALANCE_SETTLE_DELAY_MS: 400,
  FOUR_QUOTE_BALANCE_RETRY_MAX: 6,
  FOUR_QUOTE_BALANCE_RETRY_DELAY_MS: 500,
  QUOTE_ALLOWANCE_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  OFFSCREEN_RPC_TIMEOUT_MS: 15000,
  OFFSCREEN_PORT_TIMEOUT_MS: 5000
};
```

**原因**:
- Service Worker 后台任务是插件特有功能
- SDK 不涉及后台任务管理

---

### 9. CONTRACTS（合约地址）
**当前位置**: 插件
**建议**: ❌ **移除，使用 SDK 配置**

**插件当前配置**:
```typescript
export const CONTRACTS = {
  PANCAKE_ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  PANCAKE_FACTORY: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  PANCAKE_SMART_ROUTER: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  PANCAKE_V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  PANCAKE_V3_QUOTER: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  // ... Four.meme, Flap, Luna 合约地址
};
```

**SDK 已提供**:
```typescript
// @bsc-trading/fourmeme/src/constants.ts
export const FOUR_MEME_CONTRACTS = {
  TOKEN_MANAGER_V2: '0x000000000000C6A645b0E51C9eC6D4F5e0F4444444',
  TOKEN_MANAGER_HELPER: '0x0000000000004444444444444444444444444444',
};

// @bsc-trading/aggregator 也有 PancakeSwap 合约地址
```

**重构方案**: 直接从 SDK 导入合约地址

---

### 10. CUSTOM_AGGREGATOR_CONFIG（自定义聚合器配置）
**当前位置**: 插件
**建议**: ✅ **保留在插件**

```typescript
export const CUSTOM_AGGREGATOR_CONFIG = {
  DEFAULT_ADDRESS: '0xBbAc12e854a88D3771B5ca38301b35401b87e84a',
  SUPPORTED_CHANNELS: ['four', 'xmode', 'flap'] as const,
  ROUTER_ADDRESS: CONTRACTS.PANCAKE_ROUTER,
  DEFAULT_V3_FEE: 0,
  DEFAULT_FLAP_METHOD: 'getTokenV7'
};
```

**原因**:
- 自定义聚合器是插件特有功能
- SDK 不涉及自定义聚合器

---

### 11. CHANNELS（通道配置）
**当前位置**: 插件
**建议**: ⚠️ **简化，大部分信息 SDK 已提供**

**插件当前配置**:
```typescript
export const CHANNELS = {
  PANCAKE: { name: 'PancakeSwap', id: 'pancake', ... },
  FOUR: { name: 'Four.meme', id: 'four', ... },
  XMODE: { name: 'XMode', id: 'xmode', ... },
  FLAP: { name: 'Flap', id: 'flap', ... },
  LUNA: { name: 'Luna.fun', id: 'luna', ... },
};
```

**重构方案**:
```typescript
// 插件只保留 UI 显示信息
export const CHANNEL_UI_CONFIG = {
  PANCAKE: { displayName: 'PancakeSwap', icon: '🥞' },
  FOUR: { displayName: 'Four.meme', icon: '4️⃣' },
  XMODE: { displayName: 'XMode', icon: '❌' },
  FLAP: { displayName: 'Flap', icon: '🦅' },
  LUNA: { displayName: 'Luna.fun', icon: '🌙' },
};

// 通道逻辑由 SDK TradingManager 处理
```

---

## 📝 重构方案总结

### 阶段 1: 创建新的配置文件结构

```
src/shared/config/
├── plugin-config.ts          # 插件特有配置
├── user-preferences.ts       # 用户偏好设置
├── ui-config.ts              # UI 相关配置
└── sdk-config-adapter.ts     # SDK 配置适配器
```

### 阶段 2: 重构各配置文件

#### `plugin-config.ts` - 插件特有配置

```typescript
/**
 * 插件特有配置
 * 不涉及交易逻辑，只涉及插件功能
 */

// 调试配置
export const DEBUG_CONFIG = {
  ENABLED: false,
  PERF_ENABLED: false,
  LEVELS: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }
};

// 钱包配置
export const WALLET_CONFIG = {
  KEEP_ALIVE_DURATION: 30 * 60 * 1000,
  KEEP_ALIVE_INTERVAL: 25000,
  AUTO_KEEP_ALIVE_ON_UNLOCK: true,
};

// UI 配置
export const UI_CONFIG = {
  BALANCE_UPDATE_INTERVAL: 10000,
  STATUS_MESSAGE_TIMEOUT: 1200,
  URL_CHANGE_DELAY: 800
};

// 交易监控配置
export const TX_WATCHER_CONFIG = {
  BSC_WS_URLS: [...],
  POLLING_INTERVAL: 800,
  TIMEOUT_MS: 10000,
  MAX_RECONNECT_ATTEMPTS: 3,
  RECONNECT_DELAY: 2000,
  CONNECTION_TIMEOUT: 10000,
  ENABLED: false
};

// 后台任务配置
export const BACKGROUND_TASK_CONFIG = {
  APPROVE_LOCK_DURATION_MS: 60 * 1000,
  FOUR_QUOTE_BALANCE_SETTLE_DELAY_MS: 400,
  FOUR_QUOTE_BALANCE_RETRY_MAX: 6,
  FOUR_QUOTE_BALANCE_RETRY_DELAY_MS: 500,
  QUOTE_ALLOWANCE_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  OFFSCREEN_RPC_TIMEOUT_MS: 15000,
  OFFSCREEN_PORT_TIMEOUT_MS: 5000
};

// 自定义聚合器配置
export const CUSTOM_AGGREGATOR_CONFIG = {
  DEFAULT_ADDRESS: '0xBbAc12e854a88D3771B5ca38301b35401b87e84a',
  SUPPORTED_CHANNELS: ['four', 'xmode', 'flap'] as const,
  DEFAULT_V3_FEE: 0,
  DEFAULT_FLAP_METHOD: 'getTokenV7'
};
```

#### `user-preferences.ts` - 用户偏好设置

```typescript
/**
 * 用户偏好设置
 * 可在 UI 中修改，保存到 chrome.storage
 */

export interface UserPreferences {
  // 交易偏好
  defaultSlippage: number;        // 默认滑点（%）
  defaultGasPrice: number;        // 默认 Gas Price (Gwei)
  preferredDeadline: number;      // 偏好的 deadline（秒）

  // 通道偏好
  preferredChannel?: string;      // 偏好的交易通道
  autoSelectChannel: boolean;     // 是否自动选择通道

  // 网络偏好
  customRpcUrl?: string;          // 自定义 RPC URL
  useCustomRpc: boolean;          // 是否使用自定义 RPC

  // UI 偏好
  showNotifications: boolean;     // 是否显示通知
  autoRefreshBalance: boolean;    // 是否自动刷新余额

  // 高级设置
  enableWebSocketMonitor: boolean; // 是否启用 WebSocket 监控
  enableDebugMode: boolean;        // 是否启用调试模式
}

// 默认用户偏好
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultSlippage: 15,
  defaultGasPrice: 0.05,
  preferredDeadline: 60 * 20,
  autoSelectChannel: true,
  useCustomRpc: false,
  showNotifications: true,
  autoRefreshBalance: true,
  enableWebSocketMonitor: false,
  enableDebugMode: false,
};

// 从 chrome.storage 加载用户偏好
export async function loadUserPreferences(): Promise<UserPreferences> {
  const stored = await chrome.storage.local.get('userPreferences');
  return { ...DEFAULT_USER_PREFERENCES, ...stored.userPreferences };
}

// 保存用户偏好到 chrome.storage
export async function saveUserPreferences(preferences: Partial<UserPreferences>): Promise<void> {
  const current = await loadUserPreferences();
  const updated = { ...current, ...preferences };
  await chrome.storage.local.set({ userPreferences: updated });
}
```

#### `ui-config.ts` - UI 相关配置

```typescript
/**
 * UI 相关配置
 * 通道显示信息、图标等
 */

export const CHANNEL_UI_CONFIG = {
  pancake: {
    displayName: 'PancakeSwap',
    shortName: 'Pancake',
    icon: '🥞',
    color: '#D1884F',
  },
  four: {
    displayName: 'Four.meme',
    shortName: 'Four',
    icon: '4️⃣',
    color: '#4444FF',
  },
  xmode: {
    displayName: 'XMode',
    shortName: 'XMode',
    icon: '❌',
    color: '#FF4444',
  },
  flap: {
    displayName: 'Flap',
    shortName: 'Flap',
    icon: '🦅',
    color: '#FFD700',
  },
  luna: {
    displayName: 'Luna.fun',
    shortName: 'Luna',
    icon: '🌙',
    color: '#9370DB',
  },
} as const;

export type ChannelId = keyof typeof CHANNEL_UI_CONFIG;
```

#### `sdk-config-adapter.ts` - SDK 配置适配器

```typescript
/**
 * SDK 配置适配器
 * 将插件配置转换为 SDK 配置
 */

import { createTransportConfig, BSC_RPC_NODES } from '@bsc-trading/core';
import { loadUserPreferences } from './user-preferences.js';

/**
 * 创建 Transport 配置
 */
export async function createPluginTransportConfig() {
  const prefs = await loadUserPreferences();

  const builder = createTransportConfig();

  // 如果用户设置了自定义 RPC，添加为最高优先级
  if (prefs.useCustomRpc && prefs.customRpcUrl) {
    builder.addNode({
      id: 'custom-primary',
      url: prefs.customRpcUrl,
      priority: 0,
      timeout: 10000,
    });
  }

  // 添加 SDK 默认节点
  builder.useBscNodes();

  // 启用动态选择
  builder.enableDynamicSelection();

  return builder.build();
}

/**
 * 创建 TradingManager 配置
 */
export async function createPluginTradingConfig() {
  const prefs = await loadUserPreferences();

  return {
    defaultSlippage: prefs.defaultSlippage * 100, // 转换为 bps
    defaultDeadline: prefs.preferredDeadline,
    autoSelectBestChannel: prefs.autoSelectChannel,
  };
}

/**
 * 获取合约地址（从 SDK）
 */
export { FOUR_MEME_CONTRACTS } from '@bsc-trading/fourmeme';
export { FLAP_CONTRACTS } from '@bsc-trading/flap';
export { LUNA_CONTRACTS } from '@bsc-trading/luna';
// PancakeSwap 合约地址从 aggregator 获取
```

---

### 阶段 3: 更新 SDK Manager 初始化

```typescript
// src/shared/sdk-manager-adapter.ts

import { createTradingManager } from '@bsc-trading/manager';
import { createPluginTransportConfig, createPluginTradingConfig } from './config/sdk-config-adapter.js';
import { sdkClientManager } from './sdk-client-manager.js';

export class SDKManagerAdapter {
  async initialize(): Promise<void> {
    // 1. 创建 transport 配置
    const transportConfig = await createPluginTransportConfig();

    // 2. 创建 trading 配置
    const tradingConfig = await createPluginTradingConfig();

    // 3. 获取 clients
    const publicClient = sdkClientManager.getPublicClient();
    const walletClient = sdkClientManager.getWalletClient();
    const account = walletClient.account;

    // 4. 创建 TradingManager
    this.manager = createTradingManager({
      publicClient,
      walletClient,
      account,
      ...tradingConfig,
    });

    // 5. 初始化
    await this.manager.initialize();

    this.initialized = true;
  }
}
```

---

### 阶段 4: 迁移步骤

1. **创建新配置文件**
   - 创建 `src/shared/config/` 目录
   - 创建 `plugin-config.ts`, `user-preferences.ts`, `ui-config.ts`, `sdk-config-adapter.ts`

2. **迁移配置内容**
   - 将插件特有配置移到 `plugin-config.ts`
   - 将用户偏好移到 `user-preferences.ts`
   - 将 UI 配置移到 `ui-config.ts`
   - 创建 SDK 配置适配器

3. **更新导入**
   - 更新所有导入 `trading-config.ts` 的文件
   - 改为从新配置文件导入

4. **删除重复配置**
   - 删除 SDK 已提供的合约地址
   - 删除 SDK 已提供的默认参数

5. **测试验证**
   - 验证所有功能正常
   - 验证用户偏好保存/加载
   - 验证 SDK 配置正确传递

---

## 📊 重构前后对比

### 重构前

```
src/shared/trading-config.ts (512 行)
├── DEBUG_CONFIG
├── WALLET_CONFIG
├── NETWORK_CONFIG (重复)
├── RPC_CONFIG (重复)
├── TX_CONFIG (重复)
├── UI_CONFIG
├── TX_WATCHER_CONFIG
├── BACKGROUND_TASK_CONFIG
├── CONTRACTS (重复)
├── CUSTOM_AGGREGATOR_CONFIG
├── CHANNELS (部分重复)
└── ... 大量 ABI 定义
```

### 重构后

```
src/shared/config/
├── plugin-config.ts (~150 行)
│   ├── DEBUG_CONFIG
│   ├── WALLET_CONFIG
│   ├── UI_CONFIG
│   ├── TX_WATCHER_CONFIG
│   ├── BACKGROUND_TASK_CONFIG
│   └── CUSTOM_AGGREGATOR_CONFIG
│
├── user-preferences.ts (~80 行)
│   ├── UserPreferences 接口
│   ├── DEFAULT_USER_PREFERENCES
│   ├── loadUserPreferences()
│   └── saveUserPreferences()
│
├── ui-config.ts (~40 行)
│   └── CHANNEL_UI_CONFIG
│
└── sdk-config-adapter.ts (~60 行)
    ├── createPluginTransportConfig()
    ├── createPluginTradingConfig()
    └── 导出 SDK 合约地址

总计: ~330 行（减少 35%）
```

---

## ✅ 优势

1. **清晰的职责分离**
   - 插件配置 vs SDK 配置
   - 用户偏好 vs 系统配置

2. **减少重复**
   - 合约地址由 SDK 提供
   - 交易参数由 SDK 提供
   - 不再维护重复的配置

3. **更好的可维护性**
   - 配置文件更小、更专注
   - 易于理解和修改

4. **更灵活的配置**
   - 用户可以覆盖 SDK 默认值
   - 支持自定义 RPC
   - 支持保存用户偏好

5. **更好的类型安全**
   - UserPreferences 接口
   - 配置验证

---

## 🚀 实施建议

### 优先级

**P0 - 立即实施**:
1. 创建新配置文件结构
2. 迁移插件特有配置
3. 创建 SDK 配置适配器

**P1 - 短期实施**:
4. 实现用户偏好系统
5. 更新所有导入
6. 删除重复配置

**P2 - 长期优化**:
7. 添加配置验证
8. 添加配置迁移工具
9. 完善文档

### 风险控制

1. **向后兼容**
   - 保留旧配置文件作为备份
   - 渐进式迁移

2. **测试覆盖**
   - 测试所有配置路径
   - 测试用户偏好保存/加载

3. **回滚方案**
   - 保留旧配置文件
   - 可快速回滚

---

**日期**: 2026-02-12
**状态**: 📋 方案制定完成
**下一步**: 等待确认后开始实施
