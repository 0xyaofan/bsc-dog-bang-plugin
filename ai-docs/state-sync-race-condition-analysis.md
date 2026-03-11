# 快速买卖交互中的状态同步问题分析报告

## 📋 执行总结

本报告深入分析了买入和卖出流程中的所有状态更新点，识别出**6个关键竞态条件**和**4个缓存不一致问题**。主要发现：

1. **买入成功后的缓存更新存在时间窗口**：买入交易发送后立即清除缓存，但余额更新推送需要等待交易确认（500ms延迟）
2. **卖出前余额获取存在多个数据源**：UI显示余额、currentTokenInfo缓存、链上查询，三者可能不一致
3. **tokenInfo缓存的TTL过短（2秒）**：在快速交易场景下，缓存可能在买入成功和卖出准备之间过期
4. **并发交易使用nonceMutex保护**：但UI层面的currentTokenInfo状态更新不在保护范围内

---

## 🔄 完整数据流图

### 1. 买入流程的状态更新链路

```
用户点击买入
    ↓
handleBuyToken (background/index.ts:3407)
    ↓
[步骤1] 检查钱包状态
    ↓
[步骤2] 初始化客户端和预热服务
    ↓
[步骤2.5] 解析代币路由 (resolveTokenRoute)
    ↓
[步骤3-5] 执行区块链买入交易
    ↓
[步骤6] 清除缓存 (background/index.ts:3610)
    ├─ invalidateWalletDerivedCaches(walletAccount.address, tokenAddress)
    │   ├─ 清除 balance:${scope}:${wallet}
    │   ├─ 清除 tokenBalance:${scope}:${wallet}:${token}
    │   ├─ 清除 token-info-balance:${scope}:${token}:${wallet}
    │   └─ invalidateTokenInfoCache → 删除 tokenInfoCache
    ↓
[步骤7] 启动 TxWatcher 监听
    ├─ watchTransaction(txHash, onTxConfirmed)
    └─ 交易确认后触发 onTxConfirmed (background/index.ts:4790)
        ↓
        [交易成功时]
        ├─ setTimeout(() => pushWalletStatusToAllTabs(), 500)  // ⚠️ 500ms延迟
        ├─ invalidateWalletDerivedCaches(walletAccount.address, tokenAddress, { allowances: false })
        └─ refreshTokenInfoAfterTx(tokenAddress, { includeAllowances: false })
            ├─ fetchTokenInfoData(tokenAddress, walletAddress, false)
            ├─ writeCachedTokenInfo(tokenAddress, walletAddress, latestInfo)
            └─ pushTokenBalanceToAllTabs(tokenAddress, { balance: latestInfo.balance })
                ↓
                broadcastToContentPorts({ action: 'token_balance_updated', ... })
                    ↓
                    [Content Script 接收]
                    handleTokenBalancePush (content/index.ts:3896)
                    ├─ 更新 currentTokenInfo.balance
                    ├─ 更新 DOM 元素显示
                    └─ updateTokenBalanceDisplay()
```

**关键时间点**：
- T0: 买入交易发送成功
- T0+0ms: 立即清除缓存（invalidateWalletDerivedCaches）
- T0+X ms: 交易在链上确认（X通常为1-3秒）
- T0+X+500ms: 推送钱包状态更新到UI
- T0+X+500ms: refreshTokenInfoAfterTx 查询链上余额并更新缓存

### 2. 卖出流程的余额获取链路

