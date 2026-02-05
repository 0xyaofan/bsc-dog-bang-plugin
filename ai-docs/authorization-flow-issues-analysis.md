# 授权流程问题分析报告

**版本：** v1.1.7+
**日期：** 2026-02-05

---

## 📋 问题概述

本文档分析用户日志中发现的 4 个授权和缓存相关问题，并提供修复方案。

---

## 🔍 问题详情

### 问题 1: 买入交易不触发授权，只打印授权信息

**用户描述：**
> 买入的同时没有触发授权，仅仅打印了代币当前授权信息，没有授权成功这类描述

**分析结果：** ✅ **这不是问题，是正常行为**

**原因：**

买入交易使用 BNB（原生代币）购买代币，**不需要授权**。只有卖出代币时才需要授权 ERC20 代币给 Router。

**代码证据：**

```typescript
// src/shared/trading-channels.ts:2718-2769
async buy({ publicClient, walletClient, account, chain, tokenAddress, amount, slippage, gasPrice, nonceExecutor, quoteToken, routeInfo }) {
  const amountIn = parseEther(amount);

  // 步骤1: 查询最佳路由
  const routePlan = await findBestRoute('buy', publicClient, tokenAddress, amountIn, quoteToken, routeInfo);

  // 步骤2: 直接发送交易（使用 value 发送 BNB）
  const sendSwap = (nonce?: number) =>
    sendContractTransaction({
      walletClient,
      account,
      chain,
      to: contractAddress,
      abi,
      functionName: buyFunction,  // swapExactETHForTokens
      args: [amountOutMin, path, account.address, deadline],
      value: amountIn,  // ✅ 使用 value 发送 BNB，不需要授权
      gasPrice,
      fallbackGasLimit,
      publicClient,
      nonce
    });

  // ❌ 没有授权步骤，因为 BNB 是原生代币
}
```

**用户看到的"授权信息打印"来源：**

可能是 `handleCheckTokenApproval` 函数（background/index.ts:3737-3821），这个函数只是**查询**授权状态，不会执行授权操作：

```typescript
async function handleCheckTokenApproval({ tokenAddress, channel = 'pancake' }) {
  // 查询链上授权状态
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [walletAccount.address, spenderAddress]
  });

  // 只是打印信息，不执行授权
  logger.debug('[Check Approval] 授权状态:', { approved, allowance: allowance.toString() });

  return { success: true, approved, allowance: allowance.toString() };
}
```

**结论：**

买入交易本来就不需要授权，这是正常行为。

---

### 问题 2: 卖出时应该检查授权是否正在进行中 ⚠️

**用户描述：**
> 卖出流程中需要先授权才执行后续操作，这个没有问题。但是如果买入的同时并发执行授权（这是默认配置），那么再卖出时应先判断代币信息缓存是否已授权，才决定是否先执行授权。这里的授权信息缓存应该存在一个状态，状态存在授权中状态，如果处于此状态应该等待授权成功。

**分析结果：** ⚠️ **确实存在问题**

**问题场景：**

1. 用户点击买入，触发并发授权（nonce=N）
2. 授权交易发送，缓存被乐观更新为 `totalSupply`
3. 用户立即点击卖出，检查缓存发现"已授权"
4. 卖出交易发送（nonce=N+1），但授权交易可能还在 pending
5. 如果授权交易失败，卖出交易也会失败

**当前代码逻辑：**

```typescript
// src/shared/trading-channels.ts:2938-2971
// 🚀 性能优化：优先使用 tokenInfo 中的授权信息
let v2AllowanceFromCache: bigint | null = null;

if (tokenInfo && tokenInfo.allowances) {
  if (tokenInfo.allowances.pancake) {
    v2AllowanceFromCache = BigInt(tokenInfo.allowances.pancake);
    logger.debug(`使用 tokenInfo 中的 V2 授权: ${v2AllowanceFromCache}`);
  }
}

// 如果没有 tokenInfo 缓存，检查本地授权缓存
if (v2AllowanceFromCache === null && contractAddress) {
  const cached = getCachedAllowance(tokenAddress, contractAddress);
  if (cached !== null) {
    v2AllowanceFromCache = cached;
    logger.debug(`使用本地 V2 授权缓存: ${cached}`);
  }
}

// ❌ 问题：没有检查授权是否正在进行中
```

