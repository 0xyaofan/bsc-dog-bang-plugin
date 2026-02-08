# 路由系统重构方案

## 目标

1. **隔离平台逻辑**：每个平台独立处理，互不影响
2. **统一缓存管理**：单一缓存源，避免不一致
3. **改进错误处理**：错误不应该影响其他平台
4. **提高可测试性**：每个模块可以独立测试

## 架构设计

### 1. 平台路由器（Platform Router）

```typescript
// src/shared/routing/platform-router.ts

interface PlatformHandler {
  detect(tokenAddress: string): boolean;
  fetchRoute(publicClient: any, tokenAddress: string): Promise<RouteFetchResult>;
  shouldFallback(route: RouteFetchResult): boolean;
}

class FourMemeHandler implements PlatformHandler {
  detect(tokenAddress: string): boolean {
    const normalized = tokenAddress.toLowerCase();
    return normalized.endsWith('ffff') || normalized.endsWith('4444');
  }

  async fetchRoute(publicClient: any, tokenAddress: string): Promise<RouteFetchResult> {
    // Four.meme 特定逻辑
    // 不依赖全局状态
    // 不影响其他平台
  }

  shouldFallback(route: RouteFetchResult): boolean {
    return route.preferredChannel === 'pancake' && !route.readyForPancake;
  }
}

class PlatformRouter {
  private handlers: PlatformHandler[] = [
    new FourMemeHandler(),
    new FlapHandler(),
    new LunaHandler(),
    new UnknownHandler()
  ];

  async route(publicClient: any, tokenAddress: string): Promise<RouteFetchResult> {
    for (const handler of this.handlers) {
      if (handler.detect(tokenAddress)) {
        try {
          const route = await handler.fetchRoute(publicClient, tokenAddress);
          if (!handler.shouldFallback(route)) {
            return route;
          }
        } catch (error) {
          // 错误只影响当前平台，不传播
          logger.warn(`[PlatformRouter] ${handler.constructor.name} 失败:`, error);
        }
      }
    }

    // 所有平台都失败，返回默认路由
    return this.getDefaultRoute();
  }
}
```

### 2. 统一缓存管理器（Unified Cache Manager）

```typescript
// src/shared/routing/cache-manager.ts

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // 毫秒
}

class CacheManager {
  private caches = new Map<string, Map<string, CacheEntry<any>>>();

  set<T>(namespace: string, key: string, value: T, ttl: number): void {
    if (!this.caches.has(namespace)) {
      this.caches.set(namespace, new Map());
    }

    const cache = this.caches.get(namespace)!;
    cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl
    });
  }

  get<T>(namespace: string, key: string): T | null {
    const cache = this.caches.get(namespace);
    if (!cache) return null;

    const entry = cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  invalidate(namespace: string, key?: string): void {
    if (key) {
      this.caches.get(namespace)?.delete(key);
    } else {
      this.caches.delete(namespace);
    }
  }

  // 定期清理过期缓存
  cleanup(): void {
    const now = Date.now();
    for (const [namespace, cache] of this.caches.entries()) {
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          cache.delete(key);
        }
      }
    }
  }
}

// 全局单例
export const cacheManager = new CacheManager();

// 定期清理（每5分钟）
setInterval(() => cacheManager.cleanup(), 5 * 60 * 1000);
```

### 3. 错误处理策略（Error Handling Strategy）

```typescript
// src/shared/routing/error-handler.ts

class ServiceWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceWorkerError';
  }
}

class RouteQueryError extends Error {
  constructor(
    message: string,
    public platform: string,
    public tokenAddress: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'RouteQueryError';
  }
}

function handleRouteError(error: Error, context: {
  platform: string;
  tokenAddress: string;
}): RouteFetchResult | null {
  // Service Worker 错误：返回保守的默认状态
  if (error.message.includes('import() is disallowed on ServiceWorkerGlobalScope')) {
    logger.warn('[RouteError] Service Worker 限制', context);

    // 上报错误（用于监控）
    reportError(new ServiceWorkerError(error.message), context);

    // 返回保守的默认状态
    return {
      platform: context.platform as TokenPlatform,
      preferredChannel: context.platform === 'unknown' ? 'pancake' : context.platform as any,
      readyForPancake: false, // 保守假设：未迁移
      progress: 0,
      migrating: false,
      metadata: {},
      notes: 'Service Worker 限制，假设未迁移'
    };
  }

  // 其他错误：记录并返回 null（让上层决定如何处理）
  logger.error('[RouteError] 查询失败', context, error);
  reportError(new RouteQueryError(error.message, context.platform, context.tokenAddress, error), context);

  return null;
}
```

### 4. 配置管理（Configuration Management）

```typescript
// src/shared/routing/config.ts

interface RoutingConfig {
  // 缓存TTL配置
  cache: {
    migratedRoute: number;      // 已迁移路由：永久（0表示永久）
    unmigratedRoute: number;    // 未迁移路由：1小时
    pancakePair: number;        // Pancake配对：24小时
    tradePath: number;          // 交易路径：1.2秒
  };

  // 特殊配对映射
  specialPairs: Record<string, {
    pairAddress: string;
    quoteToken: string;
    version: 'v2' | 'v3';
    reason: string; // 为什么需要特殊处理
  }>;

  // 流动性阈值
  minLiquidity: Record<string, bigint>;

  // 平台优先级
  platformPriority: TokenPlatform[];
}

export const routingConfig: RoutingConfig = {
  cache: {
    migratedRoute: 0,                    // 永久
    unmigratedRoute: 60 * 60 * 1000,     // 1小时
    pancakePair: 24 * 60 * 60 * 1000,    // 24小时
    tradePath: 1200                      // 1.2秒
  },

  specialPairs: {
    '0x3753dd32cbc376ce6efd85f334b7289ae6d004af': {
      pairAddress: '0x14C90904dD8868c8E748e42D092250Ec17f748d1',
      quoteToken: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828',
      version: 'v2',
      reason: 'Service Worker 限制，无法动态查询'
    }
  },

  minLiquidity: {
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': parseEther('0.1'),  // WBNB
    '0x55d398326f99059ff775485246999027b3197955': parseEther('100'),   // USDT
    // ... 其他代币
  },

  platformPriority: ['four', 'xmode', 'flap', 'luna', 'unknown']
};
```

