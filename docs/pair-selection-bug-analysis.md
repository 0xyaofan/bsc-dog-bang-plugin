# 配对选择问题分析报告

## 问题描述

**代币**: 0x3753dd32cbc376ce6efd85f334b7289ae6d004af (KDOG)
**系统选择的配对**: 0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1
**用户认为正确的配对**: 0x94be0bbA8E1E303fE998c9360B57b826F1A4f828
**结果**: 用户损失了资金

## 调查结果

### 1. 系统选择的配对（错误）

**地址**: 0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1

通过链上查询确认：
- **token0**: 0x3753dD32Cbc376Ce6EFd85F334B7289aE6d004aF (KDOG)
- **token1**: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c (WBNB)
- **类型**: PancakeSwap V2 配对
- **状态**: ❌ 这是 KDOG/WBNB 配对，但**不是用户期望的配对**

### 2. 用户期望的正确配对

**地址**: 0x14C90904dD8868c8E748e42D092250Ec17f748d1

通过链上查询确认：
- **token0**: 0x3753dD32Cbc376Ce6EFd85F334B7289aE6d004aF (KDOG)
- **token1**: 0x94be0bbA8E1E303fE998c9360B57b826F1A4f828 (KGST)
- **类型**: V2 配对（可能是 PancakeSwap 或其他 DEX）
- **状态**: ✅ 这是 KDOG/KGST 配对，**这才是正确的配对**

### 3. KGST 代币分析

**地址**: 0x94be0bbA8E1E303fE998c9360B57b826F1A4f828

- 这是一个 ERC20 代币合约（KGST token）
- 同时也是 KDOG/KGST 配对中的 token1（报价代币）

### 4. 根本原因分析

**问题确认**：
- ✅ 正确的配对：KDOG/KGST (0x14C90904dD8868c8E748e42D092250Ec17f748d1)
- ❌ 系统选择的配对：KDOG/WBNB (0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1)
- 🔍 报价代币：KGST (0x94be0bbA8E1E303fE998c9360B57b826F1A4f828)

**核心问题**：
系统在查询 KDOG 配对时，**没有检查 KGST 作为报价代币**，导致选择了 KDOG/WBNB 配对而不是 KDOG/KGST 配对。

**为什么 KGST 没有被检查？**

查看代码 `src/shared/token-route.ts` 第 331-344 行，候选报价代币列表为：

```typescript
// 1. 固定的候选列表
[CONTRACTS.WBNB, CONTRACTS.BUSD, CONTRACTS.USDT, CONTRACTS.ASTER,
 CONTRACTS.USD1, CONTRACTS.UNITED_STABLES_U]

// 2. Four.meme 的报价代币列表
getFourQuoteTokenList()
```

查看 `src/shared/channel-config.ts` 第 9-16 行，`getFourQuoteTokenList()` 返回：

```typescript
const BUILTIN_FOUR_QUOTE_TOKENS: FourQuoteTokenEntry[] = [
  { address: CONTRACTS.CAKE ?? '', label: 'CAKE' },
  { address: CONTRACTS.USDT ?? '', label: 'USDT' },
  { address: CONTRACTS.USDC ?? '', label: 'USDC' },
  { address: CONTRACTS.USD1 ?? '', label: 'USD1' },
  { address: CONTRACTS.ASTER ?? '', label: 'ASTER' },
  { address: CONTRACTS.UNITED_STABLES_U ?? '', label: 'United Stables (U)' }
];
```

**结论**：
- ❌ KGST (0x94be0bbA8E1E303fE998c9360B57b826F1A4f828) **不在候选列表中**
- ❌ 系统只检查了：WBNB, BUSD, USDT, ASTER, USD1, UNITED_STABLES_U, CAKE, USDC
- ❌ 因此系统找到了 KDOG/WBNB 配对就立即返回，没有继续查找 KDOG/KGST 配对

## 当前代码逻辑分析

### 未知代币的处理流程

位置：`src/shared/token-route.ts`

```typescript
// 1. detectTokenPlatform() 返回 'unknown'
// 2. buildPlatformProbeOrder('unknown') 返回 ['unknown']
// 3. fetchDefaultRoute() 被调用
// 4. checkPancakePair() 被调用，不传入 quoteToken 参数
```