```
用户点击卖出
    ↓
handleSell (content/index.ts:1747)
    ↓
[前置检查1] 检查是否有待确认的买入交易
    ├─ hasPendingBuy = pendingTransactions 中是否有 type='buy' 的交易
    └─ if (!hasPendingBuy) → 检查 UI 显示余额是否为0
        ├─ 从 DOM 元素 'token-balance' 读取余额
        └─ 如果余额 < 0.001 → 抛出错误"代币余额为0"
    ↓
[前置检查2] 确保 currentTokenInfo 有授权信息 (content/index.ts:1852)
    ├─ if (!currentTokenInfo || !currentTokenInfo.allowances)
    └─ updateTokenAllowances(tokenAddress, channel)
    ↓
[前置检查3] 如果有待确认的买入，强制刷新余额 (content/index.ts:1859)
    ├─ if (hasPendingBuy)
    └─ updateTokenBalance(tokenAddress)
        ├─ sendMessageViaAdapter({ action: 'get_token_info', needApproval: false })
        ├─ background 返回 tokenInfo (可能使用缓存或链上查询)
        └─ 更新 currentTokenInfo.balance
    ↓
[发送卖出请求] sendMessageViaAdapter({ action: 'sell_token', tokenInfo: currentTokenInfo })
    ↓
handleSellToken (background/index.ts:3701)
    ↓
[步骤2.5] 解析代币路由 (resolveTokenRoute)
    ↓
[步骤5] 执行区块链卖出交易
    ├─ channelHandler.sell({ tokenInfo: tokenInfo })
    │   ↓
    │   prepareTokenSell (trading-channels.ts:612)
    │   ├─ [尝试1] 使用传入的 tokenInfo 缓存
    │   │   ├─ if (tokenInfo && tokenInfo.balance && tokenInfo.allowances)
    │   │   │   ├─ balance = BigInt(tokenInfo.balance)
    │   │   │   └─ allowance = BigInt(tokenInfo.allowances[channelKey])
    │   │   └─ hasValidCache = true
    │   ├─ [尝试2] 如果缓存未命中，链上查询
    │   │   └─ fetchTokenState(publicClient, tokenAddress, accountAddress, spenderAddress)
    │   ├─ [修复逻辑] 如果缓存余额为0，强制重新查询 (trading-channels.ts:688)
    │   │   └─ if (balance === 0n && hasValidCache) → 重新查询链上余额
    │   └─ 计算卖出数量：amountToSell = balance * percent / 100
    ↓
[步骤6] 清除缓存
    ├─ invalidateWalletDerivedCaches(walletAccount.address, tokenAddress, { allowances: true })
    └─ 注意：这次包含 allowances 缓存
```

**余额来源的优先级**：
1. **UI显示余额**（DOM元素）：用于卖出前的0余额检查
2. **currentTokenInfo.balance**（Content Script缓存）：传递给background的tokenInfo参数
3. **tokenInfoCache**（Background缓存，TTL=2秒）：get_token_info handler返回
4. **链上查询**：缓存过期或未命中时查询

---

## ⚠️ 识别的竞态条件

### 竞态条件 1：买入成功 → 卖出准备的缓存时间窗口

**场景**：用户在买入交易确认前立即点击卖出

```
时间线：
T0: 买入交易发送成功
T0+0ms: 清除 tokenInfoCache（balance、allowances）
T0+100ms: 用户点击卖出（此时链上余额已更新，但缓存已被清除）
T0+100ms: handleSell → hasPendingBuy=true，强制刷新余额
T0+100ms: updateTokenBalance → 调用 get_token_info
T0+100ms: get_token_info → tokenInfoCache已清除，查询链上余额（✅正确）
T0+100ms: 返回最新余额，更新 currentTokenInfo
T0+150ms: 发送卖出请求，携带 currentTokenInfo
T0+1000ms: 交易确认
T0+1500ms: refreshTokenInfoAfterTx 更新缓存
```

**问题**：虽然代码已实现 `hasPendingBuy` 检测和强制刷新，但仍存在以下风险：
- 如果网络延迟，链上余额查询可能需要100-300ms
- 在此期间，用户可能多次点击卖出按钮
- `isSidePanelTrading` 锁只在单次卖出请求内有效，不能阻止连续快速点击

**修复状态**：✅ 已部分修复（content/index.ts:1859-1861）
- 有 `hasPendingBuy` 检测
- 强制刷新余额
- 但缺少对余额查询结果的验证

### 竞态条件 2：tokenInfoCache 的 TTL 与快速交易的冲突

**场景**：买入成功后2秒内发起卖出

```
时间线：
T0: 买入交易发送成功
T0+0ms: 清除 tokenInfoCache
T0+1000ms: 交易确认
T0+1500ms: refreshTokenInfoAfterTx 写入 tokenInfoCache（balance=新余额，updatedAt=T0+1500ms）
T0+3600ms: 用户点击卖出（距离缓存更新已过2100ms，超过2000ms TTL）
T0+3600ms: get_token_info → readCachedTokenInfo
    ├─ Date.now() - cached.updatedAt = 2100ms > 2000ms
    ├─ tokenInfoCache.delete(key)  // 缓存过期，删除
    └─ 返回 null
T0+3600ms: get_token_info → 缓存未命中，查询链上（✅正确，但增加延迟）
```

