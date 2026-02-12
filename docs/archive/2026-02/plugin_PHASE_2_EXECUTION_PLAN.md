# 阶段 2 执行计划：路由查询系统迁移

**开始时间**: 2026-02-11 00:15
**状态**: 进行中

---

## 现状分析

### 插件 route-query 模块（15 个）

1. `base-platform-query.ts` - 平台查询基类
2. `constants.ts` - 常量定义
3. `default-platform-query.ts` - 默认查询
4. `errors.ts` - 错误类型
5. `flap-platform-query.ts` - Flap 查询
6. `four-platform-query.ts` - Four.meme 查询
7. `index.ts` - 导出
8. `liquidity-checker.ts` - 流动性检查器
9. `luna-platform-query.ts` - Luna 查询
10. `pancake-pair-finder.ts` - Pancake pair 查找器
11. `platform-detector.ts` - 平台检测器
12. `query-executor.ts` - 查询执行器
13. `route-cache-manager.ts` - 路由缓存管理器
14. `route-query-service.ts` - 路由查询服务
15. `types.ts` - 类型定义

### SDK router 包现有模块（5 个）

1. `platform-detector.ts` - 平台检测器 ✅
2. `route-cache-manager.ts` - 路由缓存管理器 ✅
3. `smart-router.ts` - 智能路由
4. `types/index.ts` - 类型定义 ✅
5. `index.ts` - 导出

### 需要迁移的模块（10 个）

1. `base-platform-query.ts` - 平台查询基类
2. `constants.ts` - 常量定义
3. `default-platform-query.ts` - 默认查询
4. `errors.ts` - 错误类型
5. `flap-platform-query.ts` - Flap 查询
6. `four-platform-query.ts` - Four.meme 查询
7. `liquidity-checker.ts` - 流动性检查器
8. `luna-platform-query.ts` - Luna 查询
9. `pancake-pair-finder.ts` - Pancake pair 查找器
10. `query-executor.ts` - 查询执行器
11. `route-query-service.ts` - 路由查询服务

---

## 迁移策略

### 策略：增强 + 新增

由于 SDK router 包已有基础结构，我们采用以下策略：

1. **保留现有模块**：platform-detector、route-cache-manager、types
2. **新增缺失模块**：将插件的 10 个模块迁移到 SDK
3. **调整依赖**：移除插件特定依赖（如 structured-logger）
4. **统一接口**：确保与 SDK 现有模块兼容

---

## 执行步骤

### 第 1 步：新增 types.ts（类型定义）

**目标**: 添加路由查询相关的类型定义

**文件**: `../bsc-trading-sdk/packages/router/src/types/route-query.ts`

**内容**:
- RouteQueryResult
- PlatformQueryResult
- LiquidityInfo
- PancakePairInfo
- 等

### 第 2 步：新增 constants.ts

**目标**: 添加常量定义

**文件**: `../bsc-trading-sdk/packages/router/src/constants.ts`

**内容**:
- 平台回退顺序
- 最小流动性阈值
- 缓存配置
- 等

### 第 3 步：新增 errors.ts

**目标**: 添加路由查询专用错误类型

**文件**: `../bsc-trading-sdk/packages/router/src/errors.ts`

**内容**:
- RouteQueryError
- PlatformQueryError
- LiquidityCheckError
- 等

### 第 4 步：新增 liquidity-checker.ts

**目标**: 添加流动性检查器

**文件**: `../bsc-trading-sdk/packages/router/src/liquidity-checker.ts`

**功能**:
- V2 pair 流动性检查
- V3 pool 流动性检查
- 最小流动性阈值判断

### 第 5 步：新增 pancake-pair-finder.ts

**目标**: 添加 Pancake pair 查找器

**文件**: `../bsc-trading-sdk/packages/router/src/pancake-pair-finder.ts`

**功能**:
- 查找 V2 pair
- 查找 V3 pool
- 选择最佳 pair

### 第 6 步：新增 base-platform-query.ts

**目标**: 添加平台查询基类

**文件**: `../bsc-trading-sdk/packages/router/src/base-platform-query.ts`

**功能**:
- 抽象查询接口
- 通用错误处理
- Pancake fallback 逻辑

### 第 7 步：新增平台查询实现

**目标**: 添加各平台的查询实现

**文件**:
- `../bsc-trading-sdk/packages/router/src/four-platform-query.ts`
- `../bsc-trading-sdk/packages/router/src/flap-platform-query.ts`
- `../bsc-trading-sdk/packages/router/src/luna-platform-query.ts`
- `../bsc-trading-sdk/packages/router/src/default-platform-query.ts`

### 第 8 步：新增 query-executor.ts

**目标**: 添加查询执行器

**文件**: `../bsc-trading-sdk/packages/router/src/query-executor.ts`

**功能**:
- 执行查询
- Fallback 逻辑
- 错误处理

### 第 9 步：新增 route-query-service.ts

**目标**: 添加路由查询服务（主入口）

**文件**: `../bsc-trading-sdk/packages/router/src/route-query-service.ts`

**功能**:
- 统一的查询入口
- 缓存管理
- 平台检测集成

### 第 10 步：更新导出

**目标**: 更新 router 包的导出

**文件**: `../bsc-trading-sdk/packages/router/src/index.ts`

### 第 11 步：添加测试

**目标**: 为新增模块添加测试

**文件**: `../bsc-trading-sdk/packages/router/src/__tests__/`

### 第 12 步：构建和验证

**目标**: 确保构建成功，测试通过

---

## 依赖调整

### 需要移除的依赖

1. **structured-logger** - 插件特定的日志系统
   - 替换为：SDK 的 Logger（@bsc-trading/core）

2. **trading-config** - 插件特定的配置
   - 替换为：参数传递或默认值

3. **Chrome API** - 浏览器扩展特定
   - 移除：不需要

### 需要添加的依赖

1. **@bsc-trading/core** - SDK 核心包
   - 使用：Logger、LruCache、withRetry、validation 等

2. **@bsc-trading/flap** - Flap 平台包
   - 使用：Flap 平台查询

3. **@bsc-trading/fourmeme** - Four.meme 平台包
   - 使用：Four.meme 平台查询

4. **@bsc-trading/luna** - Luna 平台包
   - 使用：Luna 平台查询

5. **@bsc-trading/pancakeswap** - PancakeSwap 平台包
   - 使用：PancakeSwap 查询

---

## 风险控制

### 1. 保持向后兼容

- SDK 现有接口不变
- 新增功能不影响现有功能

### 2. 模块化设计

- 每个模块独立
- 易于测试和维护

### 3. 渐进式迁移

- 一次迁移一个模块
- 每次迁移后验证

---

## 预期收益

1. **功能完整性**
   - SDK 获得完整的路由查询能力
   - 支持所有平台的路由查询

2. **代码复用**
   - 减少约 1500 行重复代码
   - 统一的路由查询逻辑

3. **可维护性**
   - 单一代码源
   - 清晰的模块划分

---

## 下一步行动

✅ **立即开始**: 新增 types/route-query.ts

---

**计划创建时间**: 2026-02-11 00:15
**预计完成时间**: 2-3 小时
**当前状态**: 准备开始执行
