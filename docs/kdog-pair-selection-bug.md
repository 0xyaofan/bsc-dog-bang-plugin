# KDOG 配对选择错误分析

## 问题描述

系统选择了 KDOG/WBNB 配对，但实际上 KDOG/KGST 配对拥有更大的流动性。

## 流动性数据对比

### KDOG/WBNB 配对（系统错误选择）
- **配对地址**: `0xD995D5Dde44C49ea7aA712567fcA9ddaB842A1f1`
- **Token0**: `0x3753dD32Cbc376Ce6EFd85F334B7289aE6d004aF` (KDOG)
- **Token1**: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` (WBNB)
- **KDOG 储备量**: **95,091.15 KDOG**
- **WBNB 储备量**: 0.001149 WBNB

### KDOG/KGST 配对（正确配对）
- **配对地址**: `0x14C90904dD8868c8E748e42D092250Ec17f748d1`
- **Token0**: `0x3753dD32Cbc376Ce6EFd85F334B7289aE6d004aF` (KDOG)
- **Token1**: `0x94be0bbA8E1E303fE998c9360B57b826F1A4f828` (KGST)
- **KDOG 储备量**: **420,839,721.93 KDOG**
- **KGST 储备量**: 284,856.38 KGST

## 关键发现

**KDOG/KGST 配对的 KDOG 流动性是 KDOG/WBNB 的 4,425.65 倍！**

```
KDOG/WBNB:  95,091.15 KDOG
KDOG/KGST:  420,839,721.93 KDOG
比率: 4,425.65x
```

这是一个巨大的差异，说明系统的配对选择逻辑存在严重问题。

## 根本原因分析

需要检查以下几个方面：

### 1. 配对发现逻辑
- 系统是否正确发现了 KDOG/KGST 配对？
- 是否有配对过滤逻辑错误地排除了 KDOG/KGST？

### 2. 流动性比较逻辑
- 系统如何比较不同配对的流动性？
- 是否使用了错误的指标（如使用 quote token 储备量而不是 base token 储备量）？
- 是否存在单位转换错误？

### 3. 配对优先级
- 是否有硬编码的配对优先级（如 WBNB 配对优先）？
- 是否有配对白名单/黑名单影响选择？

## 建议的调查步骤

1. **检查配对发现代码**
   - 查看 `custom-aggregator-agent.ts` 中的配对发现逻辑
   - 确认是否正确查询了所有可能的配对

2. **检查流动性比较代码**
   - 查看如何计算和比较配对的流动性
   - 确认是否使用了正确的储备量（base token 而不是 quote token）

3. **检查配对选择代码**
   - 查看最终的配对选择逻辑
   - 确认是否有不合理的优先级或过滤规则

## 预期修复

修复后，系统应该：
1. 正确识别 KDOG/KGST 配对拥有更大的流动性
2. 选择 KDOG/KGST 作为主要交易配对
3. 使用 KDOG/KGST 进行价格查询和交易路由

## 测试验证

修复后需要验证：
- [ ] 系统正确选择 KDOG/KGST 配对
- [ ] 价格查询使用 KDOG/KGST 配对
- [ ] 交易路由优先使用 KDOG/KGST 配对
- [ ] 其他类似代币的配对选择也正确

---

**查询时间**: 2026-02-08
**RPC 端点**: https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/

## 根本原因确认

### 问题所在

在 `/Users/youyifan/code/blockchain/binance/meme-trade-projects/github/bsc-dog-bang-plugin/src/background/custom-aggregator-agent.ts` 中，`V3_DIRECT_QUOTE_TOKENS` 定义了可以直接使用 V3 报价的代币列表：

```typescript
const V3_DIRECT_QUOTE_TOKENS = new Set(
  [
    CONTRACTS.USD1,
    CONTRACTS.UNITED_STABLES_U,
    CONTRACTS.USDT,
    CONTRACTS.BUSD,
    CONTRACTS.CAKE
  ]
    .filter((token): token is string => Boolean(token))
    .map((token) => normalizeAddress(token))
    .filter((token) => Boolean(token))
);
```

**KGST 没有被包含在这个列表中！**

### 影响

当系统尝试为 KDOG 获取报价时：

1. 系统检查 quote token 是否在 `V3_DIRECT_QUOTE_TOKENS` 中
2. 如果 quote token 是 KGST，由于它不在列表中，系统会：
   - 跳过 KDOG/KGST 的 V3 直接报价
   - 回退到使用 WBNB 作为中间代币
   - 最终选择 KDOG/WBNB 配对

3. 即使 KDOG/KGST 有 4,425 倍的流动性，系统也不会考虑它

### 代码位置

**文件**: `/Users/youyifan/code/blockchain/binance/meme-trade-projects/github/bsc-dog-bang-plugin/src/background/custom-aggregator-agent.ts`

**行号**: 约 65-75 行（V3_DIRECT_QUOTE_TOKENS 定义）

**相关函数**:
- `shouldUseV3QuoteToken()` - 检查是否应该使用 V3 报价
- `getAggregatorQuotePlan()` - 获取聚合报价计划

## 修复方案

### 方案 1: 添加 KGST 到 V3_DIRECT_QUOTE_TOKENS（推荐）

```typescript
const V3_DIRECT_QUOTE_TOKENS = new Set(
  [
    CONTRACTS.USD1,
    CONTRACTS.UNITED_STABLES_U,
    CONTRACTS.USDT,
    CONTRACTS.BUSD,
    CONTRACTS.CAKE,
    CONTRACTS.KGST  // 添加 KGST
  ]
    .filter((token): token is string => Boolean(token))
    .map((token) => normalizeAddress(token))
    .filter((token) => Boolean(token))
);
```

**优点**:
- 简单直接
- 立即生效
- 允许系统正确识别 KDOG/KGST 配对

**缺点**:
- 需要手动维护列表
- 未来可能遗漏其他重要的 quote token

### 方案 2: 动态检测流动性（更好的长期方案）

不依赖硬编码列表，而是：
1. 查询所有可能的配对
2. 获取每个配对的储备量
3. 选择流动性最大的配对

**优点**:
- 自动适应市场变化
- 不需要维护硬编码列表
- 更加健壮

**缺点**:
- 实现复杂度更高
- 需要更多的 RPC 调用
- 可能影响性能

### 方案 3: 混合方案（推荐用于生产）

1. 首先检查硬编码的 `V3_DIRECT_QUOTE_TOKENS`
2. 如果没有找到合适的配对，动态查询其他可能的 quote token
3. 比较所有找到的配对的流动性
4. 选择流动性最大的配对

## 立即行动

### 最小修复（紧急）

在 `custom-aggregator-agent.ts` 中添加 KGST：

```typescript
const V3_DIRECT_QUOTE_TOKENS = new Set(
  [
    CONTRACTS.USD1,
    CONTRACTS.UNITED_STABLES_U,
    CONTRACTS.USDT,
    CONTRACTS.BUSD,
    CONTRACTS.CAKE,
    CONTRACTS.KGST  // 添加这一行
  ]
    .filter((token): token is string => Boolean(token))
    .map((token) => normalizeAddress(token))
    .filter((token) => Boolean(token))
);
```

### 验证步骤

修复后，验证：
1. KDOG 的报价请求应该使用 KDOG/KGST 配对
2. 价格应该更准确
3. 交易滑点应该更小
4. 日志中应该显示使用了 KGST 作为 quote token

## 相关文件

- `/Users/youyifan/code/blockchain/binance/meme-trade-projects/github/bsc-dog-bang-plugin/src/background/custom-aggregator-agent.ts` - 聚合器逻辑
- `/Users/youyifan/code/blockchain/binance/meme-trade-projects/github/bsc-dog-bang-plugin/src/shared/trading-config.ts` - 配置文件
- `/Users/youyifan/code/blockchain/binance/meme-trade-projects/github/bsc-dog-bang-plugin/check_liquidity.ts` - 流动性检查脚本

## 总结

**问题**: KGST 没有被包含在 V3_DIRECT_QUOTE_TOKENS 列表中

**影响**: 系统无法识别 KDOG/KGST 配对，即使它有 4,425 倍的流动性

**修复**: 将 CONTRACTS.KGST 添加到 V3_DIRECT_QUOTE_TOKENS 列表

**优先级**: 高 - 直接影响交易价格和滑点