**问题**：
- `TOKEN_INFO_CACHE_TTL = 2000ms`（background/index.ts:894）对于快速交易场景过短
- 买入确认后的缓存刷新时间点：T0 + 交易确认时间 + 500ms延迟
- 如果用户在3-5秒内发起卖出，缓存可能已过期
- 导致不必要的链上查询，增加延迟

**建议修复**：
- 区分"快速轮询场景"和"交易场景"的缓存TTL
- 对于交易相关的余额查询，使用更长的TTL（如5-10秒）

### 竞态条件 3：UI层 currentTokenInfo 与 Background tokenInfoCache 的不同步

**场景**：Background推送余额更新，但Content Script未及时处理

```
时间线：
[Background]
T0+1500ms: refreshTokenInfoAfterTx
    ├─ writeCachedTokenInfo(tokenAddress, walletAddress, latestInfo)
    └─ pushTokenBalanceToAllTabs(tokenAddress, { balance: '1000000000000000000' })

[Content Script]
T0+1500ms: 接收 token_balance_updated 消息
T0+1500ms: handleTokenBalancePush
    ├─ if (data.tokenAddress === currentTokenAddress)  // ⚠️ 可能不匹配
    ├─ currentTokenInfo.balance = data.balance
    └─ updateTokenBalanceDisplay()

[问题场景]
如果用户在余额推送到达前切换了代币：
- currentTokenAddress 已切换为新代币
- data.tokenAddress 仍是旧代币
- 余额更新被忽略（content/index.ts:3902）
```

**问题**：
- Content Script 的 `currentTokenInfo` 与特定的 `currentTokenAddress` 绑定
- 如果用户快速切换代币，推送的余额更新可能被丢弃
- Background 的 tokenInfoCache 已更新，但 Content 的 currentTokenInfo 未更新

**建议修复**：
- 在 Content Script 维护一个 Map<tokenAddress, TokenInfo> 缓存
- 推送余额更新时，更新对应代币的缓存，而不仅仅是当前代币

### 竞态条件 4：并发卖出与授权状态的同步

**场景**：买入后立即卖出，但授权交易仍在pending

```
时间线：
[买入流程]
T0: 买入交易需要授权
T0+100ms: 发送授权交易（txHash1）
T0+100ms: setApprovalStatus(tokenAddress, spenderAddress, { status: 'pending', txHash: txHash1 })
T0+200ms: 发送买入交易（授权使用nonce机制确保顺序）
T0+1000ms: 授权交易确认
T0+2000ms: 买入交易确认

[卖出流程]
T0+500ms: 用户点击卖出（授权仍在pending）
T0+500ms: prepareTokenSell → 检查授权
    ├─ 缓存的 allowance 可能为0（买入前的状态）
    ├─ 检测到 v2ApprovalStatus.status === 'pending'
    └─ waitForApprovalComplete(tokenAddress, contractAddress, txHash1)
        ├─ 轮询等待授权完成（最多10秒）
        └─ 授权完成后继续卖出
```

**修复状态**：✅ 已修复（trading-channels.ts:3492-3498）
- 实现了 `getApprovalStatus` 和 `waitForApprovalComplete`
- 卖出前检查授权状态，如果pending则等待

### 竞态条件 5：多个Tab同时交易的nonce冲突

**场景**：用户在多个Tab同时点击买入/卖出

```
时间线：
[Tab A]
T0: 点击买入
T0+10ms: nonceMutex.runExclusive → 获取锁
T0+10ms: managedNonceCursor = 100
T0+10ms: 执行买入交易，nonce=100
T0+10ms: managedNonceCursor = 101
T0+500ms: 释放锁

[Tab B]
T0+50ms: 点击卖出
T0+50ms: nonceMutex.runExclusive → 等待锁释放
T0+500ms: 获取锁
T0+500ms: managedNonceCursor = 101
T0+500ms: 执行卖出交易，nonce=101
T0+500ms: managedNonceCursor = 102
```

**修复状态**：✅ 已正确实现
- 使用 `nonceMutex.runExclusive`（async-mutex）确保串行执行
- Background Service Worker 是单例，nonce管理是全局的
- 不同Tab的请求通过Chrome消息机制序列化到Background

### 竞态条件 6：prepareTokenSell 的余额为0修复逻辑的触发时机

