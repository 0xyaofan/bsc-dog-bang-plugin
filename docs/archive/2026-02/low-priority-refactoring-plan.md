# 低优先级重构计划

## 概述

本文档详细规划了项目的长期重构任务。这些任务旨在提高代码质量、可维护性和性能，但不影响当前功能。

## 当前代码状况分析

### 代码规模
- `src/shared/token-route.ts`: 1,492 行
- `src/shared/trading-channels.ts`: 3,989 行
- `src/shared/cache-manager.ts`: 356 行
- 总计 TypeScript 文件: 29 个

### 主要问题
1. **单文件过大**: token-route.ts 包含多个平台的路由逻辑，难以维护
2. **缓存机制简单**: 使用基础 Map，缺少 LRU 策略和性能监控
3. **错误处理分散**: 17 个 try-catch 块，缺少统一的错误类型和恢复策略
4. **性能优化空间**: 存在重复的链上查询，缺少批处理机制
5. **文档不完整**: 缺少 API 文档和开发者指南

## 重构任务优先级

### 优先级 1: 完善文档（最快见效）
**预计工作量**: 1-2 天
**风险**: 低
**收益**: 高（提升团队协作效率）

### 优先级 2: 改进错误处理
**预计工作量**: 2-3 天
**风险**: 中
**收益**: 高（提升系统稳定性）

### 优先级 3: 优化缓存机制
**预计工作量**: 2-3 天
**风险**: 中
**收益**: 中（提升性能）

### 优先级 4: 重构路由查询逻辑
**预计工作量**: 5-7 天
**风险**: 高
**收益**: 高（提升可维护性）

### 优先级 5: 性能优化
**预计工作量**: 3-5 天
**风险**: 中
**收益**: 中（提升用户体验）

---

## 任务 1: 完善文档 ✅ 开始执行

### 目标
创建完整的项目文档，包括 API 文档、开发者指南和故障排查手册。

### 具体任务

#### 1.1 创建 API 文档
**文件**: `docs/api-reference.md`

**内容**:
- 所有导出函数的签名和说明
- 参数类型和返回值
- 使用示例
- 注意事项

**关键 API**:
```typescript
// 路由查询
fetchRouteWithFallback(publicClient, tokenAddress, initialPlatform)
fetchTokenRouteState(publicClient, tokenAddress, platform)

// 平台检测
detectTokenPlatform(tokenAddress)

// 缓存管理
clearRouteCache(tokenAddress?)
getRouteCache(tokenAddress)
setRouteCache(tokenAddress, route)

// 流动性检查
checkPairLiquidity(publicClient, pairAddress, tokenAddress, quoteToken)
checkV3PoolLiquidity(publicClient, tokenAddress, quoteToken)
```

#### 1.2 创建开发者指南
**文件**: `docs/developer-guide.md`

**内容**:
- 项目架构概览
- 核心概念解释
- 开发工作流程
- 代码规范
- 测试指南
- 调试技巧

**章节结构**:
1. 快速开始
2. 架构概览
3. 核心模块详解
   - 路由系统
   - 交易通道
   - 缓存管理
   - 性能监控
4. 开发工作流
5. 测试策略
6. 调试指南

#### 1.3 创建故障排查手册
**文件**: `docs/troubleshooting.md`

**内容**:
- 常见问题和解决方案
- 错误代码说明
- 日志分析指南
- 性能问题诊断
- Service Worker 限制处理

**常见问题**:
1. Service Worker import() 错误
2. 路由查询失败
3. 缓存不生效
4. 流动性检查失败
5. 平台检测错误
6. 交易失败

#### 1.4 更新现有文档
- 补充 README.md 的使用说明
- 更新 ADR 文档
- 添加代码注释

### 实施步骤
1. 创建 API 参考文档
2. 编写开发者指南
3. 整理故障排查手册
4. 更新现有文档
5. 添加代码注释

### 验收标准
- [ ] API 文档覆盖所有导出函数
- [ ] 开发者指南包含完整的架构说明
- [ ] 故障排查手册覆盖常见问题
- [ ] 所有文档经过审阅