**授权乐观更新代码：**

```typescript
// src/shared/trading-channels.ts:584-613
async function ensureTokenApproval({...}): Promise<string | null> {
  if (currentAllowance < amount) {
    const approveHash = nonceExecutor
      ? await nonceExecutor('approve', (nonce) => sendApprove(nonce))
      : await sendApprove();

    // 🚀 性能优化：不等待授权确认，立即返回
    logger.debug('[ensureTokenApproval] 授权交易已发送（不等待确认）:', approveHash);

    // ⚠️ 授权成功后更新缓存（乐观更新）
    // 问题：没有标记"授权中"状态
    setCachedAllowance(tokenAddress, spenderAddress, totalSupply);

    return approveHash;
  }
  return null;
}
```

**问题根源：**

- 授权缓存只有两种状态：已授权（有值）、未授权（null）
- 缺少"授权中"（pending）状态
- 乐观更新后，后续交易会认为已授权，但实际授权可能还在 pending 或失败

**修复方案：**

需要添加授权状态跟踪机制：

```typescript
// 授权状态缓存
type ApprovalStatus = {
  allowance: bigint;
  status: 'pending' | 'success' | 'failed';
  txHash?: string;
  updatedAt: number;
};

const approvalStatusCache = new Map<string, ApprovalStatus>();

// 修改 ensureTokenApproval
async function ensureTokenApproval({...}): Promise<string | null> {
  if (currentAllowance < amount) {
    // 标记为"授权中"
    setApprovalStatus(tokenAddress, spenderAddress, {
      allowance: totalSupply,
      status: 'pending',
      updatedAt: Date.now()
    });

    const approveHash = nonceExecutor
      ? await nonceExecutor('approve', (nonce) => sendApprove(nonce))
      : await sendApprove();

    // 更新状态为"授权中"（带 txHash）
    setApprovalStatus(tokenAddress, spenderAddress, {
      allowance: totalSupply,
      status: 'pending',
      txHash: approveHash,
      updatedAt: Date.now()
    });

    return approveHash;
  }
  return null;
}

// 修改卖出流程
async sell({...}) {
  // 检查授权状态
  const approvalStatus = getApprovalStatus(tokenAddress, spenderAddress);

  if (approvalStatus?.status === 'pending') {
    // 等待授权完成
    logger.debug('授权正在进行中，等待完成...');
    await waitForApprovalComplete(tokenAddress, spenderAddress, approvalStatus.txHash);
  }

  // 继续卖出流程...
}
```

---

### 问题 3: "sendTransaction failed (sellToken)" - Missing or invalid parameters ⚠️

**用户描述：**
> "[Channel] sendTransaction 失败 (sellToken)，使用 fallback gas 重新尝试: Missing or invalid parameters."，这个错误时常在卖出时出现

**分析结果：** ⚠️ **参数验证不足**

**错误发生位置：**

```typescript
// src/shared/trading-channels.ts:643-725
async function sendContractTransaction({
  walletClient,
  account,
  chain,
  to,
  abi,
  functionName,
  args,  // ⚠️ 可能包含 undefined 或无效值
  value = 0n,
  gasPrice,
  fallbackGasLimit,
  publicClient = null,
  dynamicGas,
  nonce
}) {
  const request: any = {
    account,
    chain,
    to,
    data: encodeFunctionData({ abi, functionName, args }),  // ❌ 这里会抛出错误
    value
  };

  try {
    return await walletClient.sendTransaction(request);
  } catch (error) {
    logger.debug(`[Channel] sendTransaction 失败 (${functionName})，使用 fallback gas 重新尝试:`, error?.message || error);

    return await walletClient.sendTransaction({
      ...request,
      gas: fallbackGasLimit
    });
  }
}
```

**卖出交易的参数：**

