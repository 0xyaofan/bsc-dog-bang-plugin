# V3 报价修复 - 使用 viem readContract 与正确的 ABI

## 问题背景

V3 报价一直失败，错误信息：
```
execution reverted
```

尝试了多种函数选择器和参数编码方式都失败了。

## 根本原因

PancakeSwap V3 的 QuoterV2 合约使用的是 **tuple 参数**，而不是独立参数。函数签名是：

```solidity
function quoteExactInputSingle(
  (address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params
) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
```

注意：参数是一个 **命名的 tuple**，名称为 `params`。

## 解决方案

使用 viem 的 `readContract` 方法，配合正确的 ABI 定义（包含 tuple 参数）。

### 1. V3 单跳报价

**正确的 ABI 定义**：
```typescript
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
```

**调用方式**：
```typescript
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

// 返回值是一个 tuple，取第一个元素
const amountOut = Array.isArray(result) ? result[0] : result;
```

**函数选择器**：`0xc6a5026a`（正确）

这个选择器是通过以下签名计算的：
```
quoteExactInputSingle((address,address,uint256,uint24,uint160))
```

### 2. V3 多跳报价

**正确的 ABI 定义**：
```typescript
const QUOTER_ABI = [{
  inputs: [
    { name: 'path', type: 'bytes' },
    { name: 'amountIn', type: 'uint256' },
  ],
  name: 'quoteExactInput',
  outputs: [
    { name: 'amountOut', type: 'uint256' },
    { name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
    { name: 'initializedTicksCrossedList', type: 'uint32[]' },
    { name: 'gasEstimate', type: 'uint256' },
  ],
  stateMutability: 'view',
  type: 'function',
}] as const;
```

**调用方式**：
```typescript
// 编码 V3 路径：tokenA + fee + tokenB + fee + tokenC
const encodedPath = encodeV3Path(path, fee);

const result = await publicClient.readContract({
  address: PANCAKE_V3_QUOTER,
  abi: QUOTER_ABI,
  functionName: 'quoteExactInput',
  args: [encodedPath, amountIn],
});

// 返回值是一个 tuple，取第一个元素
const amountOut = Array.isArray(result) ? result[0] : result;
```

**V3 路径编码**：
```typescript
function encodeV3Path(path: Address[], fee: number): `0x${string}` {
  // 格式：tokenA (20 bytes) + fee (3 bytes) + tokenB (20 bytes) + fee (3 bytes) + tokenC (20 bytes)
  let encoded = path[0].slice(2); // 移除 0x

  for (let i = 1; i < path.length; i++) {
    // 添加 fee (3 bytes = 6 hex chars)
    const feeHex = fee.toString(16).padStart(6, '0');
    encoded += feeHex;

    // 添加下一个 token
    encoded += path[i].slice(2);
  }

  return `0x${encoded}`;
}
```

**函数选择器**：`0xcdca1753`

## 优势

### 1. 正确的函数调用
- 使用正确的 tuple 参数格式
- 函数选择器正确（0xc6a5026a）
- viem 自动处理 ABI 编码和解码

### 2. 更简洁的代码
- 不需要手动编码参数
- 不需要手动解码返回值
- 代码更易读和维护

### 3. 更好的错误处理
- viem 提供详细的错误信息
- 自动处理合约调用失败
- 更容易调试

## 关键发现

### 为什么之前的方法失败？

1. **错误的函数选择器**
   - 尝试了 0xf7729d43（错误）
   - 尝试了 0x1296323f（独立参数版本，但 PancakeSwap 使用 tuple）
   - 正确的是 0xc6a5026a（tuple 参数版本）

2. **参数编码方式错误**
   - 手动编码时没有正确处理 tuple 参数
   - tuple 参数需要特殊的编码方式

3. **从 v1 项目学到的**
   - v1 项目使用 viem 的 `readContract`
   - ABI 定义中 tuple 参数有名称 `params`
   - 调用时传入一个对象作为参数

## Service Worker 兼容性

虽然之前担心 viem 的 `readContract` 在 Service Worker 中会触发动态 import，但实际测试表明：

- **简单的 ABI 类型**（如 address, uint256）不会触发动态 import
- **tuple 参数**在新版本的 viem 中也不会触发动态 import
- 可以安全地在 Service Worker 中使用 `readContract`

如果未来遇到动态 import 问题，可以考虑：
1. 升级 viem 到最新版本
2. 使用 viem 的 tree-shaking 功能
3. 只在必要时才回退到手动编码

## 测试验证

### 测试代码

```typescript
const { createPublicClient, http, parseEther } = require('viem');
const { bsc } = require('viem/chains');

const client = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.binance.org'),
});

const QUOTER_V2 = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const TOKEN = '0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197';

const QUOTER_ABI = [{
  inputs: [{
    components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    name: 'params',
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
}];

async function testV3Quote() {
  const result = await client.readContract({
    address: QUOTER_V2,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{
      tokenIn: TOKEN,
      tokenOut: WBNB,
      amountIn: parseEther('1'),
      fee: 2500, // 使用实际的 pool fee
      sqrtPriceLimitX96: 0n,
    }],
  });

  const amountOut = Array.isArray(result) ? result[0] : result;
  console.log('Amount out:', amountOut.toString());
}

testV3Quote();
```

### 验证结果

- ✅ 函数选择器正确（0xc6a5026a）
- ✅ 参数编码正确（tuple 格式）
- ✅ 可以正确调用 QuoterV2 合约
- ✅ 返回值解码正确

## 函数选择器计算

如果需要验证或添加其他函数，可以使用以下方法计算选择器：

```typescript
import { keccak256, toBytes } from 'viem';

function getFunctionSelector(signature: string): string {
  const hash = keccak256(toBytes(signature));
  return hash.slice(0, 10); // 0x + 前 8 位
}

// quoteExactInputSingle (tuple 版本)
getFunctionSelector('quoteExactInputSingle((address,address,uint256,uint24,uint160))');
// 返回：0xc6a5026a ✓

// quoteExactInputSingle (独立参数版本 - PancakeSwap 不使用)
getFunctionSelector('quoteExactInputSingle(address,address,uint256,uint24,uint160)');
// 返回：0x1296323f ✗

// quoteExactInput
getFunctionSelector('quoteExactInput(bytes,uint256)');
// 返回：0xcdca1753 ✓
```

## 总结

通过参考 v1 项目的实现，发现 PancakeSwap V3 QuoterV2 使用的是 **tuple 参数格式**，而不是独立参数。使用 viem 的 `readContract` 配合正确的 ABI 定义，可以成功调用 V3 报价功能。

关键点：
1. ✅ 使用 viem 的 `readContract` 而不是手动编码
2. ✅ ABI 中 tuple 参数需要有名称（`params`）
3. ✅ 函数选择器是 0xc6a5026a（tuple 版本）
4. ✅ 调用时传入一个对象作为参数
5. ✅ 返回值是 tuple，取第一个元素作为 amountOut

现在用户可以正常使用 V3 路由进行交易，系统会自动在 V2 和 V3 之间选择最优路由。
