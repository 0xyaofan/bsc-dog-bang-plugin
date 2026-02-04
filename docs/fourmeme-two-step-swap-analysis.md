# Multicall 在 Four.meme 非 BNB 筹集币种场景的应用分析

**日期：** 2026-02-04
**场景：** Four.meme 非 BNB 筹集币种（如 USDT、USDC）在未迁移阶段的两阶段交易

---

## 问题场景

### Four.meme 非 BNB 筹集币种交易流程

**未迁移阶段：**
```
用户持有：BNB
目标代币：Four.meme Token（筹集币种为 USDT）

交易流程：
1. BNB → USDT（通过 PancakeSwap）
2. USDT → Four.meme Token（通过 TokenManager 合约）
```

**已迁移阶段：**
```
用户持有：BNB
目标代币：Four.meme Token（已迁移到 PancakeSwap）

交易流程：
1. BNB → USDT → Token（通过 PancakeSwap V2，单次交易）
```

### 当前实现方式

插件实现了两种方式：

#### 方式 1：自定义合约（推测）
```solidity
// 自定义合约实现两步交易
contract MultiSwapHelper {
  function swapAndBuy(
    address quoteToken,
    address tokenAddress,
    uint256 amountIn
  ) external payable {
    // 步骤 1：BNB → QuoteToken（PancakeSwap）
    uint256 quoteAmount = pancakeRouter.swapExactETHForTokens{value: msg.value}(...);

    // 步骤 2：QuoteToken → Token（TokenManager）
    tokenManager.buy(tokenAddress, quoteAmount, minAmountOut);
  }
}
```

#### 方式 2：代码分阶段执行（当前实现）
```typescript
// 步骤 1：BNB → QuoteToken
const swapTx = await pancakeRouter.swapExactETHForTokens(
  amountIn,
  minAmountOut,
  [WBNB, quoteToken],
  userAddress,
  deadline
);
await waitForTransaction(swapTx);

// 步骤 2：QuoteToken → Token
const buyTx = await tokenManager.buy(
  tokenAddress,
  quoteAmount,
  minAmountOut
);
```

---

## Multicall 能否解决这个问题？

### ❌ 标准 Multicall 不适用

**原因：Multicall 只能批量执行 READ 操作，不能批量执行 WRITE 操作**

```typescript
// ✅ Multicall 可以做的（批量读取）
const results = await publicClient.multicall({
  contracts: [
    { address: token1, functionName: 'balanceOf', args: [user] },
    { address: token2, functionName: 'balanceOf', args: [user] },
    { address: token3, functionName: 'balanceOf', args: [user] }
  ]
});

// ❌ Multicall 不能做的（批量写入）
// 这是不可能的，因为 multicall 是 view/pure 函数
await publicClient.multicall({
  contracts: [
    { address: router, functionName: 'swapExactETHForTokens', ... }, // ❌ 状态修改
    { address: tokenManager, functionName: 'buy', ... }              // ❌ 状态修改
  ]
});
```

### Multicall 的本质

**Multicall 合约：**
```solidity
contract Multicall {
  function aggregate(Call[] memory calls)
    public
    view  // 注意：这是 view 函数
    returns (uint256 blockNumber, bytes[] memory returnData)
  {
    for (uint256 i = 0; i < calls.length; i++) {
      (bool success, bytes memory ret) = calls[i].target.staticcall(calls[i].callData);
      // staticcall 只能调用 view/pure 函数，不能修改状态
      require(success);
      returnData[i] = ret;
    }
  }
}
```

**限制：**
- ✅ 可以批量读取数据（balanceOf、getAmountsOut、getReserves）
- ❌ 不能批量执行交易（swap、transfer、approve）
- ❌ 不能组合多个状态修改操作

---

## 解决方案对比

### 方案 1：自定义合约（推荐）✅

