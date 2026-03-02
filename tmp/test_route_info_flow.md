# 路由信息流转测试

## 修改内容总结

### 问题分析

1. **预加载阶段**：插件的 `DefaultPlatformQuery` 正确设置了 `route.quoteToken = 'USDT'`
2. **调用 SDK 阶段**：插件调用 `buyTokenWithSDK` 时**没有传递 `routeInfo`**
3. **SDK 内部**：`PancakeTradingService` **没有使用 `params.routeInfo.quoteToken`**
4. **路由选择**：`RouteSelector.selectBestRoute` **没有收到 `quoteToken` 参数**
5. **结果**：SDK 只生成单跳路由 `[WBNB, TOKEN]`，无法生成多跳路由 `[WBNB, USDT, TOKEN]`

### 修改内容

#### 1. SDK - PancakeTradingService (bsc-trading-sdk/packages/pancakeswap/src/pancake-trading-service.ts)

**买入方法（第 73-83 行）**：
```typescript
const route = await routeSelector.selectBestRoute({
  publicClient: context.publicClient,
  tokenIn: this.WBNB_ADDRESS,
  tokenOut: params.tokenAddress as Address,
  amountIn: amountWei,
  slippageBps: params.slippage || 50,
  preferredVersion: pancakeParams.preferredVersion,
  preferredFee: pancakeParams.preferredFee,
  quoteToken: params.routeInfo?.quoteToken as Address | undefined, // ✅ 新增
});
```

**卖出方法（第 188-198 行）**：
```typescript
const route = await routeSelector.selectBestRoute({
  publicClient: context.publicClient,
  tokenIn: params.tokenAddress as Address,
  tokenOut: this.WBNB_ADDRESS,
  amountIn: amountWei,
  slippageBps: params.slippage || 50,
  preferredVersion: pancakeParams.preferredVersion,
  preferredFee: pancakeParams.preferredFee,
  quoteToken: params.routeInfo?.quoteToken as Address | undefined, // ✅ 新增
});
```

#### 2. 插件 - sdk-trading-v2.ts

**buyTokenWithSDK 参数（第 36-41 行）**：
```typescript
export async function buyTokenWithSDK(params: {
  tokenAddress: string;
  amount: number;
  slippage: number;
  channel?: string;
  routeInfo?: any; // ✅ 新增
})
```

**buyTokenWithSDK 调用（第 78-84 行）**：
```typescript
const result = await sdkManagerAdapter.buyToken({
  tokenAddress: params.tokenAddress as Address,
  amountBnb: params.amount,
  slippageBps,
  channel,
  routeInfo: params.routeInfo, // ✅ 新增
});
```

**sellTokenWithSDK 参数（第 115-122 行）**：
```typescript
export async function sellTokenWithSDK(params: {
  tokenAddress: string;
  amount?: bigint;
  percent?: number;
  slippage: number;
  channel?: string;
  tokenInfo?: any;
  routeInfo?: any; // ✅ 新增
})
```

**sellTokenWithSDK 调用（第 178-184 行）**：
```typescript
const result = await sdkManagerAdapter.sellToken({
  tokenAddress: params.tokenAddress as Address,
  amountToken,
  slippageBps,
  channel,
  routeInfo: params.routeInfo, // ✅ 新增
});
```

#### 3. 插件 - sdk-manager-adapter.ts

**buyToken 参数（第 110-117 行）**：
```typescript
async buyToken(params: {
  tokenAddress: Address;
  amountBnb: string | number;
  slippageBps?: number;
  channel?: string;
  gasPriceWei?: bigint;
  deadline?: number;
  routeInfo?: any; // ✅ 新增
})
```

**buyToken 调用（第 129-136 行）**：
```typescript
const result = await this.manager.buy({
  tokenAddress: params.tokenAddress,
  amountBnb: params.amountBnb,
  slippage: params.slippageBps,
  channel: params.channel as any,
  gasPriceWei: params.gasPriceWei,
  deadline: params.deadline,
  routeInfo: params.routeInfo, // ✅ 新增
});
```

**sellToken 参数（第 165-172 行）**：
```typescript
async sellToken(params: {
  tokenAddress: Address;
  amountToken: string | number;
  slippageBps?: number;
  channel?: string;
  gasPriceWei?: bigint;
  deadline?: number;
  routeInfo?: any; // ✅ 新增
})
```

**sellToken 调用（第 184-191 行）**：
```typescript
const result = await this.manager.sell({
  tokenAddress: params.tokenAddress,
  amountToken: params.amountToken,
  slippage: params.slippageBps,
  channel: params.channel as any,
  gasPriceWei: params.gasPriceWei,
  deadline: params.deadline,
  routeInfo: params.routeInfo, // ✅ 新增
});
```

#### 4. 插件 - index.ts

**买入调用（第 2922-2927 行）**：
```typescript
const sdkResult = await buyTokenWithSDK({
  tokenAddress: normalizedTokenAddress,
  amount: Number(amount),
  slippage: resolvedSlippage,
  channel: resolvedChannelId,
  routeInfo: routeInfo, // ✅ 新增
});
```

