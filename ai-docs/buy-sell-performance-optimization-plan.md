# 买卖性能优化实施方案

## 🎯 优化目标

- **卖出性能提升**: ~200-500ms
- **第一次交易优化**: ~300-800ms
- **用户感知延迟降低**: ~50-70%

## 🚀 立即可实施的优化（预期收益: ~150-200ms）

### 优化 1: 并行查询 BNB 余额

**当前问题**:
```typescript
// src/background/index.ts:3954
// 卖出成功后串行查询 BNB 余额（~50-100ms 延迟）
const perfResult = timer.finish();

let currentBnbBalance: string | undefined;
try {
  const balance = await publicClient.getBalance({ address: walletAccount.address });
  currentBnbBalance = formatEther(balance);
} catch (balanceError) {
  logger.debug('[Sell] 获取当前 BNB 余额失败:', balanceError);
}

return {
  success: true,
  txHash,
  bnbBalance: currentBnbBalance,
  // ...
};
```

**优化方案**:
```typescript
// 在卖出交易发送后，立即并行查询 BNB 余额
// src/background/index.ts:3898 (在交易发送后)

// 步骤5: 执行区块链卖出交易
// ... 卖出交易代码

// 🚀 优化：并行查询 BNB 余额（不等待）
const bnbBalancePromise = publicClient.getBalance({ address: walletAccount.address })
  .then(balance => formatEther(balance))
  .catch(error => {
    logger.debug('[Sell] 获取当前 BNB 余额失败:', error);
    return undefined;
  });

logger.debug(`[Sell] 🎯 总卖出交易耗时: ${perf.measure(sellTxStart).toFixed(2)}ms`);
timer.step(`执行区块链卖出交易 (${perf.measure(stepStart).toFixed(2)}ms)`);

// 步骤6: 清除缓存
// ... 清除缓存代码

// 步骤7: 启动 TxWatcher 监听
// ... TxWatcher 代码

// 等待 BNB 余额查询完成（此时其他步骤已完成）
const currentBnbBalance = await bnbBalancePromise;

const perfResult = timer.finish();
// ...
```

**预期收益**:
- 节省时间: ~30-80ms（BNB 余额查询在后台进行）
- 代码改动: 最小（只需调整查询时机）

**实施难度**: ⭐ 低（10 分钟）

---

### 优化 2: 延长 tokenInfo 缓存 TTL

**当前问题**:
```typescript
// src/background/index.ts:895
const TOKEN_INFO_CACHE_TTL = 2000; // 2秒，对于快速买卖场景太短
```

**优化方案**:
```typescript
// src/background/index.ts
const TOKEN_INFO_CACHE_TTL = 10000; // 改为 10秒

// 或者区分场景
const TOKEN_INFO_CACHE_TTL_POLLING = 2000;      // 轮询刷新：2秒
const TOKEN_INFO_CACHE_TTL_TRANSACTION = 10000; // 交易场景：10秒

// 在 readCachedTokenInfo 中使用
function readCachedTokenInfo(tokenAddress: string, walletAddress: string, needAllowances: boolean, context: 'polling' | 'transaction' = 'transaction') {
  const entry = tokenInfoStore.get(tokenAddress, walletAddress, {
    maxAge: context === 'transaction' ? TOKEN_INFO_CACHE_TTL_TRANSACTION : TOKEN_INFO_CACHE_TTL_POLLING,
    minConfidence: 80
  });
  // ...
}
```

**注意**: 由于已实现 TokenInfoStore，这个优化已经间接支持（通过 maxAge 参数）。只需要在调用时传递更长的 maxAge。

**预期收益**:
- 缓存命中率提升: ~50-70%
- prepareTokenSell 性能提升: ~100-300ms（当缓存命中时）

**实施难度**: ⭐ 低（5 分钟）

---

## 🔧 短期优化（1-2 天，预期收益: ~150-400ms）

### 优化 3: 智能授权查询跳过

**当前实现** (部分优化):
```typescript
// src/shared/trading-channels.ts:3385
const hint = getTokenTradeHint(tokenAddress);
const knownMode = hasSellCache ? hint?.lastMode : null;

if (knownMode === 'v2') {
  shouldSkipV3 = true;
} else if (knownMode === 'v3') {
  shouldSkipV2 = true;
}
```

