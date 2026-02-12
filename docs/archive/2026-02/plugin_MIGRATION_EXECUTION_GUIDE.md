# SDK 测试和迁移执行指南

**日期**: 2026-02-11
**预计完成时间**: 2-3 周

---

## 重要说明

完成所有 SDK 测试和迁移需要 **16+ 个工作日**，这是一个大型工程。建议分阶段执行。

---

## 执行方式

### 方式 1: 自动化脚本 (推荐)

```bash
# 运行自动化脚本
./migrate.sh
```

脚本会引导你完成所有步骤，并在关键点暂停等待确认。

### 方式 2: 手动执行

按照下面的详细步骤手动执行。

---

## 阶段 1: 完善 SDK 测试 (12-14 天)

### 目标

将 SDK 测试覆盖率从 34.96% 提升到 >80%

### 步骤

#### 1.1 修复 Flap 平台测试 (2 天)

**当前状态**: 12/38 测试通过 (31.6%)

**任务**:

1. 阅读 Flap 平台实现
   ```bash
   cd ../bsc-trading-sdk
   cat packages/flap/src/platform.ts
   ```

2. 调整测试以匹配实际实现
   - 修复事件测试（检查实际触发的事件）
   - 调整 Mock 数据结构
   - 修复流动性检查逻辑

3. 运行测试验证
   ```bash
   npm test -- packages/flap/src/__tests__/platform.test.ts
   ```

4. 目标: 通过率 >80% (30+ 个测试通过)

**关键文件**:
- `packages/flap/src/__tests__/platform.test.ts`
- `packages/flap/src/platform.ts`

#### 1.2 创建 FourMeme 平台测试 (3 天)

**任务**:

1. 复制 Flap 测试模板
   ```bash
   cp packages/flap/src/__tests__/platform.test.ts \
      packages/fourmeme/src/__tests__/platform.test.ts
   ```

2. 调整为 FourMeme 特定逻辑
   - 修改导入路径
   - 调整合约地址
   - 添加 XMode 测试
   - 添加 Quote Token 测试

3. 创建 40+ 个测试用例

4. 运行测试
   ```bash
   npm test -- packages/fourmeme/src/__tests__/platform.test.ts
   ```

**预计代码量**: 900 行

#### 1.3 创建 Luna 平台测试 (3 天)

**任务**:

1. 复制测试模板

2. 调整为 Luna 特定逻辑
   - Luna 没有 preview 函数
   - 报价是估算值
   - 推荐 5-10% 滑点

3. 创建 35+ 个测试用例

4. 运行测试

**预计代码量**: 800 行

#### 1.4 创建 PancakeSwap 平台测试 (4 天)

**任务**:

1. 创建 V2 测试
   - 路由测试
   - 多跳交易测试
   - 流动性池测试

2. 创建 V3 测试
   - Fee tier 测试
   - 集中流动性测试

3. 创建 40+ 个测试用例

4. 运行测试

**预计代码量**: 1000 行

#### 1.5 创建 Query 模块测试 (2 天)

**任务**:

1. 为每个平台创建 query 测试
   - `packages/flap/src/__tests__/platform-query.test.ts`
   - `packages/fourmeme/src/__tests__/platform-query.test.ts`
   - `packages/luna/src/__tests__/platform-query.test.ts`

2. 每个文件 10+ 个测试用例

**预计代码量**: 900 行 (300 行 × 3)

#### 1.6 创建集成测试 (2 天)

**任务**:

1. 创建端到端测试
   - 完整的买入流程
   - 完整的卖出流程
   - 跨平台测试

2. 创建性能测试
   - 批量操作测试
   - 并发测试

**预计代码量**: 500 行

### 验证

```bash
cd ../bsc-trading-sdk
npm run test:coverage
```

**成功标准**:
- 总体覆盖率 >80%
- 所有平台覆盖率 >80%
- 所有测试通过

---

## 阶段 2: 移除 trading-channels.ts (1 周)

### 前提条件

- ✅ SDK 测试覆盖率 >80%
- ✅ SDK 在生产环境稳定运行 1 周
- ✅ 无重大 bug 报告

### 步骤

#### 2.1 备份文件

```bash
cd /path/to/bsc-dog-bang-plugin
cp src/shared/trading-channels.ts src/shared/trading-channels.ts.backup
```

#### 2.2 分析使用情况

```bash
# 查找所有使用 trading-channels 的地方
grep -r "from.*trading-channels\|import.*getChannel" src --include="*.ts"
```

**预期结果**:
- `src/background/index.ts` - 主要使用
- `src/background/custom-aggregator-agent.ts` - 可能使用

#### 2.3 移除回退逻辑

**文件**: `src/background/index.ts`

**删除**:
```typescript
// 删除这段代码 (约 40 行)
if (!txHash) {
  txHash = await channelHandler.buy({
    publicClient,
    walletClient,
    account: walletAccount,
    chain: chainConfig,
    tokenAddress: normalizedTokenAddress,
    amount,
    slippage: resolvedSlippage,
    gasPrice: normalizedGasPrice,
    nonceExecutor,
    quoteToken: routeInfo?.quoteToken,
    routeInfo: routeInfo
  });
}
```

