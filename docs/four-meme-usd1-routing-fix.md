# Four.meme USD1 代币路由优化修复

## 问题描述

用户在交易 Four.meme 平台上筹集币种为 USD1 的代币时，发现卖出操作会尝试 26 条不同的路径才能找到正确的路径，导致交易耗时过长（1291ms）。

### 问题日志

```
[PancakeSwap] 🚀 Four.meme 已迁移代币，直接使用 V2 路径（跳过 V3）
[PancakeSwap] RouteInfo: platform=four, readyForPancake=true, quoteToken=0x8d0D000E
[PancakeSwap] 路径失败: 0x55c4 -> 0xbb4C
[PancakeSwap] 路径失败: 0x55c4 -> 0xbb4C
[PancakeSwap] 路径失败: 0x55c4 -> 0x55d3 -> 0xbb4C
[PancakeSwap] 路径失败: 0x55c4 -> 0x8AC7 -> 0xbb4C
... (共 26 次失败尝试)
[PancakeSwap] ✅ Four.meme V2 路径成功，耗时: 1291ms
```

### 问题分析

1. **系统已知正确的 QuoteToken**：日志显示 `quoteToken=0x8d0D000E`（USD1）
2. **最优路径应该是**：Token → USD1 → WBNB（卖出方向）
3. **实际行为**：系统先尝试了直接路径（Token → WBNB）和 25 条其他中间代币路径，最后才找到正确路径

---

## 根本原因

### 代码流程分析

**文件**：`src/shared/trading-channels.ts`

#### 1. Four.meme 优化入口（第 2670-2682 行）

```typescript
if (routeInfo?.readyForPancake && (routeInfo?.platform === 'four' || routeInfo?.platform === 'flap')) {
  const platformName = routeInfo.platform === 'four' ? 'Four.meme' : 'Flap';
  logger.info(`${channelLabel} 🚀 ${platformName} 已迁移代币，直接使用 V2 路径（跳过 V3）`);

  try {
    // 🐛 问题：这里传递的是 quoteToken 参数，而不是 routeInfo.quoteToken
    const result = await findBestV2Path(direction, publicClient, tokenAddress, amountIn, undefined, quoteToken, routeInfo);
    // ...
  }
}
```

#### 2. QuoteToken 路径优化（第 2180-2219 行）

```typescript
const findBestV2Path = async (
  direction: 'buy' | 'sell',
  publicClient,
  tokenAddress: string,
  amountIn: bigint,
  preferredPath?: string[],
  quoteToken?: string,  // ⚠️ 这个参数是 undefined
  routeInfo?: any
) => {
  // ...

  // 🚀 性能优化：Four.meme 已迁移代币优先尝试 QuoteToken 路径
  if (quoteToken) {  // ❌ 因为 quoteToken 是 undefined，这个分支不会执行
    const quoteTokenPath = direction === 'buy'
      ? [nativeWrapper, quoteToken, tokenAddress]
      : [tokenAddress, quoteToken, nativeWrapper];

    // 这段代码本应该优先尝试 USD1 路径，但因为 quoteToken 是 undefined 而被跳过
    // ...
  }

  // 然后代码继续尝试直接路径和其他替代路径
  // ...
};
```

### 问题根源

**数据源不一致**：

- `routeInfo.quoteToken` 包含了正确的 QuoteToken 地址（`0x8d0D000E`）
- 但 `findBestV2Path` 函数接收的 `quoteToken` 参数是 `undefined`
- 导致 QuoteToken 路径优化逻辑（第 2183-2219 行）被跳过
- 系统退化到尝试所有可能的路径，浪费了大量时间

---

## 修复方案

### 修复代码

**文件**：`src/shared/trading-channels.ts:2678-2682`

```typescript
try {
  // 直接查询 V2 路径，跳过 V3
  // 🐛 修复：优先使用 routeInfo.quoteToken，因为它包含了代币的筹集币种信息
  const effectiveQuoteToken = routeInfo.quoteToken || quoteToken;
  const result = await findBestV2Path(direction, publicClient, tokenAddress, amountIn, undefined, effectiveQuoteToken, routeInfo);
  // ...
}
```

### 修复逻辑

1. **优先使用 `routeInfo.quoteToken`**：这是从代币元数据中获取的筹集币种信息
2. **Fallback 到 `quoteToken` 参数**：保持向后兼容性
3. **传递正确的 QuoteToken**：确保 `findBestV2Path` 函数能够执行 QuoteToken 路径优化

---

## 修复效果

### 优化前

```
[PancakeSwap] 🚀 Four.meme 已迁移代币，直接使用 V2 路径（跳过 V3）
[PancakeSwap] 路径失败: 0x55c4 -> 0xbb4C          (尝试直接路径)
[PancakeSwap] 路径失败: 0x55c4 -> 0x55d3 -> 0xbb4C (尝试中间代币 1)
[PancakeSwap] 路径失败: 0x55c4 -> 0x8AC7 -> 0xbb4C (尝试中间代币 2)
... (共 26 次失败尝试)
[PancakeSwap] ✅ Four.meme V2 路径成功，耗时: 1291ms
```

**问题**：
- 尝试了 26 条路径
- 耗时 1291ms
- 浪费了大量 RPC 调用

### 优化后（预期）

