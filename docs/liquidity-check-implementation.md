# 流动性检查实现文档

## 问题背景

用户在购买 KDOG 代币时，系统选择了错误的配对，导致资金损失：
- **错误配对**：KDOG/WBNB (0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1)
- **正确配对**：KDOG/KGST (0x14C90904dD8868c8E748e42D092250Ec17f748d1)

根本原因：
1. KGST 不在候选报价代币列表中
2. 系统没有检查配对的流动性深度
3. 可能选择了流动性不足的配对

## 解决方案

### 1. 添加新的报价代币

在 `src/shared/trading-config.ts` 中添加：
```typescript
KGST: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828',
lisUSD: '0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5',
```

在 `src/shared/channel-config.ts` 中添加到候选列表：
```typescript
const BUILTIN_FOUR_QUOTE_TOKENS: FourQuoteTokenEntry[] = [
  // ... 现有代币 ...
  { address: CONTRACTS.KGST ?? '', label: 'KGST' },
  { address: CONTRACTS.lisUSD ?? '', label: 'lisUSD' }
];
```

### 2. 实现流动性检查

#### V2 配对流动性检查

**函数**：`checkPairLiquidity()`

**位置**：`src/shared/token-route.ts`

**逻辑**：
1. 查询配对的 `getReserves()` 获取储备量
2. 查询 `token0()` 和 `token1()` 确定报价代币
3. 获取报价代币的储备量
4. 与最小流动性阈值比较

**最小流动性阈值**：
```typescript
const MIN_LIQUIDITY_THRESHOLDS = {
  // 稳定币：至少 $100
  USDT: 100 * 1e18,
  BUSD: 100 * 1e18,
  USDC: 100 * 1e18,
  USD1: 100 * 1e18,

  // WBNB：至少 0.2 BNB（约 $100）
  WBNB: 0.2 * 1e18,

  // 默认：100 个代币
  default: 100 * 1e18
};
```

**示例**：
```typescript
const hasEnoughLiquidity = await checkPairLiquidity(
  publicClient,
  pairAddress,
  tokenAddress,
  quoteToken
);

if (!hasEnoughLiquidity) {
  // 跳过此配对，继续查找其他配对
}
```

#### V3 池子流动性检查

**函数**：`checkV3PoolLiquidity()`

**位置**：`src/shared/token-route.ts`

**逻辑**：
1. 查询池子的 `liquidity()` 获取流动性值
2. 与最小流动性阈值比较

**最小流动性阈值**：
```typescript
const MIN_V3_LIQUIDITY = BigInt(1e10);
// V3 的 liquidity 是 sqrt(amount0 * amount1)
```

**示例**：
```typescript
const hasEnoughLiquidity = await checkV3PoolLiquidity(
  publicClient,
  poolAddress
);

if (!hasEnoughLiquidity) {
  // 跳过此池子，尝试下一个 fee 级别
}
```

### 3. 集成到配对查询流程

#### 场景 1：明确指定 quoteToken

```typescript
// V2 配对
const pair = await getPair(tokenAddress, quoteToken);
if (pair !== ZERO_ADDRESS) {
  const hasEnoughLiquidity = await checkPairLiquidity(
    publicClient,
    pair,
    tokenAddress,
    quoteToken
  );

  if (!hasEnoughLiquidity) {
    // 继续尝试 V3
  } else {
    return { hasLiquidity: true, pairAddress: pair, version: 'v2' };
  }
}

// V3 池子
for (const fee of [500, 2500, 10000, 100]) {
  const pool = await getPool(tokenAddress, quoteToken, fee);
  if (pool !== ZERO_ADDRESS) {
    const hasEnoughLiquidity = await checkV3PoolLiquidity(publicClient, pool);

    if (hasEnoughLiquidity) {
      return { hasLiquidity: true, pairAddress: pool, version: 'v3' };
    }
  }
}
```

#### 场景 2：遍历候选报价代币

```typescript
const candidates = [WBNB, BUSD, USDT, ASTER, USD1, UNITED_STABLES_U, KGST, lisUSD, ...];

const pairPromises = candidates.map(async (candidate) => {
  const pair = await getPair(tokenAddress, candidate);
  if (pair !== ZERO_ADDRESS) {
    const hasEnoughLiquidity = await checkPairLiquidity(
      publicClient,
      pair,
      tokenAddress,
      candidate
    );

    if (hasEnoughLiquidity) {
      return { hasLiquidity: true, quoteToken: candidate, pairAddress: pair };
    }
  }
  return null;
});

const results = await Promise.all(pairPromises);
// 返回第一个流动性充足的配对
```

## 效果

### 防止低流动性交易

**之前**：
- 系统可能选择流动性很低的配对
- 用户交易时遭受巨大滑点
- 可能导致资金损失

**现在**：
- 自动检查配对的流动性深度
- 流动性不足的配对会被跳过
- 只选择流动性充足的配对
- 如果所有配对流动性都不足，返回 `hasLiquidity: false`，禁止交易

