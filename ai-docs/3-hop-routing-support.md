# 3-Hop 路由支持技术文档

## 概述

为了支持与非主流代币配对的代币交易（如 UDOG-USAT），我们实现了 3-hop 路由支持。该功能能够自动发现代币的 quote token，并构建复杂的多跳交易路径。

## 问题背景

### 原有限制

原有的路由系统只支持 2-hop 路径：
- **直接路径**: WBNB → Token
- **桥接路径**: WBNB → Bridge → Token

### 遇到的问题

某些代币（如 UDOG `0xcc411e6eac8f660972bf06ac5ea12058267755f0`）与非主流代币配对：
- UDOG 与 USAT (`0xdb7a6d5a127ea5c0a3576677112f13d731232a27`) 配对
- USAT 与 WBNB 之间没有直接的流动性池
- USAT 与任何已知的桥接代币（USDT、USDC、BUSD 等）都没有流动性池

这导致无法通过 2-hop 路径完成交易。

## 解决方案

### 1. Quote Token 发现机制

实现 `discoverTokenQuoteToken` 函数，自动发现代币的 quote token：

```typescript
async function discoverTokenQuoteToken(
  publicClient,
  factoryAddress: string,
  factoryAbi: any,
  tokenAddress: string
): Promise<string | null>
```

**工作原理**：
1. 尝试常见的配对代币（WBNB、USDT、USDC、BUSD）
2. 检查是否存在 Pair 合约
3. 如果存在，查询 Pair 的 token0 和 token1
4. 返回不是目标代币的那个（即 quote token）

**示例**：
- 输入：UDOG 地址
- 输出：USAT 地址

### 2. 3-Hop 路径构建

实现 `build3HopPaths` 函数，构建 3-hop 路径：

```typescript
async function build3HopPaths(
  publicClient,
  factoryAddress: string,
  factoryAbi: any,
  nativeWrapper: string,
  tokenAddress: string,
  quoteToken: string,
  bridgeTokens: string[]
): Promise<{ buy: string[][], sell: string[][] }>
```

**路径结构**：
- **买入**: WBNB → Bridge → QuoteToken → Token
- **卖出**: Token → QuoteToken → Bridge → WBNB

**工作原理**：
1. 验证 QuoteToken 与 Token 的 Pair 是否存在
2. 遍历所有桥接代币
3. 检查 WBNB → Bridge 和 Bridge → QuoteToken 的 Pair 是否都存在
4. 如果都存在，构建 3-hop 路径

**示例路径**（假设找到 USDT 作为桥接）：
- 买入：WBNB → USDT → USAT → UDOG
- 卖出：UDOG → USAT → USDT → WBNB

### 3. 回退机制

在 `findBestV2Path` 函数中添加回退逻辑：

```typescript
if (!bestPath) {
  // 回退机制：尝试发现代币的 quote token 并构建 3-hop 路径
  const quoteToken = await discoverTokenQuoteToken(...);
  if (quoteToken) {
    const threeHopPaths = await build3HopPaths(...);
    // 评估 3-hop 路径
    const threeHopResults = await fetchPathAmounts(...);
    // 选择最优路径
  }
}
```

**触发条件**：
- 所有标准 2-hop 路径都失败时
- 自动尝试 3-hop 路径

**优势**：
- 对用户透明，无需手动配置
- 自动选择最优路径
- 不影响现有代币的交易

## 技术细节

### Pair 合约 ABI

```typescript
const PAIR_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
];
```

### 路径评估

使用 `fetchPathAmounts` 函数评估路径：
- 调用 Router 的 `getAmountsOut` 函数
- 获取每个路径的预期输出金额
- 选择输出金额最大的路径

### 性能优化

1. **并发查询**: 使用 `Promise.all` 并发检查多个 Pair
2. **缓存机制**: Pair 存在性检查结果会被缓存
3. **智能回退**: 只在标准路径失败时才尝试 3-hop

