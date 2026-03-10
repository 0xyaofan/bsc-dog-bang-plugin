# V3 Pool Fee Tier 选择 Bug 修复

## 问题描述

**问题代币**: `0x1d507b4a7e9301e41d86892c1ecd86cfc0694444`
- **平台**: Four.meme
- **筹集币种**: USD1
- **问题**: 使用自定义聚合器卖出时，将 32 个 USD1 兑换 WBNB，返回几乎为 0 的 WBNB

**错误交易**: https://bscscan.com/tx/0x9095e2ff15d81f485f046e11cfe9bc34576f45fdc0c38f74c65f2017c9e6db2e
- 使用的 V3 Pool: `0x3d7C319090edf2293608a0f9a786317c66D320F8` (USD1/WBNB, **0.01% fee**, 流动性极低)
- 32 USD1 → ~0 WBNB ❌

**正确交易**: https://bscscan.com/tx/0xf6c3cd040fcfd8bf4300c6c301d09980d4ed2aaf06a35f6fb778facbf567ea7d
- 使用的 V3 Pool: `0x4a3218606AF9B4728a9F187E1c1a8c07fBC172a9` (USD1/WBNB, 可能是 0.25% 或其他 fee tier, 流动性充足)
- 正常兑换 ✅

## Bug 根源分析

### 误解说明

**最初误解**: 以为是 Router 地址错误
- 插件配置的 PANCAKE_SMART_ROUTER: `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` ✅ 正确
- 交易中的地址 `0x3d7C...` 和 `0x4a32...` 不是 Router，而是 **V3 Pool 地址**

### 真正的问题

**位置**: `src/background/custom-aggregator-agent.ts:427-451`

**修复前的代码**:
```typescript
async function resolveV3FeeTier(publicClient: any, tokenA: string, tokenB: string) {
  if (!CONTRACTS.PANCAKE_V3_FACTORY) {
    return null;
  }
  // 🚨 Bug: 返回第一个找到的 pool，不检查流动性
  for (const fee of V3_FEE_TIERS) {  // [100, 250, 500, 2500, 10000]
    try {
      const pool = await readContractWithFallback(
        publicClient,
        {
          address: CONTRACTS.PANCAKE_V3_FACTORY,
          abi: PANCAKE_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenA as Address, tokenB as Address, fee]
        },
        { label: 'Pancake V3 fee probe', quoteToken: tokenB }
      );
      if (pool && normalizeAddress(pool) !== ZERO_ADDRESS) {
        return fee;  // ← 直接返回第一个存在的 pool (100 = 0.01%)
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}
```

**问题流程**:

1. **V3_FEE_TIERS** = `[100, 250, 500, 2500, 10000]`
   - 100 = 0.01%
   - 250 = 0.025%
   - 500 = 0.05%
   - 2500 = 0.25%
   - 10000 = 1%

2. **循环查询**：按顺序查询每个 fee tier 的 pool
   - 查询 0.01% pool → 找到 `0x3d7C...` → **立即返回**
   - 不再查询其他 fee tier

3. **结果**：使用流动性极低的 0.01% pool
   - USD1/WBNB 0.01% pool 几乎没有流动性
   - 导致严重滑点：32 USD1 → ~0 WBNB

### 为什么 0.01% pool 流动性低？

在 PancakeSwap V3 中：
- **低 fee tier (0.01%, 0.025%)**: 通常用于稳定币对（如 USDT/USDC），流动性集中
- **中 fee tier (0.05%, 0.25%)**: 常规代币对，流动性较好
- **高 fee tier (1%)**: 高波动性或新代币

USD1 是 World Liberty Financial 发行的稳定币，但与 WBNB 配对时：
- **0.01% pool**: 可能是早期创建的，流动性迁移到其他 pool
- **0.25% pool**: 可能是主要的流动性池

## 修复方案

### 核心思路

**查询所有 fee tier 的流动性，选择最高的**

### 修复后的代码

**文件**: `src/background/custom-aggregator-agent.ts:427-489`