**进一步优化**:
```typescript
// 新增：记录最近一次交易的详细信息
type LastTradeInfo = {
  type: 'buy' | 'sell';
  mode: 'v2' | 'v3';
  timestamp: number;
  tokenAddress: string;
};

const lastTradeCache = new Map<string, LastTradeInfo>();

// 在交易成功后记录
function recordLastTrade(tokenAddress: string, type: 'buy' | 'sell', mode: 'v2' | 'v3') {
  lastTradeCache.set(tokenAddress.toLowerCase(), {
    type,
    mode,
    timestamp: Date.now(),
    tokenAddress
  });
}

// 在卖出前查询
function getSmartAuthSkipStrategy(tokenAddress: string): { skipV2: boolean; skipV3: boolean } {
  const lastTrade = lastTradeCache.get(tokenAddress.toLowerCase());

  // 如果 1 分钟内有买入交易，直接使用相同的路由
  if (lastTrade && lastTrade.type === 'buy' && Date.now() - lastTrade.timestamp < 60000) {
    logger.debug('[SmartAuth] 使用最近买入的路由信息', {
      mode: lastTrade.mode,
      age: Date.now() - lastTrade.timestamp
    });
    return {
      skipV2: lastTrade.mode === 'v3',
      skipV3: lastTrade.mode === 'v2'
    };
  }

  // 否则使用现有的 hint 逻辑
  const hint = getTokenTradeHint(tokenAddress);
  const knownMode = hint?.lastMode;
  return {
    skipV2: knownMode === 'v3',
    skipV3: knownMode === 'v2'
  };
}
```

**预期收益**:
- 快速买卖场景下，跳过 1 个授权查询: ~50-100ms
- 缓存命中率: ~80-90%

**实施难度**: ⭐⭐ 中（1-2 小时）

---

### 优化 4: prepareTokenSell 智能缓存使用

**当前问题**:
```typescript
// src/shared/trading-channels.ts:688
// 只在余额为 0 时重新查询，但余额可能过期
if (balance === 0n && hasValidCache) {
  logger.warn('[PrepareTokenSell] 缓存余额为0，强制重新查询链上余额');
  // 重新查询
}
```

**优化方案**:
```typescript
// 增加余额年龄检查
if (tokenInfo && tokenInfo.balance && tokenInfo.allowances) {
  const balanceAge = Date.now() - (tokenInfo.balanceUpdatedAt || 0);
  const isBalanceFresh = balanceAge < 3000; // 3秒内认为新鲜

  if (isBalanceFresh || balance > 0n) {
    hasValidCache = true;
    logger.debug(`[PrepareTokenSell] 使用缓存 (年龄: ${balanceAge}ms)`);
  } else {
    logger.debug(`[PrepareTokenSell] 缓存过期 (年龄: ${balanceAge}ms)，重新查询`);
    hasValidCache = false;
  }
}
```

**注意**: 这需要在 tokenInfo 中添加 `balanceUpdatedAt` 字段。当前的 TokenInfoStore 已经支持（通过 `updatedAt`）。

**预期收益**:
- 避免使用过期缓存: ~100-300ms（当缓存过期时）
- 减少用户遇到"余额为 0"错误的概率

**实施难度**: ⭐⭐ 中（1-2 小时）

---

## 🏗️ 中期优化（3-5 天，预期收益: ~200-500ms）

### 优化 5: 路由缓存预热

**实施位置**: Content Script

**优化方案**:
```typescript
// src/content/index.ts

// 用户打开代币页面时，预热路由缓存
async function prefetchRoute(tokenAddress: string) {
  // 检查是否已有缓存
  const hint = await sendMessageViaAdapter({
    action: 'get_token_route',
    data: { tokenAddress, force: false }
  });

  if (!hint || !hint.data) {
    logger.debug('[Prefetch] 预热路由缓存', { tokenAddress });

    // 后台预热（不等待，不阻塞 UI）
    sendMessageViaAdapter({
      action: 'prefetch_route',
      data: { tokenAddress }
    }).catch(err => {
      logger.debug('[Prefetch] 预热失败:', err);
    });
  }
}

// 在 loadTokenInfo 后调用
async function loadTokenInfo(tokenAddress) {
  // ... 现有代码

  // 🚀 新增：预热路由
  prefetchRoute(tokenAddress);

  return currentTokenInfo;
}
```

**Backend 支持**:
```typescript
// src/background/index.ts

// 新增 prefetch_route handler
async function handlePrefetchRoute({ tokenAddress }) {
  try {
    // 后台查询路由（不阻塞）
    await resolveTokenRoute(tokenAddress, { force: false });
    logger.debug('[Prefetch] 路由预热成功:', tokenAddress);
  } catch (error) {
    logger.debug('[Prefetch] 路由预热失败:', error);
  }
}
```

**预期收益**:
- 第一次买入性能提升: ~100-300ms
- 用户打开代币页面后，路由已预热好

**实施难度**: ⭐⭐ 中（2-3 小时）

---

### 优化 6: TxWatcher 预热时机优化

