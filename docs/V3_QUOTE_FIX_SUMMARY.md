# V3 报价修复总结

## 问题

V3 报价一直失败，错误信息为 "execution reverted"。尝试了多种函数选择器和参数编码方式都失败：

- ❌ 0xf7729d43 - 错误的选择器
- ❌ 0x1296323f - 独立参数版本（PancakeSwap 不使用）
- ❌ 手动 eth_call 编码 - 参数格式错误

## 根本原因

PancakeSwap V3 的 QuoterV2 合约使用的是 **tuple 参数格式**，函数签名为：

```solidity
function quoteExactInputSingle(
  (address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params
) external returns (...)
```

关键点：参数是一个**命名的 tuple**，名称为 `params`。

## 解决方案

通过查看 v1 项目的实现，发现正确的方法是使用 viem 的 `readContract` 配合正确的 ABI 定义。

### 正确的实现

```typescript
// 1. 定义正确的 ABI（包含 tuple 参数）
const QUOTER_ABI = [{
  inputs: [{
    components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    name: 'params',  // 重要：tuple 参数的名称
    type: 'tuple',
  }],
  name: 'quoteExactInputSingle',
  outputs: [
    { name: 'amountOut', type: 'uint256' },
    { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' },
    { name: 'gasEstimate', type: 'uint256' },
  ],
  stateMutability: 'view',
  type: 'function',
}] as const;

// 2. 使用 readContract 调用
const result = await publicClient.readContract({
  address: PANCAKE_V3_QUOTER,
  abi: QUOTER_ABI,
  functionName: 'quoteExactInputSingle',
  args: [{
    tokenIn,
    tokenOut,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0n,
  }],
});

// 3. 提取返回值
const amountOut = Array.isArray(result) ? result[0] : result;
```

## 修改的文件

### 1. SDK 路由选择器
**文件**: `bsc-trading-sdk/packages/aggregator/src/router/route-selector.ts`

**修改内容**:
- 更新 `getV3SingleHopQuote` 方法，使用 viem readContract 和正确的 tuple ABI
- 更新 `getV3MultiHopQuote` 方法，使用 viem readContract
- 移除手动 eth_call 编码逻辑

### 2. 文档更新
**文件**: `docs/V3_ETH_CALL_FIX.md`

**修改内容**:
- 更新为正确的 viem readContract 方法
- 添加正确的 ABI 定义示例
- 说明为什么之前的方法失败
- 添加函数选择器验证方法

## 验证

### 函数选择器验证

```typescript
// 正确的 tuple 版本
keccak256('quoteExactInputSingle((address,address,uint256,uint24,uint160))')
// 结果: 0xc6a5026a ✓

// 错误的独立参数版本
keccak256('quoteExactInputSingle(address,address,uint256,uint24,uint160)')
// 结果: 0x1296323f ✗
```

### 测试结果

- ✅ 函数选择器正确（0xc6a5026a）
- ✅ 参数编码正确（tuple 格式）
- ✅ 可以正确调用 QuoterV2 合约
- ✅ 返回值解码正确
- ✅ 在 Service Worker 中可以正常运行

## 优势

1. **正确的函数调用** - 使用正确的 tuple 参数格式
2. **更简洁的代码** - 不需要手动编码/解码
3. **更好的错误处理** - viem 提供详细的错误信息
4. **Service Worker 兼容** - 新版本 viem 不会触发动态 import

## 下一步

现在 V3 报价功能已经修复，系统会自动在 V2 和 V3 之间选择最优路由：

1. 查询所有可用的 V2 和 V3 路由
2. 获取每个路由的报价
3. 选择输出最高的路由
4. 如果输出接近，优先选择 V2（Gas 更低）

用户可以正常使用插件进行交易，系统会自动选择最优路由。

## 参考

- v1 项目实现: `/Users/youyifan/code/blockchain/binance/meme-trade-projects/v1/bsc-dog-bang-plugin`
- PancakeSwap V3 QuoterV2: `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`
- 详细文档: `docs/V3_ETH_CALL_FIX.md`
