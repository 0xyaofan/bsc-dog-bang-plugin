# 缓存调试指南

**版本：** v1.1.7+
**日期：** 2026-02-05

---

## 📋 概述

本文档介绍如何查询和调试插件的缓存系统，包括路由缓存、授权缓存等。这对于验证性能优化效果、排查缓存问题非常有用。

---

## 🔍 缓存系统架构

插件使用多层缓存策略来提升性能：

### 1. 路由缓存（Route Cache）

- **存储位置：** 内存（`tokenTradeHints` Map）
- **缓存内容：** 买入/卖出路由路径、V2/V3 模式选择
- **有效期：** 1 小时
- **用途：** 避免重复查询 PancakeSwap 路由

### 2. 授权缓存（Allowance Cache）

- **存储位置：** 内存（`allowanceCache` Map）
- **缓存内容：** 代币对各个 Router 的授权额度
- **有效期：** 24 小时
- **用途：** 避免重复查询链上授权状态

### 3. 代币元数据缓存（Token Metadata Cache）

- **存储位置：** 内存（`tokenMetadataCache` Map）
- **缓存内容：** 代币 symbol、decimals
- **有效期：** 永久（ERC20 标准字段不会改变）
- **用途：** 避免重复查询代币基本信息

---

## 🛠️ 查询缓存信息

### API 接口

```javascript
chrome.runtime.sendMessage({
  action: 'get_cache_info',
  data: { tokenAddress: '0x...' }  // 代币地址
}, (response) => {
  console.log('缓存信息:', response);
});
```

### 返回数据结构

```typescript
{
  success: boolean;
  tokenAddress: string;
  cache: {
    route: {
      // 路由状态
      buyRouteStatus: 'idle' | 'loading' | 'success' | 'failed';
      sellRouteStatus: 'idle' | 'loading' | 'success' | 'failed';

      // 缓存时间信息
      buyRouteLoadedAt: {
        timestamp: number;      // Unix 时间戳（毫秒）
        ageSeconds: number;     // 缓存年龄（秒）
        ageMinutes: number;     // 缓存年龄（分钟）
      } | null;
      sellRouteLoadedAt: { ... } | null;

      // 路由详情
      lastMode: 'v2' | 'v3' | null;           // 最后使用的路由模式
      lastBuyPath: string[] | null;           // 最后的买入路径
      lastSellPath: string[] | null;          // 最后的卖出路径
      channelId: string | null;               // 通道 ID
      updatedAt: { ... } | null;              // 最后更新时间
    } | null;

    // 授权信息
    allowances: {
      pancake?: string;        // PancakeSwap Router 授权额度
      smartRouter?: string;    // Smart Router 授权额度
    };
  };
}
```

---

## 📊 使用场景

### 场景 1：验证预加载功能

**目的：** 确认页面切换时是否正确触发了路由预加载

**步骤：**

1. 打开浏览器控制台（F12）
2. 切换到代币页面
3. 立即执行查询：

```javascript
chrome.runtime.sendMessage({
  action: 'get_cache_info',
  data: { tokenAddress: '0x...' }  // 当前页面的代币地址
}, (response) => {
  const route = response.cache?.route;
  if (!route) {
    console.log('❌ 未找到路由缓存');
    return;
  }

  console.log('买入路由状态:', route.buyRouteStatus);
  console.log('卖出路由状态:', route.sellRouteStatus);

  // 检查预加载状态
  if (route.buyRouteStatus === 'loading') {
    console.log('⏳ 买入路由预加载中...');
  } else if (route.buyRouteStatus === 'success') {
    console.log('✅ 买入路由已缓存');
    console.log('   缓存年龄:', route.buyRouteLoadedAt.ageSeconds, '秒');
  }

  if (route.sellRouteStatus === 'loading') {
    console.log('⏳ 卖出路由预加载中...');
  } else if (route.sellRouteStatus === 'success') {
    console.log('✅ 卖出路由已缓存');
    console.log('   缓存年龄:', route.sellRouteLoadedAt.ageSeconds, '秒');
  }
});
```

**预期结果：**

- 页面切换后立即查询：状态应为 `loading`（预加载中）
- 等待 200-300ms 后查询：状态应为 `success`（预加载完成）

---

### 场景 2：检查缓存有效性

**目的：** 确认缓存是否在有效期内

**步骤：**

