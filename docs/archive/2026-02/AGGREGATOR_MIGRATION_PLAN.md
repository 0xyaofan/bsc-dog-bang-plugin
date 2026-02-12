# 自定义聚合器迁移执行计划

**开始日期**: 2026-02-11
**预计完成**: 1-2 周
**状态**: 准备开始

---

## 阶段划分

### 短期计划（1-2天）✅ 当前阶段

**目标**: 改善现有代码质量，为迁移做准备

**任务**:
1. ✅ 创建迁移分析报告
2. ⏳ 创建执行计划文档
3. ⏳ 提取常量和类型定义
4. ⏳ 添加代码注释
5. ⏳ 创建基础测试框架

---

### 长期计划（1-2周）⏳ 待执行

**目标**: 创建 @bsc-trading/aggregator 包，迁移核心逻辑

---

## 短期计划详细步骤

### 步骤 1: 提取常量和类型 ⏳

**目标**: 将硬编码的常量提取到单独文件

**文件**: `src/background/aggregator-constants.ts`

**内容**:
```typescript
// Fee tiers
export const V3_FEE_TIERS = [100, 250, 500, 2500, 10000] as const;

// Addresses
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Thresholds
export const UINT256_MAX = (1n << 256n) - 1n;
export const LARGE_ALLOWANCE_THRESHOLD = UINT256_MAX / 2n;

// Cache TTL
export const ALLOWANCE_CACHE_TTL_MS = 60_000;
```

**文件**: `src/background/aggregator-types.ts`

**内容**:
```typescript
export type AggregatorSwapMode =
  | { kind: 'v2' }
  | { kind: 'v3'; fee: number };

export interface AggregatorQuotePlan {
  swapMode: AggregatorSwapMode;
  minPaymentAmount: bigint;
  minTargetAmount: bigint;
}

export interface AggregatorBuyParams {
  tokenAddress: string;
  paymentToken: string;
  paymentAmount: bigint;
  minTargetAmount: bigint;
  walletAddress: string;
  // ... 其他参数
}

export interface AggregatorSellParams {
  tokenAddress: string;
  sellAmount: bigint;
  minReceiveAmount: bigint;
  walletAddress: string;
  // ... 其他参数
}
```

---

### 步骤 2: 添加代码注释 ⏳

**目标**: 为关键函数添加详细注释

**重点函数**:
1. `shouldUseCustomAggregator` - 判断逻辑
2. `executeCustomAggregatorBuy` - 买入流程
3. `executeCustomAggregatorSell` - 卖出流程
4. `queryAggregatorV3Quote` - 报价查询
5. `ensureAggregatorAllowance` - 授权管理

---

### 步骤 3: 创建测试框架 ⏳

**文件**: `test/aggregator/custom-aggregator.test.ts`

**测试覆盖**:
- [ ] shouldUseCustomAggregator 判断逻辑
- [ ] Fee tier 选择逻辑
- [ ] 授权缓存机制
- [ ] 报价计算逻辑
- [ ] 交易参数构建

---

## 长期计划详细步骤

### 阶段 1: 设计接口（2-3天）

**目标**: 设计 aggregator 包的公共接口

#### 1.1 创建包结构

```
../bsc-trading-sdk/packages/aggregator/
├── package.json
├── tsconfig.json
├── rollup.config.js
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── index.ts
│   │   ├── route.ts
│   │   ├── quote.ts
│   │   └── swap.ts
│   ├── router/
│   │   ├── index.ts
│   │   ├── v2-router.ts
│   │   ├── v3-router.ts
│   │   └── route-selector.ts
│   ├── quoter/
│   │   ├── index.ts
│   │   ├── v2-quoter.ts
│   │   ├── v3-quoter.ts
│   │   └── quote-calculator.ts
│   ├── allowance/
│   │   ├── index.ts
│   │   ├── allowance-checker.ts
│   │   └── allowance-manager.ts
│   ├── builder/
│   │   ├── index.ts
│   │   ├── swap-builder.ts
│   │   └── transaction-encoder.ts
│   └── constants.ts
└── __tests__/
    ├── router.test.ts
    ├── quoter.test.ts
    ├── allowance.test.ts
    └── builder.test.ts
```

#### 1.2 定义核心接口

**RouteSelector 接口**:
```typescript
export interface RouteOption {
  mode: 'v2' | 'v3';
  fee?: number;
  path: Address[];
  expectedOutput: bigint;
  priceImpact: number;
}

export interface RouteSelector {
  selectBestRoute(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    quoteToken?: Address;
  }): Promise<RouteOption>;
}
```

**QuoteCalculator 接口**:
```typescript
export interface QuoteResult {
  amountOut: bigint;
  priceImpact: number;
  route: RouteOption;
}

export interface QuoteCalculator {
  getQuote(params: {
    route: RouteOption;
    amountIn: bigint;
  }): Promise<QuoteResult>;
}
```