**场景**：缓存余额为0，但链上余额已更新

```
时间线：
T0: 买入交易确认，链上余额=1000 tokens
T0+0ms: Background 清除缓存
T0+100ms: 用户点击卖出
T0+100ms: Content Script 的 currentTokenInfo.balance 仍为旧值（可能为0或旧余额）
T0+100ms: 传递 tokenInfo 到 background
T0+100ms: prepareTokenSell 检查 tokenInfo.balance
    ├─ if (tokenInfo && tokenInfo.balance)
    │   └─ balance = BigInt(tokenInfo.balance)  // ⚠️ 可能为0
    ├─ hasValidCache = true
    ├─ if (balance === 0n && hasValidCache)  // ✅ 触发修复逻辑
    │   └─ 重新查询链上余额
    └─ 获取正确余额
```

**修复状态**：✅ 已修复（trading-channels.ts:688-708）
- 实现了余额为0时强制重新查询
- 但只在 `hasValidCache=true` 时触发
- 如果 tokenInfo 不存在或无效，会直接走 `fetchTokenState`

**潜在问题**：
- 如果 tokenInfo.balance 存在但数值错误（非0），修复逻辑不会触发
- 建议增加余额合理性验证（例如，与链上查询结果对比）

---

## 🔍 缓存更新时机分析

### 1. tokenInfoCache 的生命周期

| 事件 | 操作 | 位置 | 说明 |
|------|------|------|------|
| **买入交易发送后** | `invalidateTokenInfoCache` | background/index.ts:3610 | 立即清除缓存 |
| **买入交易确认后** | `refreshTokenInfoAfterTx` | background/index.ts:4851 | 查询链上余额并写入缓存 |
| **卖出交易发送后** | `invalidateTokenInfoCache` | background/index.ts:3884 | 清除缓存（包括allowances） |
| **卖出交易确认后** | `refreshTokenInfoAfterTx` | background/index.ts:4851 | 查询链上余额并写入缓存 |
| **授权交易确认后** | `refreshTokenInfoAfterTx` | background/index.ts:4851 | 只更新allowances |
| **get_token_info 调用** | `readCachedTokenInfo` | background/index.ts:4567 | 读取缓存 |
| **get_token_info 调用** | `writeCachedTokenInfo` | background/index.ts:4574 | 链上查询后写入缓存 |

### 2. currentTokenInfo（Content Script）的生命周期

| 事件 | 操作 | 位置 | 说明 |
|------|------|------|------|
| **代币切换** | `currentTokenInfo = null` | content/index.ts:2632 | 清空缓存 |
| **loadTokenInfo** | 创建 currentTokenInfo | content/index.ts:1217 | 首次加载代币信息 |
| **updateTokenBalance** | 更新 balance 字段 | content/index.ts:1139 | 余额查询后更新 |
| **updateTokenAllowances** | 更新 allowances 字段 | content/index.ts:1182 | 授权查询后更新 |
| **handleTokenBalancePush** | 更新 balance 字段 | content/index.ts:3928 | 接收推送更新 |
| **交易确认后** | updateTokenBalance | content/index.ts:3699 | 买入/卖出成功后刷新 |

### 3. UI显示余额的更新时机

| 事件 | 操作 | 位置 | 说明 |
|------|------|------|------|
| **loadTokenInfo** | updateTokenBalanceDisplay | content/index.ts:1232 | 首次加载 |
| **updateTokenBalance** | updateTokenBalanceDisplay | content/index.ts:1144 | 主动刷新 |
| **handleTokenBalancePush** | 直接更新DOM | content/index.ts:3951 | 推送更新 |
| **handleTokenBalancePush** | updateTokenBalanceDisplay | content/index.ts:3961 | 确保一致性 |

### 4. 缓存失效的触发条件

#### Background tokenInfoCache 失效：
1. **时间过期**：`Date.now() - cached.updatedAt > 2000ms`
2. **主动清除**：`invalidateTokenInfoCache()` 在交易发送后
3. **需要授权信息但缓存无授权**：`needAllowances && !cached.hasAllowances`

#### Content currentTokenInfo 失效：
1. **代币切换**：`onTokenChange` → `currentTokenInfo = null`
2. **从未加载**：`currentTokenInfo === null`

---

## 💡 可能的解决方案建议

### 方案 1：增强缓存一致性保障（推荐）