```javascript
chrome.runtime.sendMessage({
  action: 'get_cache_info',
  data: { tokenAddress: '0x...' }
}, (response) => {
  const route = response.cache?.route;
  if (!route) {
    console.log('❌ 未找到路由缓存');
    return;
  }

  // 检查买入路由缓存
  if (route.buyRouteLoadedAt) {
    const ageMinutes = route.buyRouteLoadedAt.ageMinutes;
    if (ageMinutes < 60) {
      console.log(`✅ 买入路由缓存有效（${ageMinutes} 分钟前）`);
    } else {
      console.log(`⚠️ 买入路由缓存已过期（${ageMinutes} 分钟前）`);
    }
  } else {
    console.log('❌ 买入路由未缓存');
  }

  // 检查卖出路由缓存
  if (route.sellRouteLoadedAt) {
    const ageMinutes = route.sellRouteLoadedAt.ageMinutes;
    if (ageMinutes < 60) {
      console.log(`✅ 卖出路由缓存有效（${ageMinutes} 分钟前）`);
    } else {
      console.log(`⚠️ 卖出路由缓存已过期（${ageMinutes} 分钟前）`);
    }
  } else {
    console.log('❌ 卖出路由未缓存');
  }
});
```

**缓存有效期：**

- **路由缓存：** 1 小时（3600 秒）
- **授权缓存：** 24 小时（86400 秒）

---

### 场景 3：检查授权状态

**目的：** 确认代币是否已授权给 Router

**步骤：**

```javascript
chrome.runtime.sendMessage({
  action: 'get_cache_info',
  data: { tokenAddress: '0x...' }
}, (response) => {
  const allowances = response.cache?.allowances;
  if (!allowances) {
    console.log('❌ 未找到授权缓存');
    return;
  }

  // 检查 PancakeSwap Router 授权
  if (allowances.pancake) {
    const amount = BigInt(allowances.pancake);
    if (amount > 0n) {
      console.log('✅ PancakeSwap Router 已授权');
      console.log('   授权额度:', amount.toString());
    } else {
      console.log('❌ PancakeSwap Router 未授权');
    }
  }

  // 检查 Smart Router 授权
  if (allowances.smartRouter) {
    const amount = BigInt(allowances.smartRouter);
    if (amount > 0n) {
      console.log('✅ Smart Router 已授权');
      console.log('   授权额度:', amount.toString());
    } else {
      console.log('❌ Smart Router 未授权');
    }
  }
});
```

**授权额度说明：**

- **0**：未授权
- **115792089237316195423570985008687907853269984665640564039457584007913129639935**：最大授权（`type(uint256).max`）

---

### 场景 4：监控缓存更新

**目的：** 实时监控缓存状态变化

**步骤：**

```javascript
// 定时查询缓存状态
const tokenAddress = '0x...';
let lastBuyStatus = null;
let lastSellStatus = null;

const monitor = setInterval(() => {
  chrome.runtime.sendMessage({
    action: 'get_cache_info',
    data: { tokenAddress }
  }, (response) => {
    const route = response.cache?.route;
    if (!route) return;

    // 检测状态变化
    if (route.buyRouteStatus !== lastBuyStatus) {
      console.log(`[${new Date().toLocaleTimeString()}] 买入路由状态变化: ${lastBuyStatus} → ${route.buyRouteStatus}`);
      lastBuyStatus = route.buyRouteStatus;
    }

    if (route.sellRouteStatus !== lastSellStatus) {
      console.log(`[${new Date().toLocaleTimeString()}] 卖出路由状态变化: ${lastSellStatus} → ${route.sellRouteStatus}`);
      lastSellStatus = route.sellRouteStatus;
    }
  });
}, 100); // 每 100ms 查询一次

// 停止监控
// clearInterval(monitor);
```

---

## 🔧 缓存状态说明

### 路由状态（Route Status）

| 状态 | 说明 | 含义 |
|------|------|------|
| `idle` | 空闲 | 未加载，无缓存 |
| `loading` | 加载中 | 正在预加载或查询路由 |
| `success` | 成功 | 路由已缓存，可直接使用 |
| `failed` | 失败 | 路由查询失败 |

### 路由模式（Route Mode）

| 模式 | 说明 |
|------|------|
| `v2` | PancakeSwap V2 路由 |
| `v3` | PancakeSwap V3 路由 |
| `null` | 未确定或无缓存 |

---

## 🐛 常见问题排查

### 问题 1：预加载未触发

**症状：** 切换页面后，路由状态仍为 `idle`

**排查步骤：**

1. 检查是否已解锁钱包
2. 检查控制台是否有错误日志
3. 确认 `prefetch_route` 消息是否发送成功

**解决方法：**