**实现：**
```solidity
contract FourMemeSwapHelper {
  IPancakeRouter02 public immutable pancakeRouter;
  ITokenManager public immutable tokenManager;

  function swapAndBuy(
    address tokenAddress,
    address quoteToken,
    uint256 minQuoteAmount,
    uint256 minTokenAmount,
    uint256 deadline
  ) external payable returns (uint256 tokenAmount) {
    // 步骤 1：BNB → QuoteToken
    address[] memory path = new address[](2);
    path[0] = pancakeRouter.WETH();
    path[1] = quoteToken;

    uint256[] memory amounts = pancakeRouter.swapExactETHForTokens{value: msg.value}(
      minQuoteAmount,
      path,
      address(this), // 接收到合约地址
      deadline
    );
    uint256 quoteAmount = amounts[1];

    // 步骤 2：授权 TokenManager
    IERC20(quoteToken).approve(address(tokenManager), quoteAmount);

    // 步骤 3：QuoteToken → Token
    tokenAmount = tokenManager.buy(tokenAddress, quoteAmount, minTokenAmount);

    // 步骤 4：转移代币给用户
    IERC20(tokenAddress).transfer(msg.sender, tokenAmount);
  }
}
```

**优势：**
- ✅ **单次交易**：用户只需发送一次交易
- ✅ **原子性**：要么全部成功，要么全部失败
- ✅ **Gas 优化**：节省一次交易的 21000 base gas
- ✅ **用户体验**：无需等待第一步完成
- ✅ **无需中间授权**：合约内部处理授权

**劣势：**
- ❌ 需要部署自定义合约
- ❌ 需要审计合约安全性
- ❌ 需要维护合约代码

### 方案 2：代码分阶段执行（当前实现）⚠️

**实现：**
```typescript
async function buyNonBNBQuoteToken(params) {
  // 步骤 1：BNB → QuoteToken
  const swapTx = await pancakeRouter.swapExactETHForTokens(...);
  await publicClient.waitForTransactionReceipt({ hash: swapTx });

  // 步骤 2：查询 QuoteToken 余额
  const quoteBalance = await quoteToken.balanceOf(userAddress);

  // 步骤 3：授权 TokenManager
  const approveTx = await quoteToken.approve(tokenManager, quoteBalance);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // 步骤 4：QuoteToken → Token
  const buyTx = await tokenManager.buy(tokenAddress, quoteBalance, minAmountOut);
  return buyTx;
}
```

**优势：**
- ✅ 无需部署合约
- ✅ 灵活性高，易于调试
- ✅ 可以在每步之间添加检查

**劣势：**
- ❌ **多次交易**：需要 3 次交易（swap + approve + buy）
- ❌ **非原子性**：第一步成功后，第二步可能失败
- ❌ **Gas 成本高**：3 次交易的 base gas（63000）
- ❌ **用户体验差**：需要等待多次交易确认
- ❌ **MEV 风险**：中间状态可能被抢跑

### 方案 3：Batch Precompile（仅特定链）⚠️

**适用链：** Moonbeam、Moonriver（支持 Batch Precompile）

**实现：**
```typescript
// 使用 Batch Precompile 合并多个交易
const batchTx = await batchPrecompile.batchAll([
  { to: pancakeRouter, data: swapCalldata },
  { to: quoteToken, data: approveCalldata },
  { to: tokenManager, data: buyCalldata }
]);
```

**优势：**
- ✅ 单次交易
- ✅ 原子性

**劣势：**
- ❌ **仅支持特定链**（BSC 不支持）
- ❌ 需要特殊的预编译合约

---

## 推荐方案

### 短期（当前）：方案 2 - 代码分阶段执行

**原因：**
- ✅ 无需部署合约
- ✅ 快速实现
- ✅ 灵活性高

**适用场景：**
- 未迁移的 Four.meme 代币（少见）
- 用户可以接受多次交易