### checkPancakePair() 的回退逻辑 (lines 328-384)

当没有指定 `quoteToken` 时：

```typescript
// 1. 构建候选报价代币列表
const candidates: string[] = [];
[CONTRACTS.WBNB, CONTRACTS.BUSD, CONTRACTS.USDT, CONTRACTS.ASTER,
 CONTRACTS.USD1, CONTRACTS.UNITED_STABLES_U].forEach((token) => {
  if (token) {
    const normalized = token.toLowerCase();
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }
});

// 2. 添加 Four.meme 的报价代币
getFourQuoteTokenList().forEach((token) => {
  const normalized = token.toLowerCase();
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
});

// 3. 并行查询所有候选配对
const results = await Promise.all(
  candidates.map(async (quoteToken) => {
    // 查询 V2 和 V3 配对...
  })
);

// 4. 返回第一个有效结果
for (const result of results) {
  if (result && result.hasLiquidity) {
    return result;  // ⚠️ 返回第一个找到的配对
  }
}
```

### 问题所在

**当前逻辑的问题**：
1. ❌ 返回**第一个**找到的配对，而不是**最佳**配对
2. ❌ 没有考虑流动性大小
3. ❌ 没有考虑交易量
4. ❌ 候选顺序固定：WBNB > BUSD > USDT > ASTER > USD1 > UNITED_STABLES_U
5. ❌ 如果 WBNB 配对存在，即使流动性很小，也会被选中

**对于 KDOG 代币**：
- 系统按顺序查询：WBNB, BUSD, USDT, ASTER, USD1, UNITED_STABLES_U
- 找到 KDOG/WBNB 配对 (0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1)
- 立即返回，不再检查其他配对
- **这是唯一的 V2 配对，所以选择是正确的**

## 需要用户澄清的问题

1. **配对地址确认**
   - 0x94be0bbA8E1E303fE998c9360B57b826F1A4f828 确实是您期望的配对地址吗？
   - 还是您记错了地址？

2. **交易平台确认**
   - 您是在 PancakeSwap V2 还是 V3 上交易？
   - 还是在其他 DEX（如 Uniswap、Biswap 等）？

3. **报价代币确认**
   - 您期望使用哪个报价代币？WBNB、USDT、BUSD 还是其他？
   - 系统选择的是 KDOG/WBNB 配对

4. **损失原因确认**
   - 具体的损失是如何发生的？
   - 是价格滑点太大？还是买入了错误的代币？
   - 交易哈希是什么？可以帮助分析具体问题

## 解决方案

### 方案 1：动态发现所有配对（推荐）

**问题**：当前只检查预定义的报价代币列表，无法发现使用其他代币作为报价的配对。

**解决方案**：查询代币的所有配对，然后选择流动性最大的配对。

#### 实现步骤

**步骤 1：查询所有配对**

使用 PancakeSwap Factory 的 `allPairsLength()` 和 `allPairs(index)` 函数，或者使用 The Graph 查询所有包含目标代币的配对。

```typescript
async function findAllPairsForToken(
  publicClient: any,
  tokenAddress: Address
): Promise<Array<{ pairAddress: Address; quoteToken: Address }>> {
  // 方法 1：遍历所有配对（性能较差，不推荐）
  // 方法 2：使用事件日志查询（推荐）

  // 查询 PairCreated 事件
  const logs = await publicClient.getLogs({
    address: CONTRACTS.PANCAKE_FACTORY,
    event: {
      type: 'event',
      name: 'PairCreated',
      inputs: [
        { type: 'address', indexed: true, name: 'token0' },
        { type: 'address', indexed: true, name: 'token1' },
        { type: 'address', indexed: false, name: 'pair' },
        { type: 'uint256', indexed: false, name: 'allPairsLength' }
      ]
    },
    fromBlock: 'earliest',
    toBlock: 'latest'
  });

  // 过滤出包含目标代币的配对
  const pairs = logs
    .filter(log => {
      const token0 = log.args.token0.toLowerCase();
      const token1 = log.args.token1.toLowerCase();
      const target = tokenAddress.toLowerCase();
      return token0 === target || token1 === target;
    })
    .map(log => ({
      pairAddress: log.args.pair,
      quoteToken: log.args.token0.toLowerCase() === tokenAddress.toLowerCase()
        ? log.args.token1
        : log.args.token0
    }));

  return pairs;
}
```

