# SDK 完全迁移计划

**日期**: 2026-02-11
**目标**: 删除 `src/background/index.ts` 中的重复交易逻辑，完全使用 SDK

---

## 当前状态

### 文件大小
- `src/background/index.ts`: **4685 行**

### 集成方式
- **渐进式迁移**：SDK 和旧代码并行运行
- SDK 只在 `canUseSDK()` 返回 true 时使用
- 失败时回退到旧逻辑

### 问题
1. **代码重复**：旧的交易函数仍然保留
2. **维护成本高**：需要同时维护两套代码
3. **文件过大**：4685 行难以维护

---

## 可以删除的代码

### 1. Four.meme 交易函数（~300 行）

**删除函数**:
- `sendFourEncodedBuy()` (362-419 行，~58 行)
- `executeFourQuoteBuy()` (421-507 行，~87 行)
- `scheduleFourQuoteSellSettlement()` (666-692 行，~27 行)
- `buildFourSwapContext()` (316-326 行，~11 行)
- `assertWalletReadyForFourQuote()` (310-314 行，~5 行)
- `encodeBuyTokenStruct()` (338-360 行，~23 行)

**原因**: SDK 的 `FourMemePlatform` 已完全实现这些功能

**SDK 替代**:
```typescript
// 旧代码
await executeFourQuoteBuy({ tokenAddress, amountBnb, slippage, quoteToken, ... });

// SDK 替代
await buyTokenWithSDK({ tokenAddress, amount, slippage, channel: 'four' });
```

### 2. Flap 交易函数（~100 行）

**删除函数**:
- `executeFlapQuoteBuy()` (509-609 行，~101 行)

**原因**: SDK 的 `FlapPlatform` 已完全实现

**SDK 替代**:
```typescript
// 旧代码
await executeFlapQuoteBuy({ tokenAddress, amountBnb, slippage, quoteToken, ... });

// SDK 替代
await buyTokenWithSDK({ tokenAddress, amount, slippage, channel: 'flap' });
```

### 3. XMode 交易函数（~45 行）

**删除函数**:
- `executeXModeDirectBuy()` (611-655 行，~45 行)

**原因**: SDK 的 `FourMemePlatform` 支持 XMode

**SDK 替代**:
```typescript
// 旧代码
await executeXModeDirectBuy({ tokenAddress, amountBnb, ... });

// SDK 替代
await buyTokenWithSDK({ tokenAddress, amount, slippage, channel: 'xmode' });
```

### 4. 旧的买入/卖出逻辑（待评估）

**需要检查的代码块**:
- `handleBuyToken()` 中的步骤 5.3-5.5（Four Quote、Flap Quote、XMode）
- `handleSellToken()` 中的 Four Quote 卖出逻辑

**迁移策略**:
- 移除 Quote Bridge 相关的特殊处理
- 直接使用 SDK 的统一接口

---

## 迁移步骤

### 阶段 1: 删除重复函数

1. 删除 `sendFourEncodedBuy()`
2. 删除 `executeFourQuoteBuy()`
3. 删除 `executeFlapQuoteBuy()`
4. 删除 `executeXModeDirectBuy()`
5. 删除 `scheduleFourQuoteSellSettlement()`
6. 删除 `buildFourSwapContext()`
7. 删除 `assertWalletReadyForFourQuote()`
8. 删除 `encodeBuyTokenStruct()`

**预计减少**: ~450 行

### 阶段 2: 简化 handleBuyToken()

**当前逻辑**:
```typescript
// 步骤 5.3: Four Quote 买入
if (shouldUseFourQuote(...)) {
  txHash = await executeFourQuoteBuy(...);
}

// 步骤 5.4: Flap Quote 买入
if (shouldUseFlapQuote(...)) {
  txHash = await executeFlapQuoteBuy(...);
}

// 步骤 5.5: XMode 直接买入
if (resolvedChannelId === 'xmode') {
  txHash = await executeXModeDirectBuy(...);
}

// 步骤 5.6: SDK 买入（回退）
if (!txHash && canUseSDK(...)) {
  const sdkResult = await buyTokenWithSDK(...);
}

// 步骤 5.7: 标准通道买入（最终回退）
if (!txHash) {
  const channel = getChannel(...);
  txHash = await channel.buy(...);
}
```

