# EVM 批量执行 Write 操作技术研究

**日期：** 2026-02-04
**研究目标：** 寻找可以批量执行状态修改（write）操作的 EVM 技术

---

## 执行摘要

**✅ 存在批量执行 write 操作的技术！**

发现了两种主要技术：
1. **Multicall3 合约** - 通用方案，支持大部分 EVM 链（包括 BSC）
2. **Batch Precompile** - 特定链方案（Moonbeam、Tanssi 等）

---

## 1. Multicall3 合约

### 核心发现

**Multicall3 可以批量执行状态修改操作！**

与传统 Multicall 不同，Multicall3 提供了 `aggregate3Value` 函数，可以：
- ✅ 批量执行状态修改操作（swap、transfer、approve）
- ✅ 支持发送 ETH/BNB
- ✅ 原子性执行（全部成功或全部失败）
- ✅ 单次交易

### 合约地址

**Multicall3 已部署到多个链：**

| 链 | 地址 | 状态 |
|-----|------|------|
| **Ethereum** | `0xcA11bde05977b3631167028862bE2a173976CA11` | ✅ 已部署 |
| **BSC** | `0xcA11bde05977b3631167028862bE2a173976CA11` | ✅ 已部署 |
| **Polygon** | `0xcA11bde05977b3631167028862bE2a173976CA11` | ✅ 已部署 |
| **Arbitrum** | `0xcA11bde05977b3631167028862bE2a173976CA11` | ✅ 已部署 |
| **Optimism** | `0xcA11bde05977b3631167028862bE2a173976CA11` | ✅ 已部署 |

**注意：** 所有链使用相同的地址（CREATE2 部署）

### 核心函数

#### 1. `aggregate3Value` - 支持 payable 调用

```solidity
struct Call3Value {
    address target;      // 目标合约地址
    bool allowFailure;   // 是否允许失败
    uint256 value;       // 发送的 ETH/BNB 数量
    bytes callData;      // 调用数据
}

function aggregate3Value(Call3Value[] calldata calls)
    public
    payable
    returns (Result[] memory returnData)
{
    uint256 valAccumulator;
    uint256 length = calls.length;
    returnData = new Result[](length);
    Call3Value calldata calli;
    for (uint256 i = 0; i < length;) {
        Result memory result = returnData[i];
        calli = calls[i];
        uint256 val = calli.value;
        // 累加 value，确保不超过 msg.value
        valAccumulator += val;
        (result.success, result.returnData) = calli.target.call{value: val}(calli.callData);
        assembly {
            // 如果不允许失败且调用失败，则 revert
            if iszero(or(result.success, calli.allowFailure)) {
                revert(add(result.returnData, 0x20), mload(result.returnData))
            }
            i := add(i, 1)
        }
    }
    // 确保所有 value 都被使用
    require(msg.value == valAccumulator, "Multicall3: value mismatch");
}
```

#### 2. `aggregate3` - 不支持 payable

```solidity
struct Call3 {
    address target;
    bool allowFailure;
    bytes callData;
}

function aggregate3(Call3[] calldata calls)
    public
    payable
    returns (Result[] memory returnData)
{
    // 类似 aggregate3Value，但不支持发送 ETH
}
```

### 应用场景

#### 场景 1：Four.meme 非 BNB 筹集币种（完美适用！）✅

**问题：** BNB → USDT → Four.meme Token（两步交易）

**解决方案：** 使用 Multicall3.aggregate3Value

```typescript
// 步骤 1：准备调用数据
const calls = [
  {
    target: pancakeRouter,
    allowFailure: false,
    value: parseEther('0.1'), // 0.1 BNB
    callData: encodeFunctionData({
      abi: pancakeRouterAbi,
      functionName: 'swapExactETHForTokens',
      args: [
        minUSDTAmount,
        [WBNB, USDT],
        multicall3Address, // 接收到 Multicall3 合约
        deadline
      ]
    })
  },
  {
    target: USDT,
    allowFailure: false,
    value: 0n,
    callData: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [tokenManagerAddress, maxUint256]
    })
  },
  {
    target: tokenManagerAddress,
    allowFailure: false,
    value: 0n,
    callData: encodeFunctionData({
      abi: tokenManagerAbi,
      functionName: 'buy',
      args: [tokenAddress, usdtAmount, minTokenAmount]
    })
  }
];

// 步骤 2：执行批量调用
const tx = await walletClient.writeContract({
  address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  abi: multicall3Abi,
  functionName: 'aggregate3Value',
  args: [calls],
  value: parseEther('0.1')
});
```

**优势：**
- ✅ **1 次交易**（vs 3 次）
- ✅ **原子性**：全部成功或全部失败
- ✅ **Gas 节省**：~30%
- ✅ **无需自定义合约**：Multicall3 已部署

