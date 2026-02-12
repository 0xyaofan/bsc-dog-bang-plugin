# 插件到 SDK 迁移执行计划

**执行日期**: 2026-02-11
**状态**: 进行中

---

## 当前状况分析

### SDK 已有的模块

经过检查，SDK (`bsc-trading-sdk`) 已经有以下基础模块：

**packages/core/src/utils/**:
- `retry.ts` - 基础重试机制（143 行）
- `performance.ts` - 性能监控
- `batch.ts` - 批量操作
- `helpers.ts` - 辅助函数
- `logger.ts` - 日志工具

**packages/core/src/cache/**:
- `lru-cache.ts` - LRU 缓存实现（229 行）

**packages/core/src/**:
- `errors.ts` - 错误类型
- `events/` - 事件系统
- `transport/` - 传输层
- `types/` - 类型定义

### 插件独有的增强功能

**src/shared/**:
- `retry.ts` (200 行) - 增强的重试机制，包含预设策略和统计
- `retry-helper.ts` (150 行) - 重试辅助函数和预设
- `validation.ts` (300 行) - 完整的验证工具
- `viem-helper.ts` (250 行) - Viem 辅助工具
- `cache-manager.ts` (200 行) - 缓存管理器（带监控）
- `cache-monitor.ts` (100 行) - 缓存监控系统
- `route-query/` (17 个模块) - 完整的路由查询系统

---

## 迁移策略调整

### 原计划 vs 实际情况

**原计划**: 直接迁移所有模块到 SDK

**实际情况**: SDK 已有基础实现，需要增强而非替换

### 新策略：增强 + 新增

#### 策略 A: 增强现有模块
- SDK 已有基础实现，插件版本更完善
- 将插件的增强功能合并到 SDK

#### 策略 B: 新增独有模块
- SDK 没有的模块，直接迁移
- 例如：validation.ts, viem-helper.ts, route-query/

---

## 阶段 1: 增强基础工具（修订版）

### 1.1 增强 retry.ts

**目标**: 将插件的增强功能合并到 SDK

**插件版本特性**:
- 预设重试策略（RETRY_STRATEGIES）
  - onchain: 链上操作重试
  - api: API 调用重试
  - network: 网络请求重试
- 重试统计（RetryStats）
- 重试回调（onRetry）
- 更智能的错误判断

**迁移方式**: 增强 SDK 的 retry.ts
- 保留 SDK 现有接口
- 添加预设策略
- 添加统计功能
- 添加回调支持

**文件位置**: `../bsc-trading-sdk/packages/core/src/utils/retry.ts`

---

### 1.2 增强 lru-cache.ts

**目标**: 添加缓存监控功能

**插件版本特性**:
- 缓存统计（hits, misses, evictions）
- 缓存监控管理器
- 缓存性能追踪

**迁移方式**:
1. 增强 SDK 的 lru-cache.ts，添加统计功能
2. 新增 cache-monitor.ts 到 SDK

**文件位置**:
- `../bsc-trading-sdk/packages/core/src/cache/lru-cache.ts`
- `../bsc-trading-sdk/packages/core/src/cache/cache-monitor.ts` (新增)

---

### 1.3 新增 validation.ts

**目标**: 添加完整的验证工具

**功能**:
- 地址验证（checksum、格式）
- 金额验证（范围、精度）
- 参数验证（非空、类型）
- Gas 参数验证
- 滑点验证

**迁移方式**: 直接复制到 SDK
- 调整导入路径
- 适配 SDK 的错误类型

**文件位置**: `../bsc-trading-sdk/packages/core/src/utils/validation.ts` (新增)

---

### 1.4 新增 viem-helper.ts

**目标**: 添加 Viem 辅助工具

**功能**:
- 类型转换（number ↔ bigint）
- 地址格式化
- Gas 参数处理
- 交易参数构建

**迁移方式**: 直接复制到 SDK
- 调整导入路径
- 适配 SDK 的类型定义

**文件位置**: `../bsc-trading-sdk/packages/core/src/utils/viem-helper.ts` (新增)

---

### 1.5 新增 cache-manager.ts

**目标**: 添加缓存管理器

**功能**:
- 统一的缓存管理接口
- 多个缓存实例管理
- 缓存预热支持

**迁移方式**: 直接复制到 SDK
- 调整导入路径
- 集成 cache-monitor

**文件位置**: `../bsc-trading-sdk/packages/core/src/cache/cache-manager.ts` (新增)

---

## 阶段 2: 迁移路由查询系统

### 2.1 创建 route-query 包

**目标**: 将完整的路由查询系统迁移到 SDK

**方式**: 创建新的 package
- 路径: `../bsc-trading-sdk/packages/route-query/`
- 包含 17 个模块
- 独立的包，可以单独发布

**原因**:
- 路由查询是独立的功能模块
- 可以被其他项目复用
- 便于版本管理

---

## 阶段 3: 迁移高级功能

### 3.1 增强 performance.ts

**目标**: 合并插件的性能监控功能

**迁移方式**: 增强 SDK 的 performance.ts

---

### 3.2 增强 batch.ts

**目标**: 添加批量查询功能

**迁移方式**:
- 提取 batch-query-handlers.ts 核心逻辑
- 移除 Chrome API 依赖
- 合并到 SDK 的 batch.ts

---

## 阶段 4: Quote Bridge 迁移

### 4.1 创建 quote-bridge 模块

**目标**: 提取 Quote Bridge 核心逻辑

**方式**:
- 分析依赖，分离钱包操作
- 创建 SDK 接口
- 插件通过 SDK 接口使用

---

## 执行顺序

### 第 1 步: 增强 retry.ts ✅ 准备开始
- 文件: `../bsc-trading-sdk/packages/core/src/utils/retry.ts`
- 添加预设策略
- 添加统计功能
- 添加回调支持

### 第 2 步: 增强 lru-cache.ts
- 文件: `../bsc-trading-sdk/packages/core/src/cache/lru-cache.ts`
- 添加统计功能

### 第 3 步: 新增 cache-monitor.ts
- 文件: `../bsc-trading-sdk/packages/core/src/cache/cache-monitor.ts`
- 缓存监控管理器

### 第 4 步: 新增 validation.ts
- 文件: `../bsc-trading-sdk/packages/core/src/utils/validation.ts`
- 完整的验证工具

### 第 5 步: 新增 viem-helper.ts
- 文件: `../bsc-trading-sdk/packages/core/src/utils/viem-helper.ts`
- Viem 辅助工具

### 第 6 步: 新增 cache-manager.ts
- 文件: `../bsc-trading-sdk/packages/core/src/cache/cache-manager.ts`
- 缓存管理器

### 第 7 步: 更新测试
- 为新增/增强的模块添加测试
- 确保测试通过

### 第 8 步: 更新文档
- 更新 SDK README
- 添加 API 文档
- 添加使用示例

---

## 验证方法

### 1. 单元测试
```bash
cd ../bsc-trading-sdk
pnpm test
```

### 2. 构建验证
```bash
cd ../bsc-trading-sdk
pnpm build
```

### 3. 插件集成测试
- 更新插件使用 SDK 的新功能
- 运行插件测试
- 验证功能正常

---

## 风险控制

### 1. 保持向后兼容
- SDK 现有接口不变
- 只添加新功能，不破坏旧功能

### 2. 渐进式迁移
- 一次迁移一个模块
- 每次迁移后验证
- 出问题可以快速回滚

### 3. 完整的测试
- 每个模块都有测试
- 集成测试覆盖
- 性能测试验证

---

## 下一步行动

✅ **立即开始**: 增强 retry.ts
- 读取插件的 retry.ts 和 retry-helper.ts
- 分析增强功能
- 合并到 SDK 的 retry.ts
- 添加测试
- 验证构建

---

**计划创建时间**: 2026-02-11 23:50
**预计完成时间**: 阶段 1 预计 1-2 天
**当前状态**: 准备开始执行
