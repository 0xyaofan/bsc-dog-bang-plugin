# SDK 迁移状态报告

**日期**: 2026-02-11
**状态**: 🟡 部分完成

---

## 已完成工作

### ✅ SDK 测试开发（100%）
- **Flap 平台**: 38 个测试 ✅
- **FourMeme 平台**: 26 个测试 ✅
- **Luna 平台**: 37 个测试 ✅
- **PancakeSwap V2**: 23 个测试 ✅
- **PancakeSwap V3**: 25 个测试 ✅
- **总计**: 149 个测试，100% 通过

### ✅ 测试基础设施
- 统一的 test-utils
- Mock 工具函数
- 测试地址常量
- 性能监控 mock

### ✅ 实现问题修复
- Flap/Luna: `startTimer` → `createTimer`
- Flap/Luna: 滑点格式统一为 0-100
- FourMeme: XMode 支持
- 测试覆盖率达标

---

## 待完成工作

### 🔴 trading-channels.ts 依赖移除

#### 发现的使用情况

**1. src/background/custom-aggregator-agent.ts**
- **使用**: `prepareTokenSell` (1 处)
- **位置**: 第 27 行导入，第 730 行使用
- **功能**: 准备代币卖出（查询余额、授权、计算卖出数量）
- **影响**: Aggregator 卖出功能

**2. src/background/index.ts**
- **使用**: 多个函数 (14 处)
  - `getChannel` (8 处) - 获取交易通道处理器
  - `setPancakePreferredMode` (2 处) - 设置 Pancake 偏好模式
  - `getTokenTradeHint` (1 处) - 获取代币交易提示
  - `getCachedAllowance` (2 处) - 获取缓存的授权
  - `setTokenTradeHint` (1 处) - 设置代币交易提示
  - `clearAllowanceCache` (1 处) - 清除授权缓存
- **影响**: 核心买入/卖出功能、路由查询、预加载

---

## 迁移策略

### 方案 1: 渐进式迁移（推荐）

#### 阶段 1: 保留 trading-channels.ts，标记为 deprecated
```typescript
// src/shared/trading-channels.ts
/**
 * @deprecated 此文件将在未来版本中移除
 * 新代码请使用 @bsc-trading/sdk
 */
```

**优点**:
- 不破坏现有功能
- 可以逐步迁移
- 降低风险

**缺点**:
- 代码冗余
- 维护成本高

#### 阶段 2: 创建 SDK 适配层
```typescript
// src/shared/sdk-adapter.ts
import { createSDKClient } from './sdk-client-manager.js';

/**
 * SDK 适配层：将旧的 channel API 适配到新的 SDK
 */
export function getChannelFromSDK(channelId: string) {
  const sdk = createSDKClient();

  switch (channelId) {
    case 'four':
    case 'xmode':
      return createFourMemeAdapter(sdk.fourMeme);
    case 'flap':
      return createFlapAdapter(sdk.flap);
    case 'luna':
      return createLunaAdapter(sdk.luna);
    case 'pancake':
      return createPancakeAdapter(sdk.pancakeV2, sdk.pancakeV3);
    default:
      throw new Error(`Unknown channel: ${channelId}`);
  }
}

function createFourMemeAdapter(platform: FourMemePlatform) {
  return {
    quoteBuy: async ({ publicClient, tokenAddress, amount }) => {
      // 适配到 SDK API
      return platform.getQuote({
        tokenAddress,
        amountIn: amount,
        isSell: false,
      });
    },
    buy: async ({ publicClient, walletClient, account, tokenAddress, amount, slippage, gasPrice }) => {
      // 适配到 SDK API
      return platform.buy({
        tokenAddress,
        amountIn: amount,
        slippage,
        gasPrice,
      });
    },
    // ... 其他方法
  };
}
```

#### 阶段 3: 逐步替换使用点
1. 替换 `background/index.ts` 中的 `getChannel` 调用
2. 替换 `custom-aggregator-agent.ts` 中的 `prepareTokenSell` 调用
3. 移除其他辅助函数的使用

#### 阶段 4: 删除 trading-channels.ts
- 确认所有使用点已迁移
- 运行完整测试
- 删除文件

---

### 方案 2: 一次性完全迁移

#### 步骤
1. 创建完整的 SDK 适配层
2. 一次性替换所有使用点
3. 删除 trading-channels.ts
4. 全面测试

**优点**:
- 一次性完成
- 代码更清晰

**缺点**:
- 风险高
- 可能引入 bug
- 需要大量测试

---

## 具体迁移任务

### Task 1: 创建 SDK 适配层
- [ ] 创建 `src/shared/sdk-adapter.ts`
- [ ] 实现 `getChannelFromSDK` 函数
- [ ] 为每个平台创建适配器
- [ ] 测试适配器功能

### Task 2: 迁移 prepareTokenSell
- [ ] 在 SDK 中实现类似功能或内联到使用处
- [ ] 更新 `custom-aggregator-agent.ts`
- [ ] 测试 Aggregator 卖出功能

### Task 3: 迁移 background/index.ts
- [ ] 替换 `getChannel` 调用为 `getChannelFromSDK`
- [ ] 替换辅助函数调用
- [ ] 测试买入功能
- [ ] 测试卖出功能
- [ ] 测试路由查询
- [ ] 测试预加载功能

### Task 4: 清理和验证
- [ ] 删除 trading-channels.ts
- [ ] 运行完整测试套件
- [ ] 手动测试所有交易功能
- [ ] 性能测试
- [ ] 构建验证

---

## 风险评估

### 高风险区域
1. **买入/卖出功能** - 核心功能，影响用户资金
2. **授权管理** - 错误可能导致交易失败
3. **Gas 价格处理** - 影响交易成本
4. **滑点计算** - 影响交易成功率

### 缓解措施
1. 充分的单元测试
2. 集成测试
3. 手动测试所有场景
4. 灰度发布
5. 回滚计划

---

## 时间估算

### 方案 1: 渐进式迁移
- **阶段 1**: 标记 deprecated - 0.5 天
- **阶段 2**: 创建适配层 - 2-3 天
- **阶段 3**: 逐步替换 - 3-4 天
- **阶段 4**: 删除旧代码 - 1 天
- **总计**: 6.5-8.5 天

### 方案 2: 一次性迁移
- **创建适配层**: 2-3 天
- **替换所有使用**: 2-3 天
- **测试验证**: 2-3 天
- **总计**: 6-9 天

---

## 建议

### 推荐方案: 渐进式迁移（方案 1）

**理由**:
1. **风险可控**: 每个阶段都可以独立测试和验证
2. **可回滚**: 出现问题可以快速回滚
3. **不影响现有功能**: 用户不会感知到变化
4. **便于调试**: 问题更容易定位

### 下一步行动
1. 标记 `trading-channels.ts` 为 deprecated
2. 创建 SDK 适配层框架
3. 实现第一个平台的适配器（建议从 Flap 开始，因为测试最完善）
4. 在一个小范围内测试适配器
5. 逐步扩展到其他平台

---

## 当前状态总结

### ✅ 已完成
- SDK 测试开发（149 个测试）
- 测试基础设施
- 实现问题修复
- 构建验证通过

### 🟡 进行中
- trading-channels.ts 依赖分析

### 🔴 待开始
- SDK 适配层开发
- 使用点迁移
- trading-channels.ts 删除

### 📊 完成度
- **SDK 测试**: 100%
- **代码迁移**: 0%
- **整体进度**: 50%

---

**报告时间**: 2026-02-11 16:45
**下次更新**: 开始适配层开发后