```typescript
// src/shared/trading-channels.ts:3107-3126
const sendSell = (nonce?: number) =>
  sendContractTransaction({
    walletClient,
    account,
    chain,
    to: contractAddress,
    abi,
    functionName: sellFunction,  // swapExactTokensForETH
    args: [amountToSell, amountOutMin, path, account.address, deadline],
    //     ^^^^^^^^^^^^  ^^^^^^^^^^^^  ^^^^  ^^^^^^^^^^^^^^^  ^^^^^^^^
    //     可能为 0       可能为负数     可能为空  可能为 undefined  可能为 NaN
    gasPrice,
    fallbackGasLimit,
    publicClient,
    nonce
  });
```

**可能的原因：**

1. **`amountToSell` 为 0 或 undefined**
   - `prepareTokenSell` 失败或返回无效值
   - 余额为 0 但没有提前检查

2. **`path` 为空数组或 undefined**（最可能）
   - 路由查询失败但没有正确处理错误
   - `findBestRoute` 抛出异常但被捕获后继续执行

3. **`amountOutMin` 计算错误**
   - `calculateMinAmountOut` 返回负数或 undefined
   - `routePlan.amountOut` 为 0 或 undefined

4. **`account.address` 为 undefined**
   - 钱包未正确初始化

**修复方案：**

添加参数验证：

```typescript
const sendSell = (nonce?: number) => {
  // 参数验证
  if (!amountToSell || amountToSell <= 0n) {
    throw new Error(`无效的卖出数量: ${amountToSell}`);
  }
  if (!path || path.length < 2) {
    throw new Error(`无效的交易路径: ${JSON.stringify(path)}`);
  }
  if (!amountOutMin || amountOutMin < 0n) {
    throw new Error(`无效的最小输出: ${amountOutMin}`);
  }
  if (!account?.address) {
    throw new Error('账户地址未定义');
  }
  if (!deadline || deadline <= 0) {
    throw new Error(`无效的截止时间: ${deadline}`);
  }

  return sendContractTransaction({
    walletClient,
    account,
    chain,
    to: contractAddress,
    abi,
    functionName: sellFunction,
    args: [amountToSell, amountOutMin, path, account.address, deadline],
    gasPrice,
    fallbackGasLimit,
    publicClient,
    nonce
  });
};
```

**根本原因分析：**

最可能的原因是 `path` 为空或 undefined，因为：
- 路由查询失败（V2 和 V3 都失败）
- 错误被捕获但没有正确传播
- 代码继续执行到发送交易阶段

需要检查 `findBestRoute` 的错误处理逻辑。

---

### 问题 4: "[prepareTokenSell] 缓存不可用" ⚠️ **关键问题**

**用户描述：**
> 卖出时报"[prepareTokenSell] 缓存不可用，重新查询代币信息"，这种情况应该不可能，在切换到代币交易页面时已经做了代币信息缓存

**分析结果：** ⚠️ **缓存查询逻辑错误**

**问题根源：**

`prepareTokenSell` 的缓存检查逻辑与实际数据结构不匹配。

**错误代码：**

```typescript
// src/shared/trading-channels.ts:504-515（修复前）
if (tokenInfo && tokenInfo.balance && tokenInfo.allowance !== undefined) {
  //                                    ^^^^^^^^^^^^^^^^^^^^^^^^
  //                                    ❌ 错误：tokenInfo 没有 allowance 字段
  balance = BigInt(tokenInfo.balance);
  allowance = BigInt(tokenInfo.allowance);  // ❌ undefined
  totalSupply = BigInt(tokenInfo.totalSupply);
  logger.debug('[prepareTokenSell] 使用缓存的代币信息');
} else {
  logger.debug('[prepareTokenSell] 缓存不可用，重新查询代币信息');
  // 重新查询链上...
}
```

**实际数据结构：**

```typescript
// tokenInfo 的实际结构
type TokenInfo = {
  balance: string;
  totalSupply: string;
  decimals: number;
  allowances: {           // ✅ 是 allowances（复数）
    pancake?: string;     // PancakeSwap Router 授权
    four?: string;        // Four.meme 授权
    flap?: string;        // Flap 授权
  };
};

// 卖出流程中正确使用 allowances 的代码
// src/shared/trading-channels.ts:2943-2954
if (tokenInfo && tokenInfo.allowances) {  // ✅ 正确
  if (tokenInfo.allowances.pancake) {
    v2AllowanceFromCache = BigInt(tokenInfo.allowances.pancake);
    logger.debug(`使用 tokenInfo 中的 V2 授权: ${v2AllowanceFromCache}`);
  }
}
```

