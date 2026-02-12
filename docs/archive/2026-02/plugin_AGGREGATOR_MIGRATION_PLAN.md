# 插件使用 SDK Aggregator 包的迁移计划

## 当前状况分析

### 插件的 custom-aggregator-agent.ts
- **代码行数**: 1052 行
- **核心功能**:
  - V2/V3 路由选择和报价
  - 授权管理
  - 交易构建和执行
  - Four.meme/Flap 特定逻辑
  - 与插件架构深度耦合

### SDK 的 @bsc-trading/aggregator 包
- **代码行数**: 1,755 行
- **核心功能**:
  - V2/V3 路由选择
  - 报价计算
  - 授权管理（LRU 缓存）
  - 交易构建

## 迁移策略

### 方案评估

#### ❌ 方案 1: 完全替换
**问题**:
- custom-aggregator-agent.ts 包含大量插件特定逻辑
- 与 Four.meme/Flap 深度集成
- 依赖插件的 nonceExecutor、walletClient 等
- 有特殊的错误处理和重试逻辑

**结论**: 不可行

#### ✅ 方案 2: 渐进式重构（推荐）
**思路**: 保留插件特定逻辑，用 SDK 替换可复用的核心功能

**重构范围**:

1. **可以替换的部分** (~40%):
   - ✅ V2/V3 路由选择逻辑
   - ✅ 报价计算（quoteViaPancakeV3, quotePancakeV2Path）
   - ✅ 授权缓存管理
   - ✅ 交易参数构建

2. **必须保留的部分** (~60%):
   - ❌ Four.meme/Flap 特定逻辑
   - ❌ shouldUseCustomAggregator 判断逻辑
   - ❌ executeCustomAggregatorBuy/Sell 执行逻辑
   - ❌ nonceExecutor 集成
   - ❌ 插件特定的错误处理
   - ❌ buildAggregatorArgs（Four/Flap 参数构建）

## 推荐方案

### 当前阶段：保持现状 ✅

**原因**:
1. custom-aggregator-agent.ts 已经稳定运行
2. 与插件架构深度耦合
3. 包含大量 Four/Flap 特定逻辑
4. 迁移风险大于收益

**已完成**:
- ✅ 创建了 CustomAggregatorAdapter 适配器
- ✅ 添加了 @bsc-trading/aggregator 依赖
- ✅ 为未来迁移做好准备

### 未来阶段：选择性重构 ⏸️

**时机**: 当以下条件满足时
1. SDK aggregator 包经过充分测试和验证
2. 有足够的时间进行重构和测试
3. 需要添加新功能或修复重大 bug

**重构优先级**:
1. **高优先级**: 授权管理（最容易替换，收益最大）
2. **中优先级**: 报价计算（需要适配）
3. **低优先级**: 交易构建（需要保留大量特定逻辑）

## 结论

**当前决策**:
- ✅ 保留 custom-aggregator-agent.ts 原有实现
- ✅ 创建 CustomAggregatorAdapter 作为未来迁移的基础
- ⏸️ 暂不进行大规模重构

**理由**:
1. 现有代码稳定可靠
2. 迁移成本高，风险大
3. SDK aggregator 需要更多验证
4. 可以在未来需要时逐步迁移

**下一步**:
1. 在新功能中优先使用 SDK aggregator
2. 收集 SDK aggregator 的使用反馈
3. 等待合适的时机进行重构

---

**日期**: 2026-02-12
**状态**: ✅ 分析完成，决定保持现状
**适配器**: ✅ 已创建，为未来迁移做准备