**目标**：确保快速买卖场景下，卖出能获取到正确的余额

**实施步骤**：

1. **调整 tokenInfoCache TTL**
```typescript
// background/index.ts
const TOKEN_INFO_CACHE_TTL = 5000; // 从2秒增加到5秒

// 或者区分场景
const TOKEN_INFO_CACHE_TTL_POLLING = 1000; // 快速轮询：1秒
const TOKEN_INFO_CACHE_TTL_TRANSACTION = 10000; // 交易场景：10秒

function readCachedTokenInfo(tokenAddress: string, walletAddress: string, needAllowances: boolean, context: 'polling' | 'transaction' = 'polling') {
  const ttl = context === 'transaction' ? TOKEN_INFO_CACHE_TTL_TRANSACTION : TOKEN_INFO_CACHE_TTL_POLLING;
  // ... 使用对应的TTL
}
```

2. **优化买入成功后的缓存刷新时机**
```typescript
// background/index.ts:4844
if (isSuccess) {
  // ❌ 当前：500ms后才推送
  setTimeout(() => {
    pushWalletStatusToAllTabs();
  }, 500);

  // ✅ 改进：立即刷新缓存并推送
  if (tradeContext?.tokenAddress && walletAccount?.address) {
    invalidateWalletDerivedCaches(walletAccount.address, tradeContext.tokenAddress, {
      allowances: tradeContext.type === 'sell'
    });
    // 立即刷新余额（不等待500ms）
    await refreshTokenInfoAfterTx(tradeContext.tokenAddress, {
      includeAllowances: tradeContext.type === 'sell'
    });
    // 然后推送更新
    pushWalletStatusToAllTabs();
  }
}
```

3. **在 prepareTokenSell 中增加余额验证**
```typescript
// trading-channels.ts:688
// ✅ 当前已实现：余额为0时重新查询
if (balance === 0n && hasValidCache) {
  logger.warn('[PrepareTokenSell] 缓存余额为0，强制重新查询链上余额');
  // ... 重新查询
}

// 🚀 增强：验证余额合理性
if (hasValidCache && balance > 0n) {
  // 可选：并发查询链上余额进行对比
  const chainBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [accountAddress]
  });

  if (chainBalance !== balance) {
    logger.warn('[PrepareTokenSell] 缓存余额与链上不一致，使用链上余额', {
      cached: balance.toString(),
      chain: chainBalance.toString()
    });
    balance = chainBalance;
  }
}
```

### 方案 2：实现乐观更新机制

**目标**：在交易发送后立即更新UI显示，不等待链上确认

**实施步骤**：

1. **买入后立即估算新余额**
```typescript
// background/index.ts:3652
return {
  success: true,
  txHash,
  channel: resolvedChannelId,
  route: clientRouteInfo || undefined,
  // 🚀 新增：估算的代币余额（用于乐观更新）
  estimatedTokenBalance: {
    tokenAddress: normalizedTokenAddress,
    estimatedAmount: '...' // 根据买入金额和当前价格估算
  },
  performance: { ... }
};
```

2. **Content Script 接收乐观更新**
```typescript
// content/index.ts:1074
const response = await sendMessageViaAdapter({ action: 'buy_token', ... });

if (response.success) {
  pendingTransactions.set(response.txHash, { type: 'buy', token: tokenAddress });

  // 🚀 乐观更新：立即显示估算余额
  if (response.estimatedTokenBalance) {
    if (!currentTokenInfo) {
      currentTokenInfo = { ... };
    }
    currentTokenInfo.balance = response.estimatedTokenBalance.estimatedAmount;
    currentTokenInfo.isEstimated = true; // 标记为估算值
    updateTokenBalanceDisplay(tokenAddress);
  }

  // ... 显示成功消息
}
```

3. **交易确认后替换为真实余额**
```typescript
// content/index.ts:3699
if (pendingInfo?.type === 'buy' || pendingInfo?.type === 'sell') {
  // 买卖交易：更新余额
  await updateTokenBalance(currentTokenAddress);

  // 移除估算标记
  if (currentTokenInfo) {
    currentTokenInfo.isEstimated = false;
  }
}
```

### 方案 3：增强卖出前的余额验证

**目标**：确保卖出请求发送前，余额数据是准确的

**实施步骤**：