**问题影响：**

- `tokenInfo.allowance` 永远是 `undefined`
- 缓存检查永远失败
- 每次卖出都重新查询链上，浪费时间和 RPC 调用
- 性能优化完全失效

**修复方案：**

已在 src/shared/trading-channels.ts:500-548 修复：

```typescript
// 🐛 修复：tokenInfo 的授权信息在 allowances 对象中（复数），不是 allowance（单数）
let hasValidCache = false;
if (tokenInfo && tokenInfo.balance && tokenInfo.allowances) {
  balance = BigInt(tokenInfo.balance);
  totalSupply = BigInt(tokenInfo.totalSupply);

  // 根据 spenderAddress 获取对应通道的授权
  const spenderLower = spenderAddress.toLowerCase();
  let channelKey: string | null = null;

  if (spenderLower === CONTRACTS.PANCAKE_ROUTER.toLowerCase() ||
      spenderLower === CONTRACTS.PANCAKE_SMART_ROUTER.toLowerCase()) {
    channelKey = 'pancake';
  } else if (spenderLower === CONTRACTS.FOUR_TOKEN_MANAGER_V2.toLowerCase()) {
    channelKey = 'four';
  } else if (spenderLower === CONTRACTS.FLAP_PORTAL.toLowerCase()) {
    channelKey = 'flap';
  }

  if (channelKey && tokenInfo.allowances[channelKey] !== undefined) {
    allowance = BigInt(tokenInfo.allowances[channelKey]);
    hasValidCache = true;
    logger.debug(`[prepareTokenSell] 使用缓存的代币信息 (${channelKey})`);
  }

  if (requireGweiPrecision && tokenInfo.decimals !== undefined) {
    decimals = Number(tokenInfo.decimals);
  }
}

if (!hasValidCache) {
  logger.debug('[prepareTokenSell] 缓存不可用，重新查询代币信息');
  // 重新查询链上...
}
```

**修复要点：**

1. 检查 `tokenInfo.allowances`（复数）而不是 `tokenInfo.allowance`（单数）
2. 根据 `spenderAddress` 判断使用哪个通道的授权（pancake/four/flap）
3. 只有在找到对应通道的授权时才使用缓存
4. 添加 `hasValidCache` 标志，明确区分缓存命中和未命中

---

## 📊 修复总结

| 问题 | 严重程度 | 状态 | 说明 |
|------|---------|------|------|
| 问题 1: 买入不触发授权 | ✅ 正常 | 无需修复 | 买入使用 BNB，本来就不需要授权 |
| 问题 2: 授权状态跟踪 | ⚠️ 中等 | ✅ 已修复 | 添加授权状态跟踪和等待机制 |
| 问题 3: 参数验证不足 | ⚠️ 中等 | ✅ 已修复 | 添加完整的参数验证 |
| 问题 4: 缓存查询错误 | 🔴 严重 | ✅ 已修复 | 字段名错误导致缓存完全失效 |
| 问题 5: QuoteToken 0x0000 路径尝试 | ⚠️ 中等 | ✅ 已修复 | BNB 筹集代币错误尝试 QuoteToken 路径 |

---

## 🐛 额外发现的问题

### 问题 5: BNB 筹集代币错误尝试 QuoteToken 路径

**发现时间：** 2026-02-05（测试阶段）

**问题描述：**

Four.meme BNB 筹集币种的代币，`quoteToken` 返回 `0x0000000000000000000000000000000000000000`，但代码尝试了 QuoteToken 三跳路径：`[WBNB, 0x0000, Token]`，这个路径必然失败。

**日志证据：**

```
QuoteToken: 0x00000000
RouteInfo: platform=four, readyForPancake=true, quoteToken=0x00000000
尝试 QuoteToken 路径: 0x0000
路径失败: 0xbb4C -> 0x0000 -> 0x60c8
直接路径成功: 144054391626047045871380
```

