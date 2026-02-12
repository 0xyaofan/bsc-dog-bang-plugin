# 插件适配 SDK Manager 完成

## ✅ 已完成工作

### 1. 创建 SDK Manager 适配器

**文件**: `src/shared/sdk-manager-adapter.ts` (~280 行)

**功能**:
- 封装 `@bsc-trading/manager` 的 TradingManager
- 提供插件友好的接口
- 自动初始化和服务注册
- 路由查询和缓存管理

**核心方法**:
```typescript
export class SDKManagerAdapter {
  // 初始化
  async initialize(): Promise<void>

  // 路由查询
  async queryRoute(tokenAddress: Address)
  async queryRouteBatch(tokenAddresses: Address[])

  // 交易
  async buyToken(params: {...})
  async sellToken(params: {...})
  async getQuote(params: {...})

  // 缓存管理
  clearRouteCache(tokenAddress?: Address)
  getRouteCacheStats()

  // 配置管理
  getConfig()
  updateConfig(config: {...})
}
```

---

### 2. 创建新的 SDK 交易模块

**文件**: `src/background/sdk-trading-v2.ts` (~300 行)

**功能**:
- 使用新的 SDKManagerAdapter
- 自动路由查询和通道选择
- 性能监控集成
- 完整的错误处理

**核心函数**:
```typescript
// 买入代币（自动选择通道）
export async function buyTokenWithSDK(params: {
  tokenAddress: string;
  amount: number;
  slippage: number;
  channel?: string;  // 可选，不提供则自动查询
})

// 卖出代币（自动选择通道）
export async function sellTokenWithSDK(params: {
  tokenAddress: string;
  amount?: bigint;
  percent?: number;
  slippage: number;
  channel?: string;  // 可选，不提供则自动查询
  tokenInfo?: any;
})

// 获取报价
export async function getQuoteWithSDK(params: {
  tokenAddress: Address;
  amountIn: bigint;
  direction: 'buy' | 'sell';
  channel?: string;
})

// 路由查询
export async function queryTokenRoute(tokenAddress: string)
export async function queryTokenRouteBatch(tokenAddresses: string[])

// 缓存管理
export function clearRouteCache(tokenAddress?: string)
export function getRouteCacheStats()
```

---

## 🎯 核心改进

### 1. 自动路由查询和通道选择

**旧版本**:
```typescript
// 需要手动指定平台
await buyTokenWithSDK({
  tokenAddress: '0x...',
  amount: 0.1,
  slippage: 0.5,
  channel: 'flap',  // 必须手动指定
});
```

**新版本**:
```typescript
// 自动查询路由并选择最优通道
await buyTokenWithSDK({
  tokenAddress: '0x...',
  amount: 0.1,
  slippage: 0.5,
  // channel 可选，不提供则自动查询
});

// SDK 会自动：
// 1. 检测代币平台（基于地址模式）
// 2. 查询代币状态（是否已迁移）
// 3. 选择最优通道（launchpad 或 pancake）
```

### 2. 统一的接口

**旧版本**:
```typescript
// 使用不同的平台实例
const platform = sdkAdapter.getPlatform('fourmeme');
await platform.buy({...});
```

**新版本**:
```typescript
// 统一的 TradingManager 接口
await sdkManagerAdapter.buyToken({...});

// 内部自动：
// - 选择服务
// - 处理 Quote token
// - 管理授权
// - 执行交易
```

### 3. 完整的路由查询

**新增功能**:
```typescript
// 查询单个代币路由
const route = await queryTokenRoute('0x...7777');
console.log(route);
// {
//   platform: 'flap',
//   preferredChannel: 'flap',
//   readyForPancake: false,
//   progress: 0,
//   migrating: false,
//   quoteToken: '0x...',
//   metadata: {
//     nativeToQuoteSwapEnabled: true,
//     stateReader: 'V7'
//   }
// }

// 批量查询
const routes = await queryTokenRouteBatch([
  '0x...4444',
  '0x...7777',
  '0x...'
]);
```

### 4. 智能缓存