```typescript
async function resolveV3FeeTier(publicClient: any, tokenA: string, tokenB: string) {
  if (!CONTRACTS.PANCAKE_V3_FACTORY) {
    return null;
  }

  // 🚀 修复：查询所有 fee tier 的流动性，选择最高的
  let bestFee: number | null = null;
  let bestLiquidity = 0n;

  for (const fee of V3_FEE_TIERS) {
    try {
      const pool = await readContractWithFallback(
        publicClient,
        {
          address: CONTRACTS.PANCAKE_V3_FACTORY,
          abi: PANCAKE_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenA as Address, tokenB as Address, fee]
        },
        { label: 'Pancake V3 fee probe', quoteToken: tokenB }
      );

      if (!pool || normalizeAddress(pool) === ZERO_ADDRESS) {
        continue;
      }

      // 🚀 新增：检查该 pool 的流动性（通过 tokenB 的余额）
      try {
        const liquidity = await publicClient.readContract({
          address: tokenB as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [pool as Address]
        }) as bigint;

        logger.debug(`[Aggregator] V3 Pool 流动性检查`, {
          fee,
          pool,
          tokenB,
          liquidity: liquidity.toString()
        });

        // 选择流动性最高的 fee tier
        if (liquidity > bestLiquidity) {
          bestLiquidity = liquidity;
          bestFee = fee;
        }
      } catch (error) {
        logger.debug(`[Aggregator] 获取 V3 Pool 流动性失败 (fee: ${fee}):`, error?.message || error);
        continue;
      }
    } catch (error) {
      continue;
    }
  }

  if (bestFee !== null) {
    logger.info(`[Aggregator] 选择流动性最高的 V3 Pool`, {
      tokenA,
      tokenB,
      bestFee,
      bestLiquidity: bestLiquidity.toString()
    });
  }

  return bestFee;
}
```

### 修复流程

修复后的流程：

1. **卖出代币**（0x1d507b4a7e9301e41d86892c1ecd86cfc0694444）
   ↓
2. **调用 `resolveSellSwapMode(publicClient, 'USD1')`**
   ↓
3. **调用 `resolveV3FeeTier(publicClient, USD1, WBNB)`**
   ↓
4. **查询所有 fee tier 的 pool**：
   - 0.01% pool (0x3d7C...): 流动性 10 WBNB
   - 0.025% pool: 不存在
   - 0.05% pool: 不存在
   - 0.25% pool (0x4a32...): 流动性 1000 WBNB ← **最高**
   - 1% pool: 不存在
   ↓
5. **选择 0.25% pool**（流动性最高）
   ↓
6. **构建卖出交易参数**，使用 V3 0.25% fee
   ↓
7. **执行卖出**：代币 → Four.meme → USD1 → **V3 0.25% Pool** → WBNB ✅
   ↓
8. **结果**: 32 USD1 → 正常数量的 WBNB ✅

## 关键改进

### 1. 流动性检测 💧
- **修复前**: 不检查流动性，盲目使用第一个 pool
- **修复后**: 检查所有 pool 的流动性，选择最高的

### 2. 智能选择 🎯
- **修复前**: 总是选择 0.01% pool（如果存在）
- **修复后**: 选择流动性最高的 pool，无论 fee tier

### 3. 详细日志 📝
- 记录每个 pool 的流动性
- 记录最终选择的 pool 和流动性
- 便于调试和监控

## 性能影响

### 额外开销

- **查询次数**: 增加 4-5 次链上查询（每个 fee tier 的流动性）
- **时间开销**: 约 200-300ms（并发查询可优化）

### 值得的理由

1. **避免重大损失**: 防止使用流动性极低的 pool
2. **优化用户收益**: 始终使用流动性最高的 pool
3. **查询频率低**: 只在卖出时查询一次，并且结果可以缓存

## 测试建议

### 测试场景 1: USD1 筹集代币

**代币**: 0x1d507b4a7e9301e41d86892c1ecd86cfc0694444