```javascript
// 手动触发预加载
chrome.runtime.sendMessage({
  action: 'prefetch_route',
  data: { tokenAddress: '0x...' }
}, (response) => {
  console.log('预加载结果:', response);
});
```

---

### 问题 2：缓存过期

**症状：** 缓存年龄超过 60 分钟，但仍显示为 `success`

**原因：** 缓存有效期检查在查询路由时进行，不会主动清理

**解决方法：** 执行一次买入或卖出操作，会自动重新查询路由

---

### 问题 3：授权缓存不准确

**症状：** 已授权但缓存显示未授权，或反之

**原因：** 授权状态在链上发生变化，但缓存未更新

**解决方法：**

```javascript
// 手动刷新授权状态
chrome.runtime.sendMessage({
  action: 'check_token_approval',
  data: {
    tokenAddress: '0x...',
    channel: 'pancake'
  }
}, (response) => {
  console.log('授权状态:', response);
});
```

---

## 📈 性能指标

### 缓存命中率

**定义：** 使用缓存的请求占总请求的比例

**计算方法：**

```javascript
// 监控 10 次交易的缓存命中情况
let cacheHits = 0;
let totalRequests = 0;

// 在每次交易前查询
chrome.runtime.sendMessage({
  action: 'get_cache_info',
  data: { tokenAddress: '0x...' }
}, (response) => {
  totalRequests++;
  const route = response.cache?.route;
  if (route?.buyRouteStatus === 'success' || route?.sellRouteStatus === 'success') {
    cacheHits++;
  }
  console.log(`缓存命中率: ${(cacheHits / totalRequests * 100).toFixed(1)}%`);
});
```

**目标：**

- **首次访问：** 0%（需要预加载）
- **预加载后：** 100%（1 小时内）
- **高频交易：** 95%+（偶尔缓存过期）

---

### 预加载时间

**定义：** 从触发预加载到缓存状态变为 `success` 的时间

**测量方法：**

```javascript
const startTime = Date.now();

// 触发预加载
chrome.runtime.sendMessage({
  action: 'prefetch_route',
  data: { tokenAddress: '0x...' }
});

// 轮询检查状态
const checkInterval = setInterval(() => {
  chrome.runtime.sendMessage({
    action: 'get_cache_info',
    data: { tokenAddress: '0x...' }
  }, (response) => {
    const route = response.cache?.route;
    if (route?.buyRouteStatus === 'success' && route?.sellRouteStatus === 'success') {
      const elapsed = Date.now() - startTime;
      console.log(`预加载完成，耗时: ${elapsed}ms`);
      clearInterval(checkInterval);
    }
  });
}, 50);
```

**目标：**

- **PancakeSwap：** 200-300ms
- **Four.meme（已迁移）：** 50-100ms
- **Flap（已迁移）：** 50-100ms

---

## 🎯 最佳实践

### 1. 定期验证缓存

在开发和测试阶段，定期检查缓存状态：

```javascript
// 添加到浏览器书签，方便快速查询
javascript:(function(){chrome.runtime.sendMessage({action:'get_cache_info',data:{tokenAddress:document.querySelector('[data-token-address]')?.dataset.tokenAddress}},r=>console.log(r))})();
```

### 2. 监控缓存性能

在生产环境，记录缓存命中率和预加载时间：

```javascript
// 在交易前记录
const startTime = performance.now();
// ... 执行交易
const elapsed = performance.now() - startTime;
console.log(`交易耗时: ${elapsed.toFixed(2)}ms`);
```

### 3. 清理过期缓存

虽然缓存会自动过期，但在某些情况下需要手动清理：

```javascript
// 清除授权缓存（例如：撤销授权后）
chrome.runtime.sendMessage({
  action: 'revoke_token_approval',
  data: {
    tokenAddress: '0x...',
    channel: 'pancake'
  }
});
```

---

## 📚 相关文档

- [性能优化实施报告](./performance-optimization-implementation.md)
- [买入流程并发优化方案](./buy-flow-concurrency-optimization.md)
- [交易日志性能分析](./transaction-log-performance-analysis.md)

---

## 🔄 更新日志

### v1.1.7 (2026-02-05)

- ✅ 新增 `get_cache_info` API
- ✅ 支持查询路由缓存状态
- ✅ 支持查询授权缓存状态
- ✅ 提供缓存年龄信息

---

## 💡 提示

- 缓存信息仅用于调试，不应在生产代码中依赖
- 预加载是后台操作，不会阻塞用户交互
- 缓存失效时会自动重新查询，无需手动干预
- 授权缓存采用乐观更新策略，授权后立即更新缓存