**当前问题**:
```typescript
// TxWatcher 在第一次交易时初始化（~200-500ms）
// src/background/index.ts:4914
if (walletPrivateKey && TX_WATCHER_CONFIG.ENABLED) {
  await txWatcher.initialize();  // 阻塞第一次交易
}
```

**优化方案**:
```typescript
// 在钱包解锁后立即预热（后台）
async function handleUnlockWallet({ password }) {
  // ... 解锁逻辑

  if (response.success) {
    // 🚀 后台预热（不等待，不阻塞解锁响应）
    warmupBackgroundServices().catch(err => {
      logger.debug('[Background] 预热失败:', err);
    });
  }

  return response;
}
```

**预期收益**:
- 第一次交易性能提升: ~200-500ms
- 用户解锁后无需等待，立即可以交易

**实施难度**: ⭐ 低（30 分钟）

---

## 📋 实施优先级和时间表

### Phase 1: 立即实施（今天，~20 分钟）

| 优化 | 预期收益 | 实施难度 | 文件 |
|------|---------|---------|------|
| 优化 1: 并行查询 BNB 余额 | ~30-80ms | ⭐ 低 | `src/background/index.ts:3898` |
| 优化 2: 延长缓存 TTL | ~100-300ms | ⭐ 低 | `src/background/index.ts:895` |

**总预期收益**: ~130-380ms

### Phase 2: 短期实施（明天，~3-4 小时）

| 优化 | 预期收益 | 实施难度 | 文件 |
|------|---------|---------|------|
| 优化 3: 智能授权跳过 | ~50-100ms | ⭐⭐ 中 | `src/shared/trading-channels.ts:3385` |
| 优化 4: 智能缓存使用 | ~100-300ms | ⭐⭐ 中 | `src/shared/trading-channels.ts:688` |

**总预期收益**: ~150-400ms

### Phase 3: 中期实施（本周，~5-6 小时）

| 优化 | 预期收益 | 实施难度 | 文件 |
|------|---------|---------|------|
| 优化 5: 路由缓存预热 | ~100-300ms | ⭐⭐ 中 | `src/content/index.ts`, `src/background/index.ts` |
| 优化 6: TxWatcher 预热 | ~200-500ms | ⭐ 低 | `src/background/index.ts:4914` |

**总预期收益**: ~300-800ms（第一次交易）

---

## 🎯 总预期收益

| 场景 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| **卖出（后续）** | 265-670ms | 135-290ms | **~130-380ms (49-57%)** |
| **卖出（第一次）** | 950-2400ms | 620-1620ms | **~330-780ms (35-46%)** |
| **买入（后续）** | 210-560ms | 210-560ms | **无变化** |
| **买入（第一次）** | 700-1800ms | 400-1000ms | **~300-800ms (43-56%)** |

**关键收益**:
- ✅ 卖出性能提升: **130-380ms（后续）, 330-780ms（第一次）**
- ✅ 第一次交易优化: **300-800ms**
- ✅ 用户感知延迟降低: **35-57%**

---

## ✅ 验证方法

### 1. 性能日志验证
```typescript
// 在控制台查看性能日志
// [Buy] 交易完成 - 总耗时: XXXms
// [Sell] 交易完成 - 总耗时: XXXms

// 优化前: 卖出 ~400-800ms
// 优化后: 卖出 ~200-400ms
```

### 2. 缓存命中率监控
```typescript
// 添加缓存命中率统计
let cacheHits = 0;
let cacheMisses = 0;

if (hasValidCache) {
  cacheHits++;
  logger.debug('[Cache] 命中率:', (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(2) + '%');
} else {
  cacheMisses++;
}
```

### 3. A/B 测试对比
```typescript
// 测试场景
// 1. 快速买卖（买入后 1 秒内卖出）
// 2. 第一次交易 vs 后续交易
// 3. 不同代币的性能差异
```

---

## 📝 总结

### 核心优化点

1. **并行查询 BNB 余额** - 最简单，收益明显（~30-80ms）
2. **延长缓存 TTL** - 最小改动，收益巨大（~100-300ms）
3. **智能授权跳过** - 精准优化，避免不必要查询（~50-100ms）
4. **TxWatcher 预热** - 用户无感，第一次交易大幅优化（~200-500ms）

### 实施建议

**立即开始**:
- 优化 1 + 优化 2（20 分钟，收益 ~130-380ms）

**明天完成**:
- 优化 3 + 优化 4（3-4 小时，收益 ~150-400ms）

**本周完成**:
- 优化 5 + 优化 6（5-6 小时，收益 ~300-800ms）

**总计投入**: ~9-11 小时
**总计收益**: ~580-1580ms（卖出第一次）, ~130-380ms（卖出后续）
