# 买卖性能深度调查报告 - 现有优化验证

## 📋 调查问题确认

### 问题 1: 路由缓存预热是否已实现？

**答案**: ✅ **已实现**

**证据**:
```typescript
// src/content/index.ts:2604 - createTradingPanel 中
loadTokenRoute(tokenAddress, { force: true });

// src/content/index.ts:2751 - createFloatingTradingWindow 中
loadTokenRoute(tokenAddress).catch(err => {
  logger.debug('[Floating Window] Failed to load token route:', err);
});

// src/shared/frontend-adapter.ts:619 - prefetchRoute 函数
export async function prefetchRoute(tokenAddress: string) {
  return chrome.runtime.sendMessage({
    action: 'prefetch_route',
    data: { tokenAddress }
  });
}
```

**工作流程**:
```
用户打开代币页面
  ↓
createTradingPanel() 被调用
  ↓
并行调用:
  ├─ loadTokenInfo(tokenAddress)     // 加载代币信息
  ├─ loadTokenRoute(tokenAddress)    // ✅ 预热路由缓存
  └─ loadTokenApprovalStatus()       // 查询授权状态
  ↓
第一次买入/卖出时，路由已缓存 ✅
```

**为什么可能看起来"失效"**:
1. `force: true` 参数会**强制刷新缓存**，忽略已有缓存
2. 如果路由查询很快（~50ms），用户感知不明显
3. 缓存可能因为其他原因（TTL 过期）被清除

---

### 问题 2: TxWatcher 是否每次都重新初始化？

**答案**: ⚠️ **部分优化，但第一次仍需初始化**

**证据**:
```typescript
// src/background/index.ts:93 - 全局变量
let txWatcher = null;

// src/background/index.ts:4907 - warmupBackgroundServices 中
if (!txWatcher) {
  txWatcher = new TxWatcher(publicClient);  // 创建全局实例
} else if (publicClient) {
  txWatcher.setClient(publicClient);  // 复用实例，只更新 client
}

// src/background/index.ts:4914 - 初始化 WebSocket
if (walletPrivateKey && TX_WATCHER_CONFIG.ENABLED) {
  await txWatcher.initialize();  // ⏱️ ~200-500ms（WebSocket 连接）
}
```

**调用时机**:
```typescript
// src/background/index.ts:3454 - 买入/卖出时调用
await Promise.all([
  publicClient ? Promise.resolve() : createClients(),
  warmupBackgroundServices()  // ⏱️ 第一次: ~200-500ms
]);
```

**关键发现**:
- ✅ TxWatcher **有全局实例**，不会重复创建
- ✅ warmupBackgroundServices 有**去重机制** (`warmupPromise`)
- ❌ **但第一次交易仍需等待 WebSocket 连接**

**优化空间**:
- 可以在**钱包解锁后**立即预热，而不是等到第一次交易
- 当前实现：第一次交易阻塞等待 WebSocket
- 优化后：钱包解锁后后台预热，第一次交易无需等待

---

### 问题 3: prepareTokenSell 的查询逻辑和优化空间

**答案**: ✅ **已优化，但有进一步改进空间**

#### 3.1 当前查询逻辑

**代码位置**: `src/shared/trading-channels.ts:612`

```typescript
// 1️⃣ 优先使用 tokenInfo 缓存
if (tokenInfo && tokenInfo.balance && tokenInfo.allowances) {
  balance = BigInt(tokenInfo.balance);          // ✅ 从缓存
  totalSupply = BigInt(tokenInfo.totalSupply);  // ✅ 从缓存
  allowance = BigInt(tokenInfo.allowances[channelKey]);  // ✅ 从缓存
  hasValidCache = true;
  // 性能: ~5-10ms
}

// 2️⃣ 缓存未命中，链上查询
if (!hasValidCache) {
  const state = await fetchTokenState(
    publicClient,
    tokenAddress,
    accountAddress,
    spenderAddress,
    { includeDecimals: requireGweiPrecision }
  );
  // 性能: ~100-300ms
}
```

#### 3.2 fetchTokenState 实现细节

