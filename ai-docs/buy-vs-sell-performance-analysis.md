# 买入 vs 卖出性能对比分析

## 概述

用户反馈：在实际使用中，买入交易比卖出交易感觉更快。本文档详细对比买入和卖出的完整流程，识别可能导致卖出较慢的因素。

## 流程对比

### 买入流程 (handleBuyToken)

```
1. 检查钱包状态 (~1ms)
2. 初始化客户端和预热服务 (~10-50ms)
3. 解析路由信息 (resolveTokenRoute)
4. 获取通道处理器 (~1ms)
5. 规范化 Gas Price (~1ms)
6. 执行区块链买入交易:
   a. 可能使用 Custom Aggregator
   b. 可能使用 Four Quote Bridge (executeFourQuoteBuy)
   c. 可能使用 Flap Quote (executeFlapQuoteBuy)
   d. 可能使用 XMode Direct Buy
   e. 最后才是 channelHandler.buy()
7. 清除缓存 (~1ms)
8. 启动 TxWatcher 监听 (~5-20ms)
```

### 卖出流程 (handleSellToken)

```
1. 检查钱包状态 (~1ms)
2. 初始化客户端和预热服务 (~10-50ms)
3. 解析路由信息 (resolveTokenRoute)
4. 获取通道处理器 (~1ms)
5. 规范化 Gas Price (~1ms)
6. 执行区块链卖出交易:
   a. 可能使用 Custom Aggregator
   b. 并发执行 channelHandler.sell() 和 getQuoteBalance()
   c. 如果使用 Quote Bridge，调度 settlement 操作
7. 清除缓存 (~1ms)
8. 启动 TxWatcher 监听 (~5-20ms)
```

## Channel 层面对比

### Router Channel - 买入 (buy)

```typescript
async buy({ publicClient, walletClient, account, chain, tokenAddress, amount, slippage, gasPrice, nonceExecutor }) {
  // 1. 解析 BNB 金额
  const amountIn = parseEther(amount);  // ~0.1ms

  // 2. 查询最佳路由
  const routePlan = await findBestRoute('buy', publicClient, tokenAddress, amountIn);  // ~100-300ms

  // 3. 发送交易
  const hash = await sendContractTransaction(...);  // ~50-200ms

  return hash;
}
```

**关键操作**：
- ✅ 简单的金额解析
- ✅ 单次路由查询
- ✅ 直接发送交易
- ❌ 无需查询余额
- ❌ 无需检查授权

### Router Channel - 卖出 (sell)

```typescript
async sell({ publicClient, walletClient, account, chain, tokenAddress, percent, slippage, gasPrice, tokenInfo, nonceExecutor }) {
  // 1. 并发执行：准备卖出 + 查询路由（使用预估金额）
  const preparePromise = prepareTokenSell({...});  // 查询余额、授权、计算卖出数量
  const [initialState, routePlan] = await Promise.all([
    preparePromise,  // ~50-150ms
    findBestRoute('sell', publicClient, tokenAddress, estimatedAmount)  // ~100-300ms
  ]);

  // 2. 如果实际金额与预估差异 > 5%，重新查询路由
  if (diffPercent > 5) {
    finalRoutePlan = await findBestRoute('sell', publicClient, tokenAddress, amountToSell);  // +100-300ms
  }

  // 3. 如果是 V3 路由，重新查询授权状态
  if (finalRoutePlan.kind === 'v3') {
    allowanceValue = await publicClient.readContract({...});  // +20-50ms
  }

  // 4. 检查并执行授权（如果需要）
  await ensureTokenApproval({...});  // 0ms (已授权) 或 2000-5000ms (需要授权)

  // 5. 发送交易
  const hash = await sendContractTransaction(...);  // ~50-200ms

  return hash;
}
```

**关键操作**：
- ✅ 需要查询代币余额
- ✅ 需要计算卖出数量
- ✅ 可能需要重新查询路由（如果金额差异大）
- ✅ 可能需要重新查询授权（V3 路由）
- ✅ 需要检查授权状态
- ⚠️ 可能需要发送授权交易（首次卖出或授权过期）

## prepareTokenSell 详细分析

```typescript
export async function prepareTokenSell({ publicClient, tokenAddress, accountAddress, spenderAddress, percent, tokenInfo }) {
  // 1. 使用缓存或重新查询代币信息
  if (tokenInfo && tokenInfo.balance && tokenInfo.allowance !== undefined) {
    // 使用缓存 (~0.1ms)
    balance = BigInt(tokenInfo.balance);
    allowance = BigInt(tokenInfo.allowance);
    totalSupply = BigInt(tokenInfo.totalSupply);
  } else {
    // 重新查询 (~50-150ms)
    const state = await fetchTokenState(publicClient, tokenAddress, accountAddress, spenderAddress);
    balance = state.balance;
    allowance = state.allowance;
    totalSupply = state.totalSupply;
  }

  // 2. 计算卖出数量 (~0.1ms)
  let amountToSell = percent === 100
    ? balance
    : balance * BigInt(percent) / 100n;

  return { balance, allowance, totalSupply, amountToSell };
}
```

**性能影响**：
- 如果有缓存（tokenInfo）：~0.1ms
- 如果无缓存：~50-150ms（需要 3 次 RPC 调用：balance + allowance + totalSupply）

## 关键差异总结

### 1. 代币余额查询