### 日志记录

**流动性充足**：
```
[checkPairLiquidity] 流动性充足: {
  pairAddress: '0x...',
  quoteToken: '0x...',
  quoteReserve: '1000000000000000000000'
}
```

**流动性不足**：
```
[checkPairLiquidity] 流动性不足: {
  pairAddress: '0x...',
  quoteToken: '0x...',
  quoteReserve: '50000000000000000000',
  threshold: '100000000000000000000',
  ratio: 0.5
}
```

## 配置调整

### 调整流动性阈值

如果需要调整最小流动性要求，修改 `MIN_LIQUIDITY_THRESHOLDS`：

```typescript
const MIN_LIQUIDITY_THRESHOLDS = {
  // 提高 USDT 的最小流动性要求到 $500
  [CONTRACTS.USDT?.toLowerCase() ?? '']: BigInt(500 * 1e18),

  // 降低 WBNB 的最小流动性要求到 0.1 BNB
  [CONTRACTS.WBNB?.toLowerCase() ?? '']: BigInt(0.1 * 1e18),

  // 默认阈值
  default: BigInt(100 * 1e18)
};
```

### 添加新的报价代币阈值

```typescript
const MIN_LIQUIDITY_THRESHOLDS = {
  // ... 现有配置 ...

  // 为 KGST 设置特定阈值
  [CONTRACTS.KGST?.toLowerCase() ?? '']: BigInt(1000 * 1e18),

  // 为 lisUSD 设置特定阈值
  [CONTRACTS.lisUSD?.toLowerCase() ?? '']: BigInt(100 * 1e18),
};
```

## 测试建议

### 1. 测试低流动性配对

创建一个流动性很低的测试配对，验证系统是否正确跳过：

```typescript
// 测试代币：0xTEST...
// 测试配对：TEST/WBNB，流动性只有 0.01 BNB
// 期望结果：系统跳过此配对，返回 hasLiquidity: false
```

### 2. 测试多个配对选择

创建同一代币的多个配对，验证系统是否选择流动性最大的：

```typescript
// 配对 1：TEST/WBNB，流动性 0.1 BNB（不足）
// 配对 2：TEST/USDT，流动性 $500（充足）
// 期望结果：系统选择配对 2
```

### 3. 测试 V3 池子

验证 V3 池子的流动性检查：

```typescript
// V3 池子：TEST/USDT，fee=500，liquidity=1e8（不足）
// V3 池子：TEST/USDT，fee=2500，liquidity=1e12（充足）
// 期望结果：系统跳过 fee=500，选择 fee=2500
```

## 注意事项

### 1. 缓存问题

流动性检查在缓存之前执行，因此：
- ✅ 只有流动性充足的配对才会被缓存
- ✅ 流动性不足的配对不会被缓存
- ⚠️ 如果配对的流动性后来增加了，需要清除缓存才能重新检查

**清除缓存**：
```typescript
// 清除特定代币的配对缓存
pancakePairCache.delete(tokenAddress.toLowerCase());

// 或在代码中调用
clearRouteCache(tokenAddress);
```

### 2. 性能影响

每次查询配对都会额外调用 `getReserves()` 或 `liquidity()`：
- V2 配对：额外 3 次 RPC 调用（getReserves, token0, token1）
- V3 池子：额外 1 次 RPC 调用（liquidity）

**优化建议**：
- 使用 MultiCall 批量查询（未来优化）
- 缓存流动性检查结果（未来优化）

### 3. 阈值调整

当前阈值是保守的（$100 或 0.2 BNB）：
- 对于小额交易（< $50）可能过于严格
- 对于大额交易（> $1000）可能不够严格

**建议**：
- 根据实际交易金额动态调整阈值
- 或者提供用户配置选项

## 相关文件

- `src/shared/token-route.ts` - 流动性检查实现
- `src/shared/trading-config.ts` - 报价代币配置
- `src/shared/channel-config.ts` - 候选报价代币列表
- `docs/pair-selection-bug-analysis.md` - 问题分析报告

## 总结

**修复内容**：
1. ✅ 添加 KGST 和 lisUSD 到报价代币列表
2. ✅ 实现 V2 配对流动性检查
3. ✅ 实现 V3 池子流动性检查
4. ✅ 集成到所有配对查询流程
5. ✅ 添加详细的日志记录

**效果**：
- 🛡️ 防止在低流动性配对上交易
- 🎯 自动选择流动性充足的配对
- 📊 提供流动性信息用于调试
- 💰 避免因流动性不足导致的资金损失

**下一步**：
- 监控日志，收集流动性数据
- 根据实际情况调整阈值
- 考虑实现动态阈值（基于交易金额）
- 考虑使用 MultiCall 优化性能

---

**创建日期**：2026-02-06
**版本**：1.0
**作者**：Claude Code