**注意事项：**
1. **接收地址问题**：代币会发送到 Multicall3 合约，需要额外步骤转移给用户
2. **需要包装函数**：需要在 Multicall3 外层包装一个合约来处理代币转移

#### 场景 2：批量授权 + 交易

```typescript
const calls = [
  {
    target: tokenAddress,
    allowFailure: false,
    value: 0n,
    callData: encodeApprove(spender, amount)
  },
  {
    target: routerAddress,
    allowFailure: false,
    value: 0n,
    callData: encodeSwap(...)
  }
];
```

#### 场景 3：批量转账

```typescript
const calls = addresses.map(addr => ({
  target: tokenAddress,
  allowFailure: true, // 允许单个失败
  value: 0n,
  callData: encodeTransfer(addr, amount)
}));
```

### 限制和问题

#### ❌ 问题 1：代币接收地址

**问题：** 代币会发送到 Multicall3 合约地址，而不是用户地址

```solidity
// 第一步：BNB → USDT
pancakeRouter.swapExactETHForTokens(
  minAmount,
  path,
  multicall3Address, // ❌ USDT 发送到 Multicall3
  deadline
);

// 第二步：USDT → Token
tokenManager.buy(...); // ❌ Token 也发送到 Multicall3
```

**解决方案：** 需要额外的转移步骤

```typescript
const calls = [
  // 1. BNB → USDT (发送到 Multicall3)
  { target: pancakeRouter, ... },

  // 2. Approve TokenManager
  { target: USDT, callData: encodeApprove(...) },

  // 3. USDT → Token (发送到 Multicall3)
  { target: tokenManager, ... },

  // 4. 转移 Token 给用户
  {
    target: tokenAddress,
    callData: encodeTransfer(userAddress, tokenAmount) // ❌ 不知道 tokenAmount
  }
];
```

**问题：** 第 4 步不知道 `tokenAmount`（需要第 3 步的返回值）

#### ❌ 问题 2：无法使用前一步的返回值

Multicall3 不支持在调用之间传递数据：

```typescript
// ❌ 不可能实现
const calls = [
  { target: router, callData: encodeSwap(...) },
  {
    target: token,
    callData: encodeTransfer(
      user,
      // ❌ 无法引用上一步的返回值
      previousCallReturnValue
    )
  }
];
```

#### ❌ 问题 3：需要包装合约

**最佳实践：** 仍然需要自定义合约来包装 Multicall3

```solidity
contract FourMemeMulticallWrapper {
  Multicall3 public immutable multicall3;

  function swapAndBuy(
    address tokenAddress,
    address quoteToken,
    uint256 minTokenAmount
  ) external payable {
    // 准备 Multicall3 调用
    Multicall3.Call3Value[] memory calls = new Multicall3.Call3Value[](3);

    // 1. BNB → QuoteToken
    calls[0] = Multicall3.Call3Value({
      target: pancakeRouter,
      allowFailure: false,
      value: msg.value,
      callData: abi.encodeCall(
        IPancakeRouter.swapExactETHForTokens,
        (minQuoteAmount, path, address(this), deadline)
      )
    });

    // 2. Approve
    calls[1] = Multicall3.Call3Value({
      target: quoteToken,
      allowFailure: false,
      value: 0,
      callData: abi.encodeCall(IERC20.approve, (tokenManager, type(uint256).max))
    });

    // 3. Buy
    calls[2] = Multicall3.Call3Value({
      target: tokenManager,
      allowFailure: false,
      value: 0,
      callData: abi.encodeCall(ITokenManager.buy, (tokenAddress, quoteAmount, minTokenAmount))
    });

    // 执行 Multicall3
    multicall3.aggregate3Value{value: msg.value}(calls);

    // 转移代币给用户
    uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
    IERC20(tokenAddress).transfer(msg.sender, balance);
  }
}
```

**结论：** Multicall3 本身不能完全解决问题，仍需自定义合约

---

## 2. Batch Precompile（特定链）

### 支持的链

| 链 | 支持 | 地址 |
|-----|------|------|
| **Moonbeam** | ✅ | `0x0000000000000000000000000000000000000808` |
| **Moonriver** | ✅ | `0x0000000000000000000000000000000000000808` |
| **Tanssi** | ✅ | `0x0000000000000000000000000000000000000808` |
| **BSC** | ❌ | 不支持 |
| **Ethereum** | ❌ | 不支持 |

### 核心功能

```solidity
interface Batch {
  function batchAll(
    address[] memory to,
    uint256[] memory value,
    bytes[] memory callData,
    uint64[] memory gasLimit
  ) external payable;
}
```

**特点：**
- ✅ 原生支持批量 write 操作
- ✅ 原子性执行
- ✅ 支持 payable
- ❌ **仅特定链支持**（BSC 不支持）