**步骤 2：查询每个配对的流动性**

```typescript
async function getPairReserves(
  publicClient: any,
  pairAddress: Address
): Promise<{ reserve0: bigint; reserve1: bigint }> {
  const result = await publicClient.readContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'getReserves'
  });

  return {
    reserve0: result[0],
    reserve1: result[1]
  };
}
```

**步骤 3：选择流动性最大的配对**

```typescript
async function selectBestPair(
  publicClient: any,
  tokenAddress: Address,
  pairs: Array<{ pairAddress: Address; quoteToken: Address }>
): Promise<{ pairAddress: Address; quoteToken: Address; liquidity: bigint }> {
  // 并行查询所有配对的储备量
  const pairsWithReserves = await Promise.all(
    pairs.map(async (pair) => {
      try {
        const reserves = await getPairReserves(publicClient, pair.pairAddress);

        // 确定哪个是目标代币的储备量
        const [token0, token1] = await Promise.all([
          publicClient.readContract({
            address: pair.pairAddress,
            abi: PAIR_ABI,
            functionName: 'token0'
          }),
          publicClient.readContract({
            address: pair.pairAddress,
            abi: PAIR_ABI,
            functionName: 'token1'
          })
        ]);

        const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
        const targetReserve = isToken0 ? reserves.reserve0 : reserves.reserve1;
        const quoteReserve = isToken0 ? reserves.reserve1 : reserves.reserve0;

        // 使用报价代币的储备量作为流动性指标
        return {
          ...pair,
          liquidity: quoteReserve,
          targetReserve
        };
      } catch (error) {
        return null;
      }
    })
  );

  // 过滤掉失败的查询
  const validPairs = pairsWithReserves.filter(p => p !== null);

  if (validPairs.length === 0) {
    throw new Error('No valid pairs found');
  }

  // 选择流动性最大的配对
  const bestPair = validPairs.reduce((best, current) => {
    return current.liquidity > best.liquidity ? current : best;
  });

  return bestPair;
}
```

**步骤 4：集成到 checkPancakePair**

```typescript
async function checkPancakePair(
  publicClient: any,
  tokenAddress: Address,
  quoteToken?: Address | string | null
): Promise<PancakePairCheckResult> {
  // ... 现有的缓存和 quoteToken 检查逻辑 ...

  // 兜底逻辑：动态发现所有配对
  try {
    const allPairs = await findAllPairsForToken(publicClient, tokenAddress);

    if (allPairs.length === 0) {
      return { hasLiquidity: false };
    }

    const bestPair = await selectBestPair(publicClient, tokenAddress, allPairs);

    // 缓存结果
    pancakePairCache.set(cacheKey, {
      pairAddress: bestPair.pairAddress,
      quoteToken: bestPair.quoteToken,
      version: 'v2',
      timestamp: Date.now()
    });

    return {
      hasLiquidity: true,
      quoteToken: bestPair.quoteToken,
      pairAddress: bestPair.pairAddress,
      version: 'v2'
    };
  } catch (error) {
    logger.error('[checkPancakePair] 动态发现配对失败:', error);
    return { hasLiquidity: false };
  }
}
```

### 方案 2：扩展候选报价代币列表（临时方案）

**优点**：实现简单，改动小
**缺点**：需要手动维护列表，无法覆盖所有情况

```typescript
// 在 src/shared/trading-config.ts 中添加 KGST
export const CONTRACTS = {
  // ... 现有配置 ...
  KGST: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828',
};

// 在 src/shared/channel-config.ts 中添加到候选列表
const BUILTIN_FOUR_QUOTE_TOKENS: FourQuoteTokenEntry[] = [
  { address: CONTRACTS.CAKE ?? '', label: 'CAKE' },
  { address: CONTRACTS.USDT ?? '', label: 'USDT' },
  { address: CONTRACTS.USDC ?? '', label: 'USDC' },
  { address: CONTRACTS.USD1 ?? '', label: 'USD1' },
  { address: CONTRACTS.ASTER ?? '', label: 'ASTER' },
  { address: CONTRACTS.UNITED_STABLES_U ?? '', label: 'United Stables (U)' },
  { address: CONTRACTS.KGST ?? '', label: 'KGST' }  // 新增
];
```