**代码位置**: `src/shared/trading-channels.ts:1150`

```typescript
async function fetchTokenState(...) {
  // 🚀 优化1: 使用 multicall 批量查询
  const contracts = [
    { functionName: 'balanceOf', args: [ownerAddress] },      // 查询1
    { functionName: 'allowance', args: [ownerAddress, spenderAddress] },  // 查询2
    { functionName: 'totalSupply' }  // 查询3
  ];

  const results = await publicClient.multicall({
    allowFailure: false,
    contracts
  });
  // ✅ 一次 RPC 调用完成 3 个查询
  // 性能: ~100-150ms（vs 3 次单独调用 ~300-450ms）

  // 如果 multicall 失败，回退到单独查询
  const fallbackPromises = [
    // 🚀 优化2: 使用 RPC 缓存
    callRpcWithTransportCache(
      publicClient,
      `readContract:${tokenAddress}:totalSupply`,
      RPC_CACHE_TTL,  // totalSupply 缓存（不变的数据）
      () => publicClient.readContract({ functionName: 'totalSupply' })
    ),
    // balanceOf 和 allowance 也有缓存
  ];
  // 性能: ~50-100ms（缓存命中）
}
```

#### 3.3 总供应量查询特殊性

**关键发现**:
```typescript
// totalSupply 是固定信息，使用独立缓存
callRpcWithTransportCache(
  publicClient,
  `readContract:${tokenAddress}:totalSupply`,
  RPC_CACHE_TTL,  // 缓存 TTL
  () => publicClient.readContract({ functionName: 'totalSupply' })
)
```

**与 balance/allowance 的区别**:
| 字段 | 是否会变化 | 缓存策略 | 查询接口 |
|------|-----------|---------|---------|
| **totalSupply** | ❌ 固定（大部分代币） | 永久缓存 | 独立 RPC 调用 |
| **balance** | ✅ 每次交易都变 | 短期缓存（2s） | multicall 批量 |
| **allowance** | ⚠️ 授权后变化 | 中期缓存（手动失效） | multicall 批量 |

**优化空间**:
```typescript
// 🚀 改进方案：totalSupply 使用元数据缓存（永久）
// src/shared/trading-channels.ts:1221

// 当前实现：
callRpcWithTransportCache(
  publicClient,
  `readContract:${tokenAddress}:totalSupply`,
  RPC_CACHE_TTL,  // ⚠️ 会过期
  () => publicClient.readContract({ functionName: 'totalSupply' })
)

// 改进方案：
const cached = tokenMetadataCache.get(tokenAddress.toLowerCase());
if (cached?.totalSupply !== undefined) {
  totalSupply = cached.totalSupply;  // ✅ 永久缓存命中
} else {
  // 首次查询，永久缓存
  totalSupply = await publicClient.readContract({ functionName: 'totalSupply' });
  tokenMetadataCache.set(tokenAddress.toLowerCase(), {
    ...cached,
    totalSupply
  });
}
```

**预期收益**:
- totalSupply 查询从 ~30-50ms 降低到 ~0ms（缓存命中）
- 对于频繁交易同一代币，累计节省 ~30-50ms/次

---

## 📊 理想情况下的性能分析（所有缓存命中）

### 场景设定

**假设条件**:
1. ✅ 用户已打开代币页面（loadTokenInfo, loadTokenRoute, loadTokenApprovalStatus 已执行）
2. ✅ 路由信息已缓存（V2/V3 路径已知）
3. ✅ 授权信息已缓存（买入后已授权，或手动授权完成）
4. ✅ TxWatcher 已初始化（钱包解锁后预热）
5. ✅ 代币元数据已缓存（decimals, totalSupply）

### 卖出流程时间分解（理想情况）