| 操作 | 买入 | 卖出 |
|------|------|------|
| 需要查询余额 | ❌ 不需要 | ✅ 需要 |
| 查询时机 | - | prepareTokenSell 中 |
| 耗时（有缓存） | - | ~0.1ms |
| 耗时（无缓存） | - | ~50-150ms |

**影响**：如果浮动窗口没有传递 tokenInfo 缓存，卖出会慢 50-150ms

### 2. 路由查询

| 操作 | 买入 | 卖出 |
|------|------|------|
| 查询次数 | 1 次 | 1-2 次 |
| 第一次查询 | 使用精确金额 | 使用预估金额 |
| 第二次查询 | - | 如果金额差异 > 5% |
| 耗时 | ~100-300ms | ~100-300ms (第一次) + 0-300ms (第二次) |

**影响**：如果金额差异大，卖出会慢 100-300ms

### 3. 授权检查

| 操作 | 买入 | 卖出 |
|------|------|------|
| 需要检查授权 | ❌ 不需要 | ✅ 需要 |
| V2 路由 | - | 使用 prepareTokenSell 的结果 |
| V3 路由 | - | 重新查询授权状态 (+20-50ms) |
| 需要授权交易 | - | 首次卖出或授权过期 (+2000-5000ms) |

**影响**：
- V3 路由：+20-50ms
- 需要授权：+2000-5000ms（这是最大的性能瓶颈）

### 4. Quote Settlement

| 操作 | 买入 | 卖出 |
|------|------|------|
| 需要 Settlement | ❌ 不需要 | ✅ 需要（非 BNB 募集） |
| 操作 | - | scheduleFourQuoteSellSettlement() |
| 耗时 | - | ~1ms（异步调度，不阻塞） |

**影响**：几乎无影响（异步操作）

## 性能瓶颈识别

### 主要瓶颈（按影响程度排序）

1. **授权交易**（最大瓶颈）
   - 影响：+2000-5000ms
   - 触发条件：首次卖出或授权过期
   - 优化建议：
     - ✅ 已实现：自动授权模式（buy/sell/switch）
     - ✅ 已实现：授权状态缓存
     - 🔄 可优化：预授权（在买入后立即授权卖出）

2. **代币余额查询**（无缓存时）
   - 影响：+50-150ms
   - 触发条件：浮动窗口未传递 tokenInfo
   - 优化建议：
     - ✅ 已实现：页面切换时预加载余额
     - 🔄 可优化：确保浮动窗口始终传递 tokenInfo

3. **重复路由查询**（金额差异大时）
   - 影响：+100-300ms
   - 触发条件：实际金额与预估差异 > 5%
   - 优化建议：
     - ✅ 已实现：使用缓存余额进行预估
     - 🔄 可优化：提高预估精度，减少重复查询

4. **V3 授权状态重查**
   - 影响：+20-50ms
   - 触发条件：使用 V3 路由
   - 优化建议：
     - 🔄 可优化：在 prepareTokenSell 中同时查询 V2 和 V3 授权

## 实际场景分析

### 场景 1：首次卖出（最慢）

```
买入：~200-500ms
卖出：~2200-5500ms（需要授权交易）

差异：~2000-5000ms（主要是授权交易）
```

### 场景 2：第二次卖出（已授权，有缓存）

```
买入：~200-500ms
卖出：~200-600ms

差异：~0-100ms（几乎相同）
```

### 场景 3：第二次卖出（已授权，无缓存）

```
买入：~200-500ms
卖出：~300-800ms

差异：~100-300ms（主要是余额查询）
```

### 场景 4：第二次卖出（已授权，金额差异大）

```
买入：~200-500ms
卖出：~400-1100ms

差异：~200-600ms（主要是重复路由查询）
```

## 优化建议

### 高优先级

1. **确保浮动窗口传递 tokenInfo**
   - 检查浮动窗口的卖出请求是否包含 tokenInfo
   - 如果没有，添加 tokenInfo 参数

2. **优化授权体验**
   - 考虑在买入后立即预授权卖出
   - 或者在用户首次使用时提示一次性授权

### 中优先级

3. **减少 V3 授权重查**
   - 在 prepareTokenSell 中同时查询 V2 和 V3 授权
   - 避免后续重复查询

4. **提高金额预估精度**
   - 确保 tokenInfo 缓存始终是最新的
   - 减少因金额差异导致的重复路由查询

### 低优先级

5. **并发优化**
   - 考虑将更多操作并发执行
   - 例如：路由查询 + 授权检查

## 结论

**为什么买入比卖出快？**

1. **主要原因**：卖出需要检查授权，首次卖出需要发送授权交易（+2000-5000ms）
2. **次要原因**：卖出需要查询代币余额，如果无缓存会慢 50-150ms
3. **其他原因**：卖出可能需要重复查询路由（金额差异大时）+100-300ms

**优化效果预期**：

- 如果确保浮动窗口传递 tokenInfo：减少 50-150ms
- 如果用户已授权：卖出速度与买入基本相同（~200-600ms）
- 如果实现预授权：首次卖出也能达到 ~200-600ms

**当前状态**：

- ✅ 已实现卖出并发优化（v1.1.6）
- ✅ 已实现授权管理功能（v1.1.2）
- ✅ 已实现余额预加载（v1.1.5）
- 🔄 需要检查浮动窗口是否传递 tokenInfo
- 🔄 可考虑实现预授权机制