1. **卖出前强制查询链上余额（对于快速交易场景）**
```typescript
// content/index.ts:1857
// ✅ 当前：只在有 hasPendingBuy 时刷新
if (hasPendingBuy) {
  logger.debug('[Dog Bang] 检测到待确认的买入交易，强制刷新余额');
  await updateTokenBalance(tokenAddress);
}

// 🚀 增强：检查余额是否可能过期
const balanceAge = Date.now() - (currentTokenInfo?.balanceUpdatedAt || 0);
const isBalanceStale = balanceAge > 3000; // 3秒内的余额被认为是新鲜的

if (hasPendingBuy || isBalanceStale) {
  logger.debug('[Dog Bang] 余额可能过期，强制刷新', {
    hasPendingBuy,
    balanceAge,
    isBalanceStale
  });
  await updateTokenBalance(tokenAddress);
}
```

2. **在 currentTokenInfo 中记录更新时间戳**
```typescript
// content/index.ts:1139
if (response && response.success) {
  if (!currentTokenInfo) {
    currentTokenInfo = { ... };
  } else {
    currentTokenInfo.balance = response.data.balance;
    currentTokenInfo.totalSupply = response.data.totalSupply;
    currentTokenInfo.balanceUpdatedAt = Date.now(); // 🚀 新增时间戳
  }
  // ...
}
```

3. **卖出请求中携带余额时间戳**
```typescript
// content/index.ts:1881
const response = await sendMessageViaAdapter({
  action: 'sell_token',
  data: {
    tokenAddress,
    percent: parseFloat(percent),
    slippage: parseFloat(slippage),
    gasPrice: parseFloat(gasPrice),
    channel,
    forceChannel: userChannelOverride,
    tokenInfo: currentTokenInfo,
    balanceAge: Date.now() - (currentTokenInfo?.balanceUpdatedAt || 0) // 🚀 新增
  }
});
```

4. **Background 根据余额年龄决定是否重新查询**
```typescript
// trading-channels.ts:625
let hasValidCache = false;
const cacheStart = perf.now();
if (tokenInfo && tokenInfo.balance && tokenInfo.allowances) {
  // 🚀 检查余额年龄
  const balanceAge = options?.balanceAge ?? 0;
  const isBalanceFresh = balanceAge < 3000; // 3秒内认为新鲜

  if (isBalanceFresh) {
    balance = BigInt(tokenInfo.balance);
    totalSupply = BigInt(tokenInfo.totalSupply);
    // ... 使用缓存
    hasValidCache = true;
  } else {
    logger.debug('[PrepareTokenSell] 余额过期，重新查询', { balanceAge });
  }
}
```

### 方案 4：实现 Content Script 端的代币信息缓存Map

**目标**：解决快速切换代币时余额推送丢失的问题

**实施步骤**：

1. **维护代币信息缓存**
```typescript
// content/index.ts（全局变量）
const tokenInfoCache = new Map<string, {
  tokenInfo: TokenInfo;
  updatedAt: number;
}>();

const TOKEN_INFO_CLIENT_CACHE_TTL = 10000; // 10秒
```

2. **推送余额更新时，更新缓存**
```typescript
// content/index.ts:3896
function handleTokenBalancePush(data, options: { fromPending?: boolean } = {}) {
  const { fromPending = false } = options;
  if (!data || !data.tokenAddress) return;

  const tokenAddress = data.tokenAddress;

  // 🚀 更新缓存（无论是否为当前代币）
  let cached = tokenInfoCache.get(tokenAddress);
  if (!cached) {
    cached = {
      tokenInfo: {
        address: tokenAddress,
        symbol: '',
        decimals: 18,
        totalSupply: '0',
        balance: data.balance
      },
      updatedAt: Date.now()
    };
  } else {
    cached.tokenInfo.balance = data.balance;
    cached.updatedAt = Date.now();
  }
  tokenInfoCache.set(tokenAddress, cached);

  // 只更新当前代币的UI显示
  if (tokenAddress === currentTokenAddress) {
    currentTokenInfo = cached.tokenInfo;
    // ... 更新UI
  }
}
```

