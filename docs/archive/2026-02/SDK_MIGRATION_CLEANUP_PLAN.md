# SDK 迁移代码清理计划

## 目标

以"稳妥而又不失激进"的方式清理被 SDK 取代的功能代码，完成从旧架构到 SDK 架构的彻底迁移。

## 当前状态分析

### 混合架构问题

项目当前处于 SDK 迁移的**中间阶段**，存在三层交易处理逻辑：

```
1. 自定义聚合器 (useCustomAggregator)
   ↓ (失败)
2. SDK 交易 (canUseSDK) ✅ 新方案
   ↓ (失败)
3. 标准通道处理 (channelHandler) ❌ 旧方案 - 应该删除
```

**问题**：
- 第 3 层（标准通道处理）已被 SDK 完全取代，但仍作为回退保留
- `trading-channels-compat.ts` (415 行) 大部分代码已弃用但仍在使用
- 存在大量的兼容层和缓存管理代码

## 清理策略

### 原则

1. **稳妥**：每一步都验证构建和功能
2. **激进**：不犹豫删除明确已被取代的代码
3. **渐进**：分阶段执行，每阶段都可回滚

### 风险控制

- 每个阶段完成后立即构建验证
- 保留 git commit，便于回滚
- 关键功能需要手动测试

## 执行计划

### 阶段 1：移除标准通道回退逻辑（激进）

**目标**：删除 `background/index.ts` 中的旧通道处理逻辑（步骤 5.4）

**风险**：🟡 中等 - SDK 必须完全覆盖所有场景

**步骤**：

1. **验证 SDK 覆盖率**
   - 检查 `canUseSDK()` 函数的判断逻辑
   - 确认支持的平台：four, xmode, flap, luna, pancake
   - 验证所有平台都有 SDK 实现

2. **删除买入流程中的标准通道处理**
   - 位置：`background/index.ts:2949-2967`
   - 删除 `getChannel()` 调用（行 2851）
   - 删除标准通道买入逻辑

3. **删除卖出流程中的标准通道处理**
   - 位置：`background/index.ts:3210-3263`
   - 删除 `getChannel()` 调用（行 3119）
   - 删除标准通道卖出逻辑

4. **更新错误处理**
   - SDK 失败时直接返回错误，不再回退到标准通道
   - 更新错误消息

5. **验证构建**
   ```bash
   npm run build
   ```

**预期收益**：
- 删除 ~100 行代码
- 简化交易流程
- 减少维护负担

---

### 阶段 2：迁移 prepareTokenSell 函数（稳妥）

**目标**：将 `prepareTokenSell()` 从 `trading-channels-compat.ts` 迁移出来

**风险**：🟡 中等 - 需要测试自定义聚合器功能

**步骤**：

1. **创建新的工具模块**
   - 文件：`src/shared/prepare-sell-params.ts`
   - 复制 `prepareTokenSell()` 函数逻辑
   - 添加必要的导入

2. **更新 custom-aggregator-agent.ts**
   - 更新导入语句
   - 从新模块导入 `prepareTokenSell()`

3. **验证构建和功能**
   ```bash
   npm run build
   ```

4. **测试自定义聚合器**
   - 测试 Four.meme 卖出
   - 测试 Flap 卖出

**预期收益**：
- 解除对 `trading-channels-compat.ts` 的依赖
- 为删除兼容层做准备

---

### 阶段 3：清理缓存管理代码（激进）

**目标**：删除分散的缓存管理函数，统一使用 SDK 的缓存机制

**风险**：🟡 中等 - 需要验证 SDK 缓存是否充分

**步骤**：

1. **分析缓存使用情况**
   - `getTokenTradeHint()` / `setTokenTradeHint()` - 交易提示缓存
   - `getCachedAllowance()` / `clearAllowanceCache()` - 授权缓存
   - `checkRouteCache()` / `isRouteCacheExpiringSoon()` - 路由缓存

2. **迁移到 SDK 缓存**
   - 使用 `RouteCacheManager` 管理路由缓存
   - 使用 SDK 的授权缓存机制
   - 删除自定义的缓存逻辑

3. **更新调用位置**
   - `background/index.ts` 中的缓存调用
   - `content/index.ts` 中的缓存调用

4. **验证构建**
   ```bash
   npm run build
   ```

**预期收益**：
- 删除 ~200 行缓存管理代码
- 统一缓存机制
- 减少代码重复

---

### 阶段 4：删除 trading-channels-compat.ts（激进）

**目标**：完全删除兼容层文件

**风险**：🔴 高 - 需要确保所有依赖都已迁移

**前提条件**：
- ✅ 阶段 1 完成（删除标准通道处理）
- ✅ 阶段 2 完成（迁移 prepareTokenSell）
- ✅ 阶段 3 完成（清理缓存管理）