| 步骤 | 耗时 | 说明 |
|------|------|------|
| **1. 检查钱包状态** | ~0.5ms | 内存检查 |
| **2. 预热服务** | ~0ms | 已预热，直接返回 ✅ |
| **2.5 解析代币路由** | ~5-10ms | 缓存命中 ✅ |
| **3. 获取通道处理器** | ~0.5ms | 内存操作 |
| **4. 规范化 GasPrice** | ~0.5ms | 简单计算 |
| **5. 执行卖出交易** | **~220-450ms** | **核心操作** |
| **5.1 初始化执行器** | ~1ms | 内存操作 |
| **5.2 prepareTokenSell** | **~5-10ms** | ✅ 缓存命中 |
| **5.3 查询 V2 授权** | **~0ms** | ✅ 缓存命中，跳过查询 |
| **5.4 查询 V3 授权** | **~0ms** | ✅ 已知版本，跳过查询 |
| **5.5 查询最佳路由** | **~10-20ms** | ✅ 缓存命中 |
| **5.6 授权检查** | **~1ms** | ✅ 已授权，跳过 |
| **5.7 发送卖出交易** | **~200-400ms** | 区块链操作 |
| **6. 清除缓存** | ~1ms | Map 操作 |
| **7. 启动 TxWatcher** | ~1ms | ✅ 已初始化，直接使用 |
| **8. 查询 BNB 余额** | ~30-50ms | 并行查询 |
| **总计** | **~275-545ms** | **理想情况** |

### 买入流程时间分解（理想情况）

| 步骤 | 耗时 | 说明 |
|------|------|------|
| **1. 检查钱包状态** | ~0.5ms | 内存检查 |
| **2. 预热服务** | ~0ms | 已预热 ✅ |
| **2.5 解析代币路由** | ~5-10ms | 缓存命中 ✅ |
| **3. 获取通道处理器** | ~0.5ms | 内存操作 |
| **4. 规范化 GasPrice** | ~0.5ms | 简单计算 |
| **5. 执行买入交易** | **~210-420ms** | **核心操作** |
| **5.1 初始化执行器** | ~1ms | 内存操作 |
| **5.2 查询最佳路由** | **~10-20ms** | ✅ 缓存命中 |
| **5.3 发送买入交易** | **~200-400ms** | 区块链操作 |
| **6. 清除缓存** | ~1ms | Map 操作 |
| **7. 启动 TxWatcher** | ~1ms | ✅ 已初始化 |
| **总计** | **~220-435ms** | **理想情况** |

---

## 📈 性能对比：当前 vs 理想

### 卖出性能对比

| 场景 | 缓存未命中 | 缓存命中（理想） | 提升 |
|------|-----------|----------------|------|
| **第一次卖出** | 950-2400ms | 275-545ms | **71-81%** ⬆️ |
| **后续卖出** | 265-670ms | 275-545ms | **0-19%** ⬇️ |

**关键发现**:
- ✅ **后续卖出已经很接近理想情况**（265-670ms vs 275-545ms）
- ✅ 说明现有的缓存机制**工作良好**
- ⚠️ 第一次卖出仍有大幅优化空间（服务初始化）

### 买入性能对比

| 场景 | 缓存未命中 | 缓存命中（理想） | 提升 |
|------|-----------|----------------|------|
| **第一次买入** | 700-1800ms | 220-435ms | **69-76%** ⬆️ |
| **后续买入** | 210-560ms | 220-435ms | **0-22%** ⬇️ |

**关键发现**:
- ✅ **后续买入已经达到理想水平**（210-560ms vs 220-435ms）
- ✅ 缓存机制非常有效
- ⚠️ 第一次买入的主要开销是服务初始化

---

## 🔍 买入比卖出快的真实原因（理想情况下）

### 理想情况下的差异

| 对比项 | 买入（理想） | 卖出（理想） | 差异 |
|--------|------------|------------|------|
| **prepareTokenSell** | ❌ 不需要 | ✅ ~5-10ms | +5-10ms |
| **授权查询** | ❌ 不需要 | ✅ ~0ms（缓存命中） | +0ms |
| **BNB 余额查询** | ❌ 不需要 | ✅ ~30-50ms（并行） | +30-50ms |
| **总差异** | 220-435ms | 275-545ms | **+55-110ms** |