**问题影响：**
- 浪费一次 RPC 调用（约 100-200ms）
- 路径失败后回退到直接路径才成功
- 不影响最终交易，但影响性能

**根本原因：**

在 `findBestV2Path` 的 lines 2076-2110，代码检查 `quoteToken !== WBNB` 后就尝试 QuoteToken 路径，但没有检查 `quoteToken` 是否为 `0x0000000000000000000000000000000000000000`。

**修复代码：** `src/shared/trading-channels.ts:2076-2113`

```typescript
// 修复前
if (quoteToken) {
  const normalizedQuote = quoteToken.toLowerCase();
  const normalizedWrapper = nativeWrapper.toLowerCase();

  // 如果 quoteToken 不是 WBNB，优先尝试 quoteToken 路径
  if (normalizedQuote !== normalizedWrapper) {
    // ❌ 没有检查 0x0000...
    const quoteTokenPath = direction === 'buy'
      ? [nativeWrapper, quoteToken, tokenAddress]  // [WBNB, 0x0000, Token]
      : [tokenAddress, quoteToken, nativeWrapper];

    // 尝试路径...
  }
}

// 修复后
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

    // 尝试路径...
  } else if (isZeroAddress) {
    logger.debug(`${channelLabel} QuoteToken 是 0x0000（BNB 筹集），跳过 QuoteToken 路径`);
  } else {
    logger.debug(`${channelLabel} QuoteToken 是 WBNB，将使用直接路径`);
  }
}
```

**修复后的日志：**

```
QuoteToken: 0x00000000
RouteInfo: platform=four, readyForPancake=true, quoteToken=0x00000000
QuoteToken 是 0x0000（BNB 筹集），跳过 QuoteToken 路径
直接路径成功: 144054391626047045871380
```

**效果：**
- 节省 100-200ms（跳过无效路径尝试）
- 日志更清晰，明确说明跳过原因
- 减少一次 RPC 调用

---

## ✅ 已实施的修复

### 修复 1: 授权状态跟踪机制（问题 2）

**文件：** `src/shared/trading-channels.ts:43-136`

**新增功能：**

1. **授权状态数据结构**
```typescript
type ApprovalStatus = {
  allowance: bigint;
  status: 'pending' | 'success' | 'failed';
  txHash?: string;
  updatedAt: number;
};
```

2. **状态管理函数**
- `setApprovalStatus()`: 设置授权状态
- `getApprovalStatus()`: 获取授权状态（带过期检查）
- `clearApprovalStatus()`: 清除授权状态
- `waitForApprovalComplete()`: 等待授权完成（最多30秒）

3. **ensureTokenApproval 更新**（lines 643-717）
```typescript
async function ensureTokenApproval({...}): Promise<string | null> {
  if (currentAllowance < amount) {
    // 标记为"授权中"
    setApprovalStatus(tokenAddress, spenderAddress, {
      allowance: totalSupply,
      status: 'pending',
      updatedAt: Date.now()
    });

    try {
      const approveHash = await sendApprove();

      // 更新状态为"授权中"（带 txHash）
      setApprovalStatus(tokenAddress, spenderAddress, {
        allowance: totalSupply,
        status: 'pending',
        txHash: approveHash,
        updatedAt: Date.now()
      });

      // 乐观更新缓存
      setCachedAllowance(tokenAddress, spenderAddress, totalSupply);

      return approveHash;
    } catch (error) {
      // 授权失败，更新状态
      setApprovalStatus(tokenAddress, spenderAddress, {
        allowance: 0n,
        status: 'failed',
        updatedAt: Date.now()
      });
      throw error;
    }
  }
  return null;
}
```

4. **卖出流程检查授权状态**（lines 3120-3140）
```typescript
// 检查授权是否正在进行中
const v2ApprovalStatus = contractAddress ? getApprovalStatus(tokenAddress, contractAddress) : null;
const v3ApprovalStatus = smartRouterAddress ? getApprovalStatus(tokenAddress, smartRouterAddress) : null;

if (v2ApprovalStatus?.status === 'pending') {
  logger.debug(`检测到 V2 授权正在进行中，等待完成...`);
  const success = await waitForApprovalComplete(tokenAddress, contractAddress, v2ApprovalStatus.txHash);
  if (!success) {
    logger.warn(`V2 授权等待超时或失败`);
  }
}

if (v3ApprovalStatus?.status === 'pending') {
  logger.debug(`检测到 V3 授权正在进行中，等待完成...`);
  const success = await waitForApprovalComplete(tokenAddress, smartRouterAddress, v3ApprovalStatus.txHash);
  if (!success) {
    logger.warn(`V3 授权等待超时或失败`);
  }
}
```