**替换为**:
```typescript
// SDK 失败时直接抛出错误
if (!sdkResult.success) {
  throw new Error(`SDK transaction failed: ${sdkResult.error}`);
}
```

**类似地修改卖出逻辑**

#### 2.4 移除报价函数调用

**删除**:
```typescript
const quote = await channelHandler.quoteSell({...});
```

**替换为**:
```typescript
const quote = await sdkAdapter.getQuote({...});
```

#### 2.5 删除导入

```typescript
// 删除
import { getChannel, ... } from '../shared/trading-channels.js';
```

#### 2.6 删除文件

```bash
rm src/shared/trading-channels.ts
```

#### 2.7 构建测试

```bash
npm run build
```

**验证**:
- ✅ 构建成功
- ✅ 无 TypeScript 错误
- ✅ 文件大小减少

#### 2.8 功能测试

**测试所有平台**:
- [ ] FourMeme 买入/卖出
- [ ] Flap 买入/卖出
- [ ] Luna 买入/卖出
- [ ] XMode 买入/卖出
- [ ] PancakeSwap V2 买入/卖出
- [ ] PancakeSwap V3 买入/卖出

### 预期效果

- **代码减少**: 3,989 行 (14%)
- **构建产物减少**: ~10-15 KB
- **维护成本**: 降低

---

## 阶段 3: 路由查询迁移 (可选，1 周)

### 前提条件

- ✅ 阶段 2 完成
- ✅ SDK 稳定运行 1 个月

### 步骤

#### 3.1 评估可行性

分析 `src/shared/route-query/` 目录：
- 哪些功能可以迁移到 SDK
- 哪些功能必须保留在插件

#### 3.2 迁移通用逻辑

将通用的路由查询逻辑迁移到 SDK

#### 3.3 保留插件特有逻辑

保留与 Chrome API 和缓存紧密耦合的逻辑

### 预期效果

- **代码减少**: ~1,500 行 (5%)

---

## 总体时间线

### Week 1-2: SDK 测试 (Flap + FourMeme)
- Day 1-2: 修复 Flap 测试
- Day 3-5: 创建 FourMeme 测试
- Day 6-10: 创建 Luna 测试

### Week 3: SDK 测试 (PancakeSwap + Query)
- Day 11-14: 创建 PancakeSwap 测试
- Day 15-16: 创建 Query 模块测试

### Week 4: 集成测试 + 迁移
- Day 17-18: 创建集成测试
- Day 19-23: 移除 trading-channels.ts
- Day 24-25: 功能测试和优化

### Week 5 (可选): 路由查询迁移
- Day 26-30: 路由查询迁移

---

## 检查点

### 检查点 1: 完成 Flap 测试 (Day 2)

**验证**:
```bash
cd ../bsc-trading-sdk
npm test -- packages/flap/src/__tests__/platform.test.ts
```

**成功标准**: 通过率 >80%

### 检查点 2: 完成所有平台测试 (Day 16)

**验证**:
```bash
npm run test:coverage
```

**成功标准**: 总体覆盖率 >80%

### 检查点 3: 移除 trading-channels.ts (Day 23)

**验证**:
```bash
cd /path/to/bsc-dog-bang-plugin
npm run build
ls -lh extension/dist/background.js
```

**成功标准**: 构建成功，文件大小减少

---

## 回滚计划

### 如果阶段 2 失败

```bash
# 恢复 trading-channels.ts
cp src/shared/trading-channels.ts.backup src/shared/trading-channels.ts

# 恢复代码
git checkout src/background/index.ts

# 重新构建
npm run build
```

---

## 监控指标

### SDK 质量指标

- 测试覆盖率: >80%
- 测试通过率: 100%
- 无已知 bug

### 插件质量指标

- 构建成功率: 100%
- 代码减少: ~5,500 行 (19%)
- 功能正常: 所有平台可用

---

## 资源需求

### 人力

- 1 名开发人员全职
- 或 2 名开发人员兼职

### 时间

- 最快: 2 周（全职）
- 正常: 3 周（全职）
- 保守: 4 周（兼职）

---

## 风险和缓解

### 风险 1: 测试编写时间超预期

**缓解**:
- 使用测试模板
- 并行开发
- 优先核心功能

### 风险 2: SDK 发现 bug

**缓解**:
- 及时修复
- 调整测试
- 延后迁移

### 风险 3: 插件功能受影响

**缓解**:
- 充分测试
- 保留备份
- 准备回滚

---

## 总结

### 当前状态

- SDK 开发: ✅ 完成
- SDK 测试: 🟡 10% (34.96% 覆盖率)
- 代码迁移: ⚪ 未开始

### 最终目标

- SDK 测试: ✅ 100% (>80% 覆盖率)
- 代码迁移: ✅ 100% (减少 ~5,500 行)
- 项目质量: ✅ 显著提升

### 建议

**立即开始**: 阶段 1 - 完善 SDK 测试

**预期收益**:
- 更稳定的 SDK
- 更简洁的插件代码
- 更低的维护成本

---

**创建日期**: 2026-02-11
**预计完成**: 2026-03-04 (3 周后)
**状态**: 准备就绪