### 方案 3：优先级排序（改进方案 1）

在方案 1 的基础上，不仅考虑流动性，还考虑报价代币的优先级：

```typescript
// 定义报价代币的优先级权重
const QUOTE_TOKEN_PRIORITY = {
  [CONTRACTS.USDT.toLowerCase()]: 100,
  [CONTRACTS.BUSD.toLowerCase()]: 100,
  [CONTRACTS.USDC.toLowerCase()]: 100,
  [CONTRACTS.USD1.toLowerCase()]: 90,
  [CONTRACTS.WBNB.toLowerCase()]: 80,
  [CONTRACTS.ASTER.toLowerCase()]: 70,
  // 其他代币默认权重为 50
};

function calculatePairScore(
  liquidity: bigint,
  quoteToken: string
): number {
  const priority = QUOTE_TOKEN_PRIORITY[quoteToken.toLowerCase()] || 50;
  const liquidityScore = Number(liquidity) / 1e18;

  // 综合评分：流动性 * 优先级权重
  return liquidityScore * priority;
}

// 在 selectBestPair 中使用评分
const bestPair = validPairs.reduce((best, current) => {
  const bestScore = calculatePairScore(best.liquidity, best.quoteToken);
  const currentScore = calculatePairScore(current.liquidity, current.quoteToken);
  return currentScore > bestScore ? current : best;
});
```

### 推荐方案

**短期**（立即修复）：
- 使用**方案 2**：将 KGST 添加到候选列表
- 快速修复当前问题，避免再次损失

**长期**（根本解决）：
- 使用**方案 1 + 方案 3**：动态发现 + 优先级排序
- 彻底解决未知报价代币的问题
- 自动选择最佳配对

## 下一步行动

### 立即行动（修复当前问题）

1. **添加 KGST 到候选列表**（方案 2）
   - 修改 `src/shared/trading-config.ts`：添加 KGST 地址
   - 修改 `src/shared/channel-config.ts`：添加到 BUILTIN_FOUR_QUOTE_TOKENS
   - 测试验证：确保能正确找到 KDOG/KGST 配对

2. **添加日志记录**
   - 记录所有找到的配对
   - 记录选择的配对和原因
   - 方便后续调试和分析

### 长期优化（根本解决）

1. **实现动态配对发现**（方案 1）
   - 使用事件日志查询所有配对
   - 比较流动性选择最佳配对
   - 支持任意报价代币

2. **实现优先级排序**（方案 3）
   - 稳定币优先
   - 流动性加权
   - 综合评分选择

3. **添加配对验证**
   - 检查配对的流动性是否足够
   - 检查价格是否合理
   - 警告用户低流动性风险

## 总结

**问题确认**：
- ✅ 正确的配对：KDOG/KGST (0x14C90904dD8868c8E748e42D092250Ec17f748d1)
- ❌ 系统选择的配对：KDOG/WBNB (0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1)
- 🔍 根本原因：KGST 不在候选报价代币列表中

**代码问题**：
- ❌ 只检查预定义的报价代币列表（WBNB, BUSD, USDT, ASTER, USD1, UNITED_STABLES_U, CAKE, USDC）
- ❌ 无法发现使用其他代币作为报价的配对
- ❌ 返回第一个找到的配对，没有比较流动性

**解决方案**：
- 🚀 短期：添加 KGST 到候选列表（快速修复）
- 🎯 长期：实现动态配对发现 + 流动性比较（根本解决）

**影响范围**：
- 所有使用非标准报价代币的配对都可能遇到此问题
- 建议尽快实施动态配对发现，避免类似问题再次发生

---

**创建日期**: 2026-02-06
**分析人员**: Claude Code
