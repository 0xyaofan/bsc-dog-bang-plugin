# 流动性保护机制实现

## 问题背景

用户报告卖出代币时返回的 BNB 数量很少，价格影响高达 99.99%，说明流动性极低。为了保护用户，需要在交易前检查流动性并拒绝高风险交易。

## 实现方案

### 1. 禁用 V3 报价（临时方案）

**原因**：
- V3 Quoter 在 Service Worker 中调用 `readContract` 时，viem 内部会触发动态 import
- 即使修改 ABI 的 `stateMutability` 为 `'view'`，问题依然存在
- 这是 viem 库的限制，无法在 Service Worker 环境中使用

**修改**：
```typescript
const DEFAULT_CONFIG: RouteSelectorConfig = {
  enableV2: true,
  enableV3: false, // 暂时禁用 V3
  v3FeePriority: [500, 2500, 10000, 250, 100],
  maxRoutes: 5,
};
```

**影响**：
- 所有交易将使用 V2 路由
- V2 路由在大多数情况下已经足够
- 未来可以考虑在非 Service Worker 环境中启用 V3

### 2. 实现流动性检查

参照 PancakeSwap SDK 的做法，在获取 V2 报价后检查流动性池的状态。

#### 2.1 检查流程

```typescript
private async checkV2Liquidity(
  path: Address[],
  amountIn: bigint,
  amountOut: bigint
): Promise<void> {
  // 1. 获取 pair 地址
  const pairAddress = await getPair(tokenA, tokenB);

  // 2. 检查 pair 是否存在
  if (pairAddress === ZERO_ADDRESS) {
    throw new Error('Liquidity pool does not exist');
  }

  // 3. 获取储备量
  const [reserve0, reserve1] = await getReserves(pairAddress);

  // 4. 检查最小流动性（至少 0.1 BNB）
  if (reserveOut < MIN_LIQUIDITY) {
    throw new Error('Insufficient liquidity');
  }

  // 5. 检查价格影响（不超过 10%）
  const priceImpact = calculatePriceImpact(...);
  if (priceImpact > MAX_PRICE_IMPACT) {
    throw new Error('Price impact too high');
  }
}
```

#### 2.2 流动性阈值

**最小流动性**：
```typescript
const MIN_LIQUIDITY = 100000000000000000n; // 0.1 BNB
```

- 如果输出代币的储备量小于 0.1 BNB，拒绝交易
- 这可以防止在几乎没有流动性的池子中交易

**最大价格影响**：
```typescript
const MAX_PRICE_IMPACT = 10; // 10%
```

- 如果价格影响超过 10%，拒绝交易
- 价格影响计算公式：
  ```typescript
  // 理想输出（无价格影响）
  idealOut = amountIn * reserveOut / reserveIn

  // 价格影响
  priceImpact = (idealOut - actualOut) / idealOut * 100
  ```

#### 2.3 价格影响计算

使用 Uniswap V2 的公式计算准确的价格影响：

```typescript
private calculateV2PriceImpact(
  amountIn: bigint,
  reserveIn: bigint,
  amountOut: bigint,
  reserveOut: bigint
): number {
  // 计算理想输出（无价格影响）
  // idealOut = amountIn * reserveOut / reserveIn
  const idealOut = (amountIn * reserveOut) / reserveIn;

  // 价格影响 = (idealOut - actualOut) / idealOut * 100
  if (idealOut === 0n) {
    return 0;
  }

  const impact = Number((idealOut - amountOut) * 10000n / idealOut) / 100;
  return Math.max(0, impact);
}
```

### 3. 错误处理优化

#### 3.1 收集错误信息

在 `getRoutesWithQuotes` 方法中收集所有路由的错误信息：

```typescript
const errors: string[] = [];

for (const route of routes) {
  try {
    // 尝试获取报价
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push(`${route.mode.kind} route failed: ${errorMsg}`);
  }
}
```

#### 3.2 友好的错误提示

当所有路由都失败时，检查是否是流动性问题并给出友好提示：