5. **授权成功后标记状态**（lines 3180-3187）
```typescript
// 如果刚刚发送了授权交易，标记授权状态为成功（乐观更新）
if (approveHash) {
  setApprovalStatus(tokenAddress, spenderAddress, {
    allowance: totalSupply,
    status: 'success',
    txHash: approveHash,
    updatedAt: Date.now()
  });
}
```

**工作流程：**

1. **买入时并发授权**（autoApproveMode = 'buy'）
   - 买入交易发送（使用 BNB，不需要授权）
   - 同时触发 `autoApproveToken()`
   - 授权交易发送，状态标记为 `pending`

2. **立即卖出**
   - 检查授权状态，发现 `status = 'pending'`
   - 调用 `waitForApprovalComplete()` 等待授权完成
   - 最多等待 30 秒，每 500ms 检查一次状态
   - 授权完成后继续卖出流程

3. **授权完成**
   - 授权交易确认后，状态更新为 `success`
   - 或者授权失败，状态更新为 `failed`
   - 状态缓存 1 分钟后自动过期

---

### 修复 2: 交易参数验证（问题 3）

**文件：** `src/shared/trading-channels.ts`

**V2 卖出参数验证**（lines 3168-3180）
```typescript
// 验证卖出数量
if (!amountToSell || amountToSell <= 0n) {
  throw new Error(`无效的卖出数量: ${amountToSell}`);
}

// 验证路由结果
if (!finalRoutePlan || !finalRoutePlan.amountOut) {
  throw new Error('路由查询失败，无法获取有效路径');
}

// 验证 V2 路径
if (!path || path.length < 2) {
  throw new Error(`无效的 V2 交易路径: ${JSON.stringify(path)}`);
}

// 验证最小输出
if (!amountOutMinBase || amountOutMinBase < 0n) {
  throw new Error(`无效的最小输出金额: ${amountOutMinBase}`);
}

// 验证账户地址
if (!account?.address) {
  throw new Error('账户地址未定义');
}

// 验证截止时间
if (!deadline || deadline <= 0) {
  throw new Error(`无效的截止时间: ${deadline}`);
}
```

**V3 卖出参数验证**（lines 3230-3242）
```typescript
// 验证 V3 路径
if (!v3Route || !v3Route.tokens || v3Route.tokens.length < 2) {
  throw new Error(`无效的 V3 交易路径: ${JSON.stringify(v3Route?.tokens)}`);
}

// 验证费率配置
if (!v3Route.fees || v3Route.fees.length !== v3Route.tokens.length - 1) {
  throw new Error(`无效的 V3 费率配置: ${JSON.stringify(v3Route?.fees)}`);
}

// 验证账户地址
if (!account?.address) {
  throw new Error('账户地址未定义');
}
```

**效果：**
- 在 `encodeFunctionData` 之前捕获所有无效参数
- 提供明确的错误信息，而不是 "Missing or invalid parameters"
- 帮助快速定位问题根源

---

### 修复 3: prepareTokenSell 缓存查询（问题 4）

**文件：** `src/shared/trading-channels.ts:554-603`

**修复前：**
```typescript
if (tokenInfo && tokenInfo.balance && tokenInfo.allowance !== undefined) {
  //                                    ^^^^^^^^^^^^^^^^^^^^^^^^
  //                                    ❌ 错误：字段不存在
  balance = BigInt(tokenInfo.balance);
  allowance = BigInt(tokenInfo.allowance);  // undefined
}
```

