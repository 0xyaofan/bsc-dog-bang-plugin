# 缓存管理器迁移指南

## 概述

本文档说明如何将现有的 `Map` 缓存迁移到新的 `CacheManager`。

## 现有缓存实现

当前项目中有以下缓存：

```typescript
// src/background/index.ts
const tokenMetadataCache = new Map<string, TokenMetadata>();
const tokenInfoCache = new Map<string, TokenInfoCacheEntry>();
const tokenRouteCache = new Map<string, TokenRouteCacheEntry>();
```

这些缓存已经实现了：
- ✅ TTL（过期时间）
- ✅ 缓存作用域（通过 getCacheScope()）
- ✅ 版本控制（通过 cacheKeyVersions）

## 新的 CacheManager 优势

新的 `CacheManager` 提供：
- ✅ 统一的接口
- ✅ 自动清理过期缓存
- ✅ LRU 支持
- ✅ 缓存统计（命中率、未命中率）
- ✅ 类型安全
- ✅ 更好的可测试性

## 迁移方案

### 方案 1：渐进式迁移（推荐）

**优点**：风险低，可以逐步验证
**缺点**：需要维护两套代码一段时间

#### 步骤 1：为新功能使用 CacheManager

```typescript
import { CacheManager } from '../shared/cache-manager.js';

// 新的缓存使用 CacheManager
const newFeatureCache = new CacheManager<FeatureData>({
  ttl: 60000,
  scope: 'new-feature',
  maxSize: 100,
  cleanupInterval: 300000 // 5分钟清理一次
});

// 使用
newFeatureCache.set('key', data);
const data = newFeatureCache.get('key');
```

#### 步骤 2：逐步迁移现有缓存

选择一个低风险的缓存（如 tokenMetadataCache）进行迁移：

```typescript
// 旧代码
const tokenMetadataCache = new Map<string, TokenMetadata>();

// 新代码
const tokenMetadataCache = new CacheManager<TokenMetadata>({
  ttl: TOKEN_INFO_CACHE_TTL,
  scope: 'token-metadata',
  cleanupInterval: 300000
});

// 迁移使用方式
// 旧: tokenMetadataCache.set(key, value)
// 新: tokenMetadataCache.set(key, value) // 接口相同

// 旧: tokenMetadataCache.get(key)
// 新: tokenMetadataCache.get(key) // 接口相同

// 旧: tokenMetadataCache.has(key)
// 新: tokenMetadataCache.has(key) // 接口相同

// 旧: tokenMetadataCache.delete(key)
// 新: tokenMetadataCache.delete(key) // 接口相同
```

#### 步骤 3：验证和测试

- 测试缓存命中率
- 测试过期逻辑
- 测试内存使用
- 对比性能

#### 步骤 4：迁移其他缓存

成功验证后，迁移 `tokenInfoCache` 和 `tokenRouteCache`。

### 方案 2：保持现状（当前推荐）

**理由**：
1. 现有缓存实现已经很稳定
2. 已经有 TTL、作用域、版本控制
3. 针对业务场景优化
4. 迁移风险 > 收益

**建议**：
- 保持现有缓存实现
- 为新功能使用 `CacheManager`
- 在代码审查时逐步优化现有缓存

## 使用示例

### 基本用法

```typescript
import { CacheManager } from '../shared/cache-manager.js';

// 创建缓存实例
const cache = new CacheManager<TokenInfo>({
  ttl: 60000,        // 60秒过期
  scope: 'token-info',
  maxSize: 100,      // 最多100条
  cleanupInterval: 300000  // 5分钟清理一次
});

// 设置缓存
cache.set('0x123...', tokenInfo);

// 获取缓存
const info = cache.get('0x123...');
if (info) {
  console.log('缓存命中');
}

// 检查是否存在
if (cache.has('0x123...')) {
  // ...
}

// 删除缓存
cache.delete('0x123...');

// 清空所有缓存
cache.clear();

// 获取统计信息
const stats = cache.getStats();
console.log(`命中率: ${(stats.hitRate * 100).toFixed(2)}%`);
```

### 高级用法

```typescript
// 自定义 TTL
cache.set('key', data, 120000); // 2分钟过期

// 手动清理过期缓存
const cleaned = cache.cleanup();
console.log(`清理了 ${cleaned} 个过期缓存`);

// 获取所有键
const keys = cache.keys();

// 获取所有值
const values = cache.values();

// 获取所有条目
const entries = cache.entries();

// 销毁缓存（停止自动清理）
cache.destroy();
```

### 工厂模式

```typescript
import { createCacheFactory } from '../shared/cache-manager.js';

// 创建工厂
const createCache = createCacheFactory({
  ttl: 60000,
  cleanupInterval: 300000
});

// 创建多个缓存实例
const tokenCache = createCache<TokenInfo>({ scope: 'token-info' });
const routeCache = createCache<RouteInfo>({ scope: 'route-info' });
const balanceCache = createCache<string>({ scope: 'balance', ttl: 30000 });
```

## 性能对比

### Map vs CacheManager

| 特性 | Map | CacheManager |
|------|-----|--------------|
| 基本操作 | O(1) | O(1) |
| 内存占用 | 低 | 稍高（额外元数据） |
| TTL 支持 | 需手动实现 | 内置 |
| LRU 支持 | 需手动实现 | 内置 |
| 统计信息 | 需手动实现 | 内置 |
| 自动清理 | 需手动实现 | 内置 |

### 建议

- **高频访问、简单场景**：使用 `Map`
- **需要 TTL、LRU、统计**：使用 `CacheManager`
- **新功能**：优先使用 `CacheManager`

## 总结

1. **现有缓存**：保持不变，已经很稳定
2. **新功能**：使用 `CacheManager`
3. **未来优化**：逐步迁移低风险的缓存
4. **性能监控**：使用 `getStats()` 监控缓存效率

## 相关文件

- `src/shared/cache-manager.ts` - 缓存管理器实现
- `src/background/index.ts` - 现有缓存使用
- `src/shared/frontend-adapter.ts` - 前端适配层缓存
