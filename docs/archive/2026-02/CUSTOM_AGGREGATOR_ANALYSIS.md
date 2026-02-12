# 自定义聚合器迁移分析报告

**分析日期**: 2026-02-11
**文件**: `src/background/custom-aggregator-agent.ts`
**状态**: ❌ 未迁移到 SDK

---

## 执行摘要

自定义聚合器（Custom Aggregator）是插件中的一个重要功能模块，用于通过自定义合约聚合器执行交易。经过分析，**该功能尚未迁移到 SDK**。

**关键发现**:
- ❌ SDK 中没有 aggregator 相关代码
- ⚠️ 该功能高度依赖插件特定配置
- ⚠️ 包含复杂的业务逻辑（1051 行）
- ✅ 但核心逻辑可以抽取到 SDK

---

## 文件分析

### 基本信息

- **文件路径**: `src/background/custom-aggregator-agent.ts`
- **文件大小**: 1051 行
- **主要功能**: 自定义合约聚合器交易执行

### 导出的函数

1. **shouldUseCustomAggregator** (line 301)
   - 判断是否应该使用自定义聚合器
   - 检查平台、配置、代币等条件

2. **isAggregatorUnsupportedError** (line 330)
   - 判断是否为聚合器不支持的错误

3. **executeCustomAggregatorBuy** (line 585)
   - 执行聚合器买入交易
   - 包含 V2/V3 路由选择、报价、授权、交易执行

4. **executeCustomAggregatorSell** (line 685)
   - 执行聚合器卖出交易
   - 类似买入逻辑

---

## 功能详解

### 1. 核心功能

#### 1.1 路由选择
- 支持 PancakeSwap V2 和 V3
- V3 支持多个 fee tier（100, 250, 500, 2500, 10000）
- 智能选择最优路由

#### 1.2 报价计算
- 通过 PancakeSwap V3 Quoter 获取报价
- 支持直接交易和中间代币路由
- 处理滑点和最小输出金额

#### 1.3 授权管理
- 检查代币授权额度
- 缓存授权状态（60秒 TTL）
- 智能判断是否需要重新授权

#### 1.4 交易执行
- 构建交易参数
- 编码合约调用
- 执行交易并等待确认

### 2. 依赖关系

#### 2.1 插件特定依赖

```typescript
// 配置依赖
import {
  CUSTOM_AGGREGATOR_CONFIG,
  MEME_SWAP_AGGREGATOR_ABI,
  CONTRACTS,
  TX_CONFIG,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_QUOTER_ABI,
  NETWORK_CONFIG,
  ERC20_ABI,
  AGGREGATOR_RUNTIME_CONFIG
} from '../shared/trading-config.js';

// 业务逻辑依赖
import {
  estimateQuoteAmount,
  isBnbQuote,
  normalizeAddress,
  resolveSwapSlippageBps,
  resolveQuoteTokenPreset,
  quotePancakeV2Path
} from './four-quote-bridge.js';
```

#### 2.2 可复用依赖

```typescript
// 这些已经在 SDK 中
import {
  encodeFunctionData,
  parseUnits,
  createHttpClient
} from '../shared/viem-helper.js';

import { prepareTokenSell } from '../shared/trading-channels-compat.js';
import { PerformanceTimer, perf } from '../shared/performance.js';
```

---

## 迁移评估

### 是否应该迁移？

**建议**: ⚠️ **部分迁移**

**理由**:

#### ✅ 应该迁移的部分

1. **路由选择逻辑**
   - V2/V3 路由选择算法
   - Fee tier 优化逻辑
   - 报价计算逻辑

2. **授权管理**
   - 授权检查逻辑
   - 授权缓存机制
   - 智能授权判断

3. **交易构建**
   - 交易参数构建
   - 合约调用编码
   - 滑点计算

#### ❌ 不应该迁移的部分

1. **配置管理**
   - 插件特定的配置
   - 运行时配置
   - 应保留在应用层

2. **钱包操作**
   - 钱包客户端管理
   - 交易签名和发送
   - 应保留在应用层

3. **业务逻辑**
   - 平台判断逻辑
   - Quote Bridge 集成
   - 应保留在应用层

---

## 迁移方案

### 方案 A: 创建 Aggregator 包（推荐）

**结构**:
```
@bsc-trading/aggregator
├── src/
│   ├── router/
│   │   ├── v2-router.ts
│   │   ├── v3-router.ts
│   │   └── route-selector.ts
│   ├── quoter/
│   │   ├── v2-quoter.ts
│   │   ├── v3-quoter.ts
│   │   └── quote-calculator.ts
│   ├── allowance/
│   │   ├── allowance-checker.ts
│   │   └── allowance-cache.ts
│   ├── builder/
│   │   ├── swap-builder.ts
│   │   └── transaction-encoder.ts
│   └── index.ts
```

**优点**:
- ✅ 模块化设计
- ✅ 易于测试
- ✅ 可独立发布
- ✅ 职责清晰

**缺点**:
- ⚠️ 需要创建新包
- ⚠️ 需要设计接口
- ⚠️ 开发工作量较大