---

## 任务 2: 改进错误处理

### 目标
创建统一的错误处理机制，提高系统稳定性和可调试性。

### 当前问题
- 17 个 try-catch 块分散在代码中
- 错误类型不统一
- 缺少错误恢复策略
- 错误信息不够详细

### 具体任务

#### 2.1 创建自定义错误类型
**文件**: `src/shared/errors.ts`

```typescript
// 基础错误类
export class RouteError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

// 平台特定错误
export class PlatformError extends RouteError {
  constructor(
    message: string,
    public platform: TokenPlatform,
    context?: Record<string, any>
  ) {
    super(message, 'PLATFORM_ERROR', { ...context, platform });
    this.name = 'PlatformError';
  }
}

// Service Worker 错误
export class ServiceWorkerError extends RouteError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SERVICE_WORKER_ERROR', context);
    this.name = 'ServiceWorkerError';
  }
}

// 流动性错误
export class LiquidityError extends RouteError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'LIQUIDITY_ERROR', context);
    this.name = 'LiquidityError';
  }
}

// 缓存错误
export class CacheError extends RouteError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'CACHE_ERROR', context);
    this.name = 'CacheError';
  }
}

// 网络错误
export class NetworkError extends RouteError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'NETWORK_ERROR', context);
    this.name = 'NetworkError';
  }
}
```

#### 2.2 实现错误重试机制
**文件**: `src/shared/error-retry.ts`

```typescript
export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoff: 'linear' | 'exponential';
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 检查是否应该重试
      if (options.shouldRetry && !options.shouldRetry(lastError)) {
        throw lastError;
      }

      // 最后一次尝试，不再等待
      if (attempt === options.maxAttempts) {
        break;
      }

      // 计算延迟
      const delay = options.backoff === 'exponential'
        ? options.delayMs * Math.pow(2, attempt - 1)
        : options.delayMs * attempt;

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
```

#### 2.3 添加错误恢复策略

在 `fetchRouteWithFallback` 中集成错误处理：

```typescript
try {
  const route = await withRetry(
    () => fetchTokenRouteState(publicClient, tokenAddress, platform),
    {
      maxAttempts: 3,
      delayMs: 1000,
      backoff: 'exponential',
      shouldRetry: (error) => {
        // 只重试网络错误
        return error instanceof NetworkError;
      }
    }
  );
  return route;
} catch (error) {
  if (error instanceof ServiceWorkerError) {
    // Service Worker 错误，使用默认路由
    return getDefaultRoute(platform);
  }
  throw error;
}
```

### 实施步骤
1. 创建错误类型定义
2. 实现重试机制
3. 重构现有错误处理代码
4. 添加错误日志
5. 编写测试用例

### 验收标准
- [ ] 所有错误使用自定义类型
- [ ] 关键操作支持重试
- [ ] 错误信息包含足够的上下文
- [ ] 测试覆盖率 > 80%

---

## 任务 3: 优化缓存机制

### 目标
实现更高效的缓存策略，提升性能和内存使用效率。

### 当前问题
- 使用简单的 Map 存储
- 手动清理策略（MAX_ROUTE_CACHE_SIZE = 50）
- 缺少缓存性能监控
- 没有缓存预热机制

### 具体任务

#### 3.1 实现 LRU 缓存
**文件**: `src/shared/lru-cache.ts`

```typescript
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移到最前面（最近使用）
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 如果已存在，先删除
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 添加到最前面
    this.cache.set(key, value);

    // 如果超过大小限制，删除最旧的
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
```

#### 3.2 添加缓存性能监控

```typescript
export class CacheMonitor {
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  recordHit(): void {
    this.hits++;
  }

  recordMiss(): void {
    this.misses++;
  }

  recordEviction(): void {
    this.evictions++;
  }

  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: hitRate.toFixed(2),
      total
    };
  }

  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}
```

#### 3.3 实现缓存预热

