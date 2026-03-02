# 卖出报价修复说明

## 问题描述

用户报告卖出代币时返回的 BNB 数量很少，日志显示：

1. **V3 报价全部失败**
   - 错误：`import() is disallowed on ServiceWorkerGlobalScope`
   - 原因：使用了 `simulateContract` 而不是 `readContract`

2. **V2 报价异常**
   - 卖出 34.8 个代币只得到 0.00045 BNB
   - 价格影响高达 99.99%
   - 原因：代币精度问题

## 根本原因

### 1. V3 Quoter 调用方式错误

**问题代码**：
```typescript
const result = await this.publicClient.simulateContract({
  address: PANCAKE_V3_QUOTER,
  abi: QUOTER_SINGLE_ABI,
  functionName: 'quoteExactInputSingle',
  args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
});
```

**问题**：
- `simulateContract` 在 Service Worker 中会触发动态 import，导致错误
- V3 Quoter 的函数应该使用 `readContract` 调用

**修复**：
```typescript
// 1. 修改 ABI stateMutability 为 'view'
stateMutability: 'view',  // 原来是 'nonpayable'

// 2. 使用 readContract 而不是 simulateContract
const result = await this.publicClient.readContract({
  address: PANCAKE_V3_QUOTER,
  abi: QUOTER_SINGLE_ABI,
  functionName: 'quoteExactInputSingle',
  args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
});

return result[0]; // 直接返回 amountOut，不需要 result.result[0]
```

### 2. 代币精度硬编码问题

**问题代码**：
```typescript
// 硬编码使用 18 位精度
const amountWei = parseUnits(String(params.amountToken), 18);
```

**问题**：
- 不是所有代币都是 18 位精度
- 如果代币是 9 位精度，传入的金额会被放大 10^9 倍
- 导致查询的金额远大于实际流动性，返回极小的输出

**修复**：
```typescript
// 1. 查询代币实际精度
const tokenDecimals = await this.getTokenDecimals(
  params.tokenAddress as Address,
  context.publicClient
);

// 2. 使用实际精度转换金额
const amountWei = parseUnits(String(params.amountToken), tokenDecimals);

// 3. 添加 getTokenDecimals 方法
private async getTokenDecimals(
  tokenAddress: Address,
  publicClient: any
): Promise<number> {
  const ERC20_ABI = [
    {
      inputs: [],
      name: 'decimals',
      outputs: [{ name: '', type: 'uint8' }],
      stateMutability: 'view',
      type: 'function',
    },
  ] as const;

  try {
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    });
    return decimals;
  } catch (error) {
    logger.warn('[PancakeTradingService] 获取代币精度失败，使用默认值 18');
    return 18; // 默认使用 18 位精度
  }
}
```

## 修复的文件

### 1. route-selector.ts

**修改内容**：
- 将 V3 Quoter ABI 的 `stateMutability` 从 `'nonpayable'` 改为 `'view'`
- 将 `simulateContract` 改为 `readContract`
- 修改返回值从 `result.result[0]` 改为 `result[0]`
- 添加错误处理和日志

**影响**：
- V3 报价现在可以在 Service Worker 中正常工作
- 不再触发动态 import 错误

### 2. pancake-trading-service.ts

**修改内容**：
- 在卖出前查询代币精度
- 使用实际精度转换金额
- 添加 `getTokenDecimals` 方法

**影响**：
- 卖出时使用正确的代币精度
- 报价金额准确
- 价格影响正常

## 测试验证

### 预期行为

**V3 报价**：
- 不再出现 `import() is disallowed` 错误
- 能够正常查询 V3 pool 报价
- 如果 pool 不存在，会优雅地失败并尝试其他路由

**V2 报价**：
- 使用正确的代币精度
- 报价金额准确
- 价格影响合理（通常 <5%）

### 测试场景

1. **18 位精度代币**（如 WBNB）
   - 应该正常工作，与之前行为一致

2. **9 位精度代币**（如某些 meme 币）
   - 之前：金额被放大 10^9 倍，报价异常
   - 现在：使用正确精度，报价正常

3. **V3 pool 存在的代币**
   - 应该能够获取 V3 报价
   - 如果 V3 更优，选择 V3 路由

4. **V3 pool 不存在的代币**
   - V3 报价失败，回退到 V2
   - 不影响整体交易流程

## 性能影响

**额外的 RPC 调用**：
- 每次卖出前需要查询代币精度（1 次 RPC 调用）
- 可以考虑添加精度缓存来优化

**优化建议**：
```typescript
// 添加精度缓存
private decimalsCache = new Map<Address, number>();

private async getTokenDecimals(
  tokenAddress: Address,
  publicClient: any
): Promise<number> {
  // 检查缓存
  const cached = this.decimalsCache.get(tokenAddress);
  if (cached !== undefined) {
    return cached;
  }

  // 查询并缓存
  const decimals = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });

  this.decimalsCache.set(tokenAddress, decimals);
  return decimals;
}
```

## 总结

修复了两个关键问题：

1. **V3 报价在 Service Worker 中失败** - 通过使用 `readContract` 而不是 `simulateContract` 解决
2. **代币精度硬编码导致报价异常** - 通过动态查询代币精度解决

这些修复确保了：
- V3 报价能够正常工作
- 所有精度的代币都能正确报价
- 卖出交易返回合理的 BNB 数量
- 价格影响计算准确