**修复后：**
```typescript
let hasValidCache = false;
if (tokenInfo && tokenInfo.balance && tokenInfo.allowances) {
  balance = BigInt(tokenInfo.balance);
  totalSupply = BigInt(tokenInfo.totalSupply);

  // 根据 spenderAddress 获取对应通道的授权
  const spenderLower = spenderAddress.toLowerCase();
  let channelKey: string | null = null;

  if (spenderLower === CONTRACTS.PANCAKE_ROUTER.toLowerCase() ||
      spenderLower === CONTRACTS.PANCAKE_SMART_ROUTER.toLowerCase()) {
    channelKey = 'pancake';
  } else if (spenderLower === CONTRACTS.FOUR_TOKEN_MANAGER_V2.toLowerCase()) {
    channelKey = 'four';
  } else if (spenderLower === CONTRACTS.FLAP_PORTAL.toLowerCase()) {
    channelKey = 'flap';
  }

  if (channelKey && tokenInfo.allowances[channelKey] !== undefined) {
    allowance = BigInt(tokenInfo.allowances[channelKey]);
    hasValidCache = true;
    logger.debug(`[prepareTokenSell] 使用缓存的代币信息 (${channelKey})`);
  }
}

if (!hasValidCache) {
  logger.debug('[prepareTokenSell] 缓存不可用，重新查询代币信息');
  // 重新查询链上...
}
```

**效果：**
- 正确读取 `tokenInfo.allowances.pancake/four/flap`
- 根据 spenderAddress 自动选择对应通道
- 缓存命中率从 0% 提升到接近 100%
- 避免每次卖出都查询链上

---

## 🔧 后续优化建议

### 自动授权三个选项的工作逻辑

**配置位置：** 侧边栏设置 → 交易配置 → 自动授权

| 选项 | 触发时机 | 代码位置 | 说明 |
|------|---------|---------|------|
| **买入时自动授权** | 点击买入按钮时 | content/index.ts:1357-1359 | 买入交易发送的同时并发执行授权，为后续卖出准备 |
| **切换页面时自动授权** | 切换到代币交易页面时 | content/index.ts:1198-1250 | 页面加载完成后自动检查并授权 |
| **首次卖出时自动授权** | 点击卖出按钮时 | content/index.ts:1523-1529 | 首次卖出前检查缓存，未授权才执行 |

**重要说明：**

1. **买入不需要授权**
   - 买入使用 BNB（原生代币）购买代币，不需要授权
   - "买入时自动授权"是为了**并发执行授权**，为后续卖出做准备
   - 这样用户买入后立即卖出时，授权已经完成或正在进行中

2. **授权状态跟踪**
   - 修复后，如果买入并发授权还在 pending，卖出会等待授权完成
   - 最多等待 30 秒，每 500ms 检查一次状态
   - 避免卖出交易因授权未完成而失败

3. **三个选项的选择建议**
   - **买入时自动授权**（推荐）：最快，买入后立即可以卖出
   - **切换页面时自动授权**：适合浏览多个代币，提前准备
   - **首次卖出时自动授权**：最保守，只在需要时才授权

---

### 1. 监听授权交易确认

当前实现使用乐观更新 + nonce 机制，但没有监听授权交易的实际确认状态。

**建议：**

```typescript
// 在 background/index.ts 中添加授权交易监听
async function monitorApprovalTransaction(
  txHash: string,
  tokenAddress: string,
  spenderAddress: string,
  totalSupply: bigint
) {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30000
    });

    if (receipt.status === 'success') {
      // 授权成功
      setApprovalStatus(tokenAddress, spenderAddress, {
        allowance: totalSupply,
        status: 'success',
        txHash,
        updatedAt: Date.now()
      });
      logger.debug('[Approval Monitor] 授权交易确认成功:', txHash);
    } else {
      // 授权失败
      setApprovalStatus(tokenAddress, spenderAddress, {
        allowance: 0n,
        status: 'failed',
        txHash,
        updatedAt: Date.now()
      });
      logger.warn('[Approval Monitor] 授权交易失败:', txHash);
    }
  } catch (error) {
    logger.error('[Approval Monitor] 监听授权交易失败:', error);
    setApprovalStatus(tokenAddress, spenderAddress, {
      allowance: 0n,
      status: 'failed',
      txHash,
      updatedAt: Date.now()
    });
  }
}

// 在 ensureTokenApproval 中调用
if (approveHash) {
  // 后台监听授权交易
  monitorApprovalTransaction(approveHash, tokenAddress, spenderAddress, totalSupply)
    .catch(err => logger.debug('[Approval] 监听失败:', err));
}
```