```typescript
export async function warmupCache(
  publicClient: any,
  tokenAddresses: string[]
): Promise<void> {
  const promises = tokenAddresses.map(async (address) => {
    try {
      const platform = detectTokenPlatform(address);
      await fetchRouteWithFallback(publicClient, address as Address, platform);
    } catch (error) {
      logger.warn(`缓存预热失败: ${address}`, error);
    }
  });

  await Promise.allSettled(promises);
}
```

### 实施步骤
1. 实现 LRU 缓存类
2. 添加缓存监控
3. 实现缓存预热
4. 重构 token-route.ts 使用新缓存
5. 添加测试用例

### 验收标准
- [ ] LRU 缓存正常工作
- [ ] 缓存命中率 > 70%
- [ ] 缓存预热功能可用
- [ ] 测试覆盖率 > 80%

---

## 任务 4: 重构路由查询逻辑

### 目标
将 token-route.ts 拆分为多个模块，提高代码可维护性。

### 当前问题
- token-route.ts 有 1,492 行
- 包含 4 个平台的路由逻辑
- 函数职责不够单一
- 难以测试和维护

### 具体任务

#### 4.1 模块拆分方案

```
src/routing/
├── index.ts                    # 导出所有公共 API
├── core/
│   ├── route-fetcher.ts       # 核心路由查询逻辑
│   ├── platform-detector.ts   # 平台检测
│   ├── fallback-handler.ts    # Fallback 处理
│   └── cache-manager.ts       # 缓存管理
├── platforms/
│   ├── four-route.ts          # Four.meme 路由
│   ├── flap-route.ts          # Flap 路由
│   ├── luna-route.ts          # Luna 路由
│   ├── xmode-route.ts         # XMode 路由
│   └── pancake-route.ts       # PancakeSwap 路由
├── liquidity/
│   ├── pair-checker.ts        # V2 流动性检查
│   └── pool-checker.ts        # V3 流动性检查
└── utils/
    ├── address-utils.ts       # 地址工具函数
    ├── validation.ts          # 验证函数
    └── constants.ts           # 常量定义
```

#### 4.2 接口设计

```typescript
// src/routing/core/types.ts
export interface PlatformRouter {
  platform: TokenPlatform;
  canHandle(tokenAddress: string): boolean;
  fetchRoute(publicClient: any, tokenAddress: Address): Promise<RouteFetchResult>;
}

// src/routing/platforms/four-route.ts
export class FourRouter implements PlatformRouter {
  platform: TokenPlatform = 'four';

  canHandle(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase().endsWith('ffff');
  }

  async fetchRoute(publicClient: any, tokenAddress: Address): Promise<RouteFetchResult> {
    // Four.meme 路由逻辑
  }
}
```

#### 4.3 重构步骤

**阶段 1: 准备工作**
1. 创建新的目录结构
2. 定义接口和类型
3. 编写测试框架

**阶段 2: 逐步迁移**
1. 迁移工具函数到 utils/
2. 迁移平台检测逻辑
3. 迁移 Four.meme 路由（最复杂）
4. 迁移其他平台路由
5. 迁移流动性检查
6. 迁移核心路由逻辑

**阶段 3: 清理和优化**
1. 删除旧代码
2. 更新导入路径
3. 优化性能
4. 完善文档

### 实施步骤
1. 创建新目录结构
2. 定义接口
3. 逐步迁移代码
4. 更新测试
5. 删除旧代码

### 验收标准
- [ ] 所有模块文件 < 300 行
- [ ] 每个平台独立模块
- [ ] 测试覆盖率保持 > 60%
- [ ] 所有测试通过

---

## 任务 5: 性能优化

### 目标
减少链上查询次数，提升响应速度。

### 当前问题
- 存在重复的链上查询
- 缺少请求批处理
- 没有性能监控

### 具体任务

#### 5.1 实现请求批处理