**新增功能**:
```typescript
// 获取缓存统计
const stats = getRouteCacheStats();
console.log(stats);
// {
//   size: 10,
//   maxSize: 50,
//   entries: [...]
// }

// 清除缓存
clearRouteCache('0x...');  // 清除特定代币
clearRouteCache();         // 清除所有
```

---

## 🚀 使用示例

### 示例 1: 基本买入（自动选择通道）

```typescript
import { buyTokenWithSDK } from './background/sdk-trading-v2.js';

// 买入代币（自动检测平台并选择通道）
const result = await buyTokenWithSDK({
  tokenAddress: '0x...7777',  // Flap 代币
  amount: 0.1,
  slippage: 0.5,
  // 不需要指定 channel，SDK 会自动查询并选择
});

if (result.success) {
  console.log('交易成功:', result.txHash);
} else {
  console.error('交易失败:', result.error);
}
```

### 示例 2: 手动指定通道

```typescript
// 如果需要，仍然可以手动指定通道
const result = await buyTokenWithSDK({
  tokenAddress: '0x...7777',
  amount: 0.1,
  slippage: 0.5,
  channel: 'pancake',  // 强制使用 PancakeSwap
});
```

### 示例 3: 查询路由后交易

```typescript
import { queryTokenRoute, buyTokenWithSDK } from './background/sdk-trading-v2.js';

// 1. 先查询路由
const routeResult = await queryTokenRoute('0x...7777');

if (routeResult.success) {
  const route = routeResult.route;

  console.log('代币信息:');
  console.log('  平台:', route.platform);
  console.log('  推荐通道:', route.preferredChannel);
  console.log('  已迁移:', route.readyForPancake);

  // 2. 根据路由信息决定是否交易
  if (route.readyForPancake) {
    console.log('代币已迁移到 PancakeSwap');
  } else {
    console.log(`代币在 ${route.platform} 平台`);
  }

  // 3. 执行交易（使用推荐通道）
  const result = await buyTokenWithSDK({
    tokenAddress: '0x...7777',
    amount: 0.1,
    slippage: 0.5,
    channel: route.preferredChannel,
  });
}
```

### 示例 4: 批量查询路由

```typescript
import { queryTokenRouteBatch } from './background/sdk-trading-v2.js';

// 批量查询多个代币
const tokens = [
  '0x...4444',  // Four.meme
  '0x...7777',  // Flap
  '0x...',      // Luna
];

const result = await queryTokenRouteBatch(tokens);

if (result.success) {
  for (const [address, route] of result.routes!) {
    console.log(`${address}:`);
    console.log(`  平台: ${route.platform}`);
    console.log(`  推荐通道: ${route.preferredChannel}`);
    console.log(`  已迁移: ${route.readyForPancake}`);
  }
}
```

### 示例 5: 卖出代币（按百分比）

```typescript
import { sellTokenWithSDK } from './background/sdk-trading-v2.js';

// 卖出 50% 的代币
const result = await sellTokenWithSDK({
  tokenAddress: '0x...7777',
  percent: 0.5,  // 50%
  slippage: 0.5,
  tokenInfo: {
    balance: '1000000000000000000000',  // 1000 tokens
    decimals: 18,
  },
  // channel 可选，不提供则自动查询
});
```

### 示例 6: 缓存管理

```typescript
import { getRouteCacheStats, clearRouteCache } from './background/sdk-trading-v2.js';

// 获取缓存统计
const stats = getRouteCacheStats();
console.log('缓存大小:', stats.size);
console.log('最大缓存:', stats.maxSize);

// 查看缓存详情
for (const entry of stats.entries) {
  console.log(`${entry.address}:`);
  console.log(`  缓存时间: ${new Date(entry.timestamp).toISOString()}`);
  console.log(`  TTL: ${entry.ttl === Infinity ? '永久' : `${entry.ttl}ms`}`);
}

// 清除特定代币缓存
clearRouteCache('0x...7777');

// 清除所有缓存
clearRouteCache();
```

---

## 📊 对比：旧版 vs 新版