**优化建议：**
```typescript
// 优化：使用 nonce 管理器加速交易
async function buyNonBNBQuoteTokenOptimized(params) {
  const nonce = await publicClient.getTransactionCount({ address: userAddress });

  // 并行发送交易（使用递增的 nonce）
  const [swapTx, approveTx, buyTx] = await Promise.all([
    pancakeRouter.swapExactETHForTokens({ nonce: nonce }),
    quoteToken.approve({ nonce: nonce + 1 }), // 预先授权
    tokenManager.buy({ nonce: nonce + 2 })    // 预先买入
  ]);

  // 注意：这种方式有风险，如果第一步失败，后续交易也会失败
}
```

### 中期（推荐）：方案 1 - 自定义合约

**实施步骤：**

1. **设计合约**
   ```solidity
   contract FourMemeSwapHelper {
     function swapAndBuy(...) external payable;
     function swapAndSell(...) external;
   }
   ```

2. **安全审计**
   - 检查重入攻击
   - 检查授权管理
   - 检查余额处理

3. **部署合约**
   - 部署到 BSC 主网
   - 验证合约代码

4. **集成到插件**
   ```typescript
   // 检测是否为非 BNB 筹集币种
   if (quoteToken !== WBNB && !routeInfo.readyForPancake) {
     // 使用自定义合约
     return await swapHelper.swapAndBuy(tokenAddress, quoteToken, ...);
   } else {
     // 使用标准流程
     return await tokenManager.buy(tokenAddress, ...);
   }
   ```

**预期收益：**
- ✅ 用户体验提升（1 次交易 vs 3 次交易）
- ✅ Gas 成本降低（~30%）
- ✅ 交易速度提升（~60%）
- ✅ 原子性保证

**成本：**
- 合约开发：2-3 天
- 安全审计：1-2 天
- 部署和测试：1 天
- 总计：4-6 天

---

## 性能对比

### 场景：买入非 BNB 筹集币种的 Four.meme 代币

| 指标 | 方案 1（自定义合约） | 方案 2（分阶段执行） |
|------|-------------------|-------------------|
| **交易次数** | 1 次 | 3 次 |
| **Gas 成本** | ~250K | ~350K |
| **交易时间** | 3-5 秒 | 9-15 秒 |
| **原子性** | ✅ 保证 | ❌ 无保证 |
| **MEV 风险** | ✅ 低 | ❌ 高 |
| **用户体验** | ✅ 优秀 | ⚠️ 一般 |
| **开发成本** | ❌ 高 | ✅ 低 |

---

## 结论

### 核心观点

**Multicall 不能解决两阶段交易问题**

**原因：**
- Multicall 只能批量执行 READ 操作
- 不能批量执行 WRITE 操作（swap、transfer、approve）
- 不能组合多个状态修改操作

### 推荐方案

**短期：** 保持当前的分阶段执行方式
- 无需额外开发
- 适用于少见的未迁移代币

**中期：** 开发自定义合约
- 显著提升用户体验
- 降低 Gas 成本
- 提供原子性保证

### 实施优先级

**低优先级** - 因为：
1. 未迁移的非 BNB 筹集币种代币很少见
2. 大部分代币已迁移到 PancakeSwap（单次交易）
3. 当前方案虽然不完美，但可用

**如果遇到以下情况，提升优先级：**
- 用户频繁交易未迁移的非 BNB 筹集币种代币
- 用户反馈交易体验差
- 竞品实现了更好的方案

---

## 参考资料

- [Approve & Swap with Batch Precompile](https://docs.moonbeam.network/tutorials/eth-api/batch-approve-swap/)
- [How to Coordinate Batch Transactions](https://www.chainscore.finance/guides/core-blockchain-concepts-and-architecture/transaction-lifecycle/how-to-coordinate-batch-transactions)
- [Ordering transactions in a batch multisend/multicall](https://ethereum.stackexchange.com/questions/136945/ordering-transactions-in-a-batch-multisend-multicall)

---

**总结：** Multicall 不适用于两阶段交易场景。推荐中期开发自定义合约来优化用户体验。