### 5. 测试框架（Testing Framework）

```typescript
// tests/routing/platform-handlers.test.ts

describe('FourMemeHandler', () => {
  let handler: FourMemeHandler;
  let mockPublicClient: any;

  beforeEach(() => {
    handler = new FourMemeHandler();
    mockPublicClient = createMockPublicClient();
  });

  describe('detect', () => {
    it('应该识别以 ffff 结尾的地址', () => {
      expect(handler.detect('0x1234...ffff')).toBe(true);
    });

    it('应该识别以 4444 结尾的地址', () => {
      expect(handler.detect('0x1234...4444')).toBe(true);
    });

    it('不应该识别其他地址', () => {
      expect(handler.detect('0x1234...5678')).toBe(false);
    });
  });

  describe('fetchRoute', () => {
    it('未迁移代币应该返回 Four.meme 路由', async () => {
      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        // ... 其他字段
      });

      const route = await handler.fetchRoute(mockPublicClient, '0x1234...ffff');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
    });

    it('已迁移代币应该返回 Pancake 路由', async () => {
      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: true,
        // ... 其他字段
      });

      const route = await handler.fetchRoute(mockPublicClient, '0x1234...ffff');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });

    it('Service Worker 错误应该返回默认状态', async () => {
      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await handler.fetchRoute(mockPublicClient, '0x1234...ffff');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
      expect(route.notes).toContain('Service Worker');
    });
  });
});

// 集成测试
describe('PlatformRouter Integration', () => {
  it('Four.meme 代币不应该影响 Flap 代币', async () => {
    const router = new PlatformRouter();

    // 测试 Four.meme 代币
    const fourRoute = await router.route(mockPublicClient, '0x1234...ffff');
    expect(fourRoute.platform).toBe('four');

    // 测试 Flap 代币（不应该受影响）
    const flapRoute = await router.route(mockPublicClient, '0x5678...7777');
    expect(flapRoute.platform).toBe('flap');
  });
});
```

## 迁移计划

### 阶段 1：准备工作（1-2天）

1. **创建新的目录结构**
```
src/shared/routing/
├── platform-router.ts       # 平台路由器
├── cache-manager.ts         # 统一缓存管理
├── error-handler.ts         # 错误处理
├── config.ts                # 配置管理
├── handlers/
│   ├── four-meme-handler.ts
│   ├── flap-handler.ts
│   ├── luna-handler.ts
│   └── unknown-handler.ts
└── types.ts                 # 类型定义
```

2. **编写测试用例**
   - 为每个 handler 编写单元测试
   - 编写集成测试
   - 确保测试覆盖率 > 80%

### 阶段 2：实现新架构（3-5天）

1. **实现 CacheManager**
   - 统一所有缓存
   - 添加 TTL 支持
   - 添加自动清理

2. **实现 PlatformRouter**
   - 实现平台检测
   - 实现路由查询
   - 实现 fallback 逻辑

3. **实现各个 Handler**
   - FourMemeHandler
   - FlapHandler
   - LunaHandler
   - UnknownHandler

4. **实现错误处理**
   - ServiceWorkerError
   - RouteQueryError
   - 错误上报机制

### 阶段 3：渐进式迁移（2-3天）

1. **保留旧代码，添加新代码**
   - 新旧代码并存
   - 通过配置开关切换

2. **A/B 测试**
   - 10% 流量使用新架构
   - 监控错误率和性能
   - 逐步增加到 100%

3. **清理旧代码**
   - 删除 token-route.ts 中的旧逻辑
   - 更新所有调用点
   - 更新文档

### 阶段 4：监控和优化（持续）

1. **添加监控指标**
   - 路由查询成功率
   - 缓存命中率
   - 平台分布
   - 错误类型分布

2. **性能优化**
   - 减少 RPC 调用
   - 优化缓存策略
   - 并行查询

## 预期收益

### 1. 隔离性
- ✅ 每个平台独立处理
- ✅ 修改 Four.meme 不影响 Flap
- ✅ 错误不会传播到其他平台

### 2. 可维护性
- ✅ 代码结构清晰
- ✅ 职责明确
- ✅ 易于添加新平台

### 3. 可测试性
- ✅ 每个模块可以独立测试
- ✅ 测试覆盖率高
- ✅ 易于发现问题

### 4. 性能
- ✅ 统一缓存管理
- ✅ 减少重复查询
- ✅ 更好的缓存策略

### 5. 可观测性
- ✅ 详细的日志
- ✅ 错误上报
- ✅ 监控指标

## 风险和缓解

### 风险 1：迁移过程中引入新 bug
**缓解**：
- 保留旧代码，通过开关切换
- A/B 测试，逐步放量
- 完善的测试用例

### 风险 2：性能下降
**缓解**：
- 性能测试
- 监控关键指标
- 优化热点路径

### 风险 3：用户体验受影响
**缓解**：
- 灰度发布
- 快速回滚机制
- 用户反馈渠道

---

**创建日期**：2026-02-08
**状态**：📋 待实施
**优先级**：高
**预计工期**：1-2周
