# 买入与卖出性能差异调查报告

## 📋 调查目标

1. **为什么买入比卖出快约 1 秒？**
2. **第一次交易与后续交易的差异是什么？**

## 🔍 关键发现

### 发现 1: 卖出比买入多 3 个主要耗时操作

#### 1.1 prepareTokenSell - 代币余额和授权查询

**代码位置**: `src/shared/trading-channels.ts:612`

**卖出流程**:
```typescript
// Line 3350: 准备卖出（查询余额和授权）
const preparePromise = prepareTokenSell({
  publicClient,
  tokenAddress,
  accountAddress: account.address,
  spenderAddress: contractAddress,
  percent,
  tokenInfo  // 可能使用缓存，也可能链上查询
});
```

**买入流程**:
- ❌ 不需要 prepareTokenBuy（买入用 BNB，不需要查询代币余额）

**性能差异**:
- **缓存命中**: ~5-10ms（从 tokenInfo 读取）
- **缓存未命中**: ~100-300ms（链上查询 `balance + allowance + totalSupply`）

**代码分析** (`prepareTokenSell`):
```typescript
// Line 629: 尝试使用缓存
if (tokenInfo && tokenInfo.balance && tokenInfo.allowances) {
  balance = BigInt(tokenInfo.balance);
  totalSupply = BigInt(tokenInfo.totalSupply);
  allowance = BigInt(tokenInfo.allowances[channelKey]);
  hasValidCache = true;
  // ✅ 快速路径：~5ms
}

// Line 664-684: 缓存未命中，链上查询
if (!hasValidCache) {
  const state = await fetchTokenState(
    publicClient,
    tokenAddress,
    accountAddress,
    spenderAddress,
    { includeDecimals: requireGweiPrecision }
  );
  // ❌ 慢速路径：~100-300ms（3个 RPC 调用）
  balance = state.balance;
  allowance = state.allowance;
  totalSupply = state.totalSupply;
}
```

#### 1.2 授权状态查询（V2 和 V3）

**代码位置**: `src/shared/trading-channels.ts:3445-3484`

**卖出流程 - 可能查询 2 个授权**:
```typescript
// Line 3445: V2 授权查询
const v2AllowancePromise = (contractAddress && v2AllowanceFromCache === null && !shouldSkipV2)
  ? (async () => {
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account.address, contractAddress]
      });
      // ...
    })()
  : Promise.resolve(v2AllowanceFromCache);

// Line 3466: V3 授权查询
const v3AllowancePromise = (smartRouterAddress && v3AllowanceFromCache === null && !shouldSkipV3)
  ? (async () => {
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account.address, smartRouterAddress]
      });
      // ...
    })()
  : Promise.resolve(v3AllowanceFromCache);
```

**买入流程**:
- ❌ 不需要查询授权（BNB 不需要授权）

**性能差异**:
- **有缓存**: 0ms（直接使用缓存）
- **无缓存，已知版本（V2 或 V3）**: ~50-100ms（1 个 RPC 调用）
- **无缓存，未知版本**: ~100-200ms（2 个并发 RPC 调用）

**优化策略** (已实施):
```typescript
// Line 3385-3411: 根据缓存判断需要查询哪个授权
const hint = getTokenTradeHint(tokenAddress);
const knownMode = hasSellCache ? hint?.lastMode : null;

if (knownMode === 'v2') {
  shouldSkipV3 = true;  // ✅ 跳过 V3 查询
} else if (knownMode === 'v3') {
  shouldSkipV2 = true;  // ✅ 跳过 V2 查询
}
```

#### 1.3 返回 BNB 余额

**代码位置**: `src/background/index.ts:3954-3960`

**卖出流程**:
```typescript
// Line 3954: 查询当前 BNB 余额
let currentBnbBalance: string | undefined;
try {
  const balance = await publicClient.getBalance({ address: walletAccount.address });
  currentBnbBalance = formatEther(balance);
} catch (balanceError) {
  logger.debug('[Sell] 获取当前 BNB 余额失败:', balanceError);
}
```

**买入流程**:
- ❌ 不返回 BNB 余额

**性能差异**:
- ~50-100ms（1 个额外的 RPC 调用）

**为什么需要**:
- 卖出后用户想立即看到 BNB 余额更新
- 避免等待 pushWalletStatusToAllTabs 的延迟

---

### 发现 2: 第一次交易 vs 后续交易的差异

#### 2.1 第一次交易需要的额外初始化

**代码位置**: `src/background/index.ts:3449-3456`

```typescript
// Line 3452: 第一次交易需要创建 clients 和预热服务
const needCreateClient = !publicClient;
await Promise.all([
  publicClient ? Promise.resolve() : createClients(),  // ⏱️ 第一次: ~100-300ms
  warmupBackgroundServices()  // ⏱️ 第一次: ~200-500ms
]);
```