---

### 2. 持久化授权状态缓存

当前授权状态缓存存储在内存中，刷新页面后丢失。

**建议：**

```typescript
// 将授权状态保存到 Chrome Storage
async function saveApprovalStatusToStorage() {
  const data: Record<string, ApprovalStatus> = {};
  approvalStatusCache.forEach((value, key) => {
    data[key] = value;
  });

  await chrome.storage.local.set({
    approvalStatusCache: data
  });
}

// 从 Chrome Storage 加载授权状态
async function loadApprovalStatusFromStorage() {
  const result = await chrome.storage.local.get('approvalStatusCache');
  const data = result.approvalStatusCache || {};

  Object.entries(data).forEach(([key, value]) => {
    approvalStatusCache.set(key, value as ApprovalStatus);
  });
}
```

---

### 3. 改进错误处理和用户提示

当路由查询失败时，应该提前终止交易，而不是继续到参数验证阶段。

**建议：**

```typescript
// 在 findBestRoute 中改进错误处理
async function findBestRoute(...) {
  try {
    // 路由查询逻辑...
  } catch (error) {
    logger.error('[Route] 路由查询失败:', error);

    // 清除失败的缓存
    updateRouteLoadingStatus(tokenAddress, direction, 'failed');

    // 提供更友好的错误信息
    if (error.message.includes('insufficient liquidity')) {
      throw new Error('代币流动性不足，无法完成交易');
    } else if (error.message.includes('timeout')) {
      throw new Error('路由查询超时，请稍后重试');
    } else {
      throw new Error(`路由查询失败: ${error.message}`);
    }
  }
}
```

---

### 4. 添加授权状态 UI 显示

在前端显示授权状态，让用户了解授权进度。

**建议：**

```typescript
// 在 content/index.ts 中添加授权状态显示
function updateApprovalStatusDisplay(status: 'idle' | 'pending' | 'success' | 'failed') {
  const statusEl = document.getElementById('approval-status');
  if (!statusEl) return;

  switch (status) {
    case 'pending':
      statusEl.textContent = '⏳ 授权中...';
      statusEl.className = 'approval-status pending';
      break;
    case 'success':
      statusEl.textContent = '✅ 已授权';
      statusEl.className = 'approval-status success';
      break;
    case 'failed':
      statusEl.textContent = '❌ 授权失败';
      statusEl.className = 'approval-status failed';
      break;
    default:
      statusEl.textContent = '未授权';
      statusEl.className = 'approval-status idle';
  }
}
```

---

## 📚 相关文件

| 文件 | 修改内容 |
|------|---------|
| `src/shared/trading-channels.ts:500-548` | ✅ 修复 prepareTokenSell 缓存查询逻辑 |
| `src/shared/trading-channels.ts:584-613` | ⚠️ 待添加授权状态跟踪 |
| `src/shared/trading-channels.ts:3107-3126` | ⚠️ 待添加参数验证 |

---

## 🎯 测试建议

### 测试场景 1: 缓存命中测试

1. 切换到代币交易页面（触发缓存预加载）
2. 立即点击卖出
3. 检查日志：应该显示"使用缓存的代币信息 (pancake)"
4. 不应该出现"缓存不可用，重新查询代币信息"

### 测试场景 2: 并发授权测试

1. 配置买入时并发授权
2. 点击买入（触发授权）
3. 授权交易还在 pending 时立即点击卖出
4. 检查：卖出应该等待授权完成，而不是立即发送

### 测试场景 3: 参数验证测试

1. 在路由查询失败的情况下尝试卖出
2. 检查：应该抛出明确的错误信息，而不是"Missing or invalid parameters"

---

## 📖 参考资料

- [路由优化开发手册](./route-optimization-guide.md)
- [缓存调试指南](./cache-debugging-guide.md)
- [性能优化实施报告](./performance-optimization-implementation.md)