```
[PancakeSwap] 🚀 Four.meme 已迁移代币，直接使用 V2 路径（跳过 V3）
[PancakeSwap] 尝试 QuoteToken 路径: 0x8d0D  (优先尝试 USD1 路径)
[PancakeSwap] ✅ QuoteToken 路径成功: 0x8d0D, 输出: 123456789
[PancakeSwap] ✅ Four.meme V2 路径成功，耗时: 50ms
```

**改进**：
- 第一次尝试就成功
- 耗时减少 96%（从 1291ms 降到约 50ms）
- 只需要 1 次 RPC 调用

---

## 技术细节

### QuoteToken 路径优化逻辑

**文件**：`src/shared/trading-channels.ts:2180-2219`

```typescript
// 🚀 性能优化：Four.meme 已迁移代币优先尝试 QuoteToken 路径
// Four.meme 已迁移代币在 Pancake V2 上创建的流动性池是：Token ↔ QuoteToken
// 最优路径：WBNB → QuoteToken → Token（买入）或 Token → QuoteToken → WBNB（卖出）
if (quoteToken) {
  const normalizedQuote = quoteToken.toLowerCase();
  const normalizedWrapper = nativeWrapper.toLowerCase();

  // 🐛 修复：过滤掉 0x0000... 地址（表示 BNB 筹集）
  const isZeroAddress = normalizedQuote === ZERO_ADDRESS.toLowerCase();

  // 如果 quoteToken 不是 WBNB 且不是 0x0000...，优先尝试 quoteToken 路径
  if (normalizedQuote !== normalizedWrapper && !isZeroAddress) {
    const quoteTokenPath = direction === 'buy'
      ? [nativeWrapper, quoteToken, tokenAddress]
      : [tokenAddress, quoteToken, nativeWrapper];

    try {
      logger.debug(`${channelLabel} 尝试 QuoteToken 路径: ${quoteToken.slice(0, 6)}`);
      const results = await fetchPathAmounts(
        publicClient,
        amountIn,
        [quoteTokenPath],
        contractAddress,
        abi,
        channelLabel
      );

      if (results.length > 0 && results[0].amountOut > 0n) {
        logger.debug(`${channelLabel} ✅ QuoteToken 路径成功: ${quoteToken.slice(0, 6)}, 输出: ${results[0].amountOut.toString()}`);
        return { path: quoteTokenPath, amountOut: results[0].amountOut };
      }
    } catch (error) {
      logger.debug(`${channelLabel} QuoteToken 路径失败: ${error?.message || error}`);
    }
  }
}
```

### 路径优先级

修复后的路径查找顺序：

1. **缓存路径**（如果有）
2. **已知 Pair 路径**（如果有 `pancakePairAddress`）
3. **QuoteToken 路径**（✅ 修复后会执行）
4. **直接路径**（Token ↔ WBNB）
5. **动态桥接路径**（通过其他中间代币）
6. **静态替代路径**（预定义的中间代币）

---

## 适用场景

### ✅ 受益的代币类型

1. **Four.meme 平台代币**
   - 筹集币种为 USD1、USDT、USDC 等稳定币
   - 筹集币种为其他非 BNB 代币

2. **Flap 平台代币**
   - 同样适用于非 BNB 筹集币种

### ❌ 不受影响的代币类型

1. **BNB 筹集币种**
   - `quoteToken` 为 `0x0000...` 或 `undefined`
   - 已经使用直接路径（Token ↔ WBNB）

2. **非 Four.meme/Flap 平台代币**
   - 不会进入 Four.meme 优化分支

---

## 测试建议

### 功能测试

- [ ] Four.meme USD1 筹集代币卖出：应该第一次尝试就成功
- [ ] Four.meme USDT 筹集代币卖出：应该第一次尝试就成功
- [ ] Four.meme BNB 筹集代币卖出：应该使用直接路径
- [ ] Flap 平台代币：同样受益于优化

### 性能测试

- [ ] 卖出耗时：从 1291ms 降低到 50-100ms
- [ ] RPC 调用次数：从 26 次降低到 1-2 次
- [ ] 日志输出：应该看到 "尝试 QuoteToken 路径" 和 "✅ QuoteToken 路径成功"

### 回归测试

- [ ] 其他平台代币交易不受影响
- [ ] BNB 筹集代币交易不受影响
- [ ] 缓存路径仍然优先使用

---

## 相关文件

- `src/shared/trading-channels.ts:2678-2682` - 修复位置
- `src/shared/trading-channels.ts:2180-2219` - QuoteToken 路径优化逻辑
- `src/shared/trading-channels.ts:2670-2698` - Four.meme/Flap 优化入口

---

## 总结

### 问题

Four.meme USD1 代币卖出时尝试 26 条路径，耗时 1291ms

### 根本原因

`quoteToken` 参数未传递 `routeInfo.quoteToken`，导致 QuoteToken 路径优化被跳过

### 修复方案

使用 `routeInfo.quoteToken || quoteToken` 确保 QuoteToken 信息正确传递

### 预期效果

- 路径尝试次数：26 次 → 1 次
- 交易耗时：1291ms → 50ms
- 性能提升：96%

---

**修复日期**：2026-02-06
**修复版本**：1.1.7
**影响范围**：Four.meme 和 Flap 平台的非 BNB 筹集代币
**状态**：已修复，等待测试验证