**步骤**：

1. **检查剩余依赖**
   ```bash
   grep -r "from.*trading-channels-compat" src
   ```

2. **逐个迁移剩余函数**
   - 如果还有函数被使用，先迁移
   - 确保没有遗漏

3. **删除文件**
   ```bash
   rm src/shared/trading-channels-compat.ts
   ```

4. **验证构建**
   ```bash
   npm run build
   ```

**预期收益**：
- 删除 415 行兼容层代码
- 完全迁移到 SDK 架构
- 代码结构更清晰

---

### 阶段 5：优化路由查询（可选）

**目标**：删除 `token-route.ts` 兼容层，直接使用 `route-query` 模块

**风险**：🟢 低 - 完全是包装层

**步骤**：

1. **分析 token-route.ts 的使用**
   ```bash
   grep -r "from.*token-route" src
   ```

2. **更新导入语句**
   - 将 `import { fetchRouteWithFallback } from './token-route'`
   - 改为 `import { RouteQueryService } from './route-query'`

3. **删除文件**
   ```bash
   rm src/shared/token-route.ts
   ```

4. **验证构建**
   ```bash
   npm run build
   ```

**预期收益**：
- 删除 ~100 行包装代码
- 直接使用核心模块
- 减少一层抽象

---

## 执行时间表

| 阶段 | 预计时间 | 风险 | 优先级 |
|------|---------|------|--------|
| 阶段 1 | 2-3 小时 | 🟡 中 | 高 |
| 阶段 2 | 1-2 小时 | 🟡 中 | 高 |
| 阶段 3 | 3-4 小时 | 🟡 中 | 中 |
| 阶段 4 | 1 小时 | 🔴 高 | 中 |
| 阶段 5 | 1 小时 | 🟢 低 | 低 |

**总计**：8-11 小时

## 预期收益

### 代码量减少

| 项目 | 删除行数 | 说明 |
|------|---------|------|
| 标准通道处理 | ~100 | background/index.ts |
| prepareTokenSell 迁移 | ~100 | trading-channels-compat.ts |
| 缓存管理代码 | ~200 | 多个文件 |
| trading-channels-compat.ts | ~415 | 完整文件 |
| token-route.ts | ~100 | 完整文件 |
| **总计** | **~915 行** | |

### 质量提升

- ✅ 消除混合架构
- ✅ 统一使用 SDK
- ✅ 减少代码重复
- ✅ 简化维护
- ✅ 提高可读性

### 性能提升

- ✅ 减少回退逻辑判断
- ✅ 统一缓存机制
- ✅ 减少不必要的函数调用

## 回滚计划

每个阶段完成后创建 git commit：

```bash
# 阶段 1
git add .
git commit -m "refactor: remove legacy channel handler fallback"

# 阶段 2
git add .
git commit -m "refactor: migrate prepareTokenSell function"

# 阶段 3
git add .
git commit -m "refactor: cleanup cache management code"

# 阶段 4
git add .
git commit -m "refactor: remove trading-channels-compat.ts"

# 阶段 5
git add .
git commit -m "refactor: remove token-route.ts wrapper"
```

如需回滚：
```bash
git revert HEAD
# 或
git reset --hard HEAD~1
```

## 验证清单

每个阶段完成后检查：

- [ ] TypeScript 编译通过
- [ ] Vite 构建成功
- [ ] 无循环依赖警告
- [ ] 构建产物大小合理
- [ ] 手动测试关键功能：
  - [ ] 买入交易（Four.meme）
  - [ ] 卖出交易（Four.meme）
  - [ ] 买入交易（PancakeSwap）
  - [ ] 卖出交易（PancakeSwap）
  - [ ] 自定义聚合器交易

## 注意事项

1. **不要一次性执行所有阶段**
   - 每个阶段独立完成
   - 验证通过后再进行下一阶段

2. **保持 git 历史清晰**
   - 每个阶段一个 commit
   - commit message 清晰描述变更

3. **充分测试**
   - 构建验证是必须的
   - 关键功能需要手动测试
   - 考虑添加自动化测试

4. **文档更新**
   - 更新 README.md
   - 更新架构文档
   - 记录迁移过程

## 开始执行

准备好后，从阶段 1 开始执行。每个阶段完成后更新此文档的进度。

---

**当前进度**：

- [ ] 阶段 1：移除标准通道回退逻辑
- [ ] 阶段 2：迁移 prepareTokenSell 函数
- [ ] 阶段 3：清理缓存管理代码
- [ ] 阶段 4：删除 trading-channels-compat.ts
- [ ] 阶段 5：优化路由查询