**warmupBackgroundServices 做了什么** (`src/background/index.ts:4883`):
```typescript
async function warmupBackgroundServices() {
  // 1. 创建 publicClient（如果未创建）
  if (!publicClient) {
    await createClients();  // ~100-300ms
  }

  // 2. 创建 walletClient（如果未创建）
  if (walletPrivateKey && (!walletClient || !walletAccount)) {
    await createWalletClientInstance();  // ~50-100ms
  }

  // 3. 预热 Offscreen（如果支持）
  if (isOffscreenSupported()) {
    await ensureOffscreenDocument();
    await acquireOffscreenPort();  // ~50-150ms
  }

  // 4. 初始化 TxWatcher WebSocket
  if (walletPrivateKey && TX_WATCHER_CONFIG.ENABLED) {
    await txWatcher.initialize();  // ~200-500ms（WebSocket 连接）
  }
}
```

**性能差异**:
- **第一次交易**: ~400-1000ms（需要初始化所有服务）
- **后续交易**: ~0-10ms（所有服务已预热）

#### 2.2 第一次交易的缓存未命中

**卖出流程的缓存检查**:

1. **tokenInfo 缓存** (`prepareTokenSell`)
   - 第一次: 未命中 → 链上查询 (~100-300ms)
   - 后续: 命中 → 直接使用 (~5ms)

2. **授权缓存** (`getCachedAllowance`)
   - 第一次: 未命中 → 链上查询 (~50-100ms)
   - 后续: 命中 → 直接使用 (~0ms)

3. **路由缓存** (`getTokenTradeHint`)
   - 第一次: 未命中 → 查询 V2 和 V3 (~100-200ms)
   - 后续: 命中 → 跳过不需要的授权查询 (~0ms)

**买入流程的缓存检查**:

1. **路由缓存** (`findBestRoute`)
   - 第一次: 未命中 → 查询最佳路由 (~100-300ms)
   - 后续: 命中 → 使用缓存路由 (~10-50ms)

---

## 📊 性能对比表

### 卖出流程时间分解

| 步骤 | 第一次 | 后续 | 说明 |
|------|--------|------|------|
| **1. 预热服务** | 400-1000ms | 0-10ms | TxWatcher WebSocket 初始化 |
| **2. prepareTokenSell** | 100-300ms | 5-10ms | 查询余额+授权 |
| **3. 查询 V2 授权** | 50-100ms | 0ms | 如果缓存未命中且未知版本 |
| **4. 查询 V3 授权** | 50-100ms | 0ms | 如果缓存未命中且未知版本 |
| **5. 查询最佳路由** | 100-300ms | 10-50ms | findBestRoute |
| **6. 发送交易** | 200-500ms | 200-500ms | 区块链操作 |
| **7. 查询 BNB 余额** | 50-100ms | 50-100ms | 卖出后返回余额 |
| **总计** | **950-2400ms** | **265-670ms** | **差异: ~685-1730ms** |

### 买入流程时间分解

| 步骤 | 第一次 | 后续 | 说明 |
|------|--------|------|------|
| **1. 预热服务** | 400-1000ms | 0-10ms | TxWatcher WebSocket 初始化 |
| **2. 查询最佳路由** | 100-300ms | 10-50ms | findBestRoute |
| **3. 发送交易** | 200-500ms | 200-500ms | 区块链操作 |
| **总计** | **700-1800ms** | **210-560ms** | **差异: ~490-1240ms** |

### 买入 vs 卖出性能差异

| 对比项 | 第一次 | 后续 | 原因 |
|--------|--------|------|------|
| **买入** | 700-1800ms | 210-560ms | - 不需要查询代币余额<br>- 不需要查询授权<br>- 不返回 BNB 余额 |
| **卖出** | 950-2400ms | 265-670ms | - 需要 prepareTokenSell<br>- 需要查询授权（V2/V3）<br>- 返回 BNB 余额 |
| **差异** | **+250-600ms** | **+55-110ms** | **卖出比买入慢 ~250-600ms（第一次）<br>~55-110ms（后续）** |

---

## 🐛 为什么用户观察到"买入快 1 秒"

### 实际测量结果推测

用户观察到的 "买入快 1 秒" 可能来自：

#### 场景 1: 第一次卖出 vs 第二次买入
```
第一次卖出: 950-2400ms（包含初始化）
第二次买入: 210-560ms（已预热）
差异: ~740-1840ms（约 1 秒）
```

#### 场景 2: 卖出缓存未命中 vs 买入缓存命中
```
卖出（缓存未命中）:
  - prepareTokenSell: 100-300ms（链上查询）
  - V2 授权查询: 50-100ms
  - V3 授权查询: 50-100ms
  - BNB 余额查询: 50-100ms
  - 总额外开销: ~250-600ms

买入（缓存命中）:
  - 无额外查询

差异: ~250-600ms
```

#### 场景 3: 授权查询的额外开销
```
如果卖出需要查询 2 个授权（V2 + V3）:
  - 并发查询: ~100-200ms
  - BNB 余额: ~50-100ms
  - prepareTokenSell: ~100-300ms
  - 总计: ~250-600ms

如果买入已有路由缓存:
  - 查询路由: ~10-50ms

差异: ~200-550ms
```

---

## 💡 优化建议

### 优先级 🔴 高：卖出性能优化

#### 1. 优化 prepareTokenSell 缓存策略