3. **切换代币时，从缓存恢复**
```typescript
// content/index.ts（代币切换逻辑）
async function onTokenChange(newTokenAddress: string) {
  // 检查缓存
  const cached = tokenInfoCache.get(newTokenAddress);
  const isCacheFresh = cached && (Date.now() - cached.updatedAt < TOKEN_INFO_CLIENT_CACHE_TTL);

  if (isCacheFresh) {
    logger.debug('[Dog Bang] 使用缓存的代币信息', { tokenAddress: newTokenAddress });
    currentTokenInfo = cached.tokenInfo;
    updateTokenBalanceDisplay(newTokenAddress);
    // 异步刷新授权信息（如果需要）
    updateTokenAllowances(newTokenAddress);
  } else {
    // 清空当前信息，重新加载
    currentTokenInfo = null;
    await loadTokenInfo(newTokenAddress);
  }
}
```

---

## 📊 优先级建议

| 方案 | 优先级 | 实施难度 | 预期收益 | 风险 |
|------|--------|----------|----------|------|
| **方案1：增强缓存一致性** | 🔴 高 | 低 | 高 | 低 |
| **方案3：增强卖出前验证** | 🔴 高 | 低 | 中 | 低 |
| **方案2：乐观更新** | 🟡 中 | 中 | 中 | 中（估算不准确） |
| **方案4：Client端缓存Map** | 🟢 低 | 中 | 低 | 低 |

### 推荐实施顺序：

1. **立即实施（高优先级）**：
   - 方案1的第1点：调整tokenInfoCache TTL
   - 方案1的第2点：优化买入成功后的缓存刷新时机
   - 方案3的第1-3点：卖出前余额年龄检查

2. **短期实施（1-2周）**：
   - 方案1的第3点：prepareTokenSell余额验证增强
   - 方案4：Client端缓存Map（可选）

3. **中期优化（1个月）**：
   - 方案2：乐观更新机制（需要完善估算逻辑）

---

## 🧪 测试建议

### 1. 快速买卖场景测试

**测试步骤**：
```
1. 买入代币（金额：0.01 BNB）
2. 等待交易发送成功（不等待确认）
3. 立即点击卖出100%
4. 观察：
   - 是否提示"余额为0"
   - 实际卖出的数量是否正确
   - 卖出后的余额是否为0
```

**预期结果**：
- 不应提示"余额为0"
- 卖出数量应为买入获得的全部代币
- 卖出后余额应为0（或极小的粉尘）

### 2. 买入确认前卖出测试

**测试步骤**：
```
1. 买入代币（金额：0.01 BNB）
2. 在交易确认前（约1秒内）点击卖出100%
3. 观察卖出流程是否正常
```

**预期结果**：
- Content Script 检测到 hasPendingBuy=true
- 强制刷新余额
- 卖出成功

### 3. 缓存过期测试

**测试步骤**：
```
1. 买入代币
2. 等待交易确认（约2秒）
3. 等待缓存过期（再等3秒）
4. 点击卖出
5. 观察是否触发链上查询
```

**预期结果**：
- 缓存已过期，触发链上查询
- 查询成功，卖出正常

### 4. 多Tab并发测试

**测试步骤**：
```
1. 打开2个Tab，访问同一代币页面
2. Tab A：点击买入
3. Tab B：立即点击卖出
4. 观察nonce是否冲突
```

**预期结果**：
- nonceMutex 确保串行执行
- 不会出现nonce冲突
- 两个交易都成功

---

## 📌 总结

### 关键发现：

1. **买入后立即卖出的场景已有部分保护**：
   - `hasPendingBuy` 检测 ✅
   - 强制刷新余额 ✅
   - `prepareTokenSell` 余额为0修复 ✅

2. **仍存在的问题**：
   - tokenInfoCache TTL过短（2秒）
   - 买入确认后的推送延迟（500ms）
   - 余额年龄未跟踪
   - Client端缓存在快速切换代币时可能丢失

3. **根本原因**：
   - **时间窗口问题**：交易发送 → 清除缓存 → 交易确认 → 刷新缓存，存在时间差
   - **缓存TTL设计**：针对快速轮询优化，但不适合快速交易
   - **多层缓存不同步**：Background tokenInfoCache、Content currentTokenInfo、UI显示余额

### 建议优先实施：

1. 调整 tokenInfoCache TTL（5-10秒）
2. 移除买入确认后的500ms推送延迟
3. 增加余额年龄跟踪和卖出前验证
4. 在 prepareTokenSell 中增强余额合理性验证

这些改进可以显著降低快速买卖场景下的余额不一致问题，提升用户体验。