```typescript
if (quotedRoutes.length === 0 && errors.length > 0) {
  // 检查是否是流动性问题
  const hasLiquidityError = errors.some(
    e => e.includes('Insufficient liquidity') || e.includes('Price impact too high')
  );

  if (hasLiquidityError) {
    throw new Error(
      'Transaction rejected: Insufficient liquidity or price impact too high. ' +
      'This token may have very low liquidity on PancakeSwap. ' +
      'Please try a smaller amount or wait for more liquidity.'
    );
  }

  throw new Error(`All routes failed: ${errors.join('; ')}`);
}
```

## 用户体验

### 修改前

- 交易可以执行，但返回极少的代币
- 价格影响 99.99%
- 用户损失惨重

### 修改后

**场景 1：流动性不足**
```
❌ Transaction rejected: Insufficient liquidity or price impact too high.
   This token may have very low liquidity on PancakeSwap.
   Please try a smaller amount or wait for more liquidity.
```

**场景 2：价格影响过高**
```
❌ Transaction rejected: Price impact too high: 15.23%, maximum allowed is 10%
```

**场景 3：流动性池不存在**
```
❌ Transaction rejected: Liquidity pool does not exist
```

**场景 4：正常交易**
```
✅ 流动性检查通过
   - Pair: 0x1234...
   - Reserve In: 1000000000000000000000
   - Reserve Out: 500000000000000000000
   - Price Impact: 2.34%
```

## 配置参数

可以通过 RouteSelector 的配置调整阈值：

```typescript
const routeSelector = new RouteSelector(publicClient, {
  enableV2: true,
  enableV3: false,
  // 未来可以添加自定义阈值
  // minLiquidity: parseEther('0.1'),
  // maxPriceImpact: 10,
});
```

## 性能影响

**额外的 RPC 调用**：
- 每次报价需要额外 3 次 RPC 调用：
  1. `getPair` - 获取 pair 地址
  2. `getReserves` - 获取储备量
  3. `token0` - 确定代币顺序

**优化建议**：
- 可以缓存 pair 地址和 token0
- 只在必要时查询储备量（储备量会变化，不适合长期缓存）

## 测试验证

### 测试场景

1. **正常流动性的代币**
   - 应该通过流动性检查
   - 价格影响 < 10%
   - 交易正常执行

2. **低流动性的代币**
   - 应该被拒绝
   - 显示友好的错误提示
   - 不会执行交易

3. **高价格影响的交易**
   - 应该被拒绝
   - 显示具体的价格影响百分比
   - 建议用户减少交易金额

4. **不存在的流动性池**
   - 应该被拒绝
   - 提示流动性池不存在

## 未来改进

### 1. 可配置的阈值

允许用户自定义流动性和价格影响阈值：

```typescript
interface LiquidityCheckConfig {
  minLiquidity: bigint;
  maxPriceImpact: number;
  enabled: boolean;
}
```

### 2. 多跳路由的流动性检查

当前只检查单跳路由，未来可以扩展到多跳：

```typescript
if (path.length > 2) {
  // 检查每一跳的流动性
  for (let i = 0; i < path.length - 1; i++) {
    await checkV2Liquidity([path[i], path[i + 1]], ...);
  }
}
```

### 3. V3 流动性检查

当 V3 可用时，添加 V3 的流动性检查：

```typescript
private async checkV3Liquidity(
  tokenA: Address,
  tokenB: Address,
  fee: number,
  amountIn: bigint,
  amountOut: bigint
): Promise<void> {
  // 获取 V3 pool
  const pool = await getPool(tokenA, tokenB, fee);

  // 检查流动性
  const liquidity = await pool.liquidity();

  // 检查价格影响
  // ...
}
```

### 4. 滑点保护

除了价格影响，还可以添加滑点保护：

```typescript
const expectedOutput = quote.amountOut;
const minOutput = expectedOutput * (100 - slippageBps) / 100;

if (actualOutput < minOutput) {
  throw new Error('Slippage too high');
}
```

## 总结

实现了完整的流动性保护机制：

1. ✅ **禁用 V3 报价** - 避免 Service Worker 错误
2. ✅ **流动性检查** - 检查储备量和价格影响
3. ✅ **友好的错误提示** - 告诉用户为什么交易被拒绝
4. ✅ **保护用户资金** - 防止在低流动性池子中交易

这些改进确保用户不会在流动性极低的情况下执行交易，避免巨大的价格影响和资金损失。