## 使用示例

### 代码示例

```typescript
// 用户尝试买入 UDOG
// 系统自动执行以下流程：

// 1. 尝试标准路径
//    - WBNB → UDOG (失败)
//    - WBNB → USDT → UDOG (失败)
//    - WBNB → USDC → UDOG (失败)

// 2. 触发回退机制
//    - 发现 UDOG 的 quote token 是 USAT
//    - 构建 3-hop 路径：WBNB → USDT → USAT → UDOG
//    - 评估路径，获取预期输出
//    - 执行交易
```

### 日志输出

```
[PancakeSwap] 标准路径失败，尝试发现 quote token...
[QuoteDiscovery] 发现代币 0xCc411E6e 的 quote token: 0xdB7A6D5A
[3HopPath] 找到有效路径: 0xbb4C → 0x55d3 → 0xdB7A → 0xCc41
[PancakeSwap] 找到 1 个 3-hop 路径
```

## 限制和注意事项

### 当前限制

1. **只支持 3-hop**: 不支持 4-hop 或更多跳
2. **只检查常见配对**: 只检查 WBNB、USDT、USDC、BUSD 作为 quote token
3. **V2 Only**: 目前只在 V2 路由中实现，V3 路由暂不支持

### Gas 成本

3-hop 路径的 Gas 成本比 2-hop 路径高：
- 2-hop: ~150,000 - 200,000 gas
- 3-hop: ~250,000 - 350,000 gas

### 滑点影响

多跳路径的滑点影响更大：
- 每一跳都会产生滑点
- 建议使用更高的滑点容忍度（如 5-10%）

## 未来改进

1. **扩展 quote token 检测**: 支持更多配对代币
2. **4-hop 支持**: 支持更复杂的路径
3. **V3 集成**: 在 V3 路由中实现相同功能
4. **混合路由**: 支持 V2 和 V3 混合路径
5. **路径缓存**: 缓存成功的 3-hop 路径
6. **智能 Gas 估算**: 根据路径长度动态调整 Gas Limit

## 相关文件

- `src/shared/trading-channels.ts` - 核心实现
  - `discoverTokenQuoteToken` (line 836-901)
  - `build3HopPaths` (line 907-975)
  - `findBestV2Path` 回退逻辑 (line 1384-1440)
- `src/shared/trading-config.ts` - 配置文件
- `CHANGELOG.md` - 变更记录

## 测试建议

1. **测试 UDOG-USAT 代币**
   - 地址：0xcc411e6eac8f660972bf06ac5ea12058267755f0
   - 验证能否成功买入和卖出

2. **测试其他非标准配对代币**
   - 寻找其他与非主流代币配对的代币
   - 验证自动发现机制

3. **性能测试**
   - 测量 3-hop 路径的执行时间
   - 对比 2-hop 和 3-hop 的 Gas 成本

4. **边界情况**
   - 测试没有任何流动性的代币
   - 测试 quote token 发现失败的情况
   - 测试所有桥接代币都不可用的情况

## 故障排查

### 问题：3-hop 路径仍然失败

**可能原因**：
1. Quote token 与任何桥接代币都没有流动性池
2. 流动性太低，无法完成交易
3. 代币有特殊限制（如交易税、黑名单等）

**解决方案**：
1. 检查日志，确认是否成功发现 quote token
2. 手动在 PancakeSwap 上验证流动性池是否存在
3. 尝试在 PancakeSwap 官网直接交易

### 问题：Gas 估算失败

**可能原因**：
1. 路径中某个 Pair 的流动性不足
2. 代币有转账限制

**解决方案**：
1. 增加 Gas Limit
2. 检查代币合约是否有特殊限制

## 总结

3-hop 路由支持是一个重要的功能增强，使系统能够处理更复杂的代币配对情况。通过自动发现 quote token 和智能路径构建，用户可以无缝交易各种非标准配对的代币。