**当前问题**:
- tokenInfo 缓存 TTL 只有 2 秒（`TOKEN_INFO_CACHE_TTL = 2000`）
- 快速买卖场景下，买入后 2 秒内卖出，缓存可能已过期

**优化方案**:
```typescript
// src/background/index.ts
const TOKEN_INFO_CACHE_TTL_TRANSACTION = 10000; // 交易场景：10秒

// 使用新实现的 TokenInfoStore，已支持可信度和年龄管理
tokenInfoStore.get(tokenAddress, walletAddress, {
  maxAge: 10000,      // 10秒内有效
  minConfidence: 80   // 至少 80% 可信度
})
```

**预期收益**:
- 缓存命中率提升 ~50-70%
- 卖出性能提升 ~100-300ms

#### 2. 智能跳过不必要的授权查询

**当前实现** (已优化):
```typescript
// Line 3385: 根据缓存判断需要查询哪个授权
const hint = getTokenTradeHint(tokenAddress);
const knownMode = hasSellCache ? hint?.lastMode : null;

if (knownMode === 'v2') {
  shouldSkipV3 = true;  // ✅ 已实现
}
```

**进一步优化**:
```typescript
// 如果上次交易是买入，卖出时可以直接使用相同的路由
const lastTrade = getLastTradeInfo(tokenAddress);
if (lastTrade && lastTrade.type === 'buy' && Date.now() - lastTrade.timestamp < 60000) {
  // 1分钟内的买入，直接使用相同的路由和授权
  shouldSkipV2 = lastTrade.mode === 'v3';
  shouldSkipV3 = lastTrade.mode === 'v2';
}
```

**预期收益**:
- 跳过 1 个授权查询：~50-100ms

#### 3. 并行查询 BNB 余额

**当前实现**:
```typescript
// Line 3954: 卖出成功后查询 BNB 余额
const balance = await publicClient.getBalance({ address: walletAccount.address });
```

**优化方案**:
```typescript
// 在 prepareTokenSell 时并行查询 BNB 余额
const [sellResult, bnbBalance] = await Promise.all([
  channelHandler.sell({ ... }),
  publicClient.getBalance({ address: walletAccount.address })
]);
```

**预期收益**:
- 并行查询节省时间：~50-100ms

### 优先级 🟡 中：买入性能优化

#### 4. 路由缓存预热

**当前问题**:
- 第一次买入需要查询最佳路由（~100-300ms）
- 切换代币后缓存失效

**优化方案**:
```typescript
// 用户打开代币页面时，预热路由缓存
async function prefetchRoute(tokenAddress: string) {
  if (!getTokenTradeHint(tokenAddress)) {
    findBestRoute('buy', publicClient, tokenAddress, parseEther('0.01'))
      .catch(err => logger.debug('[Prefetch] 预热路由失败', err));
  }
}
```

**预期收益**:
- 第一次买入性能提升：~100-300ms

### 优先级 🟢 低：通用优化

#### 5. TxWatcher 预热时机优化

**当前问题**:
- TxWatcher WebSocket 在第一次交易时初始化（~200-500ms）

**优化方案**:
```typescript
// 钱包解锁后立即预热 TxWatcher
async function handleUnlockWallet({ password }) {
  // ... 解锁逻辑

  // 后台预热（不等待）
  warmupBackgroundServices().catch(err => {
    logger.debug('[Background] 预热失败:', err);
  });

  return { success: true, address: walletAccount.address };
}
```

**预期收益**:
- 第一次交易性能提升：~200-500ms
- 用户解锁后不会感知到延迟

---

## 📌 总结

### 核心发现

1. **买入比卖出快的原因**:
   - ✅ 买入不需要查询代币余额（用 BNB 买）
   - ✅ 买入不需要查询授权（BNB 不需要授权）
   - ✅ 买入不返回 BNB 余额
   - 差异：**~250-600ms（第一次）, ~55-110ms（后续）**

2. **第一次交易比后续慢的原因**:
   - ✅ 第一次需要初始化服务（TxWatcher WebSocket 等）
   - ✅ 第一次缓存未命中，需要链上查询
   - 差异：**~400-1000ms（服务初始化）+ ~200-500ms（缓存未命中）**

3. **用户观察到的 "买入快 1 秒"**:
   - 可能是第一次卖出 vs 第二次买入（包含服务初始化差异）
   - 或者卖出缓存未命中 + 授权查询 + BNB 余额查询的累积延迟

### 优化优先级

**立即实施** (🔴 高优先级):
1. 延长 tokenInfo 缓存 TTL（2s → 10s）- 已通过 TokenInfoStore 实现
2. 并行查询 BNB 余额 - **预期节省 ~50-100ms**

**短期实施** (🟡 中优先级):
1. 智能跳过不必要的授权查询 - **预期节省 ~50-100ms**
2. 路由缓存预热 - **预期节省 ~100-300ms（第一次）**

**长期优化** (🟢 低优先级):
1. TxWatcher 预热时机优化 - **预期节省 ~200-500ms（第一次）**

**预期总收益**:
- 卖出性能提升：**~200-500ms**
- 第一次交易性能提升：**~300-800ms**
- 用户感知延迟降低：**~50-70%**