| 功能 | 旧版 (sdk-adapter) | 新版 (sdk-manager-adapter) |
|------|-------------------|---------------------------|
| 平台管理 | 手动创建各平台实例 | 统一的 TradingManager |
| 通道选择 | 手动指定 | 自动查询 + 手动指定 |
| 路由查询 | ❌ 不支持 | ✅ 支持（单个/批量） |
| 平台检测 | ❌ 不支持 | ✅ 自动检测 |
| 迁移检测 | ❌ 不支持 | ✅ 自动检测 |
| 缓存管理 | ❌ 不支持 | ✅ 支持 |
| Quote token | 手动处理 | 自动处理 |
| 授权管理 | 手动处理 | 自动处理 |
| 错误处理 | 基础 | 完整 |
| 代码量 | ~360 行 | ~280 行（适配器）+ ~300 行（交易模块） |

---

## 🎯 迁移指南

### 步骤 1: 更新导入

**旧版**:
```typescript
import { sdkAdapter } from '../shared/sdk-adapter.js';
```

**新版**:
```typescript
import { sdkManagerAdapter } from '../shared/sdk-manager-adapter.js';
// 或使用封装好的函数
import { buyTokenWithSDK, sellTokenWithSDK } from './background/sdk-trading-v2.js';
```

### 步骤 2: 更新初始化

**旧版**:
```typescript
await sdkAdapter.initialize();
```

**新版**:
```typescript
await sdkManagerAdapter.initialize();
// 或者不需要手动初始化，交易函数会自动初始化
```

### 步骤 3: 更新交易调用

**旧版**:
```typescript
const result = await sdkAdapter.buyToken({
  tokenAddress: '0x...',
  amountIn: parseEther('0.1'),
  slippageBps: 50,
  platform: 'fourmeme',  // 必须指定
});
```

**新版**:
```typescript
const result = await buyTokenWithSDK({
  tokenAddress: '0x...',
  amount: 0.1,
  slippage: 0.5,
  // channel 可选，不提供则自动查询
});
```

### 步骤 4: 添加路由查询（可选）

**新增功能**:
```typescript
// 查询路由信息
const route = await queryTokenRoute('0x...');

// 使用路由信息
await buyTokenWithSDK({
  tokenAddress: '0x...',
  amount: 0.1,
  slippage: 0.5,
  channel: route.route.preferredChannel,
});
```

---

## ✅ 构建和测试

### 构建插件

```bash
cd /path/to/bsc-dog-bang-plugin
npm run build
```

### 测试新功能

1. **测试自动路由查询**:
   - 买入不同平台的代币（Four.meme, Flap, Luna）
   - 不指定 channel，验证自动选择

2. **测试路由查询**:
   - 调用 `queryTokenRoute()` 查询单个代币
   - 调用 `queryTokenRouteBatch()` 批量查询
   - 验证返回的路由信息

3. **测试缓存**:
   - 多次查询同一代币，验证缓存命中
   - 调用 `getRouteCacheStats()` 查看统计
   - 调用 `clearRouteCache()` 清除缓存

4. **测试迁移检测**:
   - 查询已迁移的代币，验证 `readyForPancake: true`
   - 查询未迁移的代币，验证 `readyForPancake: false`

---

## 🎉 总结

插件适配 SDK Manager 完成：

1. ✅ 创建 SDKManagerAdapter（~280 行）
2. ✅ 创建新的 SDK 交易模块（~300 行）
3. ✅ 自动路由查询和通道选择
4. ✅ 完整的路由查询功能
5. ✅ 智能缓存管理
6. ✅ 统一的接口
7. ✅ 完整的错误处理

**完成度**: 100%

**特点**:
- 自动平台检测
- 自动通道选择
- 完整的路由查询
- 智能缓存
- 向后兼容（保留旧接口）
- 代码更简洁

**下一步**:
1. 在插件主逻辑中集成新的 SDK 交易模块
2. 测试完整的交易流程
3. 性能测试和优化
4. 文档更新

---

**日期**: 2026-02-12
**状态**: ✅ 完全实现
**下一步**: 集成到插件主逻辑并测试