**简化后**:
```typescript
// 直接使用 SDK
if (canUseSDK(resolvedChannelId, routeInfo)) {
  const sdkResult = await buyTokenWithSDK({
    tokenAddress: normalizedTokenAddress,
    amount: Number(amount),
    slippage,
    channel: resolvedChannelId
  });

  if (sdkResult.success) {
    txHash = sdkResult.txHash;
  } else {
    throw new Error(sdkResult.error);
  }
} else {
  // 不支持的通道（Custom Aggregator 等）
  const channel = getChannel(...);
  txHash = await channel.buy(...);
}
```

**预计减少**: ~100 行

### 阶段 3: 简化 handleSellToken()

类似 `handleBuyToken()` 的简化

**预计减少**: ~80 行

### 阶段 4: 清理导入和依赖

删除不再使用的导入:
- `prepareFourQuoteBuy`
- `finalizeFourQuoteConversion`
- `prepareFlapQuoteBuy`
- `FOUR_TOKEN_MANAGER_ABI`
- `FLAP_PORTAL_ABI`
- `encodeBuyTokenStruct` 相关

**预计减少**: ~20 行

---

## 预期效果

### 代码减少
- **删除重复函数**: ~450 行
- **简化 handleBuyToken()**: ~100 行
- **简化 handleSellToken()**: ~80 行
- **清理导入**: ~20 行
- **总计**: **~650 行**

### 文件大小
- **迁移前**: 4685 行
- **迁移后**: ~4035 行
- **减少**: ~14%

### 代码质量
- ✅ 消除重复代码
- ✅ 统一交易接口
- ✅ 降低维护成本
- ✅ 提高可读性

---

## 风险评估

### 风险 1: 功能回退

**风险**: 删除旧代码后，某些边缘情况可能无法处理

**缓解措施**:
- SDK 已经过 1,596 个测试
- 保留 Custom Aggregator 等特殊逻辑
- 分阶段迁移，每阶段都进行测试

### 风险 2: Quote Bridge 兼容性

**风险**: Four Quote 和 Flap Quote 的特殊处理可能丢失

**缓解措施**:
- SDK 已实现 Quote Token 支持
- `prepareFourQuoteBuy` 和 `prepareFlapQuoteBuy` 逻辑已集成到 SDK
- 保留 `shouldUseFourQuote()` 和 `shouldUseFlapQuote()` 判断逻辑

### 风险 3: 性能影响

**风险**: SDK 可能比旧代码慢

**缓解措施**:
- SDK 已优化性能
- 集成了性能监控
- 可以通过 `getPerformanceStats()` 监控

---

## 迁移验证

### 1. 单元测试
```bash
npm run test:run
```

### 2. 构建测试
```bash
npm run build
```

### 3. 功能测试

测试所有平台的买入/卖出:
- ✅ Four.meme (包括 Quote Token)
- ✅ Flap (包括 Quote Token)
- ✅ Luna
- ✅ XMode
- ✅ PancakeSwap V2/V3

### 4. 性能测试

对比迁移前后的性能:
```typescript
sdkAdapter.setPerformanceMonitoring(true);
// 执行交易
const stats = sdkAdapter.getPerformanceStats();
console.log('性能统计:', stats);
```

---

## 实施建议

### 选项 1: 立即完全迁移（推荐）

**优点**:
- 一次性解决问题
- 代码立即变得简洁
- 减少维护成本

**缺点**:
- 需要全面测试
- 可能需要修复边缘情况

**适用场景**: SDK 已经过充分测试，有信心完全替换

### 选项 2: 分阶段迁移

**阶段 1**: 删除重复函数（~450 行）
**阶段 2**: 简化 handleBuyToken()（~100 行）
**阶段 3**: 简化 handleSellToken()（~80 行）

**优点**:
- 风险更低
- 每阶段都可以验证

**缺点**:
- 需要更多时间
- 中间状态仍有重复代码

---

## 建议

基于以下事实：
1. ✅ SDK 已 100% 完成
2. ✅ 1,596 个测试全部通过
3. ✅ Chrome Extension 构建成功
4. ✅ 所有 5 个平台都已实现

**建议采用选项 1：立即完全迁移**

这将：
- 减少 ~650 行代码（14%）
- 消除重复逻辑
- 统一交易接口
- 降低维护成本

---

**报告日期**: 2026-02-11
**状态**: 待执行