```typescript
export class BatchRequestManager {
  private pending: Map<string, Promise<any>>;

  constructor() {
    this.pending = new Map();
  }

  async batchRead(
    publicClient: any,
    requests: Array<{
      address: Address;
      abi: any;
      functionName: string;
      args?: any[];
    }>
  ): Promise<any[]> {
    // 使用 multicall 批量查询
    return await publicClient.multicall({
      contracts: requests.map(req => ({
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args
      }))
    });
  }

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 去重相同的请求
    if (this.pending.has(key)) {
      return this.pending.get(key) as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }
}
```

#### 5.2 优化流动性检查

当前问题：
- 每次都查询 token0/token1
- 可以缓存配对信息

优化方案：
```typescript
const pairInfoCache = new LRUCache<string, {
  token0: string;
  token1: string;
}>(100);

async function checkPairLiquidityOptimized(
  publicClient: any,
  pairAddress: string,
  tokenAddress: string,
  quoteToken: string
): Promise<boolean> {
  // 使用 multicall 一次性查询所有信息
  const [reserves, token0, token1] = await publicClient.multicall({
    contracts: [
      {
        address: pairAddress,
        abi: PAIR_ABI,
        functionName: 'getReserves'
      },
      {
        address: pairAddress,
        abi: PAIR_ABI,
        functionName: 'token0'
      },
      {
        address: pairAddress,
        abi: PAIR_ABI,
        functionName: 'token1'
      }
    ]
  });

  // 处理结果...
}
```

#### 5.3 添加性能监控

```typescript
export class PerformanceMonitor {
  private metrics: Map<string, number[]>;

  constructor() {
    this.metrics = new Map();
  }

  async measure<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.record(name, duration);
    }
  }

  private record(name: string, duration: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(duration);
  }

  getStats(name: string) {
    const durations = this.metrics.get(name) || [];
    if (durations.length === 0) {
      return null;
    }

    const sorted = [...durations].sort((a, b) => a - b);
    return {
      count: durations.length,
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }
}
```

### 实施步骤
1. 实现请求批处理
2. 优化流动性检查
3. 添加性能监控
4. 分析性能瓶颈
5. 持续优化

### 验收标准
- [ ] 链上查询次数减少 30%
- [ ] 平均响应时间减少 20%
- [ ] 性能监控数据可用
- [ ] 测试覆盖率 > 70%

---

## 实施计划

### 第 1 周: 完善文档
- Day 1-2: API 文档
- Day 3-4: 开发者指南
- Day 5: 故障排查手册

### 第 2 周: 改进错误处理
- Day 1-2: 创建错误类型
- Day 3-4: 实现重试机制
- Day 5: 重构现有代码

### 第 3 周: 优化缓存机制
- Day 1-2: 实现 LRU 缓存
- Day 3: 添加监控
- Day 4-5: 集成和测试

### 第 4-5 周: 重构路由查询逻辑
- Week 4: 准备和迁移工具函数
- Week 5: 迁移平台路由

### 第 6 周: 性能优化
- Day 1-3: 实现批处理
- Day 4-5: 优化和监控

---

## 风险评估

### 高风险任务
- **重构路由查询逻辑**: 可能引入 bug，需要充分测试

### 中风险任务
- **改进错误处理**: 需要修改大量现有代码
- **优化缓存机制**: 可能影响现有行为

### 低风险任务
- **完善文档**: 不影响代码
- **性能优化**: 可以逐步实施

---

## 成功指标

### 代码质量
- [ ] 单文件代码行数 < 500
- [ ] 测试覆盖率 > 70%
- [ ] 所有测试通过

### 性能指标
- [ ] 缓存命中率 > 70%
- [ ] 平均响应时间减少 20%
- [ ] 链上查询次数减少 30%

### 文档完整性
- [ ] API 文档完整
- [ ] 开发者指南清晰
- [ ] 故障排查手册实用

---

## 总结

本重构计划采用渐进式方法，从低风险的文档完善开始，逐步推进到高风险的代码重构。每个任务都有明确的目标、实施步骤和验收标准，确保重构工作有序进行。

**关键原则**:
1. 测试先行，确保不引入 bug
2. 渐进式重构，避免大规模改动
3. 持续监控，及时发现问题
4. 文档同步，保持知识传承