**卖出调用（第 3162-3168 行）**：
```typescript
const sdkResult = await sellTokenWithSDK({
  tokenAddress: normalizedTokenAddress,
  percent: resolvedPercent,
  slippage: resolvedSlippage,
  channel: resolvedChannelId,
  tokenInfo,
  routeInfo: routeInfo, // ✅ 新增
});
```

## 数据流转路径

```
1. 预加载阶段
   └─ DefaultPlatformQuery.queryRoute()
      └─ pancakePairFinder.findBestPair()
         └─ 返回 { quoteToken: '0x55d398326f99059ff775485246999027b3197955' (USDT) }

2. 买入交易阶段
   └─ index.ts: handleBuyToken()
      └─ resolveTokenRoute(tokenAddress)
         └─ routeInfo = { quoteToken: '0x55d398326f99059ff775485246999027b3197955', ... }
      └─ buyTokenWithSDK({ ..., routeInfo })
         └─ sdkManagerAdapter.buyToken({ ..., routeInfo })
            └─ tradingManager.buy({ ..., routeInfo })
               └─ PancakeTradingService.buy({ ..., routeInfo })
                  └─ RouteSelector.selectBestRoute({ ..., quoteToken: routeInfo.quoteToken })
                     └─ generateRoutes({ quoteToken })
                        ├─ V2 单跳: [WBNB, TOKEN]
                        ├─ V2 多跳: [WBNB, USDT, TOKEN] ✅
                        ├─ V3 单跳: [WBNB, TOKEN] (fee=500/2500/10000)
                        └─ V3 多跳: [WBNB, USDT, TOKEN] (fee=500/2500/10000) ✅
```

## 预期效果

### 修改前
- SDK 只生成单跳路由：`[WBNB, TOKEN]`
- V3 单跳报价失败（因为没有 WBNB/TOKEN 的 V3 池子）
- 最终选择 V2 路由

### 修改后
- SDK 生成单跳和多跳路由：
  - 单跳：`[WBNB, TOKEN]`
  - 多跳：`[WBNB, USDT, TOKEN]` ✅
- V3 多跳报价成功（WBNB->USDT->TOKEN）
- 比较 V2 和 V3 的报价，选择最优路由
- 预期选择 V3 多跳路由（因为流动性更好）

## 测试方法

### 1. 查看控制台日志

在浏览器控制台中查找以下日志：

```
[RouteSelector] 开始选择路由
  tokenIn: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c (WBNB)
  tokenOut: 0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197 (TOKEN)
  quoteToken: 0x55d398326f99059ff775485246999027b3197955 (USDT) ✅

[RouteSelector] 生成路由选项
  count: 8 (或更多)
  routes: [
    { mode: { kind: 'v2' }, pathLength: 2 },
    { mode: { kind: 'v2' }, pathLength: 3 }, ✅ 多跳
    { mode: { kind: 'v3', fee: 500 }, pathLength: 2 },
    { mode: { kind: 'v3', fee: 500 }, pathLength: 3 }, ✅ 多跳
    ...
  ]

[RouteSelector] V3 多跳报价成功
  path: [WBNB, USDT, TOKEN]
  fee: 10000
  amountOut: ... ✅

[RouteSelector] 选择最优路由
  mode: { kind: 'v3', fee: 10000 }
  expectedOutput: ...
```

### 2. 检查交易路径

在交易确认前，检查交易数据中的路径编码：

- V2 多跳：`path = [WBNB, USDT, TOKEN]`
- V3 多跳：`path = 0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c002710 55d398326f99059ff775485246999027b3197955002710 e747e54783ba3f77a8e5251a3cba19ebe9c0e197`
  - `bb4cdb...` = WBNB (20 bytes)
  - `002710` = fee 10000 (3 bytes)
  - `55d398...` = USDT (20 bytes)
  - `002710` = fee 10000 (3 bytes)
  - `e747e5...` = TOKEN (20 bytes)

### 3. 验证交易成功

- 交易应该成功执行
- Gas 费用应该合理
- 获得的代币数量应该符合预期

## 注意事项

1. **缓存问题**：如果之前有缓存的路由信息，可能需要清除缓存或等待缓存过期（30秒）
2. **RPC 限制**：确保 RPC 节点支持 V3 报价查询
3. **流动性变化**：V3 池子的流动性可能会变化，影响报价结果
4. **Gas 估算**：V3 多跳交易的 Gas 费用会比单跳高

## 回滚方案

如果修改导致问题，可以通过以下方式回滚：

1. 恢复 `PancakeTradingService.ts` 中的 `selectBestRoute` 调用，移除 `quoteToken` 参数
2. 恢复插件中的 `buyTokenWithSDK` 和 `sellTokenWithSDK` 调用，移除 `routeInfo` 参数
3. 重新编译：`npm run build`