**AllowanceManager 接口**:
```typescript
export interface AllowanceInfo {
  needsApproval: boolean;
  currentAllowance: bigint;
}

export interface AllowanceManager {
  checkAllowance(params: {
    token: Address;
    owner: Address;
    spender: Address;
    amount: bigint;
  }): Promise<AllowanceInfo>;

  ensureAllowance(params: {
    token: Address;
    owner: Address;
    spender: Address;
    amount: bigint;
  }): Promise<void>;
}
```

**SwapBuilder 接口**:
```typescript
export interface SwapTransaction {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface SwapBuilder {
  buildBuyTransaction(params: {
    route: RouteOption;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: Address;
    deadline: bigint;
  }): SwapTransaction;

  buildSellTransaction(params: {
    route: RouteOption;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: Address;
    deadline: bigint;
  }): SwapTransaction;
}
```

---

### 阶段 2: 实现核心模块（3-5天）

#### 2.1 实现 Router 模块

**文件**: `packages/aggregator/src/router/route-selector.ts`

**功能**:
- 查找所有可能的路由
- 计算每个路由的预期输出
- 选择最优路由

#### 2.2 实现 Quoter 模块

**文件**: `packages/aggregator/src/quoter/quote-calculator.ts`

**功能**:
- 调用 PancakeSwap V2/V3 Quoter
- 计算价格影响
- 处理滑点

#### 2.3 实现 Allowance 模块

**文件**: `packages/aggregator/src/allowance/allowance-manager.ts`

**功能**:
- 检查授权额度
- 缓存授权状态
- 智能判断是否需要授权

#### 2.4 实现 Builder 模块

**文件**: `packages/aggregator/src/builder/swap-builder.ts`

**功能**:
- 构建 V2 交易参数
- 构建 V3 交易参数
- 编码合约调用

---

### 阶段 3: 编写测试（2-3天）

#### 3.1 单元测试

**覆盖率目标**: 80%+

**测试文件**:
- `router.test.ts` - 路由选择测试
- `quoter.test.ts` - 报价计算测试
- `allowance.test.ts` - 授权管理测试
- `builder.test.ts` - 交易构建测试

#### 3.2 集成测试

**测试场景**:
- 完整的买入流程
- 完整的卖出流程
- 错误处理
- 边界条件

---

### 阶段 4: 更新插件（1-2天）

#### 4.1 安装依赖

```json
{
  "dependencies": {
    "@bsc-trading/aggregator": "workspace:*"
  }
}
```

#### 4.2 更新导入

```typescript
// 旧代码
import {
  executeCustomAggregatorBuy,
  executeCustomAggregatorSell
} from './custom-aggregator-agent.js';

// 新代码
import {
  RouteSelector,
  QuoteCalculator,
  AllowanceManager,
  SwapBuilder
} from '@bsc-trading/aggregator';
```

#### 4.3 重构函数

将 `executeCustomAggregatorBuy` 和 `executeCustomAggregatorSell` 重构为使用 SDK 模块。

---

### 阶段 5: 验证和优化（1-2天）

#### 5.1 功能验证

- [ ] 买入交易正常
- [ ] 卖出交易正常
- [ ] 授权流程正常
- [ ] 错误处理正常

#### 5.2 性能测试

- [ ] 路由选择性能
- [ ] 报价查询性能
- [ ] 缓存命中率

#### 5.3 文档完善

- [ ] API 文档
- [ ] 使用示例
- [ ] 迁移指南

---

## 风险和缓解

### 风险 1: 接口设计不合理

**缓解**:
- 先设计接口，充分讨论
- 参考现有实现
- 保持灵活性

### 风险 2: 功能回归

**缓解**:
- 完整的测试覆盖
- 保留旧代码作为回退
- 分阶段迁移

### 风险 3: 性能下降

**缓解**:
- 性能基准测试
- 优化关键路径
- 使用缓存

---

## 成功标准

### 功能完整性

- ✅ 所有功能正常工作
- ✅ 测试覆盖率 > 80%
- ✅ 无功能回归

### 代码质量

- ✅ 模块化设计
- ✅ 清晰的接口
- ✅ 完整的文档

### 性能

- ✅ 性能不低于现有实现
- ✅ 缓存命中率 > 90%
- ✅ 响应时间 < 2s

---

## 时间表

| 阶段 | 任务 | 预计时间 | 状态 |
|------|------|---------|------|
| 短期 | 提取常量和类型 | 0.5天 | ⏳ |
| 短期 | 添加代码注释 | 0.5天 | ⏳ |
| 短期 | 创建测试框架 | 1天 | ⏳ |
| 长期 | 设计接口 | 2-3天 | ⏳ |
| 长期 | 实现核心模块 | 3-5天 | ⏳ |
| 长期 | 编写测试 | 2-3天 | ⏳ |
| 长期 | 更新插件 | 1-2天 | ⏳ |
| 长期 | 验证和优化 | 1-2天 | ⏳ |
| **总计** | - | **10-18天** | - |

---

## 下一步行动

✅ **立即开始**: 创建 @bsc-trading/aggregator 包结构

---

**计划创建时间**: 2026-02-11 00:35
**预计开始时间**: 2026-02-11
**预计完成时间**: 2026-02-25
**当前状态**: 准备开始执行