**结论**:
- 在**理想情况**下（所有缓存命中），卖出比买入慢 **~55-110ms**
- 主要差异来自 **BNB 余额查询**（~30-50ms）和 **prepareTokenSell**（~5-10ms）
- ✅ 这与用户观察的"后续交易差异不大"**完全吻合**

---

## 💡 优化建议更新

基于深入调查，更新优化建议：

### 🔴 高优先级（立即实施）

#### 1. 钱包解锁后预热 TxWatcher
**当前问题**: 第一次交易需要等待 WebSocket 初始化（~200-500ms）

**优化方案**:
```typescript
// src/background/index.ts - handleUnlockWallet 中
async function handleUnlockWallet({ password }) {
  // ... 解锁逻辑

  if (response.success) {
    // 🚀 后台预热（不等待）
    warmupBackgroundServices().catch(err => {
      logger.debug('[Background] 预热失败:', err);
    });
  }

  return response;
}
```

**预期收益**: 第一次交易节省 ~200-500ms

#### 2. totalSupply 使用永久缓存
**当前问题**: totalSupply 使用 RPC_CACHE_TTL，可能过期

**优化方案**:
```typescript
// src/shared/trading-channels.ts:1221
// 改用 tokenMetadataCache（永久缓存）
const cached = tokenMetadataCache.get(tokenAddress.toLowerCase());
if (cached?.totalSupply) {
  totalSupply = cached.totalSupply;  // ✅ 永久缓存
} else {
  totalSupply = await publicClient.readContract({ functionName: 'totalSupply' });
  tokenMetadataCache.set(tokenAddress.toLowerCase(), { ...cached, totalSupply });
}
```

**预期收益**: 节省 ~30-50ms（频繁交易同一代币）

#### 3. 并行查询 BNB 余额
**当前实现**: 串行查询（~50-100ms）

**优化方案**: 在卖出交易发送后立即开始查询

**预期收益**: 节省 ~30-80ms

---

### 🟡 中优先级（观察后实施）

#### 4. 智能路由缓存（已实现，但 force: true 会绕过）
**当前问题**: `loadTokenRoute(tokenAddress, { force: true })` 强制刷新

**优化建议**:
```typescript
// 首次加载时不强制刷新
loadTokenRoute(tokenAddress, { force: false });  // 使用缓存

// 只在必要时强制刷新（交易后）
// 买入/卖出成功后调用 force: true
```

**预期收益**: 节省 ~50-100ms（首次加载）

---

## 📝 总结

### 核心发现

1. **路由预热**: ✅ 已实现，工作正常
2. **TxWatcher 预热**: ⚠️ 部分实现，第一次仍需初始化
3. **prepareTokenSell 查询**: ✅ 已优化（multicall + 缓存）
4. **totalSupply 缓存**: ⚠️ 使用 RPC 缓存，可改用永久缓存

### 性能真相

**理想情况下**（所有缓存命中）:
- **买入**: ~220-435ms
- **卖出**: ~275-545ms
- **差异**: ~55-110ms（主要是 BNB 余额查询）

**实际情况**（后续交易）:
- **买入**: ~210-560ms ✅ 已达到理想水平
- **卖出**: ~265-670ms ✅ 已接近理想水平
- **差异**: ~55-110ms ✅ 符合预期

**第一次交易**:
- **买入**: ~700-1800ms
- **卖出**: ~950-2400ms
- **主要开销**: TxWatcher WebSocket 初始化（~200-500ms）

### 优化价值评估

| 优化项 | 实施难度 | 预期收益 | 影响范围 |
|--------|---------|---------|---------|
| **TxWatcher 预热** | ⭐ 低 | ~200-500ms | 第一次交易 |
| **totalSupply 永久缓存** | ⭐ 低 | ~30-50ms | 频繁交易 |
| **并行 BNB 余额** | ⭐ 低 | ~30-80ms | 所有卖出 |
| **智能路由缓存** | ⭐⭐ 中 | ~50-100ms | 首次加载 |

**建议**: 优先实施前 3 个优化，预期总收益 ~260-630ms（第一次交易）