---

### 方案 B: 集成到现有包（简单）

**位置**: `@bsc-trading/pancakeswap` 或 `@bsc-trading/router`

**优点**:
- ✅ 不需要新包
- ✅ 开发工作量小
- ✅ 快速实现

**缺点**:
- ⚠️ 职责不够清晰
- ⚠️ 包体积增大
- ⚠️ 耦合度较高

---

### 方案 C: 保留在插件（当前状态）

**优点**:
- ✅ 无需迁移工作
- ✅ 保持现有架构
- ✅ 风险最低

**缺点**:
- ❌ 无法被其他项目复用
- ❌ 维护两套代码
- ❌ 测试覆盖不足

---

## 推荐方案

### 短期（1-2周）: 方案 C

**理由**:
- 当前功能稳定
- 迁移收益不明显
- 其他工作优先级更高

**行动**:
- 保持现状
- 添加单元测试
- 完善文档

---

### 长期（1-2月）: 方案 A

**理由**:
- 提高代码复用性
- 改善架构清晰度
- 便于其他项目使用

**行动**:
1. 设计 Aggregator 包接口
2. 提取核心逻辑
3. 编写测试
4. 更新插件使用 SDK 接口

---

## 核心逻辑提取示例

### 1. 路由选择器

```typescript
// @bsc-trading/aggregator/src/router/route-selector.ts

export interface RouteOption {
  mode: 'v2' | 'v3';
  fee?: number;
  path: Address[];
  expectedOutput: bigint;
}

export class RouteSelector {
  /**
   * 选择最优路由
   */
  async selectBestRoute(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    quoteToken?: Address;
  }): Promise<RouteOption> {
    // 1. 获取所有可能的路由
    const routes = await this.getAllRoutes(params);

    // 2. 获取每个路由的报价
    const quotes = await this.getQuotes(routes);

    // 3. 选择输出最大的路由
    return this.selectBest(quotes);
  }
}
```

### 2. 授权管理器

```typescript
// @bsc-trading/aggregator/src/allowance/allowance-manager.ts

export class AllowanceManager {
  private cache: LruCache<string, AllowanceInfo>;

  /**
   * 检查并确保授权
   */
  async ensureAllowance(params: {
    token: Address;
    owner: Address;
    spender: Address;
    amount: bigint;
  }): Promise<{ needsApproval: boolean; currentAllowance: bigint }> {
    // 1. 检查缓存
    const cached = this.cache.get(this.getCacheKey(params));
    if (cached && this.isValid(cached)) {
      return cached;
    }

    // 2. 查询链上授权额度
    const allowance = await this.getAllowance(params);

    // 3. 判断是否需要授权
    const needsApproval = allowance < params.amount;

    // 4. 更新缓存
    this.cache.set(this.getCacheKey(params), { needsApproval, currentAllowance: allowance });

    return { needsApproval, currentAllowance: allowance };
  }
}
```

### 3. 交易构建器

```typescript
// @bsc-trading/aggregator/src/builder/swap-builder.ts

export class SwapBuilder {
  /**
   * 构建买入交易
   */
  buildBuyTransaction(params: {
    route: RouteOption;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: Address;
    deadline: bigint;
  }): { to: Address; data: Hex; value: bigint } {
    // 根据路由类型构建交易
    if (params.route.mode === 'v2') {
      return this.buildV2Swap(params);
    } else {
      return this.buildV3Swap(params);
    }
  }
}
```

---

## 依赖关系图

```
插件 (custom-aggregator-agent.ts)
├── 配置层 (trading-config.js) ← 插件特定
├── 业务逻辑层
│   ├── 路由选择 ← 可迁移到 SDK
│   ├── 报价计算 ← 可迁移到 SDK
│   ├── 授权管理 ← 可迁移到 SDK
│   └── 交易构建 ← 可迁移到 SDK
├── 钱包层 (viem-helper.js) ← 已在 SDK
└── 工具层 (performance.js) ← 已在 SDK

SDK (@bsc-trading/aggregator) ← 待创建
├── router/ ← 路由选择逻辑
├── quoter/ ← 报价计算逻辑
├── allowance/ ← 授权管理逻辑
└── builder/ ← 交易构建逻辑
```

---

## 总结

### 当前状态

- ❌ 自定义聚合器**未迁移**到 SDK
- ✅ 功能在插件中运行良好
- ⚠️ 代码无法被其他项目复用

### 建议

**短期**: 保持现状，优先完成其他工作

**长期**: 创建 `@bsc-trading/aggregator` 包，提取核心逻辑

### 优先级

**优先级**: 🟡 中等

**理由**:
- 功能稳定，不紧急
- 迁移收益明显但不关键
- 可以在有时间时进行

### 预计工作量

- **设计接口**: 1-2 天
- **提取逻辑**: 3-5 天
- **编写测试**: 2-3 天
- **集成验证**: 1-2 天

**总计**: 7-12 天（1-2 周）

---

**报告创建时间**: 2026-02-11 00:30
**分析人员**: Claude Code
**状态**: ✅ 分析完成