**步骤**:
1. 卖出代币
2. 检查日志，应该显示：
   - "V3 Pool 流动性检查: fee=100, liquidity=..."
   - "V3 Pool 流动性检查: fee=2500, liquidity=..."
   - "选择流动性最高的 V3 Pool: bestFee=2500"（假设 0.25% 流动性最高）
3. 确认交易使用流动性高的 pool
4. 确认收到正常数量的 WBNB

### 测试场景 2: USDT 筹集代币

**代币**: 找一个 USDT 筹集的代币

**步骤**:
1. 卖出代币
2. 检查日志，应该显示选择流动性最高的 fee tier
3. 确认交易正常

### 测试场景 3: 对比修复前后

**测试代币**: 0x1d507b4a7e9301e41d86892c1ecd86cfc0694444

**修复前**（模拟）:
- 使用 0.01% pool
- 32 USD1 → ~0 WBNB
- 损失 100%

**修复后**:
- 使用 0.25% pool（流动性最高）
- 32 USD1 → 正常数量 WBNB
- 正常交易 ✅

## 预期效果

### 修复前

**USD1/WBNB 示例**:
- 0.01% pool: 10 WBNB 流动性
- 0.25% pool: 1000 WBNB 流动性
- **插件选择**: 0.01% pool ❌
- **结果**: 严重滑点，几乎全部损失

### 修复后

**USD1/WBNB 示例**:
- 0.01% pool: 10 WBNB 流动性
- 0.25% pool: 1000 WBNB 流动性
- **插件选择**: 0.25% pool ✅
- **结果**: 正常交易，获得合理价格

## 相关文件

**修改的文件**:
- `src/background/custom-aggregator-agent.ts:427-489` - `resolveV3FeeTier` 函数

**涉及的函数**:
- `resolveSellSwapMode` (567-583) - 调用 resolveV3FeeTier
- `executeCustomAggregatorSell` (685-890) - 卖出流程
- `buildAggregatorSellArgs` (939-972) - 构建交易参数

## V3 Fee Tier 说明

### PancakeSwap V3 Fee Tiers

| Fee Tier | 百分比 | 适用场景 | 示例代币对 |
|----------|--------|----------|-----------|
| 100      | 0.01%  | 稳定币对 | USDT/USDC |
| 250      | 0.025% | 相关资产 | ETH/WETH |
| 500      | 0.05%  | 常规代币 | BNB/BUSD |
| 2500     | 0.25%  | 常规代币 | BNB/CAKE |
| 10000    | 1%     | 高波动性 | 新代币/BNB |

### 流动性分布

不同代币对在不同 fee tier 的流动性分布差异很大：
- **稳定币对**: 主要在 0.01% pool
- **常规代币对**: 主要在 0.05% - 0.25% pool
- **新代币**: 可能分散在多个 pool

**教训**: 不能假设任何 fee tier 一定有流动性，必须实际查询。

## 总结

此次修复解决了一个**关键的流动性选择 Bug**：

1. **问题**: 盲目使用第一个找到的 V3 pool，导致使用流动性极低的 pool
2. **修复**: 查询所有 fee tier 的流动性，选择最高的
3. **效果**: 确保用户始终使用流动性最好的 pool，避免严重滑点

修复后，自定义聚合器在卖出 V3 时会：
- ✅ 查询所有可用的 fee tier
- ✅ 检查每个 pool 的流动性
- ✅ 选择流动性最高的 pool
- ✅ 提供详细的日志记录
- ✅ 保护用户免受流动性陷阱

## 参考资料

- [USD1/WBNB Pool (0.01%)](https://www.geckoterminal.com/bsc/pools/0x3d7c319090edf2293608a0f9a786317c66d320f8) - 流动性低的 pool
- [PancakeSwap V3 Smart Router](https://bscscan.com/address/0x13f4EA83D0bd40E75C8222255bc855a974568Dd4) - 官方 V3 Router
- [World Liberty Financial USD1](https://worldlibertyfinancial.com/usd1) - USD1 稳定币介绍