### 示例：Approve + Swap

```typescript
// Moonbeam 上可用
const tx = await batchPrecompile.batchAll(
  [tokenAddress, routerAddress],
  [0, 0],
  [approveCalldata, swapCalldata],
  [100000, 300000]
);
```

**结论：** BSC 不支持，不适用于插件

---

## 3. 对比分析

### 技术对比

| 特性 | Multicall3 | Batch Precompile | 自定义合约 |
|------|-----------|-----------------|----------|
| **BSC 支持** | ✅ 已部署 | ❌ 不支持 | ✅ 需部署 |
| **批量 Write** | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| **原子性** | ✅ 保证 | ✅ 保证 | ✅ 保证 |
| **Payable** | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| **返回值传递** | ❌ 不支持 | ❌ 不支持 | ✅ 支持 |
| **代币接收** | ❌ 发送到合约 | ❌ 发送到合约 | ✅ 灵活处理 |
| **开发成本** | ⚠️ 需包装 | ❌ BSC 不可用 | ✅ 完全控制 |

### 适用场景对比

| 场景 | Multicall3 | 自定义合约 | 推荐 |
|------|-----------|----------|------|
| **简单批量调用** | ✅ 适用 | ✅ 适用 | Multicall3 |
| **需要返回值传递** | ❌ 不适用 | ✅ 适用 | 自定义合约 |
| **Four.meme 两步交易** | ⚠️ 需包装 | ✅ 完美 | 自定义合约 |
| **批量授权** | ✅ 适用 | ✅ 适用 | Multicall3 |
| **批量转账** | ✅ 适用 | ✅ 适用 | Multicall3 |

---

## 4. 插件应用建议

### 方案 1：直接使用 Multicall3（不推荐）❌

**原因：**
- ❌ 代币接收地址问题
- ❌ 无法传递返回值
- ❌ 仍需额外逻辑处理

### 方案 2：Multicall3 + 包装合约（可行）⚠️

```solidity
contract FourMemeMulticallWrapper {
  // 使用 Multicall3 执行批量调用
  // 处理代币转移逻辑
}
```

**优势：**
- ✅ 利用 Multicall3 的批量能力
- ✅ 自定义代币转移逻辑

**劣势：**
- ❌ 仍需部署合约
- ❌ 增加复杂度

### 方案 3：纯自定义合约（推荐）✅

```solidity
contract FourMemeSwapHelper {
  // 直接实现两步交易逻辑
  // 完全控制流程
}
```

**优势：**
- ✅ 完全控制
- ✅ 简单直接
- ✅ 最优 Gas 效率

**劣势：**
- ❌ 需要部署和审计

---

## 5. 结论

### 核心发现

**✅ 存在批量执行 write 操作的技术**

1. **Multicall3** - 通用方案，BSC 已部署
2. **Batch Precompile** - 特定链方案，BSC 不支持

### 对于插件的建议

**Multicall3 不能完全解决 Four.meme 两步交易问题**

**原因：**
1. 代币接收地址问题
2. 无法传递返回值
3. 仍需包装合约

**最终推荐：** 纯自定义合约

**理由：**
- Multicall3 虽然支持批量 write，但不能解决代币接收和返回值传递问题
- 使用 Multicall3 仍需包装合约，不如直接实现自定义合约
- 自定义合约提供最大灵活性和最优 Gas 效率

### 实施优先级

**低优先级** - 原因同前：
- 未迁移的非 BNB 筹集币种代币很少见
- 当前分阶段执行方案可用
- 开发成本 vs 收益比不高

---

## 6. 参考资料

### Multicall3

- [Cosmos Multicall3 Documentation](https://cosmos-docs.mintlify.app/docs/evm/next/documentation/smart-contracts/predeployed-contracts/multicall3)
- [Filecoin Multicall Documentation](https://docs.filecoin.io/smart-contracts/advanced/multicall)
- [Berachain Multicall3 Docs](https://docs.berachain.com/developers/contracts/multicall3)
- [Multicall – Aggregate Multiple Contract Calls](https://vinta.ws/code/solidity-multicall-aggregate-multiple-contract-calls.html)

### Batch Precompile

- [Moonbeam Batch Precompile](https://docs.moonbeam.network/builders/pallets-precompiles/precompiles/batch)
- [Approve & Swap with Batch Precompile](https://docs.moonbeam.network/tutorials/eth-api/batch-approve-swap/)
- [Tanssi Batch Precompile](https://docs.tanssi.network/builders/toolkit/ethereum-api/precompiles/batch/)

---

**总结：** Multicall3 支持批量 write 操作，但对于 Four.meme 两步交易场景，纯自定义合约仍是最佳方案。
